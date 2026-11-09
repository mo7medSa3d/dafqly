import { describe, it, expect } from "vitest";
import {
  parseLedgerExtraction, parseReceiptExtraction, parseReplyClassification,
  normalizeLedgerRowDigits, suggestDebtorByName, scoreLedger,
  evaluateReceiptChecks, matchReceiptAmount, decideReceiptOutcome,
  resolveRelativeDate, actionForIntent, scoreReplySet, scoreReceiptSet,
  LOW_CONFIDENCE_CELL, HUMAN_REVIEW_THRESHOLD, AUTO_CLOSE_MIN_CONFIDENCE, MAX_LEDGER_PAGES,
  type ReceiptExtraction,
} from "./ai";

describe("constants", () => {
  it("pins the plan thresholds", () => {
    expect(LOW_CONFIDENCE_CELL).toBe(0.8);
    expect(HUMAN_REVIEW_THRESHOLD).toBe(0.8);
    expect(AUTO_CLOSE_MIN_CONFIDENCE).toBe(0.9);
    expect(MAX_LEDGER_PAGES).toBe(10);
  });
});

describe("Zod parsers (LLM output is untrusted)", () => {
  it("parses a ledger page, coercing an Arabic-digit EGP string amount to minor units", () => {
    const out = parseLedgerExtraction({
      rows: [{
        name: "أحمد سامي", phone: "٠١٠٠١٢٣٤٥٦٧", amount_minor: "١٬٢٥٠٫٥٠",
        date: "2026-11-01", note: null, confidence: 0.93,
        cellConfidence: { name: 0.9, amount: 0.95 },
      }],
    });
    expect(out).not.toBeNull();
    expect(out!.rows[0]!.amount_minor).toBe(125050);
    expect(out!.rows[0]!.phone).toBe("٠١٠٠١٢٣٤٥٦٧");
  });

  it("accepts a numeric amount: integers are minor units, decimals are EGP", () => {
    const base = { name: "x", phone: null, date: null, note: null, confidence: 0.9, cellConfidence: { name: 0.9, amount: 0.9 } };
    expect(parseLedgerExtraction({ rows: [{ ...base, amount_minor: 4200 }] })!.rows[0]!.amount_minor).toBe(4200);
    expect(parseLedgerExtraction({ rows: [{ ...base, amount_minor: 42.5 }] })!.rows[0]!.amount_minor).toBe(4250);
  });

  it("returns null on invalid LLM output (routes to human)", () => {
    expect(parseLedgerExtraction({ rows: [{ name: "x" }] })).toBeNull();
    expect(parseLedgerExtraction("garbage")).toBeNull();
    expect(parseLedgerExtraction(null)).toBeNull();
    expect(parseReceiptExtraction({ is_receipt: "yes" })).toBeNull();
    expect(parseReplyClassification({ intent: "pay_everything_now", confidence: 0.99 })).toBeNull();
    expect(parseReplyClassification({ intent: "promise_to_pay", confidence: 1.4 })).toBeNull();
  });

  it("parses receipt + reply shapes", () => {
    const r = parseReceiptExtraction({
      is_receipt: true, amount_minor: "500.00", currency: "EGP", datetime: "2026-11-08T10:00:00Z",
      sender_name: "Ahmed", sender_account_tail: "1234", reference_no: "REF1", method: "instapay",
      status_text: "ناجحة", confidence: 0.97, tamper_signals: [],
    });
    expect(r!.amount_minor).toBe(50000);
    expect(r!.method).toBe("instapay");
    const c = parseReplyClassification({ intent: "promise_to_pay", confidence: 0.9, promised_date: "2026-11-12", amount_minor: null });
    expect(c!.intent).toBe("promise_to_pay");
  });
});

