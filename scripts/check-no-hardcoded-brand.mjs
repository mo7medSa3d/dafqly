// BRAND.md §0/§10: no hardcoded hex colors or font names in app code; tokens only.
// Scans apps/*/src and apps/*/app code (excluding the places where brand assets
// are wired verbatim: the copied manifest/icons and the globals.css that
// @imports tokens.css). Brand package itself is the source of tokens, not app code.
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const roots = ["apps/web/app", "apps/web/src", "apps/worker/src"];
const exts = new Set([".ts", ".tsx", ".css"]);
const skipFiles = new Set([
  // globals.css defines the Tailwind v4 @theme mapping FROM CSS variables in
  // tokens.css; it references var(--...) only, which this checker verifies.
]);
const hexRe = /#[0-9a-fA-F]{3,8}\b/;
const fontNameRe = /\bThmanyah\b|\bNoto Sans Arabic\b|\bPlus Jakarta Sans\b|\bIBM Plex Sans Arabic\b/;
let failed = false;
let scanned = 0;

function walk(dir, rel) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const p = join(rel, entry.name);
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, p); continue; }
    if (!entry.isFile() || !exts.has(extname(entry.name)) || skipFiles.has(p)) continue;
    scanned++;
    const raw = readFileSync(full, "utf8");
    // Comments may quote token values / font names when explaining the wiring
    // rules; executable code may not use them. Strip block and line comments,
    // preserving line numbers.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const code = line.replace(/\/\/.*$/, "");
      if (hexRe.test(code)) { console.error(`${p}:${i + 1}: hardcoded hex color: ${line.trim()}`); failed = true; }
      if (fontNameRe.test(code)) { console.error(`${p}:${i + 1}: hardcoded font name: ${line.trim()}`); failed = true; }
    }
  }
}
for (const r of roots) walk(join(repoRoot, r), r);
if (scanned === 0) { console.error("check-no-hardcoded-brand: FAILED (0 files scanned)"); process.exit(1); }
if (failed) { console.error("check-no-hardcoded-brand: FAILED"); process.exit(1); }
console.log(`check-no-hardcoded-brand: OK (${scanned} files scanned; no hardcoded hex colors or font names in app code)`);
