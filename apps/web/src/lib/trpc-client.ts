"use client";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/server/routers";

/** Browser tRPC client. Mutations that trigger sends (M2+) must pass an Idempotency-Key via a per-call client; read/write CRUD uses this shared one. */
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
