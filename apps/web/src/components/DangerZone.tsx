"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadSimple, Trash, WarningCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { btnDanger, btnGhost, inputCls } from "./ui";

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
    <section data-testid="danger-zone" className="panel-shadow flex flex-col gap-4 rounded-2xl border border-danger/40 bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2.5 text-[18px] font-bold text-danger">
        <span className="flex size-9 items-center justify-center rounded-xl bg-danger-bg">
          <WarningCircle size={20} weight="fill" aria-hidden />
        </span>
        {t("title")}
      </h2>
      <div>
        <button data-testid="export-all" disabled={busy} onClick={() => void exportAll()} className={`${btnGhost} w-full justify-start px-4`}>
          <DownloadSimple size={18} weight="fill" aria-hidden className="text-primary" />
          {t("exportAll")}
        </button>
        <p className="mt-1.5 text-xs text-text-muted">{t("exportHint")}</p>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-border pt-4">
        <p className="text-xs text-text-muted">{t("deleteHint")}</p>
        <input data-testid="delete-confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
          placeholder={t("deleteConfirmPlaceholder")} className={inputCls} />
        <button data-testid="delete-all" disabled={busy || confirmation.length === 0} onClick={() => void deleteAll()}
          className={`${btnDanger} w-full`}>
          <Trash size={17} weight="fill" aria-hidden />
          {t("deleteAll")}
        </button>
        {done && <p data-testid="deleted-note" className="text-sm font-bold text-danger">{t("deleted")}</p>}
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      </div>
    </section>
  );
}
