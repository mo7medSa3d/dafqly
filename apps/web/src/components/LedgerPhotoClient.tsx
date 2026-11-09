"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Notebook, WarningCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel, btnGhost, btnPrimary } from "./ui";

/**
 * F6 ledger-photo review: upload pages -> extraction progress -> editable
 * review table next to the page list, low-confidence CELLS highlighted ->
 * explicit confirm (commit). Nothing is imported before confirm.
 * The stored page image is shown by file name (the dev storage is the
 * in-process fake — signed URLs land with the S3 adapter); the file itself
 * is attached to every imported invoice as evidence.
 */
interface RowData { name: string; phone: string | null; amountMinor: string; date: string | null; note: string | null; debtorId: string | null }
interface JobRow {
  id: string; rowNumber: number; status: string; errors: { field: string; reason: string }[];
  data: RowData | null; confidence: string | null;
  cellConfidence: { name: number; amount: number } | null;
  suggestedDebtorId: string | null; suggestionScore: number | null; pageFileId: string | null;
}
interface Job { id: string; status: string; stats: Record<string, number> | null; rows: JobRow[] }
interface JobLite { id: string; fileName: string; status: string; stats: Record<string, number> | null }

const LOW = 0.8;
const lowCell = "bg-status-due-bg/60";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function LedgerPhotoClient() {
  const t = useTranslations("ledgerPhoto");
  const [job, setJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<RowData>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setJobs((await trpc.ledgerAi.listJobs.query()) as JobLite[]);
  }, []);
  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const loadJob = useCallback(async (id: string) => {
    const j = (await trpc.ledgerAi.job.query({ jobId: id })) as Job;
    setJob(j);
    setEdits({});
  }, []);

  async function onFiles(files: FileList) {
    setBusy(true); setMsg(null); setProgress(t("uploading"));
    try {
      const uploads = [];
      for (const file of Array.from(files).slice(0, 10)) {
        uploads.push({ fileName: file.name, mime: file.type || "image/png", contentBase64: await fileToBase64(file) });
      }
      const created = await trpc.ledgerAi.create.mutate({ uploads });
      setProgress(t("extracting"));
      const view = await trpc.ledgerAi.runExtraction.mutate({ jobId: created.jobId });
      setJob(view as Job);
      setProgress(null);
      await loadJobs();
    } catch { setMsg(t("failed")); setProgress(null); } finally { setBusy(false); }
  }

  async function onSaveRow(row: JobRow) {
    const e = edits[row.id];
    if (!e) return;
    setBusy(true);
    try {
      await trpc.ledgerAi.updateRow.mutate({
        rowId: row.id,
        ...(e.name !== undefined ? { name: e.name } : {}),
        ...(e.phone !== undefined ? { phone: e.phone } : {}),
        ...(e.amountMinor !== undefined ? { amount: (Number(e.amountMinor) / 100).toFixed(2) } : {}),
        ...(e.date !== undefined ? { date: e.date } : {}),
        ...(e.debtorId !== undefined ? { debtorId: e.debtorId } : {}),
      });
      if (job) await loadJob(job.id);
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onCommit() {
    if (!job) return;
    setBusy(true); setMsg(null);
    try {
      const r = await trpc.ledgerAi.commit.mutate({ jobId: job.id });
      setMsg(t("committed", { invoices: r.createdInvoices, debtors: r.createdDebtors, skipped: r.skippedInvalid }));
      await loadJob(job.id);
      await loadJobs();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  const edit = (row: JobRow, patch: Partial<RowData>) =>
    setEdits((prev) => ({ ...prev, [row.id]: { ...prev[row.id], ...patch } }));
  const val = (row: JobRow, key: keyof RowData): string => {
    const e = edits[row.id];
    if (e && e[key] !== undefined) return String(e[key] ?? "");
    return String(row.data?.[key] ?? "");
  };
  const lowNote = (
    <span className="mt-1 flex items-center gap-1 text-xs font-bold text-status-due-fg">
      <WarningCircle size={13} weight="fill" aria-hidden />
      {t("lowConfidence")}
    </span>
  );
  const cellInput = "w-full rounded-md bg-transparent p-1.5 focus:bg-surface";

  return (
    <section className="flex flex-col gap-5">
      <label className="brand-pattern-light panel-shadow flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-8 text-center transition-colors hover:bg-surface-muted/40">
        <Camera size={28} weight="fill" aria-hidden className="text-teal-600 dark:text-teal-300" />
        <span className="text-lg font-extrabold">{t("pick")}</span>
        <input data-testid="ledger-file" type="file" accept="image/*" multiple disabled={busy} className="sr-only"
          onChange={(e) => { if (e.target.files?.length) void onFiles(e.target.files); }} />
      </label>
      {progress && <p data-testid="ledger-progress" className="font-semibold text-text-muted">{progress}</p>}
      {job?.stats && (
        <p className="text-text-muted">
          {t("progress", { done: job.stats.pagesDone ?? 0, total: job.stats.pagesTotal ?? 0, rows: job.stats.rowsFound ?? 0 })}
        </p>
      )}
      {msg && <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 font-bold">{msg}</p>}

      {job && job.rows.length > 0 && (
        <Panel padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-muted/70">
                  <th className="px-3 py-2.5 text-start font-bold">{t("name")}</th>
                  <th className="px-3 py-2.5 text-start font-bold">{t("phone")}</th>
                  <th className="px-3 py-2.5 text-start font-bold">{t("amount")}</th>
                  <th className="px-3 py-2.5 text-start font-bold">{t("date")}</th>
                  <th className="px-3 py-2.5 text-start font-bold">{t("suggestion")}</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row) => (
                  <tr key={row.id} data-testid={`ledger-row-${row.rowNumber}`} className="border-t border-border align-top">
                    <td className={`px-2 py-1.5 ${row.cellConfidence && row.cellConfidence.name < LOW ? lowCell : ""}`}>
                      <input aria-label={t("name")} className={cellInput} value={val(row, "name")}
                        onChange={(e) => edit(row, { name: e.target.value })} />
                      {row.cellConfidence && row.cellConfidence.name < LOW && lowNote}
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={t("phone")} className={cellInput} value={val(row, "phone")}
                        onChange={(e) => edit(row, { phone: e.target.value })} />
                      {row.errors.map((er) => <span key={er.field} className="block text-xs font-semibold text-status-overdue-fg">{er.reason}</span>)}
                    </td>
                    <td className={`px-2 py-1.5 ${row.cellConfidence && row.cellConfidence.amount < LOW ? lowCell : ""}`}>
                      <input aria-label={t("amount")} className={cellInput}
                        value={edits[row.id]?.amountMinor !== undefined ? String(Number(edits[row.id]!.amountMinor) / 100) : row.data ? (Number(row.data.amountMinor) / 100).toFixed(2) : ""}
                        onChange={(e) => edit(row, { amountMinor: String(Math.round(Number(e.target.value || "0") * 100)) })} />
                      {row.cellConfidence && row.cellConfidence.amount < LOW && lowNote}
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={t("date")} className={cellInput} value={val(row, "date")}
                        onChange={(e) => edit(row, { date: e.target.value || null })} />
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {row.suggestedDebtorId
                        ? (
                          <button type="button" className="rounded-full border border-border px-2.5 py-1 font-bold transition-colors hover:border-border-strong hover:bg-surface-muted"
                            onClick={() => edit(row, { debtorId: row.suggestedDebtorId })}>
                            {t("useSuggestion", { score: Math.round((row.suggestionScore ?? 0) * 100) })}
                          </button>
                        )
                        : <span className="text-text-muted">{t("newDebtor")}</span>}
                      {val(row, "debtorId") && <span className="mt-1 block font-bold text-teal-700 dark:text-teal-300">{t("suggestionAccepted")}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" disabled={busy} className={btnGhost}
                        onClick={() => void onSaveRow(row)}>{t("saveRow")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {job.status === "pending_review" && (
            <div className="border-t border-border p-4 sm:px-6">
              <button data-testid="ledger-commit" type="button" disabled={busy} onClick={() => void onCommit()} className={btnPrimary}>
                {t("commit")}
              </button>
            </div>
          )}
        </Panel>
      )}

      {jobs.length > 0 && (
        <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="flex flex-col divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                <Notebook size={20} weight="fill" aria-hidden className="shrink-0 text-teal-600 dark:text-teal-300" />
                <span className="font-bold">{j.fileName}</span>
                <span className="text-text-muted">{j.status}</span>
                <button type="button" className={`${btnGhost} ms-auto`} onClick={() => void loadJob(j.id)}>
                  {t("open")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
