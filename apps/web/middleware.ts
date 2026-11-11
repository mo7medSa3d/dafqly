import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./src/i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // 1. Cleanly redirect /arabic or /english path aliases to canonical /ar or /en
  if (pathname === "/arabic" || pathname.startsWith("/arabic/")) {
    const cleanPath = pathname.replace(/^\/arabic/, "/ar") || "/ar";
    const res = NextResponse.redirect(new URL(cleanPath, req.url));
    res.cookies.set("NEXT_LOCALE", "ar", { path: "/", maxAge: 31536000, sameSite: "lax" });
    return res;
  }
  if (pathname === "/english" || pathname.startsWith("/english/")) {
    const cleanPath = pathname.replace(/^\/english/, "/en") || "/en";
    const res = NextResponse.redirect(new URL(cleanPath, req.url));
    res.cookies.set("NEXT_LOCALE", "en", { path: "/", maxAge: 31536000, sameSite: "lax" });
    return res;
  }

  // 2. Strip unsightly ?locale=english or ?lang=arabic query params from the browser URL while saving preference
  if (searchParams.has("locale") || searchParams.has("lang")) {
    const l = (searchParams.get("locale") || searchParams.get("lang") || "").toLowerCase();
    const target = l === "en" || l === "english" ? "en" : l === "ar" || l === "arabic" ? "ar" : null;
    if (target) {
      const cleanUrl = req.nextUrl.clone();
      cleanUrl.searchParams.delete("locale");
      cleanUrl.searchParams.delete("lang");
      const res = NextResponse.redirect(cleanUrl);
      res.cookies.set("NEXT_LOCALE", target, { path: "/", maxAge: 31536000, sameSite: "lax" });
      return res;
    }
  }

  return intlMiddleware(req);
}

export const config = {
  // Skip API routes, health probes, the public statement pages (/s/...) and static files.
  matcher: ["/((?!api|healthz|readyz|s/|_next|.*\\..*).*)"],
};
