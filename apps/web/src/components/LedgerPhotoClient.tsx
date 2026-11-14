"use client";
import { inputVariants } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Camera, CheckCircle, Eye, Notebook, Trash, WarningCircle } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";
import { Panel, StatusPill, btnGhost, btnPrimary } from "./ui";

/**
 * F6 ledger-photo review: upload pages -> extraction progress -> editable
 * review table next to the page list, low-confidence CELLS highlighted ->
 * explicit confirm (commit). Nothing is imported before confirm.
 * Page images live in S3-compatible storage (MinIO locally, S3-compatible
 * in production — see aiDeps() in server/engine.ts); only tests use the
 * in-process fake storage. The file itself is attached to every imported
 * invoice as evidence.
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
  const locale = useLocale();
  const isAr = locale === "ar";
  const [job, setJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<RowData>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const list = (await trpc.ledgerAi.listJobs.query()) as JobLite[];
      setJobs(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const loadJob = useCallback(async (id: string) => {
    try {
      const j = (await trpc.ledgerAi.job.query({ jobId: id })) as Job;
      setJob(j);
      setEdits({});
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadJobs().then((list) => {
      const pending = list?.find((j) => j.status === "pending_review");
      if (pending && !job) {
        void loadJob(pending.id);
      }
    });
  }, [loadJobs, loadJob, job]);

  async function onDeleteJob(id: string) {
    setBusy(true); setMsg(null);
    try {
      await trpc.ledgerAi.delete.mutate({ jobId: id });
      setMsg(t("deleted"));
      if (job?.id === id) setJob(null);
      await loadJobs();
    } catch {
      setMsg(t("failed"));
    } finally {
      setBusy(false);
    }
  }

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
      <WarningCircle size={13} aria-hidden />
      {t("lowConfidence")}
    </span>
  );
  const cellInput = cn(inputVariants, "min-h-[32px] rounded-md border-transparent bg-transparent px-1.5 py-1 hover:border-border focus:bg-surface");

  return (
    <section className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        {/* Dropzone Column (7 cols) */}
        <label className="panel-shadow relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-border/80 bg-surface/90 p-8 text-center transition-all hover:border-primary/60 hover:bg-surface-muted/30 lg:col-span-7">
          <div className="flex size-14 items-center justify-center rounded-xl bg-callout text-primary">
            <Camera size={32} aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg font-extrabold text-text">{t("pick")}</span>
            <p className="text-xs text-text-muted">
              {isAr
                ? "يدعم تصوير الدفاتر الورقية أو رفع صور متعددة (حتى 10 صفحات)"
                : "Supports photographing paper ledgers or uploading multiple pages (up to 10)"}
            </p>
          </div>
          <input
            data-testid="ledger-file"
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => { if (e.target.files?.length) void onFiles(e.target.files); }}
          />
        </label>

        {/* Smart Scan Guide Column (5 cols) */}
        <div className="panel-shadow flex flex-col justify-between rounded-xl border border-border bg-surface p-6 lg:col-span-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Notebook size={20} className="text-primary" />
              <h2 className="text-base font-bold text-text">
                {isAr ? "المسح الضوئي الذكي" : "Smart Document Scan"}
              </h2>
            </div>
            <ul className="flex flex-col gap-2 pt-1 text-xs text-text-muted" dir={isAr ? "rtl" : "ltr"}>
              <li className="flex items-start gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-bold text-primary">1</span>
                <span>
                  {isAr
                    ? "التقاط أو رفع صور دفاتر الحسابات والمستندات الورقية"
                    : "Capture or upload ledger pages and receipts"}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-bold text-primary">2</span>
                <span>
                  {isAr
                    ? "استخراج فوري للقيود والمطابقة التلقائية مع سجلات العملاء"
                    : "Instant AI data extraction and customer matching"}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-bold text-primary">3</span>
                <span>
                  {isAr
                    ? "مراجعة واعتماد بنقرة واحدة للتحويل إلى فواتير نشطة"
                    : "One-click review and conversion to active invoices"}
                </span>
              </li>
            </ul>
          </div>
          <div className="mt-4 rounded-xl bg-surface-muted/60 p-3 text-[11px] text-text-subtle" dir={isAr ? "rtl" : "ltr"}>
            {isAr
              ? "تُبرز الحقول التي تتطلب تدقيقاً للمراجعة قبل الاعتماد النهائي."
              : "Fields requiring review are highlighted for verification."}
          </div>
        </div>
      </div>

      {progress && <p data-testid="ledger-progress" className="font-semibold text-primary">{progress}</p>}
      {job?.stats && (
        <p className="text-text-muted">
          {t("progress", { done: job.stats.pagesDone ?? 0, total: job.stats.pagesTotal ?? 0, rows: job.stats.rowsFound ?? 0 })}
        </p>
      )}
      {msg && <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 font-bold">{msg}</p>}

      {job && job.rows.length === 0 && (
        <div data-testid="ledger-empty" className="panel-shadow flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface p-8 text-center">
          <WarningCircle size={32} className="text-status-due-fg" />
          <p className="font-bold text-text">
            {locale === "en" ? "No transactions were detected on this page" : "لم يتم التعرف على أي معاملات في الصفحة"}
          </p>
          <p className="max-w-md text-xs leading-relaxed text-text-muted">
            {locale === "en"
              ? "Ensure the photo is clear, well-lit, and legible without heavy shadows or reflections, then try again."
              : "تأكد من وضوح الصورة والإضاءة وتجنب الظلال أو الانعكاسات القوية، ثم أعد المحاولة."}
          </p>
        </div>
      )}

      {job && job.rows.length > 0 && (
        <Panel padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-surface-muted">
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
                          <button type="button" className={cn(buttonVariants({ variant: "outline", size: "default" }))}
                            onClick={() => edit(row, { debtorId: row.suggestedDebtorId })}>
                            {t("useSuggestion", { score: Math.round((row.suggestionScore ?? 0) * 100) })}
                          </button>
                        )
                        : <span className="text-text-muted">{t("newDebtor")}</span>}
                      {val(row, "debtorId") && <span className="mt-1 block font-bold text-status-paid-fg dark:text-status-paid-fg">{t("suggestionAccepted")}</span>}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 sm:px-6">
              <button data-testid="ledger-commit" type="button" disabled={busy} onClick={() => void onCommit()} className={btnPrimary}>
                <CheckCircle size={17} />
                <span>{t("commit")}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDeleteJob(job.id)}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-text-muted hover:border-danger hover:text-danger")}
              >
                <Trash size={15} strokeWidth={2.5} />
                <span>{t("deleteDraft")}</span>
              </button>
            </div>
          )}
        </Panel>
      )}

      {jobs.length > 0 && (
        <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="flex flex-col divide-y border-border">
            {jobs.map((j) => {
              const isSelected = job?.id === j.id;
              const isPending = j.status === "pending_review";
              return (
                <li
                  key={j.id}
                  className={`flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5 transition-colors ${
                    isSelected ? "bg-primary/5 border-s-4 border-s-primary" : "hover:bg-surface-muted/40"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Notebook size={20} aria-hidden className="shrink-0 text-status-paid-fg dark:text-status-paid-fg" />
                    <span className="truncate text-sm font-bold text-text">{j.fileName}</span>
                    <span className="text-xs">
                      {isPending ? (
                        <StatusPill status="open" label={t("statusPending")} />
                      ) : (
                        <StatusPill status="paid" label={t("statusCommitted")} />
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ms-auto">
                    <button
                      type="button"
                      className={isPending ? btnPrimary : btnGhost}
                      onClick={() => void loadJob(j.id)}
                    >
                      <Eye size={15} strokeWidth={2.5} />
                      <span>{t("open")}</span>
                    </button>
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => void onDeleteJob(j.id)}
                        disabled={busy}
                        title={t("deleteDraft")}
                        aria-label={t("deleteDraft")}
                        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-9 text-text-muted hover:border-danger hover:text-danger")}
                      >
                        <Trash size={15} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
