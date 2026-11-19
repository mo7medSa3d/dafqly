import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

const intlMiddleware = createMiddleware(routing);
const REQUEST_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

function resolveRequestId(req: NextRequest): string {
  const incoming = req.headers.get("x-request-id")?.trim();
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
}

function withSecurityHeaders(res: NextResponse, requestId: string): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("x-request-id", requestId);
  return res;
}

function setLocaleCookie(res: NextResponse, locale: "ar" | "en"): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  res.cookies.set("NEXT_LOCALE", locale, {
    path: "/",
    maxAge: 31536000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

function normalizePathname(path: string): string {
  return path.replace(/^\/+/, "/") || "/";
}

export default function middleware(req: NextRequest) {
  const requestId = resolveRequestId(req);
  // Propagate validated/minted correlation ID to downstream handlers and next-intl.
  req.headers.set("x-request-id", requestId);

  const { pathname, searchParams } = req.nextUrl;

  // 1. Cleanly redirect /arabic or /english path aliases to canonical /ar or /en (preserving query params)
  if (pathname === "/arabic" || pathname.startsWith("/arabic/")) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.pathname = normalizePathname(pathname.replace(/^\/arabic/, "/ar"));
    return withSecurityHeaders(setLocaleCookie(NextResponse.redirect(cleanUrl), "ar"), requestId);
  }
  if (pathname === "/english" || pathname.startsWith("/english/")) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.pathname = normalizePathname(pathname.replace(/^\/english/, "/en"));
    return withSecurityHeaders(setLocaleCookie(NextResponse.redirect(cleanUrl), "en"), requestId);
  }

  // 2. Strip ?locale= / ?lang= query params while saving preference and updating locale prefix
  if (searchParams.has("locale") || searchParams.has("lang")) {
    const l = (searchParams.get("locale") || searchParams.get("lang") || "").toLowerCase();
    const target = l === "en" || l === "english" ? "en" : l === "ar" || l === "arabic" ? "ar" : null;
    if (target) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete("locale");
      cleanUrl.searchParams.delete("lang");
      const normalized = normalizePathname(cleanUrl.pathname);
      cleanUrl.pathname = /^\/(ar|en)(\/|$)/.test(normalized)
        ? normalized.replace(/^\/(ar|en)(?=\/|$)/, `/${target}`)
        : normalized;
      return withSecurityHeaders(setLocaleCookie(NextResponse.redirect(cleanUrl), target), requestId);
    }
  }

  return withSecurityHeaders(intlMiddleware(req), requestId);
}

export const config = {
  // Skip API routes, health probes, the public statement pages (/s/...) and static files.
  matcher: ["/((?!api|healthz|readyz|s/|_next|.*\\..*).*)"],
};
