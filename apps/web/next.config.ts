import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";

/**
 * Secure headers (BUILD_PLAN §8, M6, ADR-024) on EVERY response, including
 * API routes and the public statement page (no framing anywhere).
 * CSP notes (deliberately pragmatic, verified over HTTP + Playwright):
 * - script-src/style-src keep 'unsafe-inline': Next.js App Router emits
 *   inline bootstrap scripts and Tailwind/next-intl inline styles; a
 *   nonce-based policy needs per-request middleware wiring that is a
 *   tracked follow-up (docs/SECURITY.md), not a silent breakage risk.
 * - Everything else is 'self'-only; objects, base-uri and framing are off.
 * HSTS is production-only (browsers ignore it over plain HTTP anyway, and
 * sending it in dev on localhost can pin a developer's browser to https).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      isProd
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  compress: true,
  reactStrictMode: true,
  transpilePackages: ["@tahseel/core", "@tahseel/db", "@tahseel/brand"],
  serverExternalPackages: ["argon2", "postgres"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default withNextIntl(nextConfig);
