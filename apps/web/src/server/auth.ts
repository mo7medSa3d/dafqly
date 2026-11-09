import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hash as argon2Hash, verify as argon2Verify, argon2id } from "argon2";
import { ownerDb } from "./db";
import { env } from "./env";
import * as schema from "@tahseel/db/schema";

/**
 * Email + password auth (BUILD_PLAN §3): argon2id password hashing (plugged
 * into Better Auth's password hooks), secure session cookies from the
 * library. The adapter uses the OWNER connection (ADR-008) because account
 * lookup by email is inherently cross-tenant; tenant data never flows
 * through this connection.
 */
export const auth = betterAuth({
  appName: "Tahseel",
  secret: process.env.BETTER_AUTH_SECRET ?? env().SESSION_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? env().APP_URL,
  database: drizzleAdapter(ownerDb(), {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    password: {
      hash: (password: string) => argon2Hash(password, { type: argon2id }),
      verify: (data: { hash: string; password: string }) => argon2Verify(data.hash, data.password),
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  // Better Auth ships its own sign-in rate limiter (observed in testing:
  // 429 after 3 attempts/10s, non-uniform body). It is disabled so the
  // app's single limiter (src/server/rate-limit.ts, applied in the auth
  // route) governs auth POSTs with the uniform API error shape (ADR-011).
  rateLimit: { enabled: false },
});
export type Session = typeof auth.$Infer.Session;
