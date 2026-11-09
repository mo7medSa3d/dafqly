/**
 * Per-debtor timeline merge (F1). Event kinds arrive with their milestones —
 * invoices and payments in M1, messages in M2, disputes recorded from M1 as
 * audit/dispute transitions — and all flow through this one pure merge so
 * ordering is tested once, in core.
 */
export type TimelineEventKind = "invoice" | "payment" | "message" | "dispute" | "audit";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  /** ISO instant of the event. */
  at: string;
  summary: string;
  amountMinor?: string; // bigint serialized, when the event carries money
  status?: string;
}

/** At equal instants, a payment settles before the invoice state it caused is narrated; deterministic id tie-break last. */
const KIND_ORDER: Record<TimelineEventKind, number> = { payment: 0, dispute: 1, message: 2, invoice: 3, audit: 4 };

export function mergeTimeline(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.slice().sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1; // newest first
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kindDiff !== 0) return kindDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
