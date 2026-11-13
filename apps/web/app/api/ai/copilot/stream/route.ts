import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { appDb, ownerDb } from "@/server/db";
import { listTenantsForUser, todayInTimezone } from "@/server/services";
import { askWorkspaceCopilot, copilotQueryInput } from "@/server/intelligence";
import { withAiTenantContext } from "@/server/ai-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const raw = await request.json().catch(() => null);
  const parsed = copilotQueryInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) return NextResponse.json({ error: "NO_TENANT" }, { status: 403 });

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const result = await withAiTenantContext(tenant.tenantId, () => askWorkspaceCopilot(
          appDb(), tenant.tenantId, session.user.id, tenant.businessNameAr,
          todayInTimezone(tenant.timezone), parsed.data,
          (text) => emit({ type: "token", text }),
        ));
        emit({ type: "done", response: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI request failed";
        emit({ type: "error", message: message.includes("monthly AI spending cap")
          ? "GLOBAL_AI_BUDGET_EXCEEDED" : "AI_REQUEST_FAILED" });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      // The provider call has a bounded timeout; stop writing to a closed
      // response immediately, even when the upstream request is still draining.
      cancelled = true;
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
