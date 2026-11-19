"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DownloadSimple, Trash, WarningCircle } from "@/components/ui/solid-icons";
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
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await trpc.tenantData.export.query();
      const url = URL.createObjectURL(new Blob([out.json], { type: "application/json;charset=utf-8" }));
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

  async function deleteAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.tenantData.deleteAll.mutate({ confirmation });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="danger-zone" className="panel-shadow flex flex-col gap-5 rounded-xl border border-danger/40 bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2.5 text-[18px] font-bold text-danger">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-danger-bg text-danger">
          <WarningCircle size={20} aria-hidden />
        </span>
        {t("title")}
      </h2>
      <div className="rounded-xl border border-border bg-surface-muted/40 p-4">
        <button type="button" data-testid="export-all" disabled={busy} aria-busy={busy} onClick={() => void exportAll()} className={`${btnGhost} w-full justify-start px-4`}>
          <DownloadSimple size={18} aria-hidden className="text-primary" />
          {t("exportAll")}
        </button>
        <p className="mt-2 text-xs text-text-muted">{t("exportHint")}</p>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-danger/45 bg-danger-bg/40 p-4">
        <label htmlFor="danger-delete-confirmation" className="text-xs font-bold text-danger">
          {t("deleteAll")}
        </label>
        <p id="danger-delete-hint" className="text-xs leading-relaxed text-text-muted">{t("deleteHint")}</p>
        <input
          id="danger-delete-confirmation"
          data-testid="delete-confirmation"
          aria-describedby="danger-delete-hint"
          autoComplete="off"
          spellCheck={false}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={t("deleteConfirmPlaceholder")}
          className={inputCls}
        />
        <button
          type="button"
          data-testid="delete-all"
          disabled={busy || confirmation.trim().length === 0}
          aria-busy={busy}
          onClick={() => void deleteAll()}
          className={`${btnDanger} w-full`}
        >
          <Trash size={17} aria-hidden />
          {t("deleteAll")}
        </button>
        {done && <p role="status" data-testid="deleted-note" className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{t("deleted")}</p>}
        {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-semibold text-danger">{error}</p>}
      </div>
    </section>
  );
}