describe("normalizeLedgerRowDigits + debtor suggestion (SUGGEST ONLY)", () => {
  it("normalizes Eastern digits in phone and trims the name", () => {
    const row = normalizeLedgerRowDigits({
      name: "  أحمد  ", phone: "٠١٠٠ ١٢٣٤٥٦٧", amount_minor: 100, date: null, note: null,
      confidence: 0.9, cellConfidence: { name: 0.9, amount: 0.9 },
    });
    expect(row.phone).toBe("01001234567");
    expect(row.name).toBe("أحمد");
  });

  it("suggests an existing debtor for a close Arabic name, never below threshold", () => {
    const debtors = [{ id: "d1", displayName: "أحمد سامي حسن" }, { id: "d2", displayName: "منى علي" }];
    expect(suggestDebtorByName("احمد سامى", debtors)?.debtorId).toBe("d1");
    expect(suggestDebtorByName("الحاج محمود عبد الرحمن", debtors)).toBeNull();
    expect(suggestDebtorByName("منى على", debtors)?.score).toBeGreaterThanOrEqual(0.6);
  });
});

describe("scoreLedger", () => {
  it("computes amount/name accuracy and the wrong-cell low-flag rate", () => {
    const gold = [
      { name: "أحمد سامي", amount_minor: 10000 },
      { name: "منى علي", amount_minor: 20000 },
      { name: "كريم فؤاد", amount_minor: 30000 },
    ];
    const pred = [
      { name: "أحمد سامي", phone: null, amount_minor: 10000, date: null, note: null, confidence: 0.95, cellConfidence: { name: 0.95, amount: 0.95 } },
      { name: "منى علي", phone: null, amount_minor: 25000, date: null, note: null, confidence: 0.5, cellConfidence: { name: 0.9, amount: 0.4 } },
      { name: "كريم فؤد", phone: null, amount_minor: 30000, date: null, note: null, confidence: 0.5, cellConfidence: { name: 0.3, amount: 0.9 } },
    ];
    const s = scoreLedger(pred, gold);
    expect(s.amountAccuracy).toBeCloseTo(2 / 3);
    expect(s.nameAccuracy).toBeCloseTo(2 / 3);
    // 2 wrong cells (amount row2, name row3), both flagged low -> 1.0
    expect(s.wrongCellLowFlagRate).toBe(1);
    expect(s.wrongCells).toBe(2);
  });
});

const receipt = (over: Partial<ReceiptExtraction> = {}): ReceiptExtraction => ({
  is_receipt: true, amount_minor: 50000, currency: "EGP", datetime: "2026-11-08T10:00:00Z",
  sender_name: "A", sender_account_tail: "1234", reference_no: "REF-1", method: "instapay",
  status_text: "success", confidence: 0.95, tamper_signals: [], ...over,
});

