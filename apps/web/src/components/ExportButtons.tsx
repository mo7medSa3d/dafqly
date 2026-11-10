"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadSimple } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel, btnGhost } from "./ui";

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
  const kinds = [
    { kind: "invoices" as const, testid: "export-invoices", label: t("exportInvoices") },
    { kind: "payments" as const, testid: "export-payments", label: t("exportPayments") },
    { kind: "debtors" as const, testid: "export-debtors", label: t("exportDebtors") },
  ];
  return (
    <Panel title={t("exportTitle")} icon={DownloadSimple}>
      <div className="flex flex-col gap-2">
        {kinds.map((k) => (
          <button key={k.kind} data-testid={k.testid} disabled={busy} onClick={() => void download(k.kind)}
            className={`${btnGhost} w-full justify-start px-4`}>
            <DownloadSimple size={18} weight="fill" aria-hidden className="text-primary" />
            {k.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}
