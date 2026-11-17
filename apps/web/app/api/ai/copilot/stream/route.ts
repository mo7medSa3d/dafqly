import { NextResponse } from "next/server";
import { AppError, toApiErrorBody } from "@tahseel/core";
import { auth } from "@/server/auth";
import { appDb, ownerDb } from "@/server/db";
import { listTenantsForUser, todayInTimezone } from "@/server/services";
import { askWorkspaceCopilot, copilotQueryInput, type CopilotStreamEvent } from "@/server/intelligence";
import { withAiTenantContext } from "@/server/ai-budget";
import { rateLimit } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Agent runs (several tool round-trips + streamed answer) can exceed the default.
export const maxDuration = 120;

const HEARTBEAT_MS = 15_000;
const MAX_BODY_BYTES = 65_536;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * SSE contract (one JSON object per `data:` line):
 *   status      {phase: reading_context|thinking|writing}
 *   tool_start  {id, toolName, titleAr, titleEn}
 *   tool_result {id, toolName, ok, summaryAr, summaryEn}
 *   token       {text}                 — the model's own words, as generated
 *   done        {response}             — final persisted answer + metadata
 *   error       {message}              — stable code, never provider internals
 * A `: ping` comment is sent every 15 s so proxies/CDNs do not drop an idle
 * connection while a slow tool or model step is running.
 */
export async function POST(request: Request): Promise<Response> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  let tenant: Awaited<ReturnType<typeof listTenantsForUser>>[number] | undefined;
  let parsedData: ReturnType<typeof copilotQueryInput.parse>;
  try {
    session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
    }
    // LLM calls cost real money: throttle per user, not just per IP.
    const limit = rateLimit(`copilot:stream:${session.user.id}`, { limit: 20, windowSeconds: 60 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    let raw: unknown;
    try {
      const rawBytes = await readRequestBodyLimited(request, MAX_BODY_BYTES);
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
    } catch (err) {
      if (err instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
      }
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
    }
    const parsed = copilotQueryInput.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE });
    }
    parsedData = parsed.data;

    const mine = await listTenantsForUser(ownerDb(), session.user.id);
    tenant = mine[0];
    if (!tenant) {
      return NextResponse.json({ error: "NO_TENANT" }, { status: 403, headers: NO_STORE });
    }
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }

  const encoder = new TextEncoder();
  // One controller aborts the provider request when the browser disconnects or
  // the user presses "stop" — otherwise the model keeps generating (and billing).
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; abort.abort(); }
      };
      const emit = (event: Record<string, unknown>) => write(`data: ${JSON.stringify(event)}\n\n`);
      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      // Flush headers immediately so the UI can switch to "working" right away.
      write("retry: 3000\n\n");
      try {
        const result = await withAiTenantContext(tenant.tenantId, () => askWorkspaceCopilot(
          appDb(), tenant.tenantId, session!.user.id, tenant.businessNameAr,
          todayInTimezone(tenant.timezone), parsedData,
          (event: CopilotStreamEvent) => emit(event),
          abort.signal,
        ));
        emit({
          type: "done",
          response: result,
          ...(result.aiFallbackReason === "global_budget_exceeded"
            ? { aiFallbackReason: result.aiFallbackReason, budgetExceeded: true }
            : {}),
        });
      } catch (error) {
        if (!abort.signal.aborted) {
          const message = error instanceof Error ? error.message : "AI request failed";
          console.error("[copilot] stream failed", { tenantId: tenant.tenantId, error: message.slice(0, 300) });
          const isBudgetExceeded =
            (error instanceof AppError && error.code === "AI_GLOBAL_BUDGET_EXCEEDED") ||
            message.includes("AI_GLOBAL_BUDGET_EXCEEDED") ||
            message.includes("monthly AI spending cap");
          emit({ type: "error", message: isBudgetExceeded ? "AI_GLOBAL_BUDGET_EXCEEDED" : "AI_REQUEST_FAILED" });
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
