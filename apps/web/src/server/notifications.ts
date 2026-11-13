import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  buildOperationalNotificationCandidates,
  normalizeCurrencyCode,
  type NotificationCandidate,
} from "@tahseel/core";
import { withTenant, type Db } from "@tahseel/db";
import {
  cheques,
  debtors,
  disputes,
  invoices,
  messageIntents,
  messages,
  notifications,
  payments,
  tenants,
} from "@tahseel/db/schema";
import { getQuotaStatus } from "./billing";

export interface NotificationView {
  id: string;
  kind: string;
  severity: "info" | "warning" | "urgent" | "success";
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  actionUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

function toNotificationView(r: typeof notifications.$inferSelect): NotificationView {
  return {
    id: r.id,
    kind: r.kind,
    severity: (r.severity as NotificationView["severity"]) ?? "info",
    titleAr: r.titleAr,
    titleEn: r.titleEn,
    bodyAr: r.bodyAr,
    bodyEn: r.bodyEn,
    actionUrl: r.actionUrl ?? null,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Insert a notification idempotently inside an existing `withTenant` transaction.
 * Duplicate `dedupeKey` for the tenant is a silent no-op (respecting already
 * read/dismissed notifications so dismissed alerts do not re-appear).
 */
export async function upsertNotificationInTx(
  tx: Db,
  tenantId: string,
  candidate: NotificationCandidate,
): Promise<void> {
  await tx
    .insert(notifications)
    .values({
      id: uuidv7(),
      tenantId,
      kind: candidate.kind,
      severity: candidate.severity,
      titleAr: candidate.titleAr,
      titleEn: candidate.titleEn,
      bodyAr: candidate.bodyAr,
      bodyEn: candidate.bodyEn,
      actionUrl: candidate.actionUrl,
      entityType: candidate.entityType ?? null,
      entityId: candidate.entityId ?? null,
      dedupeKey: candidate.dedupeKey,
    })
    .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] });
}

export async function emitNotification(
  app: Db,
  tenantId: string,
  candidate: NotificationCandidate,
): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    await upsertNotificationInTx(tx, tenantId, candidate);
  });
}

function addDaysIso(iso: string, days: number): string {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Scans current tenant operational signals (open disputes, claimed receipt
 * payments, human-inbox replies, cheques due/bounced, >14d overdue debtors,
 * monthly quota warnings, and daily briefing) and materializes missing
 * notifications idempotently.
 */
export async function syncWorkspaceNotifications(
  app: Db,
  tenantId: string,
  todayIso: string,
  briefingSummary?: { summaryAr: string; summaryEn: string },
): Promise<{ created: number; truncatedCategories: string[] }> {
  const dueWindowEnd = addDaysIso(todayIso, 3);
  const overdueCutoff = addDaysIso(todayIso, -14);

  let quotaRatio: number | null = null;
  try {
    const q = await getQuotaStatus(app, tenantId, new Date());
    quotaRatio = q.quota ? q.ratio : null;
  } catch (err) {
    // Quota warnings degrade gracefully, but a failing quota lookup must
    // not vanish silently — it usually means the DB is unhappy.
    console.warn("[notifications] quota lookup failed during sync", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    quotaRatio = null;
  }

  return withTenant(app, tenantId, async (tx) => {
    const [claimRows, disputeRows, intentRows, chequeRows, overdueRows, tenantRow] = await Promise.all([
      tx
        .select({
          id: payments.id,
          debtorId: payments.debtorId,
          debtorName: debtors.displayName,
          amountMinor: payments.amountMinor,
        })
        .from(payments)
        .innerJoin(debtors, eq(debtors.id, payments.debtorId))
        .where(eq(payments.status, "claimed"))
        .limit(11),
      tx
        .select({
          id: disputes.id,
          debtorId: disputes.debtorId,
          debtorName: debtors.displayName,
          invoiceRef: invoices.reference,
        })
        .from(disputes)
        .innerJoin(debtors, eq(debtors.id, disputes.debtorId))
        .innerJoin(invoices, eq(invoices.id, disputes.invoiceId))
        .where(eq(disputes.status, "open"))
        .limit(11),
      tx
        .select({
          id: messageIntents.id,
          intent: messageIntents.intent,
          bodySnippet: messages.bodyText,
        })
        .from(messageIntents)
        .innerJoin(messages, eq(messages.id, messageIntents.messageId))
        .where(and(eq(messageIntents.resolvedBy, "human"), eq(messageIntents.actionTaken, "human_inbox")))
        .limit(11),
      tx
        .select({
          id: cheques.id,
          number: cheques.number,
          debtorName: debtors.displayName,
          dueDate: cheques.dueDate,
          amountMinor: cheques.amountMinor,
          status: cheques.status,
        })
        .from(cheques)
        .innerJoin(debtors, eq(debtors.id, cheques.debtorId))
        .where(
          sql`(${cheques.status} = 'bounced' OR (${cheques.status} IN ('held', 'deposited') AND ${cheques.dueDate} <= ${dueWindowEnd}))`,
        )
        .limit(11),
      tx
        .select({
          debtorId: debtors.id,
          displayName: debtors.displayName,
          dueOn: invoices.dueOn,
          remainingMinor: sql<string>`(${invoices.amountMinor} - ${invoices.paidMinor})::text`,
        })
        .from(invoices)
        .innerJoin(debtors, eq(debtors.id, invoices.debtorId))
        .where(
          and(
            isNull(debtors.deletedAt),
            inArray(invoices.status, ["open", "partially_paid"]),
            lte(invoices.dueOn, overdueCutoff),
          ),
        )
        .limit(31),
      // F-06: tenant display currency for the notification amounts.
      tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    ]);

    // Each category query fetched cap+1 rows: a full page means more items
    // exist than this sync can notify about — surface that instead of
    // silently dropping the rest.
    const truncatedCategories: string[] = [];
    const take = <T,>(rows: T[], cap: number, category: string): T[] => {
      if (rows.length > cap) truncatedCategories.push(category);
      return rows.slice(0, cap);
    };
    const claimRowsCapped = take(claimRows, 10, "claims");
    const disputeRowsCapped = take(disputeRows, 10, "disputes");
    const intentRowsCapped = take(intentRows, 10, "intents");
    const chequeRowsCapped = take(chequeRows, 10, "cheques");
    const overdueRowsCapped = take(overdueRows, 30, "overdue");

    const overdueByDebtor = new Map<string, { debtorId: string; displayName: string; overdueMinor: bigint; maxDaysOverdue: number }>();
    const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
    for (const r of overdueRowsCapped) {
      const rem = BigInt(r.remainingMinor || "0");
      if (rem <= 0n) continue;
      const dueMs = Date.parse(`${r.dueOn}T00:00:00Z`);
      const days = Math.max(0, Math.floor((todayMs - dueMs) / 86_400_000));
      const cur = overdueByDebtor.get(r.debtorId);
      if (cur) {
        cur.overdueMinor += rem;
        if (days > cur.maxDaysOverdue) cur.maxDaysOverdue = days;
      } else {
        overdueByDebtor.set(r.debtorId, {
          debtorId: r.debtorId,
          displayName: r.displayName,
          overdueMinor: rem,
          maxDaysOverdue: days,
        });
      }
    }

    const candidates = buildOperationalNotificationCandidates({
      todayIso,
      pendingClaims: claimRowsCapped,
      openDisputes: disputeRowsCapped,
      humanIntents: intentRowsCapped.map((i) => ({ id: i.id, intent: i.intent, bodySnippet: i.bodySnippet ?? "" })),
      upcomingCheques: chequeRowsCapped,
      severeOverdueDebtors: [...overdueByDebtor.values()].sort((a, b) =>
        b.overdueMinor > a.overdueMinor ? 1 : b.overdueMinor < a.overdueMinor ? -1 : 0,
      ),
      quotaRatio,
      briefingSummaryAr: briefingSummary?.summaryAr,
      briefingSummaryEn: briefingSummary?.summaryEn,
      currency: normalizeCurrencyCode(tenantRow?.[0]?.settings?.currency),
    });

    if (candidates.length === 0) return { created: 0, truncatedCategories };

    const inserted = await tx
      .insert(notifications)
      .values(
        candidates.map((c) => ({
          id: uuidv7(),
          tenantId,
          kind: c.kind,
          severity: c.severity,
          titleAr: c.titleAr,
          titleEn: c.titleEn,
          bodyAr: c.bodyAr,
          bodyEn: c.bodyEn,
          actionUrl: c.actionUrl,
          entityType: c.entityType ?? null,
          entityId: c.entityId ?? null,
          dedupeKey: c.dedupeKey,
        })),
      )
      .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })
      .returning({ id: notifications.id });

    return { created: inserted.length, truncatedCategories };
  });
}

