import nodemailer from "nodemailer";
import { AppError } from "@tahseel/core";
import { env } from "./env";

/**
 * Outbound email (H5): the SMTP seam. SMTP_URL already existed in the env
 * schema (Mailpit locally) but nothing used it — this is the first sender.
 *
 * Fail-closed rule: in production SMTP_URL must be set explicitly. The
 * schema default (localhost:1025) is a dev Mailpit default, so a production
 * deploy that forgot to configure mail throws EMAIL_NOT_CONFIGURED instead
 * of silently dropping verification emails or sending them at localhost.
 */
function safeEnv() {
  try {
    return env();
  } catch {
    return null;
  }
}

export function resolveSmtpUrl(): string | undefined {
  const nodeEnv = process.env.NODE_ENV ?? safeEnv()?.NODE_ENV;
  const rawSmtp = process.env.SMTP_URL;
  if (rawSmtp !== undefined) {
    return rawSmtp || undefined;
  }
  if (nodeEnv === "production") return undefined;
  const e = safeEnv();
  return e?.SMTP_URL ?? "smtp://localhost:1025";
}

type Transporter = ReturnType<typeof nodemailer.createTransport>;
const transportPool = new Map<string, Transporter>();

function getPooledTransport(smtpUrl: string): Transporter {
  let transport = transportPool.get(smtpUrl);
  if (!transport) {
    transport = nodemailer.createTransport({
      url: smtpUrl,
      pool: true,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    } as unknown as Parameters<typeof nodemailer.createTransport>[0]);
    transportPool.set(smtpUrl, transport);
  }
  return transport;
}

function assertSafeEmailHeader(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed)) {
    throw new AppError("INVALID_EMAIL_HEADER", `Invalid email ${field}`, 400);
  }
  return trimmed;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(
  input: SendEmailInput,
  overrides: { smtpUrl?: string; from?: string } = {},
): Promise<void> {
  const smtpUrl = overrides.smtpUrl ?? resolveSmtpUrl();
  if (!smtpUrl) {
    throw new AppError("EMAIL_NOT_CONFIGURED", "SMTP is not configured: set SMTP_URL to send email", 500);
  }
  const isOverride = Boolean(overrides.smtpUrl);
  const transport = isOverride
    ? nodemailer.createTransport({
        url: smtpUrl,
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
      } as unknown as Parameters<typeof nodemailer.createTransport>[0])
    : getPooledTransport(smtpUrl);
  const from = assertSafeEmailHeader(overrides.from ?? safeEnv()?.EMAIL_FROM ?? "Dafqly <no-reply@localhost>", "from");
  const to = assertSafeEmailHeader(input.to, "to");
  const subject = assertSafeEmailHeader(input.subject, "subject");
  try {
    await transport.sendMail({
      from,
      to,
      subject,
      text: input.text,
      html: input.html,
    });
  } finally {
    if (isOverride) transport.close();
  }
}

/** The verification email Better Auth sends on sign-up / re-request. */
export async function sendVerificationEmailLink(
  input: {
    to: string;
    url: string;
  },
  overrides: { smtpUrl?: string; from?: string } = {},
): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new AppError("INVALID_VERIFICATION_URL", "Invalid verification URL", 400);
  }
  if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") || /[\r\n\0]/.test(input.url)) {
    throw new AppError("INVALID_VERIFICATION_URL", "Invalid verification URL", 400);
  }
  await sendEmail(
    {
      to: input.to,
      subject: "تحقق من بريدك الإلكتروني — DAFQLY",
      text: `مرحباً،\n\nللتحقق من بريدك الإلكتروني في DAFQLY افتح هذا الرابط (صالح لمدة ساعة):\n${input.url}\n\nإذا لم تطلب هذا الحساب فتجاهل هذه الرسالة.\n\n---\nHello,\n\nVerify your email for DAFQLY by opening this link (valid for one hour):\n${input.url}\n\nIf you did not request this account, ignore this message.`,
    },
    overrides,
  );
}
