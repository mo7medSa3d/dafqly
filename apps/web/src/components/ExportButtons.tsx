"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadSimple } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";
import { Panel, btnGhost } from "./ui";

type ExportKind = "invoices" | "payments" | "debtors";

const EXPORT_FETCHERS: Record<ExportKind, () => Promise<{ csv: string; filename: string }>> = {
  invoices: () => trpc.reports.exportInvoices.query(),
  payments: () => trpc.reports.exportPayments.query(),
  debtors: () => trpc.reports.exportDebtors.query(),
};

/** F11 CSV exports: fetched through the tenant-scoped tRPC procedures and saved as a file download. */
export function ExportButtons() {
  const t = useTranslations("reports");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(kind: ExportKind) {
    setBusy(true);
    setError(null);
    try {
      const out = await EXPORT_FETCHERS[kind]();
      const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
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
          <button
            key={k.kind}
            data-testid={k.testid}
            disabled={busy}
            onClick={() => void download(k.kind)}
            className={`${btnGhost} w-full justify-start px-4`}
          >
            <DownloadSimple size={18} aria-hidden className="text-primary" />
            {k.label}
          </button>
        ))}
        {error && <p className="text-xs font-semibold text-danger">{error}</p>}
      </div>
    </Panel>
  );
}
