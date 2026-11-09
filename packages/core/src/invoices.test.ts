import { describe, it, expect } from "vitest";
import {
  INVOICE_STATUSES, canTransition, assertTransition, isTerminalStatus,
  deriveStatusFromPaid, resolveStatusAfterPayment, resolveDueOn, addDaysIso,
  isOverdue, daysOverdue, agingBucket, outstandingMinor,
  allocatePayment, validateExplicitAllocations, AllocationError, type AllocationTarget,
} from "./invoices";

describe("invoice status machine (BUILD_PLAN §6, F1: ALL transitions covered)", () => {
  it("covers every ordered pair of statuses explicitly", () => {
    // Exhaustive 6x6 matrix: this test IS the transition table's proof.
    const expected: Record<string, string[]> = {
      open: ["partially_paid", "paid", "disputed", "written_off", "cancelled"],
      partially_paid: ["open", "paid", "disputed", "written_off", "cancelled"],
      paid: ["open", "partially_paid", "disputed"],
      disputed: ["open", "partially_paid", "paid", "written_off", "cancelled"],
      written_off: [],
      cancelled: [],
    };
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe((expected[from] ?? []).includes(to));
      }
    }
  });
  it("terminal statuses are written_off and cancelled", () => {
    expect(isTerminalStatus("written_off")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("open")).toBe(false);
    expect(isTerminalStatus("paid")).toBe(false);
  });
  it("assertTransition throws with both states named", () => {
    expect(() => assertTransition("cancelled", "open")).toThrow(/cancelled.*open/);
    expect(() => assertTransition("open", "paid")).not.toThrow();
  });
  it("no self-transitions", () => {
    for (const s of INVOICE_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe("status derived from confirmed paid amount (§6: paid_minor from confirmed allocations only)", () => {
  it("0 paid -> open, partial -> partially_paid, full/over -> paid", () => {
    expect(deriveStatusFromPaid(1000n, 0n)).toBe("open");
    expect(deriveStatusFromPaid(1000n, 1n)).toBe("partially_paid");
    expect(deriveStatusFromPaid(1000n, 999n)).toBe("partially_paid");
    expect(deriveStatusFromPaid(1000n, 1000n)).toBe("paid");
    expect(deriveStatusFromPaid(1000n, 1500n)).toBe("paid");
  });
  it("payment changes never resurrect terminal invoices, and preserve disputed until resolved by derive", () => {
    expect(resolveStatusAfterPayment("written_off", 1000n, 1000n)).toBe("written_off");
    expect(resolveStatusAfterPayment("cancelled", 1000n, 1000n)).toBe("cancelled");
    expect(resolveStatusAfterPayment("open", 1000n, 400n)).toBe("partially_paid");
    expect(resolveStatusAfterPayment("partially_paid", 1000n, 0n)).toBe("open"); // reversal to zero
    expect(resolveStatusAfterPayment("disputed", 1000n, 1000n)).toBe("paid");
  });
  it("outstanding never goes negative (overpayment is credit, §6)", () => {
    expect(outstandingMinor(1000n, 1500n)).toBe(0n);
    expect(outstandingMinor(1000n, 250n)).toBe(750n);
  });
});

describe("due dates and overdue/aging (§5: overdue is derived; §6: no due date -> issued + default terms)", () => {
  it("resolveDueOn uses the explicit due date, else issued + terms", () => {
    expect(resolveDueOn("2026-11-01", "2026-11-20", 14)).toBe("2026-11-20");
    expect(resolveDueOn("2026-11-01", null, 14)).toBe("2026-11-15");
    expect(resolveDueOn("2026-12-30", undefined, 3)).toBe("2027-01-02");
    expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });
  it("isOverdue only for open/partially_paid past due", () => {
    expect(isOverdue("open", "2026-11-01", "2026-11-02")).toBe(true);
    expect(isOverdue("partially_paid", "2026-11-01", "2026-11-02")).toBe(true);
    expect(isOverdue("open", "2026-11-02", "2026-11-02")).toBe(false); // due today is not overdue
    expect(isOverdue("paid", "2026-11-01", "2026-11-02")).toBe(false);
    expect(isOverdue("disputed", "2026-11-01", "2026-11-02")).toBe(false);
    expect(daysOverdue("2026-11-01", "2026-11-11")).toBe(10);
  });
  it("aging buckets: current, 0-7, 8-30, 31-60, 60+", () => {
    const today = "2026-11-30";
    expect(agingBucket("2026-12-05", today)).toBe("current");
    expect(agingBucket("2026-11-30", today)).toBe("0-7");
    expect(agingBucket("2026-11-23", today)).toBe("0-7");
    expect(agingBucket("2026-11-22", today)).toBe("8-30");
    expect(agingBucket("2026-10-31", today)).toBe("8-30");
    expect(agingBucket("2026-10-30", today)).toBe("31-60");
    expect(agingBucket("2026-10-01", today)).toBe("31-60");
    expect(agingBucket("2026-09-30", today)).toBe("60+");
  });
});

const target = (invoiceId: string, amount: number, paid: number, dueOn: string, status: AllocationTarget["status"] = "open"): AllocationTarget =>
  ({ invoiceId, amountMinor: BigInt(amount), paidMinor: BigInt(paid), dueOn, status });

describe("payment allocation (F1 acceptance: one payment across three invoices)", () => {
  it("auto-allocates oldest-due first and updates all three invoices", () => {
    const result = allocatePayment(100_000n, [
      target("c", 40_000, 0, "2026-11-20"),
      target("a", 30_000, 0, "2026-11-01"),
      target("b", 50_000, 10_000, "2026-11-10", "partially_paid"),
    ]);
    expect(result.allocations.map((a) => [a.invoiceId, a.amountMinor.toString(), a.newStatus])).toEqual([
      ["a", "30000", "paid"],
      ["b", "40000", "paid"],
      ["c", "30000", "partially_paid"],
    ]);
    expect(result.allocatedMinor).toBe(100_000n);
    expect(result.creditMinor).toBe(0n);
  });
  it("overpayment becomes credit, never a negative invoice", () => {
    const result = allocatePayment(200_000n, [target("a", 30_000, 0, "2026-11-01")]);
    expect(result.allocatedMinor).toBe(30_000n);
    expect(result.creditMinor).toBe(170_000n);
    expect(result.allocations[0]?.newPaidMinor).toBe(30_000n);
  });
  it("skips paid/terminal invoices", () => {
    const result = allocatePayment(10_000n, [
      target("p", 30_000, 30_000, "2026-11-01", "paid"),
      target("w", 30_000, 0, "2026-11-01", "written_off"),
      target("o", 30_000, 0, "2026-11-05"),
    ]);
    expect(result.allocations.map((a) => a.invoiceId)).toEqual(["o"]);
  });
  it("zero or negative payment allocates nothing and is all credit-free zero", () => {
    const result = allocatePayment(0n, [target("a", 30_000, 0, "2026-11-01")]);
    expect(result.allocations).toEqual([]);
    expect(result.creditMinor).toBe(0n);
  });
  it("explicit allocations are validated: sum, per-invoice outstanding, duplicates, positivity", () => {
    const targets = [target("a", 30_000, 0, "2026-11-01"), target("b", 50_000, 10_000, "2026-11-10", "partially_paid")];
    expect(() => validateExplicitAllocations(100_000n, [
      { invoiceId: "a", amountMinor: 30_000n }, { invoiceId: "b", amountMinor: 40_000n },
    ], targets)).not.toThrow();
    expect(() => validateExplicitAllocations(60_000n, [
      { invoiceId: "a", amountMinor: 30_000n }, { invoiceId: "b", amountMinor: 40_000n },
    ], targets)).toThrow(AllocationError); // sum exceeds payment
    expect(() => validateExplicitAllocations(100_000n, [
      { invoiceId: "b", amountMinor: 40_001n },
    ], targets)).toThrow(/exceeds outstanding/);
    expect(() => validateExplicitAllocations(100_000n, [
      { invoiceId: "a", amountMinor: 1n }, { invoiceId: "a", amountMinor: 1n },
    ], targets)).toThrow(/duplicate/);
    expect(() => validateExplicitAllocations(100_000n, [
      { invoiceId: "a", amountMinor: 0n },
    ], targets)).toThrow(/positive/);
    expect(() => validateExplicitAllocations(100_000n, [
      { invoiceId: "nope", amountMinor: 1n },
    ], targets)).toThrow(/unknown invoice/);
  });
});
