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
export function resolveSmtpUrl(): string | undefined {
  if (process.env.SMTP_URL) return process.env.SMTP_URL;
  if (process.env.NODE_ENV === "production") return undefined;
  return "smtp://localhost:1025";
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
  const transport = nodemailer.createTransport(smtpUrl);
  try {
    await transport.sendMail({
      from: overrides.from ?? env().EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } finally {
    transport.close();
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
  await sendEmail(
    {
      to: input.to,
      subject: "تحقق من بريدك الإلكتروني — DAFQLY",
      text: `مرحباً،\n\nللتحقق من بريدك الإلكتروني في DAFQLY افتح هذا الرابط (صالح لمدة ساعة):\n${input.url}\n\nإذا لم تطلب هذا الحساب فتجاهل هذه الرسالة.\n\n---\nHello,\n\nVerify your email for DAFQLY by opening this link (valid for one hour):\n${input.url}\n\nIf you did not request this account, ignore this message.`,
    },
    overrides,
  );
}
