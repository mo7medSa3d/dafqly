import { initTRPC, TRPCError } from "@trpc/server";
import { AppError } from "@tahseel/core";
import { z } from "zod";
import { auth, emailVerificationEnabled } from "./auth";
import { appDb, ownerDb } from "./db";
import { listTenantsForUser } from "./services";
import { withAiTenantContext } from "./ai-budget";

export interface TrpcContext {
  user: { id: string; email: string; name: string; emailVerified: boolean } | null;
  headers: Headers;
  appDb: ReturnType<typeof appDb>;
  ownerDb: ReturnType<typeof ownerDb>;
}

export async function createTrpcContext(headers: Headers): Promise<TrpcContext> {
  const session = await auth.api.getSession({ headers });
  return {
    user: session?.user
      ? { id: session.user.id, email: session.user.email, name: session.user.name, emailVerified: session.user.emailVerified }
      : null,
    headers,
    appDb: appDb(),
    ownerDb: ownerDb(),
  };
}

const t = initTRPC.context<TrpcContext>().create({
  // Uniform API error shape on the wire: preserve shape.code as numeric JSON-RPC code
  // for @trpc/client deserialization, and provide semantic app error codes in data.
  errorFormatter({ shape, error }) {
    const appErr = error.cause instanceof AppError ? error.cause : undefined;
    const zodIssues = error.cause instanceof z.ZodError ? error.cause.issues : undefined;
    return {
      ...shape,
      message: appErr?.message ?? error.message,
      data: {
        ...shape.data,
        code: appErr?.code ?? shape.data?.code,
        appCode: appErr?.code,
        details: appErr?.details ?? zodIssues ?? { httpStatus: shape.data?.httpStatus, path: shape.data?.path },
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign-in required" });
  // H5: when email verification is enabled, an unverified account cannot
  // use any authenticated capability (including creating tenants and
  // sending reminders) until the email is verified. Off by default until
  // a real SMTP sender is configured — see auth.emailVerificationEnabled.
  // The gate lives here (not tenantProcedure) so tenant creation is
  // covered too; the verification flow itself runs on Better Auth's own
  // /api/auth endpoints, not on tRPC.
  if (emailVerificationEnabled() && !ctx.user.emailVerified) {
    throw new TRPCError({ code: "FORBIDDEN", message: "EMAIL_NOT_VERIFIED: verify your email to use the workspace" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Resolves the caller's tenant (M0: the user's first membership; multi-tenant switching is a later UX). */
export const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const mine = await listTenantsForUser(ctx.ownerDb, ctx.user.id);
  const first = mine[0];
  if (!first) throw new TRPCError({ code: "FORBIDDEN", message: "NO_TENANT: complete onboarding first" });
  return withAiTenantContext(first.tenantId, () => next({ ctx: { ...ctx, tenantId: first.tenantId, role: first.role } }));
});

/**
 * Owner-only tenant procedure. Money-moving and tenant-wide actions —
 * refunds, confirming claimed payments, plan changes, settings, dispute
 * resolution, full-data exports — must not be callable by staff members.
 * The role comes from the caller's membership row, never from the client.
 */
export const ownerProcedure = tenantProcedure.use(({ ctx, next }) => {
  if (ctx.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only workspace owners can perform this action" });
  }
  return next({ ctx });
});
