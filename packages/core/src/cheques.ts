import { z } from "zod";
import { addDaysIso } from "./invoices";

/**
 * Cheque domain logic (BUILD_PLAN F9, §5): the explicit status machine,
 * due-date alerts and calendar grouping. Pure functions only; persistence
 * and payment effects live in the web cheque service. Money is integer
 * minor units everywhere.
 */

export const CHEQUE_STATUSES = ["held", "deposited", "cleared", "bounced", "returned", "cancelled"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];
export type ChequeDirection = "receivable" | "payable";

/**
 * The F9 machine, pinned by the acceptance criteria: a cheque is HELD when
 * registered, DEPOSITED at the bank, then CLEARED or BOUNCED (or RETURNED
 * uncashed). A held cheque may also be RETURNED to its drawer or CANCELLED.
 * cleared/bounced/returned/cancelled are terminal.
 */
const TRANSITIONS: Record<ChequeStatus, readonly ChequeStatus[]> = {
  held: ["deposited", "returned", "cancelled"],
  deposited: ["cleared", "bounced", "returned"],
  cleared: [],
  bounced: [],
  returned: [],
  cancelled: [],
};

export function canTransitionCheque(from: ChequeStatus, to: ChequeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class ChequeTransitionError extends Error {
  constructor(from: ChequeStatus, to: ChequeStatus) {
    super(`Illegal cheque status transition: ${from} -> ${to}`);
    this.name = "ChequeTransitionError";
  }
}

export function assertChequeTransition(from: ChequeStatus, to: ChequeStatus): void {
  if (!canTransitionCheque(from, to)) throw new ChequeTransitionError(from, to);
}

export function isTerminalChequeStatus(status: ChequeStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

// ------------------------------------------------------------------- alerts
export type ChequeAlertKind = "due_in_3_days" | "due_today";

/**
 * F9 alerts: exactly 3 days before the due date and on the due date itself,
 * for cheques still in play (held or deposited — a cleared/bounced cheque
 * needs no reminder). The caller persists one alert row per (cheque, kind),
 * which is what makes the alert job idempotent.
 */
export function dueAlertKind(
  cheque: { dueDate: string; status: ChequeStatus },
  today: string,
): ChequeAlertKind | null {
  if (cheque.status !== "held" && cheque.status !== "deposited") return null;
  if (cheque.dueDate === today) return "due_today";
  if (cheque.dueDate === addDaysIso(today, 3)) return "due_in_3_days";
  return null;
}

// ----------------------------------------------------------------- calendar
export interface ChequeWeekGroup<T> {
  /** ISO date (YYYY-MM-DD) of the Monday starting the week. */
  weekStart: string;
  cheques: T[];
}

/** Monday (ISO) of the week containing an ISO date. */
export function mondayOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0=Sun..6=Sat
  const offset = (dow + 6) % 7; // days since Monday
  return addDaysIso(isoDate, -offset);
}

/** F9 calendar view: cheques grouped by the ISO week of their due date, weeks ascending, cheques by due date then id. */
export function groupChequesByWeek<T extends { dueDate: string; id: string }>(cheques: readonly T[]): ChequeWeekGroup<T>[] {
  const byWeek = new Map<string, T[]>();
  for (const c of cheques) {
    const week = mondayOfWeek(c.dueDate);
    const list = byWeek.get(week) ?? [];
    list.push(c);
    byWeek.set(week, list);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, list]) => ({
      weekStart,
      cheques: list.sort((a, b) => (a.dueDate === b.dueDate ? (a.id < b.id ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1)),
    }));
}

// ------------------------------------------------- photo extraction (claim)
/**
 * Cheque photo extraction (F9 via the F6/F7 vision pipeline): the model's
 * output is an untrusted CLAIM the merchant reviews in a pre-filled form —
 * it is never registered directly. Zod-validated like every LLM output
 * (hard rule 4); invalid output parses to null and the merchant types the
 * cheque by hand.
 */
export const chequeExtractionSchema = z.object({
  number: z.string().trim().min(1).max(40).nullable(),
  bank: z.string().trim().min(1).max(120).nullable(),
  amount_minor: z.number().int().positive().nullable(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  drawer_name: z.string().trim().nullable().optional().default(null),
  payee_name: z.string().trim().nullable().optional().default(null),
  confidence: z.number().min(0).max(1),
});
export type ChequeExtraction = z.infer<typeof chequeExtractionSchema>;

export function parseChequeExtraction(input: unknown): ChequeExtraction | null {
  const parsed = chequeExtractionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
