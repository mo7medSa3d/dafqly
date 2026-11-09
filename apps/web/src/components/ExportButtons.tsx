"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc-client";

/** F11 CSV exports: fetched through the tenant-scoped tRPC procedures and saved as a file download. */
export function ExportButtons() {
  const t = useTranslations("reports");
  const [busy, setBusy] = useState(false);
  async function download(kind: "invoices" | "payments" | "debtors") {
    setBusy(true);
    try {
      const out = kind === "invoices" ? await trpc.reports.exportInvoices.query()
        : kind === "payments" ? await trpc.reports.exportPayments.query()
        : await trpc.reports.exportDebtors.query();
      const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = out.filename; a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-bold">{t("exportTitle")}:</span>
      <button data-testid="export-invoices" disabled={busy} onClick={() => void download("invoices")} className="min-h-touch rounded-md border border-border px-3 py-1 font-bold">{t("exportInvoices")}</button>
      <button data-testid="export-payments" disabled={busy} onClick={() => void download("payments")} className="min-h-touch rounded-md border border-border px-3 py-1 font-bold">{t("exportPayments")}</button>
      <button data-testid="export-debtors" disabled={busy} onClick={() => void download("debtors")} className="min-h-touch rounded-md border border-border px-3 py-1 font-bold">{t("exportDebtors")}</button>
    </div>
  );
}
