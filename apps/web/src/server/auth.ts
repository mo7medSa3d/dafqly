import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hash as argon2Hash, verify as argon2Verify, argon2id } from "argon2";
import { ownerDb } from "./db";
import { env } from "./env";
import { sendVerificationEmailLink } from "./email";
import * as schema from "@tahseel/db/schema";

/**
 * H5: email verification is OFF by default (EMAIL_VERIFICATION_ENABLED=1
 * turns it on). It must stay off until a real SMTP sender is configured:
 * with the flag on and no sender, sign-up fails loudly with
 * EMAIL_NOT_CONFIGURED (email.ts) instead of silently never verifying.
 * Read straight from process.env (not the cached env()) so tests can flip
 * it per case.
 */
export function emailVerificationEnabled(): boolean {
  return process.env.EMAIL_VERIFICATION_ENABLED === "1";
}

/**
 * Email + password auth (BUILD_PLAN §3): argon2id password hashing (plugged
 * into Better Auth's password hooks), secure session cookies from the
 * library. The adapter uses the OWNER connection (ADR-008) because account
 * lookup by email is inherently cross-tenant; tenant data never flows
 * through this connection.
 *
 * Lazy construction: building the config at module import time calls env()
 * and opens the owner DB pool, which makes any module importing auth
 * (routers, tRPC context) un-importable without a full environment —
 * including the route-classification tests, which need no DB at all. The
 * Proxy builds the real instance on first property access and keeps the
 * same public shape (`auth.api.*`, `auth.handler`, `auth.$Infer.Session`).
 */
function buildAuth() {
  return betterAuth({
    appName: "DAFQLY",
    secret: process.env.BETTER_AUTH_SECRET ?? env().SESSION_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? env().APP_URL,
    database: drizzleAdapter(ownerDb(), {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    // L6: cross-origin auth is allowlisted explicitly. APP_URL is always
    // trusted; TRUSTED_ORIGINS adds more (comma-separated) when the app is
    // served behind another origin. Empty = same-origin only.
    trustedOrigins: [
      env().APP_URL,
      ...env().TRUSTED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    ].filter((o, i, all) => all.indexOf(o) === i),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // H5: when verification is enabled, sign-in is refused until the
      // email is verified (and sign-up sends the verification email).
      requireEmailVerification: emailVerificationEnabled(),
      password: {
        hash: (password: string) => argon2Hash(password, { type: argon2id }),
        verify: (data: { hash: string; password: string }) => argon2Verify(data.hash, data.password),
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmailLink({ to: user.email, url });
      },
      sendOnSignUp: emailVerificationEnabled(),
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60, // 1 hour
    },
    session: {
      // L5: 7-day sessions (was 30), 24h refresh age, 60s cookie cache
      // (was 5 min — a revoked session must stop working promptly).
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24, // Refresh token age after 24h of active use
      cookieCache: {
        enabled: true,
        maxAge: 60, // 60 seconds fast cookie cache to prevent DB session roundtrips
      },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: {
        // L5: strict — every auth flow in the app is same-origin (the
        // Paymob redirect-back lands on the unauthenticated /s/<token>
        // page, which needs no session cookie), so lax buys nothing here.
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    // Better Auth ships its own sign-in rate limiter (observed in testing:
    // 429 after 3 attempts/10s, non-uniform body). It is disabled so the
    // app's single limiter (src/server/rate-limit.ts, applied in the auth
    // route) governs auth POSTs with the uniform API error shape (ADR-011).
    rateLimit: { enabled: false },
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

const globalForAuth = globalThis as unknown as {
  auth?: AuthInstance;
};

function getAuth(): AuthInstance {
  let instance = globalForAuth.auth;
  if (!instance) {
    instance = buildAuth();
    globalForAuth.auth = instance;
  }
  return instance;
}

export const auth = new Proxy({} as AuthInstance, {
  get(_target, prop) {
    return Reflect.get(getAuth(), prop);
  },
});
export type Session = AuthInstance["$Infer"]["Session"];