describe("evaluateReceiptChecks + decideReceiptOutcome", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("all checks pass for a clean, fresh, unseen receipt", () => {
    const { checks, allPassed } = evaluateReceiptChecks({ extraction: receipt(), sha256: "h1", seenHashes: new Set(), seenReferences: new Set(), now });
    expect(allPassed).toBe(true);
    expect(checks.map((c) => c.key)).toEqual(["duplicate_hash", "duplicate_reference", "date_plausible", "is_receipt", "no_tamper", "confidence_ok"]);
  });
  it("catches duplicate hash, duplicate reference, future date, tamper, non-receipt, low confidence", () => {
    const dup = evaluateReceiptChecks({ extraction: receipt(), sha256: "h1", seenHashes: new Set(["h1"]), seenReferences: new Set(["REF-1"]), now });
    expect(dup.allPassed).toBe(false);
    expect(dup.checks.find((c) => c.key === "duplicate_hash")!.passed).toBe(false);
    expect(dup.checks.find((c) => c.key === "duplicate_reference")!.passed).toBe(false);
    const future = evaluateReceiptChecks({ extraction: receipt({ datetime: "2026-12-25T10:00:00Z" }), sha256: "h", seenHashes: new Set(), seenReferences: new Set(), now });
    expect(future.checks.find((c) => c.key === "date_plausible")!.passed).toBe(false);
    const old = evaluateReceiptChecks({ extraction: receipt({ datetime: "2026-01-01T10:00:00Z" }), sha256: "h", seenHashes: new Set(), seenReferences: new Set(), now });
    expect(old.checks.find((c) => c.key === "date_plausible")!.passed).toBe(false);
    const bad = evaluateReceiptChecks({ extraction: receipt({ is_receipt: false, tamper_signals: ["edited_amount"], confidence: 0.5 }), sha256: "h", seenHashes: new Set(), seenReferences: new Set(), now });
    expect(bad.allPassed).toBe(false);
  });
  it("auto-close requires opt-in AND all checks AND confidence >= 0.9", () => {
    expect(decideReceiptOutcome({ checks: { allPassed: true }, autoCloseEnabled: true, confidence: 0.95 })).toBe("auto_confirm");
    expect(decideReceiptOutcome({ checks: { allPassed: true }, autoCloseEnabled: false, confidence: 0.95 })).toBe("claimed");
    expect(decideReceiptOutcome({ checks: { allPassed: true }, autoCloseEnabled: true, confidence: 0.85 })).toBe("claimed");
    expect(decideReceiptOutcome({ checks: { allPassed: false }, autoCloseEnabled: true, confidence: 0.99 })).toBe("claimed");
    // also accepts the full evaluateReceiptChecks result
    const full = evaluateReceiptChecks({ extraction: receipt(), sha256: "h", seenHashes: new Set(), seenReferences: new Set(), now });
    expect(decideReceiptOutcome({ checks: full, autoCloseEnabled: true, confidence: 0.95 })).toBe("auto_confirm");
  });
});

describe("matchReceiptAmount (subset-sum capped)", () => {
  const inv = (id: string, outstandingMinor: number, dueOn: string) => ({ id, outstandingMinor, dueOn });
  it("exact single", () => {
    const m = matchReceiptAmount(50000, [inv("a", 30000, "2026-11-01"), inv("b", 50000, "2026-11-02")]);
    expect(m.kind).toBe("exact_single");
    expect(m.invoiceIds).toEqual(["b"]);
  });
  it("exact sum across two invoices", () => {
    const m = matchReceiptAmount(80000, [inv("a", 30000, "2026-11-01"), inv("b", 50000, "2026-11-02"), inv("c", 90000, "2026-11-03")]);
    expect(m.kind).toBe("exact_sum");
    expect(m.invoiceIds.sort()).toEqual(["a", "b"]);
    expect(m.allocations.reduce((s, x) => s + x.amountMinor, 0)).toBe(80000);
  });
  it("partial allocates oldest-first; none when nothing is open", () => {
    const m = matchReceiptAmount(20000, [inv("a", 30000, "2026-11-01"), inv("b", 50000, "2026-11-02")]);
    expect(m.kind).toBe("partial");
    expect(m.allocations).toEqual([{ invoiceId: "a", amountMinor: 20000 }]);
    expect(matchReceiptAmount(20000, []).kind).toBe("none");
    expect(matchReceiptAmount(0, [inv("a", 1, "2026-11-01")]).kind).toBe("none");
  });
});

