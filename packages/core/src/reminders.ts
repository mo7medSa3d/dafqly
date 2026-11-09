import { nextAllowedSlot, zonedTimeToUtc, localDateOf, type SchedulePolicy } from "./time";
import { addDaysIso } from "./invoices";

/**
 * Reminder engine pure logic (BUILD_PLAN F4 + §6, F3): step planning,
 * opt-out keywords, message status ordering, provider error classification
 * (ADR-015), retry backoff, the quality guard and §6 grouping. Everything
 * here is pure and clock-injected; DB/provider work lives in
 * @tahseel/reminders (ADR-016).
 */

export interface PlanPolicy extends SchedulePolicy {
  weeklyCap: number;
  /** Local wall-clock time steps fire at (before quiet-hours adjustment). */
  sendTimeLocal: string;
}
export const DEFAULT_WEEKLY_CAP = 3;

export interface ReminderStepDef { stepKey: string; offsetDays: number }
export const DEFAULT_REMINDER_STEPS: ReminderStepDef[] = [
  { stepKey: "d-3", offsetDays: -3 },
  { stepKey: "d0", offsetDays: 0 },
  { stepKey: "d+3", offsetDays: 3 },
  { stepKey: "d+7", offsetDays: 7 },
  { stepKey: "d+14", offsetDays: 14 },
  { stepKey: "weekly", offsetDays: 21 },
];
/** Hard cap (§7-F4): never more than 6 reminders per invoice. */
export const MAX_REMINDERS_PER_INVOICE = 6;

export interface PlanInvoiceInput {
  id: string;
  status: "open" | "partially_paid" | "paid" | "disputed" | "written_off" | "cancelled";
  dueOn: string; // YYYY-MM-DD
}
export interface PlannedStep {
  invoiceId: string;
  stepKey: string;
  channel: "whatsapp";
  templateKey: "invoice_upcoming" | "invoice_due_today" | "invoice_overdue";
  dueAt: Date;
}

function templateForOffset(offsetDays: number): PlannedStep["templateKey"] {
  if (offsetDays < 0) return "invoice_upcoming";
  if (offsetDays === 0) return "invoice_due_today";
  return "invoice_overdue";
}

/**
 * The plan for one invoice: default steps relative to the DUE DATE (not to
 * today), each at the policy send time in the tenant timezone, pushed out of
 * quiet hours by nextAllowedSlot. Steps already past at `now` are not
 * planned (no catch-up spam). Only open/partially_paid invoices get steps.
 */
export function planReminders(invoice: PlanInvoiceInput, policy: PlanPolicy, now: Date, opts: { notBefore?: Date } = {}): PlannedStep[] {
  if (invoice.status !== "open" && invoice.status !== "partially_paid") return [];
  const steps: PlannedStep[] = [];
  for (const def of DEFAULT_REMINDER_STEPS.slice(0, MAX_REMINDERS_PER_INVOICE)) {
    const localDate = addDaysIso(invoice.dueOn, def.offsetDays);
    const raw = zonedTimeToUtc(localDate, policy.sendTimeLocal, policy.timezone);
    const dueAt = nextAllowedSlot(raw, policy);
    if (dueAt.getTime() < now.getTime()) continue;
    // F8 promise override point: a debtor's promise pushes every planned
    // step to the promised date or later (the engine's promise path moves
    // the earliest existing reminder to promised+1 and re-plans the rest
    // through here so no step can fire before the promise matures).
    if (opts.notBefore && dueAt.getTime() < opts.notBefore.getTime()) continue;
    steps.push({ invoiceId: invoice.id, stepKey: def.stepKey, channel: "whatsapp", templateKey: templateForOffset(def.offsetDays), dueAt });
  }
  return steps;
}

// ---------------------------------------------------------------- opt-out

const OPT_OUT_KEYWORDS = [
  "إيقاف", "ايقاف", "إيقاف التذكيرات", "ايقاف التذكيرات", "إلغاء", "الغاء",
  "إلغاء الاشتراك", "stop", "unsubscribe", "لا ترسل", "لاترسل",
];

/**
 * Keyword opt-out detection (runs BEFORE any LLM, F4/F8 — recall matters
 * more than precision, but long conversational messages must not misfire):
 * matches when the whole normalized message is the keyword, or the message
 * is just the keyword plus punctuation/whitespace.
 */
