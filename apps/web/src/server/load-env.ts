import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Monorepo convenience: the single .env lives at the repo root (.env.example
 * is the template). Next.js only auto-loads env files inside apps/web, so in
 * local dev we import the root one for keys that are not already set.
 * In production the host injects real env vars and this is a no-op.
 */
export function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  const candidate = resolve(process.cwd(), "../../.env");
  if (!existsSync(candidate)) return;
  for (const line of readFileSync(candidate, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !m[1] || process.env[m[1]] !== undefined) continue;
    let value = m[2] ?? "";
    // dotenv semantics: quoted values keep everything up to the closing
    // quote; unquoted values end at an inline " #" comment. (.env.example
    // uses trailing comments, e.g. NEXT_PUBLIC_BRAND_FONT=off  # on only…)
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      value = end > 0 ? value.slice(1, end) : value.replace(/^"|"$/g, "");
    } else {
      value = value.split(" #")[0]?.trim() ?? "";
    }
    process.env[m[1]] = value;
  }
}
loadRootEnv();

