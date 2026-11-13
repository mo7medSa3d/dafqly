import { describe, it, expect } from "vitest";
import { createServer, type Socket, type AddressInfo } from "node:net";
import { sendEmail, sendVerificationEmailLink, resolveSmtpUrl } from "./email";

/**
 * H5: the SMTP seam is tested against a minimal in-process SMTP stub —
 * no Mailpit, no credentials, no network. The stub speaks just enough
 * SMTP (EHLO / MAIL FROM / RCPT TO / DATA / QUIT) to prove nodemailer
 * actually delivers a message with the right recipient and body.
 * Delivery to a REAL server is still BLOCKED (no SMTP credentials here).
 */
async function withStubSmtp(fn: (url: string, received: () => string) => Promise<void>) {
  let data = "";
  let state = "greeting";
  const server = createServer((socket: Socket) => {
    socket.write("220 stub-smtp ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (state === "data") {
          if (line === ".") {
            state = "done";
            socket.write("250 OK: queued\r\n");
          } else {
            data += `${line}\r\n`;
          }
          continue;
        }
        const cmd = line.split(" ")[0]?.toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") socket.write("250-stub\r\n250 8BITMIME\r\n");
        else if (cmd === "DATA") {
          state = "data";
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd === "QUIT") socket.write("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`smtp://127.0.0.1:${port}`, () => data);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Minimal quoted-printable decode (nodemailer QP-encodes the body, so the
 * `=` in `?token=abc123` arrives as `=3D`). */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

describe("email (H5 SMTP seam)", () => {
  it("delivers a verification email to the stub server with the URL in the body", async () => {
    await withStubSmtp(async (url, received) => {
      await sendVerificationEmailLink(
        { to: "user@example.test", url: "https://app.example.test/verify?token=abc123" },
        { smtpUrl: url, from: "Tahseel <no-reply@example.test>" },
      );
      const body = decodeQuotedPrintable(received());
      expect(body).toContain("user@example.test");
      expect(body).toContain("https://app.example.test/verify?token=abc123");
    });
  });

  it("resolveSmtpUrl: explicit URL wins; production without one is unconfigured", () => {
    // @types/node marks NODE_ENV/SMTP_URL read-only on ProcessEnv; mutate
    // through a plain record cast and restore afterwards.
    const envMut = process.env as Record<string, string | undefined>;
    const prevNodeEnv = envMut.NODE_ENV;
    const prevSmtp = envMut.SMTP_URL;
    try {
      envMut.SMTP_URL = "smtp://mail.example.test:587";
      expect(resolveSmtpUrl()).toBe("smtp://mail.example.test:587");
      delete envMut.SMTP_URL;
      envMut.NODE_ENV = "production";
      expect(resolveSmtpUrl()).toBeUndefined();
      envMut.NODE_ENV = "development";
      expect(resolveSmtpUrl()).toBe("smtp://localhost:1025");
    } finally {
      if (prevNodeEnv === undefined) delete envMut.NODE_ENV;
      else envMut.NODE_ENV = prevNodeEnv;
      if (prevSmtp === undefined) delete envMut.SMTP_URL;
      else envMut.SMTP_URL = prevSmtp;
    }
  });

  it("sendEmail fails closed (EMAIL_NOT_CONFIGURED) in production without SMTP_URL", async () => {
    const envMut = process.env as Record<string, string | undefined>;
    const prevNodeEnv = envMut.NODE_ENV;
    const prevSmtp = envMut.SMTP_URL;
    try {
      envMut.NODE_ENV = "production";
      delete envMut.SMTP_URL;
      await expect(
        sendEmail({ to: "a@example.test", subject: "x", text: "y" }),
      ).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    } finally {
      if (prevNodeEnv === undefined) delete envMut.NODE_ENV;
      else envMut.NODE_ENV = prevNodeEnv;
      if (prevSmtp === undefined) delete envMut.SMTP_URL;
      else envMut.SMTP_URL = prevSmtp;
    }
  });
});
