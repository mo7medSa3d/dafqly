// Lightweight secrets scan over tracked or workspace files (BUILD_PLAN §9).
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

let files = [];
let useGit = false;
try {
  files = execSync("git ls-files", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  useGit = files.length > 0;
} catch {
  files = walkFiles(".");
}

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
  if (/\.(png|jpg|jpeg|gif|ico|otf|woff2?|zip)$/i.test(file)) continue;
  let text;
  try {
    text = useGit
      ? execSync(`git show :${JSON.stringify(file)}`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
      : readFileSync(file, "utf8");
  } catch { continue; }
  for (const { name, re } of patterns) {
    const m = text.match(re);
    if (m && !allow.test(m[0])) { console.error(`${file}: possible ${name}`); failed = true; }
  }
}
if (failed) { console.error("check-secrets: FAILED"); process.exit(1); }
console.log(`check-secrets: OK (${files.length} files scanned)`);
