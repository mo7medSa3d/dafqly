import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  scoreLedger, scoreReceiptSet, scoreReplySet, evaluateReceiptChecks, decideReceiptOutcome,
  type LedgerRow, type ReplyIntent,
} from "@tahseel/core";
import { sha256Of } from "@tahseel/core/files-crypto";
import { FakeLlmProvider } from "@tahseel/providers";
import { baselineClassify, scoreReplies, type LabeledReply } from "./baseline";

/**
 * `pnpm eval` (BUILD_PLAN §9). M4: runs the three LLM-feature evals (F6
 * ledger, F7 receipts, F8 replies) against the SYNTHETIC golden sets in
 * fixtures/{ledger,receipts,replies}/test through the deterministic FAKE
 * provider and the full core pipeline (Zod parsers, receipt checks,
 * auto-close gate, action allowlist), prints metrics vs the plan targets
 * and exits non-zero when any target is missed.
 *
 * HONESTY: no real Anthropic key (HUMAN_INPUTS #5) and no real eval data
 * (#9) exist, so these numbers prove the PIPELINE + fake against synthetic
 * data — they do NOT measure a live LLM on real customer data. The live
 * run is a RUNBOOK human step (fixtures/private + ANTHROPIC_API_KEY).
 */
const fixturesRoot = resolve(new URL("../fixtures", import.meta.url).pathname);
const llm = new FakeLlmProvider();
let failed = false;
const gate = (label: string, ok: boolean) => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed = true;
};

console.log("== Tahseel eval ==");
for (const kind of ["replies", "ledger", "receipts", "import"] as const) {
  for (const split of ["dev", "test"] as const) {
    const dir = resolve(fixturesRoot, kind, split);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith(".")) : [];
    console.log(`fixtures/${kind}/${split}: ${files.length} file(s)`);
  }
}
const hasReal = existsSync(resolve(fixturesRoot, "../fixtures-private"));
console.log(hasReal
  ? "Real data present under fixtures-private (not part of this synthetic run)."
  : "REAL EVAL DATA: none found. Datasets below are SYNTHETIC (generated + labelled in-repo). Real datasets are a human input (packages/eval/README.md).");

// ---------------------------------------------------------- harness smoke
{
  const syntheticPath = new URL("./synthetic/replies.jsonl", import.meta.url);
  const rows = readFileSync(syntheticPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as LabeledReply);
  const metrics = scoreReplies(rows, baselineClassify);
  console.log(`\nHarness smoke (baseline keyword classifier, NOT the LLM): n=${metrics.total}, accuracy=${metrics.accuracy.toFixed(2)}, opt-out recall=${metrics.optOutRecall.toFixed(2)}`);
  gate("smoke: opt-out recall = 1.00", metrics.optOutRecall >= 1);
}

// ------------------------------------------------------------- F6 ledger
{
  const dir = resolve(fixturesRoot, "ledger/test");
  const ids = readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")).sort();
  const predicted: LedgerRow[] = [];
  const gold: { name: string; amount_minor: number }[] = [];
  for (const id of ids) {
    const bytes = new Uint8Array(readFileSync(resolve(dir, `${id}.svg`)));
    const goldFile = JSON.parse(readFileSync(resolve(dir, `${id}.json`), "utf8")) as { rows: { name: string; amount_minor: number }[] };
    const out = await llm.extractLedgerPage(bytes, "image/svg+xml");
    if (!out.data) throw new Error(`fake returned no data for synthetic ledger page ${id}`);
    predicted.push(...out.data.rows);
    gold.push(...goldFile.rows);
  }
  const s = scoreLedger(predicted, gold);
  console.log(`\nF6 ledger (SYNTHETIC, FAKE provider): ${ids.length} pages, ${s.total} rows`);
  console.log(`  amount accuracy=${s.amountAccuracy.toFixed(3)} (target >= 0.90), name accuracy=${s.nameAccuracy.toFixed(3)} (target >= 0.85), wrong cells=${s.wrongCells}, wrong-cell low-flag rate=${s.wrongCellLowFlagRate.toFixed(3)} (target >= 0.90)`);
  gate("ledger amount accuracy >= 0.90", s.amountAccuracy >= 0.9);
  gate("ledger name accuracy >= 0.85", s.nameAccuracy >= 0.85);
  gate("ledger wrong-cell low-flag rate >= 0.90", s.wrongCellLowFlagRate >= 0.9);
}

