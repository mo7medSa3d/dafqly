import { z } from "zod";
import { decodeCursor, encodeCursor, type InvoiceStatus } from "@tahseel/core";
import { applyOptOut, resumeReminders } from "@tahseel/reminders";
import { router, publicProcedure, protectedProcedure, tenantProcedure } from "./trpc";
import { createTenantInput, createTenantForUser, listTenantsForUser, getDashboardSummary, todayInTimezone, getTenantSettingsAndIntegrations, updateTenantSettings, updateTenantSettingsInput } from "./services";
import {
  createDebtor, createDebtorInput, updateDebtor, softDeleteDebtor, listDebtorsPage2,
  createInvoice, createInvoiceInput, listInvoicesPage, updateInvoice, transitionInvoice,
  bulkTransitionInvoices, recordPayment, recordPaymentInput, getDebtorDetail, getDebtorTimeline,
} from "./ledger";
import { createImportPreview, createImportPreviewInput, updateImportMapping, getImportJob, listImportJobs, commitImport, undoImport, deleteImportJob } from "./imports";
import {
  createGatewayLink, createGatewayLinkInput, listPaymentLinks, refundGatewayPayment, refundInput,
  confirmClaimedPayment, rejectClaimedPayment, getReconciliation, gatewayDeps,
} from "./gateway";
import { createStatementLink, listStatementLinks, revokeStatementLink, listDisputes } from "./statements";
import { createLedgerJob, createLedgerJobInput, runLedgerExtraction, getLedgerJob, listLedgerJobs, updateLedgerRow, updateLedgerRowInput, commitLedgerJob, deleteLedgerJob } from "./ledger-ai";
import { processReceiptImage, listReceiptClaims } from "./receipts";
import { listIntents, resolveMessageIntent } from "./replies";
import { aiDeps, engineDeps } from "./engine";
import {
  registerCheque, registerChequeInput, listCheques, transitionCheque, getChequeCalendar,
  runChequeAlerts, listChequeAlerts, extractChequePhoto,
} from "./cheques";
import { getKpis, getForecast, exportInvoicesCsv, exportPaymentsCsv, exportDebtorsCsv } from "./reports";
import {
  getPlanCatalogue, getQuotaStatus, changePlan, changePlanInput, listSubscriptionInvoices,
  generateSubscriptionInvoices,
} from "./billing";
import { exportTenantData, deleteTenantData } from "./tenant-data";
import { FakePaymentProvider } from "@tahseel/providers";
import { paymentProviderFromEnv, realGatewayConfigured } from "./gateway";
import { globalSearch, listAuditTrail } from "./search";
import {
  mapWorkspaceHeaders, mapHeadersInput,
  analyzeWorkspaceReceipt, analyzeReceiptInput,
  generateWorkspaceNotification, generateNotificationInput,
  AI_WORKSPACE_TOOLS,
} from "./ai-workspace";
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  dismissNotification,
} from "./notifications";
import {
  getWorkspaceIntelligence, getDebtorIntelligence, askWorkspaceCopilot, copilotQueryInput,
} from "./intelligence";

const pageArgs = (input: { cursor?: string; limit?: number } | undefined) => ({
  cursor: input?.cursor ? decodeCursor(input.cursor) : undefined,
  limit: input?.limit,
});
const encodePage = <T extends { nextCursor: { id: string } | null }>(page: T) => ({
  ...page,
  nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
});

async function tenantMeta(ctx: { ownerDb: Parameters<typeof listTenantsForUser>[0]; user: { id: string }; tenantId: string }): Promise<{ today: string; businessName: string }> {
  const mine = await listTenantsForUser(ctx.ownerDb, ctx.user.id);
  const found = mine.find((m) => m.tenantId === ctx.tenantId);
  return {
    today: todayInTimezone(found?.timezone ?? "Africa/Cairo"),
    businessName: found?.businessNameAr ?? "DAFQLY",
  };
}

