import { describe, it, expect } from "vitest";
import {
  CHEQUE_STATUSES, canTransitionCheque, assertChequeTransition, ChequeTransitionError,
  isTerminalChequeStatus, dueAlertKind, mondayOfWeek, groupChequesByWeek, parseChequeExtraction,
  type ChequeStatus,
} from "./cheques";

describe("cheque status machine (F9, exhaustive 6x6)", () => {
  const legal: Record<ChequeStatus, ChequeStatus[]> = {
    held: ["deposited", "returned", "cancelled"],
    deposited: ["cleared", "bounced", "returned"],
    cleared: [], bounced: [], returned: [], cancelled: [],
  };
  it("allows exactly the legal transitions", () => {
    for (const from of CHEQUE_STATUSES) {
      for (const to of CHEQUE_STATUSES) {
        expect(canTransitionCheque(from, to), `${from} -> ${to}`).toBe(legal[from].includes(to));
      }
    }
  });
  it("assert throws ChequeTransitionError on illegal moves", () => {
    expect(() => assertChequeTransition("cleared", "held")).toThrow(ChequeTransitionError);
    expect(() => assertChequeTransition("held", "cleared")).toThrow(ChequeTransitionError);
    expect(() => assertChequeTransition("deposited", "cancelled")).toThrow(ChequeTransitionError);
  });
  it("terminal statuses are cleared/bounced/returned/cancelled", () => {
    expect(CHEQUE_STATUSES.filter(isTerminalChequeStatus)).toEqual(["cleared", "bounced", "returned", "cancelled"]);
  });
});

describe("dueAlertKind (F9 alerts)", () => {
  // today = 2026-11-09 (Monday). due 2026-11-12 = +3 days.
  it("fires due_in_3_days exactly three days before", () => {
    expect(dueAlertKind({ dueDate: "2026-11-12", status: "held" }, "2026-11-09")).toBe("due_in_3_days");
    expect(dueAlertKind({ dueDate: "2026-11-12", status: "deposited" }, "2026-11-09")).toBe("due_in_3_days");
  });
  it("fires due_today on the due date", () => {
    expect(dueAlertKind({ dueDate: "2026-11-09", status: "held" }, "2026-11-09")).toBe("due_today");
  });
  it("is silent on other days and for terminal cheques", () => {
    expect(dueAlertKind({ dueDate: "2026-11-11", status: "held" }, "2026-11-09")).toBeNull();
    expect(dueAlertKind({ dueDate: "2026-11-08", status: "held" }, "2026-11-09")).toBeNull();
    expect(dueAlertKind({ dueDate: "2026-11-09", status: "cleared" }, "2026-11-09")).toBeNull();
    expect(dueAlertKind({ dueDate: "2026-11-12", status: "bounced" }, "2026-11-09")).toBeNull();
  });
});

describe("calendar grouping (F9)", () => {
  it("mondayOfWeek pins Monday starts (2026-11-09 IS a Monday)", () => {
    expect(mondayOfWeek("2026-11-09")).toBe("2026-11-09"); // Mon
    expect(mondayOfWeek("2026-11-15")).toBe("2026-11-09"); // Sun
    expect(mondayOfWeek("2026-11-16")).toBe("2026-11-16"); // next Mon
  });
  it("groups by due week, sorted", () => {
    const groups = groupChequesByWeek([
      { id: "b", dueDate: "2026-11-20" },
      { id: "a", dueDate: "2026-11-10" },
      { id: "c", dueDate: "2026-11-09" },
    ]);
    expect(groups.map((g) => g.weekStart)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(groups[0]!.cheques.map((c) => c.id)).toEqual(["c", "a"]);
    expect(groups[1]!.cheques.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("parseChequeExtraction (untrusted LLM output)", () => {
  it("accepts a valid extraction and rejects junk to null", () => {
    expect(parseChequeExtraction({ number: "123", bank: "CIB", amount_minor: 50000, issue_date: "2026-11-01", due_date: "2026-12-01", confidence: 0.9 })?.amount_minor).toBe(50000);
    expect(parseChequeExtraction({ number: "123", confidence: 2 })).toBeNull();
    expect(parseChequeExtraction("garbage")).toBeNull();
    expect(parseChequeExtraction(null)).toBeNull();
  });
});
