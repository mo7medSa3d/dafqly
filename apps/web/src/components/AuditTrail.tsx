"use client";
import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Clock, ShieldCheck, UserCheck } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";
import { formatDateTime } from "@/lib/format";
import { Panel } from "./ui";

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
}

const CALLOUT_COLOR = "bg-callout text-primary border-primary/20";
const PAID_COLOR = "bg-status-paid-bg text-status-paid-fg border-border";
const MUTED_COLOR = "bg-surface-muted text-text-muted border-border";

const ACTION_META: Record<string, { ar: string; en: string; color: string }> = {
  "invoice.created": { ar: "إنشاء فاتورة", en: "Invoice created", color: "bg-primary/10 text-primary border-primary/20" },
  "invoice.updated": { ar: "تحديث فاتورة", en: "Invoice updated", color: CALLOUT_COLOR },
  "invoice.transitioned": { ar: "تغيير حالة فاتورة", en: "Invoice transitioned", color: "bg-accent/20 text-accent-fg border-accent/30" },
  "invoice.disputed": { ar: "تعليق فاتورة للاعتراض", en: "Invoice disputed", color: "bg-status-disputed-bg text-status-disputed-fg border-border" },
  "debtor.created": { ar: "إضافة عميل", en: "Customer added", color: PAID_COLOR },
  "debtor.updated": { ar: "تعديل عميل", en: "Customer updated", color: "bg-status-due-bg text-status-due-fg border-border" },
  "debtor.promise_recorded": { ar: "تسجيل وعد بالسداد", en: "Promise to pay logged", color: CALLOUT_COLOR },
  "payment.confirmed": { ar: "تأكيد دفعة", en: "Payment confirmed", color: PAID_COLOR },
  "payment.recorded": { ar: "تسجيل دفعة", en: "Payment recorded", color: CALLOUT_COLOR },
  "cheque.registered": { ar: "تسجيل شيك", en: "Cheque registered", color: CALLOUT_COLOR },
  "dispute.raised": { ar: "تسجيل اعتراض عميل", en: "Dispute raised", color: "bg-status-overdue-bg text-status-overdue-fg border-border" },
  "dispute.resolved": { ar: "حسم اعتراض فاتورة", en: "Dispute resolved", color: PAID_COLOR },
  "statement_link.created": { ar: "إنشاء رابط كشف حساب", en: "Statement link created", color: CALLOUT_COLOR },
  "statement_link.revoked": { ar: "إلغاء رابط كشف حساب", en: "Statement link revoked", color: MUTED_COLOR },
  "message_intent.resolved": { ar: "مراجعة رسالة واردة", en: "Inbox reply resolved", color: PAID_COLOR },
  "ai.copilot_queried": { ar: "استشارة المساعد الذكي", en: "AI Copilot query", color: CALLOUT_COLOR },
  "ai.notification_generated": { ar: "إنشاء مسودة تذكير", en: "Reminder draft generated", color: CALLOUT_COLOR },
  "ai.installment_planned": { ar: "حساب خطة تقسيط وجدولة", en: "Installment schedule calculated", color: CALLOUT_COLOR },
  "ai.reply_suggested": { ar: "اقتراح رد على العميل", en: "Customer reply suggested", color: CALLOUT_COLOR },
  "ai.receipt_analyzed": { ar: "استخراج بيانات إيصال ومراجعتها", en: "Receipt data extracted for review", color: CALLOUT_COLOR },
  "ai.headers_mapped": { ar: "مطابقة أعمدة ملف الاستيراد", en: "Import columns mapped", color: CALLOUT_COLOR },
  "tenant.settings_updated": { ar: "تحديث الإعدادات", en: "Settings updated", color: MUTED_COLOR },
  "tenant.plan_changed": { ar: "ترقية الباقة", en: "Plan upgraded", color: "bg-primary/10 text-primary border-primary/20" },
  "import.committed": { ar: "استيراد ملف فواتير", en: "Import committed", color: PAID_COLOR },
};

function formatAction(action: string, isAr: boolean): { label: string; color: string } {
  const meta = ACTION_META[action];
  return meta ? { label: isAr ? meta.ar : meta.en, color: meta.color } : { label: action, color: MUTED_COLOR };
}

function formatDate(iso: string, locale: string): string {
  try {
    return formatDateTime(new Date(iso), locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export function AuditTrail() {
  const t = useTranslations("audit");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void trpc.audit.list
      .query({ limit: 20 })
      .then((items: AuditEntry[]) => {
        if (!active) return;
        setForbidden(false);
        setError(null);
        setLogs(items);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const code = (err as { data?: { code?: string } } | null)?.data?.code;
        const msg = err instanceof Error ? err.message : "";
        const isForbidden = code === "FORBIDDEN" || /owner|FORBIDDEN/i.test(msg);
        setForbidden(isForbidden);
        setError(isForbidden ? null : (msg || (isAr ? "تعذر تحميل سجل العمليات." : "Failed to load audit log.")));
        setLogs([]);
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAr]);

  return (
    <Panel
      title={t("title")}
      subtitle={t("subtitle")}
      icon={ShieldCheck}
      padded={false}
      className="overflow-hidden"
    >
      <div className="border-b border-border/60 bg-callout/40 px-5 py-3 text-xs text-text-muted">
        <p className="flex items-center gap-2">
          <ShieldCheck size={16} aria-hidden className="text-primary shrink-0" />
          <span>
            {isAr
              ? "سجل غير قابل للتعديل أو الحذف، مسجل بواسطة قاعدة البيانات لضمان نزاهة الحسابات ومتابعة أي تغيير يطرأ على الفواتير والمدفوعات."
              : "Immutable security log recorded by the database to guarantee accounting integrity and audit all invoice and payment changes."}
          </span>
        </p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-xs text-text-muted animate-pulse">
          {isAr ? "جارٍ تحميل السجل..." : "Loading audit log..."}
        </div>
      ) : forbidden ? (
        <div className="py-8 text-center text-xs font-semibold text-text-muted">
          {isAr ? "سجل العمليات متاح لمالك الحساب فقط." : "Audit log is restricted to workspace owners."}
        </div>
      ) : error ? (
        <div role="alert" className="py-8 text-center text-xs font-semibold text-danger">
          {error}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-8 text-center text-xs text-text-muted">
          {t("noLogs")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-start text-xs sm:text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-border/60 bg-surface-muted text-text-subtle font-semibold">
                <th className="px-4 py-2.5 text-start">{t("action")}</th>
                <th className="px-4 py-2.5 text-start">{t("entity")}</th>
                <th className="px-4 py-2.5 text-start">{t("actor")}</th>
                <th className="px-4 py-2.5 text-start">{t("date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {logs.map((log: AuditEntry) => {
                const actionMeta = formatAction(log.action, isAr);
                return (
                  <tr key={log.id} className="transition-colors hover:bg-callout/30">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-bold ${actionMeta.color}`}>
                        {actionMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text">
                      <span className="font-mono text-xs text-text-muted tabular-nums" dir="ltr">
                        {log.entity} #{log.entityId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
                        <UserCheck size={13} aria-hidden className="text-primary" />
                        {log.actorUserId ? log.actorUserId.slice(0, 10) : (isAr ? "النظام" : "System")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted font-medium whitespace-nowrap tabular-nums" dir="ltr">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} aria-hidden className="text-text-subtle" />
                        {formatDate(log.createdAt, locale)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
