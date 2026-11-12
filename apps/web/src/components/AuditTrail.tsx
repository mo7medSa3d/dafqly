"use client";
import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Clock, ShieldCheck, UserCheck } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel } from "./ui";

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
}

function formatAction(action: string, isAr: boolean): { label: string; color: string } {
  switch (action) {
    case "invoice.created":
      return { label: isAr ? "إنشاء فاتورة" : "Invoice created", color: "bg-primary/10 text-primary border-primary/20" };
    case "invoice.updated":
      return { label: isAr ? "تحديث فاتورة" : "Invoice updated", color: "bg-callout text-primary border-primary/20" };
    case "invoice.transitioned":
      return { label: isAr ? "تغيير حالة فاتورة" : "Invoice transitioned", color: "bg-accent/20 text-accent-fg border-accent/30" };
    case "invoice.disputed":
      return { label: isAr ? "تعليق فاتورة للاعتراض" : "Invoice disputed", color: "bg-status-disputed-bg text-status-disputed-fg border-border" };
    case "debtor.created":
      return { label: isAr ? "إضافة عميل" : "Customer added", color: "bg-status-paid-bg text-status-paid-fg border-border" };
    case "debtor.updated":
      return { label: isAr ? "تعديل عميل" : "Customer updated", color: "bg-status-due-bg text-status-due-fg border-border" };
    case "debtor.promise_recorded":
      return { label: isAr ? "تسجيل وعد بالسداد" : "Promise to pay logged", color: "bg-callout text-primary border-primary/20" };
    case "payment.confirmed":
      return { label: isAr ? "تأكيد دفعة" : "Payment confirmed", color: "bg-status-paid-bg text-status-paid-fg border-border" };
    case "payment.recorded":
      return { label: isAr ? "تسجيل دفعة" : "Payment recorded", color: "bg-callout text-primary border-primary/20" };
    case "cheque.registered":
      return { label: isAr ? "تسجيل شيك" : "Cheque registered", color: "bg-callout text-primary border-primary/20" };
    case "dispute.raised":
      return { label: isAr ? "تسجيل اعتراض عميل" : "Dispute raised", color: "bg-status-overdue-bg text-status-overdue-fg border-border" };
    case "dispute.resolved":
      return { label: isAr ? "حسم اعتراض فاتورة" : "Dispute resolved", color: "bg-status-paid-bg text-status-paid-fg border-border" };
    case "statement_link.created":
      return { label: isAr ? "إنشاء رابط كشف حساب" : "Statement link created", color: "bg-callout text-primary border-primary/20" };
    case "statement_link.revoked":
      return { label: isAr ? "إلغاء رابط كشف حساب" : "Statement link revoked", color: "bg-surface-muted text-text-muted border-border" };
    case "message_intent.resolved":
      return { label: isAr ? "مراجعة رسالة واردة" : "Inbox reply resolved", color: "bg-status-paid-bg text-status-paid-fg border-border" };
    case "ai.copilot_queried":
      return { label: isAr ? "استشارة المساعد الذكي" : "AI Copilot query", color: "bg-callout text-primary border-primary/20" };
    case "ai.notification_generated":
      return { label: isAr ? "صياغة تنبيه بالذكاء الاصطناعي" : "AI smart draft generated", color: "bg-callout text-primary border-primary/20" };
    case "ai.installment_planned":
      return { label: isAr ? "بناء خطة تقسيط وجدولة" : "AI installment plan built", color: "bg-callout text-primary border-primary/20" };
    case "ai.reply_suggested":
      return { label: isAr ? "اقتراح رد ذكي للعميل" : "AI inbox reply suggested", color: "bg-callout text-primary border-primary/20" };
    case "ai.receipt_analyzed":
      return { label: isAr ? "فحص إيصال بالذكاء الاصطناعي" : "AI receipt verification", color: "bg-callout text-primary border-primary/20" };
    case "ai.headers_mapped":
      return { label: isAr ? "مطابقة أعمدة ذكية" : "AI header mapping", color: "bg-callout text-primary border-primary/20" };
    case "settings.updated":
      return { label: isAr ? "تحديث الإعدادات" : "Settings updated", color: "bg-surface-muted text-text-muted border-border" };
    case "plan.changed":
      return { label: isAr ? "ترقية الباقة" : "Plan upgraded", color: "bg-primary/10 text-primary border-primary/20" };
    case "import.committed":
      return { label: isAr ? "استيراد ملف فواتير" : "Import committed", color: "bg-status-paid-bg text-status-paid-fg border-border" };
    default:
      return { label: action, color: "bg-surface-muted text-text-muted border-border" };
  }
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
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

  useEffect(() => {
    let active = true;
    void trpc.audit.list
      .query({ limit: 20 })
      .then((items: AuditEntry[]) => {
        if (!active) return;
        setLogs(items);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLogs([]);
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
          <ShieldCheck size={16} weight="fill" className="text-primary shrink-0" />
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
      ) : logs.length === 0 ? (
        <div className="py-8 text-center text-xs text-text-muted">
          {t("noLogs")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-surface-muted/50 text-text-subtle font-semibold">
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
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${actionMeta.color}`}>
                        {actionMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-text">
                      <span className="font-mono text-xs text-text-muted">
                        {log.entity} #{log.entityId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        <UserCheck size={13} weight="fill" className="text-primary" />
                        {log.actorUserId ? log.actorUserId.slice(0, 10) : (isAr ? "النظام" : "System")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted font-medium whitespace-nowrap" dir="ltr">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} weight="fill" className="text-text-subtle" />
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
