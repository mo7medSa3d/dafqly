import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

const intlMiddleware = createMiddleware(routing);

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

function setLocaleCookie(res: NextResponse, locale: "ar" | "en"): NextResponse {
  res.cookies.set("NEXT_LOCALE", locale, {
    path: "/",
    maxAge: 31536000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

export default function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // 1. Cleanly redirect /arabic or /english path aliases to canonical /ar or /en (preserving query params)
  if (pathname === "/arabic" || pathname.startsWith("/arabic/")) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.pathname = pathname.replace(/^\/arabic/, "/ar") || "/ar";
    return withSecurityHeaders(setLocaleCookie(NextResponse.redirect(cleanUrl), "ar"));
  }
  if (pathname === "/english" || pathname.startsWith("/english/")) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.pathname = pathname.replace(/^\/english/, "/en") || "/en";
    return withSecurityHeaders(setLocaleCookie(NextResponse.redirect(cleanUrl), "en"));
  }

  // 2. Strip ?locale= / ?lang= query params while saving preference and updating locale prefix
  if (searchParams.has("locale") || searchParams.has("lang")) {
    const l = (searchParams.get("locale") || searchParams.get("lang") || "").toLowerCase();
    const target = l === "en" || l === "english" ? "en" : l === "ar" || l === "arabic" ? "ar" : null;
    if (target) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete("locale");
      cleanUrl.searchParams.delete("lang");
      if (/^\/(ar|en)(\/|$)/.test(cleanUrl.pathname)) {
        cleanUrl.pathname = cleanUrl.pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${target}`);
      }
      return withSecurityHeaders(setLocaleCookie(NextResponse.redirect(cleanUrl), target));
    }
  }

  return withSecurityHeaders(intlMiddleware(req));
}

export const config = {
  // Skip API routes, health probes, the public statement pages (/s/...) and static files.
  matcher: ["/((?!api|healthz|readyz|s/|_next|.*\\..*).*)"],
};
