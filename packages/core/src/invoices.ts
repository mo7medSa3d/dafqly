/**
 * Invoice status machine, overdue/aging derivation and payment allocation
 * (BUILD_PLAN §5, §6, F1). Pure domain logic: no IO, money is bigint minor
 * units throughout.
 */

export const INVOICE_STATUSES = ["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Explicit transition table (§6: "transitions are explicit and tested").
 * Payment-driven moves (open <-> partially_paid <-> paid) are computed by
 * deriveStatusFromPaid; this table governs every legal from->to pair,
 * including reversals (paid -> partially_paid/open when a confirmed payment
 * is rejected) and dispute resolution (disputed -> any live state).
 * written_off and cancelled are terminal.
 */
const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  open: ["partially_paid", "paid", "disputed", "written_off", "cancelled"],
  partially_paid: ["open", "paid", "disputed", "written_off", "cancelled"],
  paid: ["open", "partially_paid", "disputed"],
  disputed: ["open", "partially_paid", "paid", "written_off", "cancelled"],
  written_off: [],
  cancelled: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvoiceTransitionError extends Error {
  constructor(from: InvoiceStatus, to: InvoiceStatus) {
    super(`Illegal invoice status transition: ${from} -> ${to}`);
    this.name = "InvoiceTransitionError";
  }
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new InvoiceTransitionError(from, to);
}

export function isTerminalStatus(status: InvoiceStatus): boolean {
  return status === "written_off" || status === "cancelled";
}

/** Status implied purely by the confirmed paid amount. */
export function deriveStatusFromPaid(amountMinor: bigint, paidMinor: bigint): InvoiceStatus {
  if (paidMinor <= 0n) return "open";
  if (paidMinor < amountMinor) return "partially_paid";
  return "paid";
}

/**
 * Status after paid_minor is recomputed from confirmed allocations.
 * Terminal invoices never move; disputed invoices resolve to the derived
 * status once money fully settles them, otherwise keep their derived state.
 */
export function resolveStatusAfterPayment(current: InvoiceStatus, amountMinor: bigint, paidMinor: bigint): InvoiceStatus {
  if (isTerminalStatus(current)) return current;
  return deriveStatusFromPaid(amountMinor, paidMinor);
}

export function outstandingMinor(amountMinor: bigint, paidMinor: bigint): bigint {
  const due = amountMinor - paidMinor;
  return due > 0n ? due : 0n;
}

// --------------------------------------------------------------------- dates
const DAY_MS = 86_400_000;
function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function utcMsToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return utcMsToIso(isoToUtcMs(iso) + days * DAY_MS);
}

/** Invoice with no due date is due on issue date + tenant default terms (F1 edge case). */
export function resolveDueOn(issuedOn: string, dueOn: string | null | undefined, defaultTermsDays: number): string {
  return dueOn ?? addDaysIso(issuedOn, defaultTermsDays);
}

/** Whole days `today` is past `dueOn` (negative when not yet due). */
export function daysOverdue(dueOn: string, today: string): number {
  return Math.round((isoToUtcMs(today) - isoToUtcMs(dueOn)) / DAY_MS);
}

/** Overdue is derived, never stored (§5): open/partially_paid and due before today. */
export function isOverdue(status: InvoiceStatus, dueOn: string, today: string): boolean {
  return (status === "open" || status === "partially_paid") && dueOn < today;
}

export type AgingBucket = "current" | "0-7" | "8-30" | "31-60" | "60+";
export const AGING_BUCKETS: readonly AgingBucket[] = ["current", "0-7", "8-30", "31-60", "60+"];

export function agingBucket(dueOn: string, today: string): AgingBucket {
  const days = daysOverdue(dueOn, today);
  if (days < 0) return "current";
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 60) return "31-60";
  return "60+";
}

// ---------------------------------------------------------------- allocation
export interface AllocationTarget {
  invoiceId: string;
  amountMinor: bigint;
  paidMinor: bigint;
  dueOn: string; // YYYY-MM-DD
  status: InvoiceStatus;
}