// ------------------------------------------------------------ F7 receipts
{
  const dir = resolve(fixturesRoot, "receipts/test");
  const ids = readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "")).sort();
  // Fixed eval clock so the synthetic datetimes (2026-11-0x) stay plausible deterministically.
  const now = new Date("2026-11-09T12:00:00Z");
  const seenHashes = new Set<string>();
  const seenReferences = new Set<string>();
  const items = [];
  for (const id of ids) {
    const bytes = new Uint8Array(readFileSync(resolve(dir, `${id}.svg`)));
    const goldFile = JSON.parse(readFileSync(resolve(dir, `${id}.json`), "utf8")) as {
      clean: boolean; duplicate: boolean;
      extraction: { is_receipt: boolean; amount_minor: number | null; reference_no: string | null };
    };
    const out = await llm.extractReceipt(bytes, "image/svg+xml");
    if (!out.data) throw new Error(`fake returned no data for synthetic receipt ${id}`);
    const sha = sha256Of(bytes);
    const checks = evaluateReceiptChecks({ extraction: out.data, sha256: sha, seenHashes, seenReferences, now });
    const autoConfirmed = decideReceiptOutcome({ checks, autoCloseEnabled: true, confidence: out.data.confidence }) === "auto_confirm";
    const duplicateCaught = goldFile.duplicate
      ? (!checks.checks.find((c) => c.key === "duplicate_hash")!.passed
        || !checks.checks.find((c) => c.key === "duplicate_reference")!.passed
        || out.data.tamper_signals.length > 0)
      : false;
    items.push({
      goldAmountMinor: goldFile.extraction.amount_minor,
      predictedAmountMinor: out.data.amount_minor,
      clean: goldFile.clean,
      duplicate: goldFile.duplicate,
      duplicateCaught,
      // Gold truth: auto-confirm would be RIGHT only for a genuine, new,
      // correctly-read receipt.
      shouldAutoConfirm: goldFile.extraction.is_receipt && !goldFile.duplicate
        && out.data.amount_minor !== null && out.data.amount_minor === goldFile.extraction.amount_minor
        && out.data.tamper_signals.length === 0,
      autoConfirmed,
    });
    seenHashes.add(sha);
    if (out.data.reference_no) seenReferences.add(out.data.reference_no);
  }
  const s = scoreReceiptSet(items);
  console.log(`\nF7 receipts (SYNTHETIC, FAKE provider): ${s.total} images, clean=${s.cleanTotal}`);
  console.log(`  clean amount accuracy=${s.cleanAmountAccuracy.toFixed(3)} (target >= 0.95), false auto-confirms=${s.falseAutoConfirms} (target 0), duplicates caught=${s.duplicatesCaught}/${s.duplicateTotal} (target 100%)`);
  gate("receipt clean amount accuracy >= 0.95", s.cleanAmountAccuracy >= 0.95);
  gate("receipt false auto-confirms == 0", s.falseAutoConfirms === 0);
  gate("receipt duplicates always caught", s.duplicateCatchRate >= 1);
}

// -------------------------------------------------------------- F8 replies
{
  const dir = resolve(fixturesRoot, "replies/test");
  const lines = readFileSync(resolve(dir, "replies.jsonl"), "utf8").trim().split("\n");
  const items = [];
  for (const line of lines) {
    const row = JSON.parse(line) as {
      text: string; intent: ReplyIntent; today: string;
      expected_promised_date?: string; injection?: boolean;
    };
    const out = await llm.classifyReply(row.text, { todayIso: row.today, timezone: "Africa/Cairo" });
    items.push({
      expectedIntent: row.intent,
      predictedIntent: out.data?.intent ?? null,
      predictedConfidence: out.data?.confidence ?? 0,
      expectedDate: row.expected_promised_date ?? null,
      predictedDate: out.data?.promised_date ?? null,
      injection: row.injection ?? false,
    });
  }
  const s = scoreReplySet(items);
  console.log(`\nF8 replies (SYNTHETIC, FAKE rule classifier): ${s.total} labelled replies, dated=${s.dateTotal}`);
  console.log(`  intent accuracy=${s.intentAccuracy.toFixed(3)} (target >= 0.90), date accuracy=${s.dateAccuracy.toFixed(3)} (target >= 0.95), opt-out recall=${s.optOutRecall.toFixed(3)} (target 1.00), injection violations=${s.injectionViolations} (target 0)`);
  gate("reply intent accuracy >= 0.90", s.intentAccuracy >= 0.9);
  gate("reply date accuracy >= 0.95", s.dateAccuracy >= 0.95);
  gate("reply opt-out recall == 1.00", s.optOutRecall >= 1);
  gate("reply injection violations == 0", s.injectionViolations === 0);
}

// ------------------------------------------------------------- F12 backtest
{
  const { syntheticBacktest } = await import("./backtest");
  const bt = syntheticBacktest();
  console.log("\nF12 forecast backtest (SYNTHETIC deterministic history, core backtestForecast):");
  for (const w of bt.weeks) {
    console.log(`  week ${w.weekStart}: predicted=${w.predictedMinor}, actual=${w.actualMinor}, abs error=${w.absErrorMinor}`);
  }
  console.log(`  mean absolute error = ${bt.maeMinor} minor units/week`);
}

console.log(failed
  ? "\nEVAL FAILED: at least one SYNTHETIC target was missed."
  : "\nEVAL OK: all SYNTHETIC targets met (fake provider + synthetic data — NOT a live-LLM measurement).");
if (failed) process.exit(1);
