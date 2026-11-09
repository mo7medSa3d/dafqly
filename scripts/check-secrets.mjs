// Lightweight secrets scan over tracked files (BUILD_PLAN §9). Fails if a
// committed file looks like it contains a real credential. Placeholder values
// from .env.example ("change-me", "dev-only", example.invalid) are allowed.
import { execSync } from "node:child_process";

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const patterns = [
  { name: "private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style key", re: /\bsk-(?!ant-)[A-Za-z0-9]{32,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "generic bearer token assignment", re: /(ACCESS_TOKEN|API_KEY|SECRET_KEY)\s*=\s*[A-Za-z0-9_\-/+]{24,}/ },
];
const allow = /change-me|dev-only|example\.invalid|example\.test|your-|placeholder/i;
let failed = false;
for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|ico|otf|woff2?)$/i.test(file)) continue;
  let text;
  try { text = execSync(`git show :${JSON.stringify(file)}`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }); } catch { continue; }
  for (const { name, re } of patterns) {
    const m = text.match(re);
    if (m && !allow.test(m[0])) { console.error(`${file}: possible ${name}`); failed = true; }
  }
}
if (failed) { console.error("check-secrets: FAILED"); process.exit(1); }
console.log(`check-secrets: OK (${files.length} tracked files scanned)`);