export interface AllocationResult {
  allocations: { invoiceId: string; amountMinor: bigint; newPaidMinor: bigint; newStatus: InvoiceStatus }[];
  allocatedMinor: bigint;
  /** Unallocated remainder: a credit balance on the debtor, never negative invoices (§6). */
  creditMinor: bigint;
}

const ALLOCATABLE: ReadonlySet<InvoiceStatus> = new Set(["open", "partially_paid", "disputed"]);

function applyToTarget(target: AllocationTarget, amount: bigint) {
  const newPaidMinor = target.paidMinor + amount;
  return {
    invoiceId: target.invoiceId,
    amountMinor: amount,
    newPaidMinor,
    newStatus: resolveStatusAfterPayment(target.status, target.amountMinor, newPaidMinor),
  };
}

/**
 * Auto-allocation: oldest due date first (then invoice id for determinism),
 * filling each invoice's outstanding before moving on. Disputed invoices are
 * NOT auto-allocated (money waits for the dispute to resolve) unless they are
 * passed explicitly by the merchant.
 */
export function allocatePayment(paymentMinor: bigint, targets: readonly AllocationTarget[]): AllocationResult {
  if (paymentMinor <= 0n) return { allocations: [], allocatedMinor: 0n, creditMinor: 0n };
  const eligible = targets
    .filter((t) => (t.status === "open" || t.status === "partially_paid") && outstandingMinor(t.amountMinor, t.paidMinor) > 0n)
    .slice()
    .sort((a, b) => (a.dueOn === b.dueOn ? (a.invoiceId < b.invoiceId ? -1 : 1) : a.dueOn < b.dueOn ? -1 : 1));
  const allocations: AllocationResult["allocations"] = [];
  let remaining = paymentMinor;
  for (const t of eligible) {
    if (remaining <= 0n) break;
    const due = outstandingMinor(t.amountMinor, t.paidMinor);
    const take = due < remaining ? due : remaining;
    allocations.push(applyToTarget(t, take));
    remaining -= take;
  }
  return { allocations, allocatedMinor: paymentMinor - remaining, creditMinor: remaining };
}

export class AllocationError extends Error {
  constructor(reason: string) {
    super(`Invalid allocation: ${reason}`);
    this.name = "AllocationError";
  }
}

/** Validates merchant-specified allocations against the payment and the invoices' outstanding. */
export function validateExplicitAllocations(
  paymentMinor: bigint,
  allocations: readonly { invoiceId: string; amountMinor: bigint }[],
  targets: readonly AllocationTarget[],
): AllocationResult {
  const byId = new Map(targets.map((t) => [t.invoiceId, t]));
  const seen = new Set<string>();
  let sum = 0n;
  const applied: AllocationResult["allocations"] = [];
  for (const a of allocations) {
    if (a.amountMinor <= 0n) throw new AllocationError(`amount for invoice ${a.invoiceId} must be positive`);
    if (seen.has(a.invoiceId)) throw new AllocationError(`duplicate allocation for invoice ${a.invoiceId}`);
    seen.add(a.invoiceId);
    const target = byId.get(a.invoiceId);
    if (!target) throw new AllocationError(`unknown invoice ${a.invoiceId}`);
    if (!ALLOCATABLE.has(target.status)) throw new AllocationError(`invoice ${a.invoiceId} is ${target.status} and cannot take payments`);
    if (a.amountMinor > outstandingMinor(target.amountMinor, target.paidMinor)) {
      throw new AllocationError(`amount for invoice ${a.invoiceId} exceeds outstanding`);
    }
    sum += a.amountMinor;
    applied.push(applyToTarget(target, a.amountMinor));
  }
  if (sum > paymentMinor) throw new AllocationError("allocations exceed the payment amount");
  return { allocations: applied, allocatedMinor: sum, creditMinor: paymentMinor - sum };
}