describe("resolveRelativeDate (deterministic, tenant-local today given)", () => {
  // 2026-11-09 is a Monday.
  it("handles بكرة / بعد بكرة / آخر الشهر / أول الشهر", () => {
    expect(resolveRelativeDate("هدفع بكرة", "2026-11-09", "Africa/Cairo")).toEqual({ date: "2026-11-10", ambiguous: false });
    expect(resolveRelativeDate("بعد بكره ان شاء الله", "2026-11-09", "Africa/Cairo").date).toBe("2026-11-11");
    expect(resolveRelativeDate("آخر الشهر", "2026-11-09", "Africa/Cairo").date).toBe("2026-11-30");
    expect(resolveRelativeDate("أول الشهر الجاي", "2026-11-09", "Africa/Cairo").date).toBe("2026-12-01");
  });
  it("weekdays resolve to the NEXT occurrence (same weekday = +7)", () => {
    expect(resolveRelativeDate("يوم الخميس", "2026-11-09", "Africa/Cairo").date).toBe("2026-11-12");
    expect(resolveRelativeDate("الاتنين الجاي", "2026-11-09", "Africa/Cairo").date).toBe("2026-11-16"); // today IS Monday -> +7
    expect(resolveRelativeDate("الجمعة", "2026-11-09", "Africa/Cairo").date).toBe("2026-11-13");
  });
  it("بعد العيد is ambiguous -> human; explicit dates pass through", () => {
    expect(resolveRelativeDate("بعد العيد", "2026-11-09", "Africa/Cairo")).toEqual({ date: null, ambiguous: true });
    expect(resolveRelativeDate("هدفع 2026-11-20", "2026-11-09", "Africa/Cairo").date).toBe("2026-11-20");
    expect(resolveRelativeDate("كلام عادي", "2026-11-09", "Africa/Cairo")).toEqual({ date: null, ambiguous: false });
  });
});

describe("actionForIntent (allowlist; low confidence -> human)", () => {
  it("maps the allowlist and gates on 0.8", () => {
    expect(actionForIntent("promise_to_pay", 0.9)).toEqual({ action: "replan_after_promise", auto: true });
    expect(actionForIntent("already_paid", 0.9).action).toBe("request_receipt");
    expect(actionForIntent("dispute", 0.9).action).toBe("open_dispute");
    expect(actionForIntent("request_extension", 0.95)).toEqual({ action: "merchant_approval", auto: false });
    expect(actionForIntent("opt_out", 0.9).action).toBe("opt_out");
    expect(actionForIntent("wrong_person", 0.9).action).toBe("mark_phone_invalid");
    expect(actionForIntent("question", 0.99).action).toBe("human_inbox");
    expect(actionForIntent("promise_to_pay", 0.5)).toEqual({ action: "human_inbox", auto: false });
    expect(actionForIntent("partial_payment_offer", 0.95).action).toBe("human_inbox");
  });
});

describe("eval scorers", () => {
  it("scoreReplySet: intent/date accuracy, opt-out recall, injection violations", () => {
    const s = scoreReplySet([
      { expectedIntent: "promise_to_pay", predictedIntent: "promise_to_pay", predictedConfidence: 0.9, expectedDate: "2026-11-12", predictedDate: "2026-11-12" },
      { expectedIntent: "opt_out", predictedIntent: "opt_out", predictedConfidence: 0.99 },
      { expectedIntent: "greeting_or_other", predictedIntent: "greeting_or_other", predictedConfidence: 0.9, injection: true },
      { expectedIntent: "question", predictedIntent: "dispute", predictedConfidence: 0.9, injection: true },
    ]);
    expect(s.intentAccuracy).toBeCloseTo(0.75);
    expect(s.dateAccuracy).toBe(1);
    expect(s.optOutRecall).toBe(1);
    expect(s.injectionViolations).toBe(1); // injection row auto-acted as dispute
  });
  it("scoreReceiptSet: clean amount accuracy, false auto-confirms, duplicate catch rate", () => {
    const s = scoreReceiptSet([
      { goldAmountMinor: 10000, predictedAmountMinor: 10000, clean: true, shouldAutoConfirm: true, autoConfirmed: true },
      { goldAmountMinor: 20000, predictedAmountMinor: 20000, clean: true, shouldAutoConfirm: true, autoConfirmed: true },
      { goldAmountMinor: null, predictedAmountMinor: null, shouldAutoConfirm: false, autoConfirmed: false },
      { goldAmountMinor: 10000, predictedAmountMinor: 10000, duplicate: true, duplicateCaught: true, shouldAutoConfirm: false, autoConfirmed: false },
    ]);
    expect(s.cleanAmountAccuracy).toBe(1);
    expect(s.falseAutoConfirms).toBe(0);
    expect(s.duplicateCatchRate).toBe(1);
  });
});