async function tenantToday(ctx: { ownerDb: Parameters<typeof listTenantsForUser>[0]; user: { id: string }; tenantId: string }): Promise<string> {
  return (await tenantMeta(ctx)).today;
}

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  tenant: {
    mine: protectedProcedure.query(async ({ ctx }) => listTenantsForUser(ctx.ownerDb, ctx.user.id)),
    create: protectedProcedure
      .input(createTenantInput)
      .mutation(async ({ ctx, input }) => createTenantForUser(ctx.appDb, ctx.user.id, input)),
    integrations: tenantProcedure.query(async ({ ctx }) => getTenantSettingsAndIntegrations(ctx.appDb, ctx.tenantId)),
    updateSettings: tenantProcedure
      .input(updateTenantSettingsInput)
      .mutation(async ({ ctx, input }) => updateTenantSettings(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
  },
  dashboard: {
    summary: tenantProcedure.query(async ({ ctx }) => {
      return getDashboardSummary(ctx.appDb, ctx.tenantId, await tenantToday(ctx));
    }),
  },
  debtors: {
    list: tenantProcedure
      .input(z.object({ cursor: z.string().optional(), limit: z.number().optional(), search: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return encodePage(await listDebtorsPage2(ctx.appDb, ctx.tenantId, { ...pageArgs(input), search: input?.search }));
      }),
    create: tenantProcedure
      .input(createDebtorInput)
      .mutation(async ({ ctx, input }) => createDebtor(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    update: tenantProcedure
      .input(z.object({ id: z.string().uuid(), displayName: z.string().trim().min(1).max(160).optional(), notes: z.string().max(2000).nullable().optional(), riskFlag: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => updateDebtor(ctx.appDb, ctx.tenantId, ctx.user.id, input.id, input)),
    remove: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => { await softDeleteDebtor(ctx.appDb, ctx.tenantId, ctx.user.id, input.id); return { ok: true }; }),
    toggleReminders: tenantProcedure
      .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const deps = engineDeps();
        if (input.enabled) {
          const res = await resumeReminders(deps, ctx.tenantId, input.id, new Date());
          return { ok: true, optedOut: false, plannedInvoices: res.plannedInvoices };
        } else {
          const res = await applyOptOut(deps, ctx.tenantId, input.id, new Date(), "merchant_manual");
          return { ok: true, optedOut: true, cancelledReminders: res.cancelledReminders };
        }
      }),
    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => getDebtorDetail(ctx.appDb, ctx.tenantId, input.id, await tenantToday(ctx))),
    timeline: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => getDebtorTimeline(ctx.appDb, ctx.tenantId, input.id)),
  },
  invoices: {
    list: tenantProcedure
      .input(z.object({
        cursor: z.string().optional(), limit: z.number().optional(),
        debtorId: z.string().uuid().optional(),
        status: z.enum(["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"]).optional(),
        overdue: z.boolean().optional(), agingBucket: z.string().optional(), search: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => encodePage(await listInvoicesPage(ctx.appDb, ctx.tenantId, {
        ...pageArgs(input),
        debtorId: input?.debtorId, status: input?.status as InvoiceStatus | undefined,
        overdue: input?.overdue, agingBucket: input?.agingBucket, search: input?.search,
      }, await tenantToday(ctx)))),
    create: tenantProcedure
      .input(createInvoiceInput)
      .mutation(async ({ ctx, input }) => createInvoice(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    update: tenantProcedure
      .input(z.object({
        id: z.string().uuid(), amount: z.string().optional(), description: z.string().nullable().optional(),
        reference: z.string().nullable().optional(), dueOn: z.string().optional(), issuedOn: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => updateInvoice(ctx.appDb, ctx.tenantId, ctx.user.id, input.id, input, await tenantToday(ctx))),
    transition: tenantProcedure
      .input(z.object({ id: z.string().uuid(), to: z.enum(["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"]) }))
      .mutation(async ({ ctx, input }) => transitionInvoice(ctx.appDb, ctx.tenantId, ctx.user.id, input.id, input.to, await tenantToday(ctx))),
    bulkTransition: tenantProcedure
      .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100), to: z.enum(["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"]) }))
      .mutation(async ({ ctx, input }) => bulkTransitionInvoices(ctx.appDb, ctx.tenantId, ctx.user.id, input.ids, input.to)),
  },
  payments: {
    record: tenantProcedure
      .input(recordPaymentInput)
      .mutation(async ({ ctx, input }) => recordPayment(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    // F5 gateway (Paymob): links are priced server-side from the ledger.
    createLink: tenantProcedure
      .input(createGatewayLinkInput)
      .mutation(async ({ ctx, input }) => createGatewayLink(gatewayDeps(), ctx.tenantId, ctx.user.id, input)),
    links: tenantProcedure
      .input(z.object({ debtorId: z.string().uuid() }))
      .query(async ({ ctx, input }) => listPaymentLinks(ctx.appDb, ctx.tenantId, input.debtorId)),
    refund: tenantProcedure
      .input(refundInput)
      .mutation(async ({ ctx, input }) => refundGatewayPayment(gatewayDeps(), ctx.tenantId, ctx.user.id, input)),
    confirm: tenantProcedure
      .input(z.object({ paymentId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => { await confirmClaimedPayment(ctx.appDb, ctx.tenantId, ctx.user.id, input.paymentId); return { ok: true }; }),
    reject: tenantProcedure
      .input(z.object({ paymentId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => { await rejectClaimedPayment(ctx.appDb, ctx.tenantId, ctx.user.id, input.paymentId); return { ok: true }; }),
    reconciliation: tenantProcedure
      .query(async ({ ctx }) => getReconciliation(ctx.appDb, ctx.tenantId)),
  },
  statements: {
    // F10: the raw token is returned exactly once, by create.
    create: tenantProcedure
      .input(z.object({ debtorId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => createStatementLink(ctx.appDb, ctx.tenantId, ctx.user.id, input.debtorId, new Date())),
    list: tenantProcedure
      .input(z.object({ debtorId: z.string().uuid() }))
      .query(async ({ ctx, input }) => listStatementLinks(ctx.appDb, ctx.tenantId, input.debtorId, new Date())),
    revoke: tenantProcedure
      .input(z.object({ linkId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => { await revokeStatementLink(ctx.appDb, ctx.tenantId, ctx.user.id, input.linkId, new Date()); return { ok: true }; }),
    disputes: tenantProcedure
      .input(z.object({ debtorId: z.string().uuid() }))
      .query(async ({ ctx, input }) => listDisputes(ctx.appDb, ctx.tenantId, input.debtorId)),
  },
  imports: {
    preview: tenantProcedure
      .input(createImportPreviewInput)
      .mutation(async ({ ctx, input }) => createImportPreview(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    remap: tenantProcedure
      .input(z.object({
        jobId: z.string().uuid(),
        mapping: z.record(z.enum(["name", "phone", "amount", "dueDate", "issuedDate", "reference", "description", "notes"]), z.number().int().min(0)),
      }))
      .mutation(async ({ ctx, input }) => updateImportMapping(ctx.appDb, ctx.tenantId, ctx.user.id, input.jobId, input.mapping)),
    job: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .query(async ({ ctx, input }) => getImportJob(ctx.appDb, ctx.tenantId, input.jobId)),
    list: tenantProcedure.query(async ({ ctx }) => listImportJobs(ctx.appDb, ctx.tenantId)),
    commit: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => commitImport(ctx.appDb, ctx.tenantId, ctx.user.id, input.jobId, await tenantToday(ctx))),
    undo: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => undoImport(ctx.appDb, ctx.tenantId, ctx.user.id, input.jobId)),
    delete: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => deleteImportJob(ctx.appDb, ctx.tenantId, ctx.user.id, input.jobId)),
  },
  ledgerAi: {
    // F6: upload pages -> extraction (pending review) -> merchant edit -> explicit commit.
    create: tenantProcedure
      .input(createLedgerJobInput)
      .mutation(async ({ ctx, input }) => createLedgerJob(ctx.appDb, ctx.tenantId, ctx.user.id, aiDeps(), input)),
    runExtraction: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => runLedgerExtraction(ctx.appDb, ctx.tenantId, ctx.user.id, aiDeps(), input.jobId)),
    job: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .query(async ({ ctx, input }) => getLedgerJob(ctx.appDb, ctx.tenantId, input.jobId)),
    listJobs: tenantProcedure.query(async ({ ctx }) => listLedgerJobs(ctx.appDb, ctx.tenantId)),
    updateRow: tenantProcedure
      .input(updateLedgerRowInput)
      .mutation(async ({ ctx, input }) => { await updateLedgerRow(ctx.appDb, ctx.tenantId, ctx.user.id, input); return { ok: true }; }),
    commit: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => commitLedgerJob(ctx.appDb, ctx.tenantId, ctx.user.id, input.jobId, await tenantToday(ctx))),
    delete: tenantProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => deleteLedgerJob(ctx.appDb, ctx.tenantId, ctx.user.id, input.jobId)),
  },
  receipts: {
    // F7: merchant upload -> extraction + checks -> claimed (or auto-confirmed) payment.
    uploadAndProcess: tenantProcedure
      .input(z.object({
        debtorId: z.string().uuid(),
        fileName: z.string().trim().min(1).max(200),
        mime: z.string().trim().min(3).max(80),
        contentBase64: z.string().min(4),
      }))
      .mutation(async ({ ctx, input }) => {
        const ai = aiDeps();
        const deps = engineDeps();
        return processReceiptImage(ctx.appDb, ctx.tenantId, ctx.user.id, {
          llm: ai.llm, storage: ai.storage,
          notifyText: (toE164, body, idempotencyKey) =>
            deps.providers.whatsapp.sendText({ toE164, body, idempotencyKey }).then(() => undefined),
        }, {
          debtorId: input.debtorId,
          bytes: new Uint8Array(Buffer.from(input.contentBase64, "base64")),
          mime: input.mime,
        });
      }),
    listClaims: tenantProcedure.query(async ({ ctx }) => listReceiptClaims(ctx.appDb, ctx.tenantId)),
  },
  replies: {
    // F8: the AI inbox — classifications a human must review.
    listIntents: tenantProcedure
      .input(z.object({ onlyHuman: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => listIntents(ctx.appDb, ctx.tenantId, { onlyHuman: input?.onlyHuman ?? true })),
    resolveIntent: tenantProcedure
      .input(z.object({
        intentId: z.string().uuid(),
        decision: z.string().min(1).max(100),
      }))
      .mutation(async ({ ctx, input }) => resolveMessageIntent(ctx.appDb, ctx.tenantId, ctx.user.id, input.intentId, input.decision)),
  },
  cheques: {
    // F9: register (manual, or photo pre-fill then merchant submit), lifecycle, calendar, alerts.
    register: tenantProcedure
      .input(registerChequeInput)
      .mutation(async ({ ctx, input }) => registerCheque(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    list: tenantProcedure
      .input(z.object({ status: z.enum(["held", "deposited", "cleared", "bounced", "returned", "cancelled"]).optional() }).optional())
      .query(async ({ ctx, input }) => listCheques(ctx.appDb, ctx.tenantId, { status: input?.status })),
    transition: tenantProcedure
      .input(z.object({ id: z.string().uuid(), to: z.enum(["deposited", "cleared", "bounced", "returned", "cancelled"]) }))
      .mutation(async ({ ctx, input }) => transitionCheque(ctx.appDb, ctx.tenantId, ctx.user.id, input.id, input.to, await tenantToday(ctx))),
    calendar: tenantProcedure.query(async ({ ctx }) => getChequeCalendar(ctx.appDb, ctx.tenantId)),
    runAlerts: tenantProcedure
      .mutation(async ({ ctx }) => runChequeAlerts(ctx.appDb, ctx.tenantId, await tenantToday(ctx))),
    alerts: tenantProcedure.query(async ({ ctx }) => listChequeAlerts(ctx.appDb, ctx.tenantId)),
    extractPhoto: tenantProcedure
      .input(z.object({
        fileName: z.string().trim().min(1).max(200),
        mime: z.string().trim().min(3).max(80),
        contentBase64: z.string().min(4),
      }))
      .mutation(async ({ ctx, input }) => {
        const ai = aiDeps();
        return extractChequePhoto(ctx.appDb, ctx.tenantId, ctx.user.id, { llm: ai.llm, storage: ai.storage }, {
          bytes: new Uint8Array(Buffer.from(input.contentBase64, "base64")), mime: input.mime,
        });
      }),
  },
  reports: {
    // F11/F12: KPIs + reminder performance, forecast, CSV exports.
    kpis: tenantProcedure.query(async ({ ctx }) => {
      const k = await getKpis(ctx.appDb, ctx.tenantId, await tenantToday(ctx));
      return {
        ...k,
        totalOutstandingMinor: String(k.totalOutstandingMinor),
        overdueAmountMinor: String(k.overdueAmountMinor),
        collectedInMonthMinor: String(k.collectedInMonthMinor),
        agingBuckets: Object.fromEntries(Object.entries(k.agingBuckets).map(([b, v]) => [b, String(v)])),
        topDebtors: k.topDebtors.map((d) => ({ ...d, outstandingMinor: String(d.outstandingMinor) })),
      };
    }),
    forecast: tenantProcedure.query(async ({ ctx }) => {
      const f = await getForecast(ctx.appDb, ctx.tenantId, await tenantToday(ctx));
      return {
        ...f,
        weeks: f.weeks.map((w) => ({ ...w, expectedMinor: String(w.expectedMinor), conservativeMinor: String(w.conservativeMinor) })),
      };
    }),
    exportInvoices: tenantProcedure.query(async ({ ctx }) => exportInvoicesCsv(ctx.appDb, ctx.tenantId)),
    exportPayments: tenantProcedure.query(async ({ ctx }) => exportPaymentsCsv(ctx.appDb, ctx.tenantId)),
    exportDebtors: tenantProcedure.query(async ({ ctx }) => exportDebtorsCsv(ctx.appDb, ctx.tenantId)),
  },
  billing: {
    // F13: plans catalogue (config table; PLACEHOLDER prices), quota, plan change, subscription invoices.
    plans: tenantProcedure.query(async ({ ctx }) => ({
      pricesArePlaceholders: true,
      plans: (await getPlanCatalogue(ctx.appDb)).map((p) => ({ ...p, priceMinor: String(p.priceMinor) })),
    })),
    quota: tenantProcedure.query(async ({ ctx }) => {
      const q = await getQuotaStatus(ctx.appDb, ctx.tenantId, new Date());
      return { ...q, ratio: Math.round(q.ratio * 1000) / 1000 };
    }),
    changePlan: tenantProcedure
      .input(changePlanInput)
      .mutation(async ({ ctx, input }) => {
        const provider = paymentProviderFromEnv();
        return changePlan(
          { app: ctx.appDb, provider, providerIsFake: provider instanceof FakePaymentProvider && !realGatewayConfigured() },
          ctx.tenantId, ctx.user.id, input, new Date(),
        );
      }),
    invoices: tenantProcedure.query(async ({ ctx }) => listSubscriptionInvoices(ctx.appDb, ctx.tenantId)),
    generateInvoices: tenantProcedure
      .mutation(async ({ ctx }) => generateSubscriptionInvoices(ctx.ownerDb, ctx.appDb, new Date())),
  },
  tenantData: {
    // §8 (M6): export everything / delete everything. Owner-only enforced
    // in the service for delete (ctx.role comes from the caller's membership).
    export: tenantProcedure.query(async ({ ctx }) => exportTenantData(ctx.appDb, ctx.tenantId)),
    deleteAll: tenantProcedure
      .input(z.object({ confirmation: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => deleteTenantData(ctx.ownerDb, ctx.tenantId, { userId: ctx.user.id, role: ctx.role }, input.confirmation)),
  },
  search: {
    global: tenantProcedure
      .input(z.object({ q: z.string().trim().min(1).max(100) }))
      .query(async ({ ctx, input }) => globalSearch(ctx.appDb, ctx.tenantId, input.q)),
  },
  audit: {
    list: tenantProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
      .query(async ({ ctx, input }) => listAuditTrail(ctx.appDb, ctx.tenantId, input?.limit ?? 25)),
  },
  aiWorkspace: {
    tools: tenantProcedure.query(() => AI_WORKSPACE_TOOLS),
    mapHeaders: tenantProcedure
      .input(mapHeadersInput)
      .mutation(async ({ ctx, input }) => mapWorkspaceHeaders(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    analyzeReceipt: tenantProcedure
      .input(analyzeReceiptInput)
      .mutation(async ({ ctx, input }) => analyzeWorkspaceReceipt(ctx.appDb, ctx.tenantId, ctx.user.id, input)),
    generateNotification: tenantProcedure
      .input(generateNotificationInput)
      .mutation(async ({ ctx, input }) => {
        const { businessName } = await tenantMeta(ctx);
        return generateWorkspaceNotification(ctx.appDb, ctx.tenantId, ctx.user.id, businessName, input);
      }),
  },
  notifications: {
    list: tenantProcedure
      .input(z.object({ onlyUnread: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }).optional())
      .query(async ({ ctx, input }) => listNotifications(ctx.appDb, ctx.tenantId, input ?? {})),
    sync: tenantProcedure
      .mutation(async ({ ctx }) => {
        const { today, businessName } = await tenantMeta(ctx);
        const intel = await getWorkspaceIntelligence(ctx.appDb, ctx.tenantId, businessName, today, { syncNotifications: true });
        return { ok: true, unreadCount: (await listNotifications(ctx.appDb, ctx.tenantId)).unreadCount, headlineAr: intel.headlineAr };
      }),
    markRead: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => markNotificationRead(ctx.appDb, ctx.tenantId, input.id)),
    markAllRead: tenantProcedure
      .mutation(async ({ ctx }) => markAllNotificationsRead(ctx.appDb, ctx.tenantId)),
    dismiss: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => dismissNotification(ctx.appDb, ctx.tenantId, input.id)),
  },
  intelligence: {
    overview: tenantProcedure
      .input(z.object({ syncNotifications: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { today, businessName } = await tenantMeta(ctx);
        return getWorkspaceIntelligence(ctx.appDb, ctx.tenantId, businessName, today, {
          syncNotifications: input?.syncNotifications ?? false,
        });
      }),
    forDebtor: tenantProcedure
      .input(z.object({ debtorId: z.string().uuid() }))
      .query(async ({ ctx, input }) => getDebtorIntelligence(ctx.appDb, ctx.tenantId, input.debtorId, await tenantToday(ctx))),
    askCopilot: tenantProcedure
      .input(copilotQueryInput)
      .mutation(async ({ ctx, input }) => {
        const { today, businessName } = await tenantMeta(ctx);
        return askWorkspaceCopilot(ctx.appDb, ctx.tenantId, ctx.user.id, businessName, today, input);
      }),
  },
});
export type AppRouter = typeof appRouter;
