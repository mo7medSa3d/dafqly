import { initTRPC, TRPCError } from "@trpc/server";
import { AppError } from "@tahseel/core";
import { z } from "zod";
import { auth } from "./auth";
import { appDb, ownerDb } from "./db";
import { listTenantsForUser } from "./services";

export interface TrpcContext {
  user: { id: string; email: string; name: string } | null;
  appDb: ReturnType<typeof appDb>;
  ownerDb: ReturnType<typeof ownerDb>;
}

export async function createTrpcContext(headers: Headers): Promise<TrpcContext> {
  const session = await auth.api.getSession({ headers });
  return {
    user: session?.user ? { id: session.user.id, email: session.user.email, name: session.user.name } : null,
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
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Resolves the caller's tenant (M0: the user's first membership; multi-tenant switching is a later UX). */
export const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const mine = await listTenantsForUser(ctx.ownerDb, ctx.user.id);
  const first = mine[0];
  if (!first) throw new TRPCError({ code: "FORBIDDEN", message: "NO_TENANT: complete onboarding first" });
  return next({ ctx: { ...ctx, tenantId: first.tenantId, role: first.role } });
});
