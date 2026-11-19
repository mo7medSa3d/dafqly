import { AppError, toApiErrorBody } from "@tahseel/core";
import { auth, emailVerificationEnabled } from "@/server/auth";
import { appDb, ownerDb } from "@/server/db";
import { aiDeps } from "@/server/engine";
import { getFileBytes } from "@/server/files";
import { listTenantsForUser } from "@/server/services";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "File not found", 404)), { status: 404, headers: NO_STORE });
  }
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return Response.json(toApiErrorBody(new AppError("UNAUTHORIZED", "Sign in required", 401)), { status: 401, headers: NO_STORE });
  }
  if (emailVerificationEnabled() && !session.user.emailVerified) {
    return Response.json(toApiErrorBody(new AppError("FORBIDDEN", "EMAIL_NOT_VERIFIED: verify your email to access files", 403)), { status: 403, headers: NO_STORE });
  }
  const memberships = await listTenantsForUser(ownerDb(), session.user.id);
  const requestedTenant = req.headers.get("x-tenant-id") ?? cookieValue(req.headers.get("cookie"), "tahseel_tenant");
  const activeTenant = (requestedTenant ? memberships.find((m) => m.tenantId === requestedTenant) : undefined) ?? memberships[0];
  if (!activeTenant) {
    return Response.json(toApiErrorBody(new AppError("FORBIDDEN", "No active workspace", 403)), { status: 403, headers: NO_STORE });
  }
  try {
    const { file, bytes } = await getFileBytes(appDb(), aiDeps().storage, activeTenant.tenantId, id);
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }
}