export function isOptOutText(text: string): boolean {
  const normalized = text
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/[.!؟?،,,;؛:]+$/u, "")
    .trim()
    .toLowerCase();
  if (OPT_OUT_KEYWORDS.includes(normalized)) return true;
  // "إيقاف لو سمحت" style: keyword as a complete short message (<= 3 words).
  const words = normalized.split(/\s+/);
  return words.length <= 3 && OPT_OUT_KEYWORDS.some((k) => normalized === k || normalized.startsWith(`${k} `));
}

// ------------------------------------------------- message status ordering

export type ProviderMessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";
const STATUS_ORDER: Record<Exclude<ProviderMessageStatus, "failed">, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** Out-of-order status webhooks must never move a message backwards (§7-F3). */
export function canAdvanceMessageStatus(current: ProviderMessageStatus, next: ProviderMessageStatus): boolean {
  if (current === "failed") return false;
  if (next === "failed") return current === "queued" || current === "sent";
  return STATUS_ORDER[next] > STATUS_ORDER[current];
}

// ------------------------------------------------ provider error taxonomy

export type ProviderErrorKind = "rate_limit" | "temporary" | "not_reachable" | "policy" | "template" | "reengagement" | "unknown";
export interface ClassifiedError { kind: ProviderErrorKind; retryable: boolean }

/** Error-code mapping verified against Meta's docs in ADR-015. */
export function classifyProviderError(code: number): ClassifiedError {
  if (code === 130429 || code === 131048 || code === 131056) return { kind: "rate_limit", retryable: true };
  if (code === 131026) return { kind: "not_reachable", retryable: false };
  if (code === 131047) return { kind: "reengagement", retryable: false };
  if (code === 132000 || code === 132001 || code === 132015 || code === 132016) return { kind: "template", retryable: false };
  if (code === 131030 || code === 131031) return { kind: "policy", retryable: false };
  if (code === 131000 || code === 131016 || code >= 500) return { kind: "temporary", retryable: true };
  return { kind: "unknown", retryable: false };
}

/** Exponential backoff with jitter (§7-F4): 1s, 2s, 4s … capped at 60s. */
export function backoffDelayMs(attempt: number, rng: () => number = Math.random): number {
  const base = Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
  return base + Math.floor(rng() * 250);
}
export const MAX_SEND_ATTEMPTS = 5;

// ------------------------------------------------------------ quality guard

export interface QualityStats { sent: number; failed: number; blocked: number }
export interface QualityVerdict { pause: boolean; failureRate: number; blockRate: number; reason: string | null }

/**
 * F3 quality guard: auto-pause a tenant whose delivery failure rate exceeds
 * 20% (over at least 20 sends) or whose block/opt-out rate exceeds 5%.
 */
export function evaluateQualityGuard(stats: QualityStats): QualityVerdict {
  const failureRate = stats.sent > 0 ? stats.failed / stats.sent : 0;
  const blockRate = stats.sent > 0 ? stats.blocked / stats.sent : 0;
  if (stats.sent >= 20 && failureRate > 0.2) {
    return { pause: true, failureRate, blockRate, reason: `failure rate ${(failureRate * 100).toFixed(1)}% over ${stats.sent} sends` };
  }
  if (stats.sent >= 20 && blockRate > 0.05) {
    return { pause: true, failureRate, blockRate, reason: `block rate ${(blockRate * 100).toFixed(1)}% over ${stats.sent} sends` };
  }
  return { pause: false, failureRate, blockRate, reason: null };
}

// ----------------------------------------------------------------- grouping

export interface DueReminderLike { id: string; debtorId: string; channel: "whatsapp" | "sms"; dueAt: Date }
export interface ReminderGroup { key: string; debtorId: string; channel: "whatsapp" | "sms"; localDay: string; reminderIds: string[] }

/** §6 grouping: one consolidated message per debtor + channel + tenant-local day. */
export function groupDueReminders(items: DueReminderLike[], timezone: string): ReminderGroup[] {
  const map = new Map<string, ReminderGroup>();
  for (const item of items) {
    const localDay = localDateOf(item.dueAt, timezone);
    const key = `${item.debtorId}|${item.channel}|${localDay}`;
    const group = map.get(key) ?? { key, debtorId: item.debtorId, channel: item.channel, localDay, reminderIds: [] };
    group.reminderIds.push(item.id);
    map.set(key, group);
  }
  return [...map.values()];
}
