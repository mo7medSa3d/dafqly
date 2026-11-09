"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc-client";

/** §8 data rights (M6): export-all download + owner delete with typed confirmation. */
export function DangerZone() {
  const t = useTranslations("tenantData");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportAll() {
    setBusy(true);
    try {
      const out = await trpc.tenantData.export.query();
      const url = URL.createObjectURL(new Blob([out.json], { type: "application/json;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = out.filename; a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  }

  async function deleteAll() {
    setBusy(true); setError(null);
    try {
      await trpc.tenantData.deleteAll.mutate({ confirmation });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  return (
    <section data-testid="danger-zone" className="flex flex-col gap-3 rounded-lg border border-danger bg-surface p-4">
      <h3 className="font-bold">{t("title")}</h3>
      <div>
        <button data-testid="export-all" disabled={busy} onClick={() => void exportAll()} className="min-h-touch rounded-md border border-border px-3 py-1 font-bold">{t("exportAll")}</button>
        <p className="mt-1 text-sm text-text-muted">{t("exportHint")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-muted">{t("deleteHint")}</p>
        <input data-testid="delete-confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
          placeholder={t("deleteConfirmPlaceholder")} className="min-h-touch rounded-md border border-border bg-bg px-3" />
        <button data-testid="delete-all" disabled={busy || confirmation.length === 0} onClick={() => void deleteAll()}
          className="min-h-touch rounded-md bg-danger px-3 py-1 font-bold text-white">{t("deleteAll")}</button>
        {done && <p data-testid="deleted-note" className="text-sm">{t("deleted")}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </section>
  );
}
