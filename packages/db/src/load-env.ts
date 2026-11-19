import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    for (const rawLine of readFileSync(candidate, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(rawLine);
      if (!m || !m[1] || process.env[m[1]] !== undefined) continue;
      let value = m[2] ?? "";
      if (value.startsWith('"') || value.startsWith("'")) {
        const quote = value[0]!;
        const end = value.indexOf(quote, 1);
        value = end > 0 ? value.slice(1, end) : value.slice(1);
      } else {
        value = value.split(" #")[0]?.trim() ?? "";
      }
      process.env[m[1]] = value;
    }
    return;
  }
}

loadRootEnv();
