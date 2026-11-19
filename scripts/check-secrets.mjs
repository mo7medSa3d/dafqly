// Lightweight secrets scan over tracked or workspace files (BUILD_PLAN §9).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skipDirs = new Set([".git", "node_modules", ".next", "dist", "coverage", "backups", ".playwright-mcp"]);

function walkFiles(dir, rel = "", out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const relPath = rel ? join(rel, entry.name) : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, relPath, out);
    else if (entry.isFile()) out.push(relPath);
  }
  return out;
}

let files = [];
try {
  // -z avoids octal-quoting non-ASCII/spaced paths; --others --exclude-standard catches untracked non-ignored files.
  files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 10 * 1024 * 1024,
  }).split("\0").filter(Boolean);
} catch {
  files = walkFiles(repoRoot);
}

const patterns = [
  { name: "private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google/Gemini API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI-style key", re: /\bsk-(?!ant-)[A-Za-z0-9]{32,}/g },
  { name: "live payment secret key", re: /\b(?:egy_)?sk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "generic bearer token assignment", re: /(ACCESS_TOKEN|API_KEY|SECRET_KEY)\s*=\s*[A-Za-z0-9_\-/+]{24,}/g },
  // H6: a credential literal in a migration or compose file is a bug — new
  // passwords must come from the environment. The single grandfathered
  // value is migration 0000's applied-history role password (tahseel_app_dev):
  // rewriting applied migration history is worse than the dev-only default
  // it carries; rotation is documented in docs/RUNBOOK.md.
  {
    name: "SQL password literal", files: /\.sql$/i, allowValues: ["tahseel_app_dev"],
    re: /PASSWORD\s+'[^']{1,}'/g,
  },
  {
    // Anchored at line start so the `${VAR:?...}` self-reference inside a
    // variable value (docker-compose.yml) does not match its own key.
    name: "compose password literal", files: /docker-compose.*\.ya?ml$/i,
    re: /^\s*(POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD)\s*:\s*(?!\$)[^\s#]+/gm,
  },
];
const binaryRe = /\.(png|jpg|jpeg|gif|ico|otf|woff2?|zip|pdf|webp|ttf|eot|dump|gz)$/i;
const allow = /change-me|dev-only|example\.invalid|example\.test|your-|placeholder/i;
let failed = false;
for (const file of files) {
  if (binaryRe.test(file)) continue;
  let text;
  try {
    text = readFileSync(join(repoRoot, file), "utf8");
  } catch {
    try {
      text = execFileSync("git", ["show", `:${file}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    } catch { continue; }
  }
  for (const { name, re, files: fileFilter, allowValues } of patterns) {
    if (fileFilter && !fileFilter.test(file)) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (allow.test(m[0])) continue;
      if (allowValues && allowValues.some((v) => m[0].includes(v))) continue;
      console.error(`${file}: possible ${name}`);
      failed = true;
      break;
    }
  }
}
if (failed) { console.error("check-secrets: FAILED"); process.exit(1); }
console.log(`check-secrets: OK (${files.length} files scanned)`);
