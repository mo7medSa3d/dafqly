/**
 * M6 load bench (§8: dashboard < 300 ms at 100k invoices/tenant).
 * Usage (from apps/web): LOAD_TENANT_ID=<uuid> LOAD_APP_URL=postgres://app@.../tahseel_load \
 *   npx tsx scripts/bench-load.mts
 * Runs the REAL services (getKpis, debtor list, invoice list) 5 times each
 * and prints the median wall time. Artifacts stay out of the test suite.
 */
import { createAppDb } from "@tahseel/db";
import { getKpis, getKpisReference, getForecast } from "../src/server/reports";
import { listDebtorsPage2, listInvoicesPage } from "../src/server/ledger";

const tenantId = process.env.LOAD_TENANT_ID;
const url = process.env.LOAD_APP_URL;
if (!tenantId || !url) { console.error("LOAD_TENANT_ID and LOAD_APP_URL are required"); process.exit(1); }
const { db } = createAppDb(url);
const today = "2026-11-09";

async function median(label: string, fn: () => Promise<unknown>) {
  const times: number[] = [];
  let sample: unknown;
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    sample = await fn();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  console.log(`${label}: median=${times[2]!.toFixed(1)}ms runs=[${times.map((t) => t.toFixed(0)).join(", ")}]`);
  return sample;
}

const kpis = await median("getKpis (dashboard)", () => getKpis(db, tenantId, today)) as Awaited<ReturnType<typeof getKpis>>;
console.log(`  kpis: outstanding=${kpis.totalOutstandingMinor} overdue=${kpis.overdueAmountMinor} collectedMonth=${kpis.collectedInMonthMinor} rate=${kpis.collectionRate.toFixed(4)} dso=${kpis.dsoDays} top1=${kpis.topDebtors[0]?.outstandingMinor}`);
await median("getForecast", () => getForecast(db, tenantId, today));
await median("listDebtors (page 50)", () => listDebtorsPage2(db, tenantId, { limit: 50 }));
await median("listInvoices (page 50)", () => listInvoicesPage(db, tenantId, { limit: 50 }, today));
if (process.env.CROSSCHECK === "1") {
  const ref = await getKpisReference(db, tenantId, today);
  const canon = (v: unknown): string => JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val);
  console.log("crosscheck sql-vs-reference:", canon(kpis) === canon(ref) ? "EQUAL" : "DIFFER");
  console.log("  reference:", JSON.stringify(ref).slice(0, 300));
}
process.exit(0);
