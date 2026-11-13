// F-20: ar.json and en.json must carry identical key sets — a missing key
// in one locale renders as a raw key (or a crash) in the other. next-intl
// does not fail the build on a missing key, so this script is the guard;
// it runs as part of `pnpm lint` (and therefore CI).
import { readFileSync } from "node:fs";

const files = ["apps/web/src/messages/ar.json", "apps/web/src/messages/en.json"];

function flatten(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flatten(value, `${prefix}${key}.`));
    } else {
      out.push(`${prefix}${key}`);
    }
  }
  return out;
}

const [ar, en] = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const arKeys = new Set(flatten(ar));
const enKeys = new Set(flatten(en));
const onlyAr = [...arKeys].filter((k) => !enKeys.has(k)).sort();
const onlyEn = [...enKeys].filter((k) => !arKeys.has(k)).sort();

if (onlyAr.length === 0 && onlyEn.length === 0) {
  console.log(`check-message-parity: OK (${arKeys.size} keys in both locales)`);
  process.exit(0);
}
for (const k of onlyAr) console.error(`missing in en.json: ${k}`);
for (const k of onlyEn) console.error(`missing in ar.json: ${k}`);
console.error(`check-message-parity: FAIL (${onlyAr.length + onlyEn.length} mismatched keys)`);
process.exit(1);