export async function listNotifications(
  app: Db,
  tenantId: string,
  opts: { onlyUnread?: boolean; limit?: number } = {},
): Promise<{ items: NotificationView[]; unreadCount: number; urgentCount: number }> {
  return withTenant(app, tenantId, async (tx) => {
    const conds = [isNull(notifications.dismissedAt)];
    if (opts.onlyUnread) conds.push(isNull(notifications.readAt));

    const [rows, counts] = await Promise.all([
      tx
        .select()
        .from(notifications)
        .where(and(...conds))
        .orderBy(desc(notifications.createdAt))
        .limit(opts.limit ?? 30),
      tx
        .select({
          unreadCount: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int`,
          urgentCount: sql<number>`count(*) filter (where ${notifications.readAt} is null and ${notifications.severity} = 'urgent')::int`,
        })
        .from(notifications)
        .where(isNull(notifications.dismissedAt)),
    ]);

    return {
      items: rows.map(toNotificationView),
      unreadCount: Number(counts[0]?.unreadCount ?? 0),
      urgentCount: Number(counts[0]?.urgentCount ?? 0),
    };
  });
}

export async function markNotificationRead(app: Db, tenantId: string, id: string): Promise<{ ok: true }> {
  await withTenant(app, tenantId, async (tx) => {
    const now = new Date();
    await tx
      .update(notifications)
      .set({ readAt: now, updatedAt: now })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
  });
  return { ok: true };
}

export async function markAllNotificationsRead(app: Db, tenantId: string): Promise<{ ok: true }> {
  await withTenant(app, tenantId, async (tx) => {
    const now = new Date();
    await tx
      .update(notifications)
      .set({ readAt: now, updatedAt: now })
      .where(and(isNull(notifications.dismissedAt), isNull(notifications.readAt)));
  });
  return { ok: true };
}

export async function dismissNotification(app: Db, tenantId: string, id: string): Promise<{ ok: true }> {
  await withTenant(app, tenantId, async (tx) => {
    const now = new Date();
    await tx
      .update(notifications)
      .set({
        dismissedAt: now,
        readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(eq(notifications.id, id));
  });
  return { ok: true };
}
