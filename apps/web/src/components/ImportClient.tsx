"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import {
  ArrowCounterClockwise,
  CheckCircle,
  DownloadSimple,
  Eye,
  FileCsv,
  FileText,
  Trash,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { ImportIllustration } from "./illustrations";
import { Panel, StatusPill, btnGhost, btnPrimary, inputCls } from "./ui";

const FIELDS = ["name", "phone", "amount", "dueDate", "issuedDate", "reference", "description", "notes"] as const;
type Field = (typeof FIELDS)[number];

interface JobRow { rowNumber: number; status: string; errors: { field: string; reason: string }[]; data: { name: string; phoneE164: string; amountMinor: string; dueOn: string | null } | null }
interface Job { id: string; fileName: string; status: string; stats: Record<string, number> | null; headerLabels?: string[]; rows: JobRow[]; undoExpiresAt: string | null }
interface JobLite { id: string; fileName: string; status: string; stats: Record<string, number> | null; undoExpiresAt: string | null }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ImportClient() {
  const t = useTranslations("import");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [columns, setColumns] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const list = await trpc.imports.list.query();
      setJobs(list as JobLite[]);
      return list as JobLite[];
    } catch {
      return [];
    }
  }, []);

  const loadJob = useCallback(async (id: string) => {
    try {
      const j = await trpc.imports.job.query({ jobId: id });
      setJob(j as Job);
      if (j.mapping) {
        setMapping(j.mapping as Partial<Record<Field, number>>);
        const maxCol = Math.max(-1, ...Object.values(j.mapping as Record<string, number>));
        setColumns(Math.max(maxCol + 1, 4));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadJobs().then((list) => {
      // Auto-load latest pending_review job if no job is actively loaded
      const pending = list.find((j) => j.status === "pending_review");
      if (pending && !jobId) {
        setJobId(pending.id);
        void loadJob(pending.id);
      }
    });
  }, [loadJobs, loadJob, jobId]);

  async function onFile(file: File) {
    setBusy(true); setMsg(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const preview = await trpc.imports.preview.mutate({ fileName: file.name, contentBase64 });
      setJobId(preview.jobId);
      await loadJob(preview.jobId);
      await loadJobs();
    } catch (err: unknown) {
      setMsg((err instanceof Error ? err.message : null) || t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onRemap() {
    if (!jobId || job?.status !== "pending_review") return;
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined && v >= 0));
      await trpc.imports.remap.mutate({ jobId, mapping: clean as never });
      await loadJob(jobId);
    } catch (err: unknown) {
      setMsg((err instanceof Error ? err.message : null) || t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!jobId || job?.status !== "pending_review") return;
    setBusy(true); setMsg(null);
    try {
      await trpc.imports.commit.mutate({ jobId });
      setMsg(t("committed"));
      await loadJob(jobId);
      await loadJobs();
    } catch (err: unknown) {
      setMsg((err instanceof Error ? err.message : null) || t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true); setMsg(null);
    try {
      await trpc.imports.delete.mutate({ jobId: id });
      setMsg(t("deleted"));
      if (jobId === id) {
        setJobId(null);
        setJob(null);
      }
      await loadJobs();
    } catch {
      setMsg(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  function downloadSampleCsv() {
    const csvContent = isAr
      ? "\uFEFFاسم العميل,رقم الهاتف,المبلغ المستحق,تاريخ الاستحقاق,رقم الفاتورة,ملاحظات\nأحمد محمد,01001234567,1500,2026-12-01,INV-1001,فاتورة بضاعة\nشركة الأمل,01122334455,4200.50,2026-12-15,INV-1002,توريد خامات\n"
      : "Customer Name,Phone Number,Amount,Due Date,Invoice No,Notes\nAhmed Mohamed,01001234567,1500,2026-12-01,INV-1001,Goods delivery\nAl Amal Co,01122334455,4200.50,2026-12-15,INV-1002,Materials\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", isAr ? "نموذج_استيراد_دافقلي.csv" : "dafqly_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function onUndo(id: string) {
    setBusy(true); setMsg(null);
    try {
      await trpc.imports.undo.mutate({ jobId: id });
      setMsg(t("undone"));
      if (jobId === id) await loadJob(id);
      await loadJobs();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  const isErrorMsg = msg ? (msg.includes("تعذّر") || msg.toLowerCase().includes("failed")) : false;

  return (
    <section className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Upload Dropzone */}
        <label className="brand-pattern-light panel-shadow relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-surface p-8 text-center transition-all hover:border-primary hover:bg-surface-muted/40 lg:col-span-7">
          <ImportIllustration size={80} />
          <div className="flex flex-col items-center gap-1">
            <span className="flex items-center gap-2 text-lg font-extrabold text-text">
              <UploadSimple size={22} weight="bold" aria-hidden className="text-primary" />
              {t("pick")}
            </span>
            <p className="text-xs text-text-muted">
              {isAr
                ? "يدعم ملفات إكسل وجداول البيانات الشائعة حتى 10 ميجابايت"
                : "Supports Excel files and common spreadsheets up to 10 MB"}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <span className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-bold text-text-muted">XLSX</span>
            <span className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-bold text-text-muted">XLS</span>
            <span className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-bold text-text-muted">CSV</span>
          </div>

          <input
            data-testid="import-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>

        {/* Guidelines / Helper Column */}
        <div className="panel-shadow flex flex-col justify-between rounded-2xl border border-border bg-surface p-6 lg:col-span-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <FileText size={20} weight="fill" className="text-primary" />
              <h2 className="text-base font-bold text-text">
                {isAr ? "استيراد ملفات الفواتير" : "Invoice File Import"}
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-text-muted" dir={isAr ? "rtl" : "ltr"}>
              {isAr ? (
                <>
                  رفع مباشر لملفات <bdi className="font-semibold text-text">Excel</bdi> وجداول <bdi className="font-semibold text-text">CSV</bdi> مع مطابقة تلقائية للأعمدة وفحص فوري للمستحقات قبل الاعتماد.
                </>
              ) : (
                "Direct Excel and CSV spreadsheet upload with automated column detection and instant data validation before commit."
              )}
            </p>
            <ul className="flex flex-col gap-1.5 pt-1 text-xs text-text-muted">
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "اسم العميل أو المنشأة" : "Customer or Business Name"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "رقم الهاتف للتواصل والتذكيرات" : "Phone Number"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "المبلغ المستحق" : "Amount Due"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "تاريخ الاستحقاق (اختياري)" : "Due Date (Optional)"}</span>
              </li>
            </ul>
            <div className="pt-2">
              <button
                type="button"
                onClick={downloadSampleCsv}
                data-testid="import-sample-download"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary active:scale-95"
              >
                <DownloadSimple size={15} weight="bold" className="text-primary" />
                <span>{isAr ? "تحميل قالب CSV القياسي" : "Download Standard CSV Template"}</span>
              </button>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-surface-muted/60 p-3 text-[11px] text-text-muted" dir={isAr ? "rtl" : "ltr"}>
            {isAr
              ? "فحص آلي لمنع تكرار السجلات وتأكيد الدقة قبل الاعتماد."
              : "Automated validation prevents duplicate records before commit."}
          </div>
        </div>
      </div>

      {msg && (
        <div
          role="status"
          data-testid="import-msg"
          className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-bold ${
            isErrorMsg
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-status-paid-fg/30 bg-status-paid-bg text-status-paid-fg"
          }`}
        >
          {isErrorMsg ? (
            <WarningCircle size={18} weight="fill" aria-hidden />
          ) : (
            <CheckCircle size={18} weight="fill" aria-hidden />
          )}
          <span>{msg}</span>
        </div>
      )}

      {job && (
        <Panel title={`${t("preview")} — ${job.fileName}`} icon={FileCsv}>
          <div className="flex flex-col gap-5">
            {job.stats && (
              <p data-testid="import-stats" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <span>{t("total")}: <b className="tnum" dir="ltr">{job.stats.total}</b></span>
                <span>{t("valid")}: <b className="tnum" dir="ltr">{job.stats.valid}</b></span>
                <span>{t("invalid")}: <b className="tnum" dir="ltr">{job.stats.invalid}</b></span>
                <span>{t("duplicate")}: <b className="tnum" dir="ltr">{job.stats.duplicate}</b></span>
                <span>{t("emptyRows")}: <b className="tnum" dir="ltr">{job.stats.empty}</b></span>
              </p>
            )}
            <fieldset disabled={busy || job.status !== "pending_review"} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <legend className="mb-1 font-bold">{t("mapping")}</legend>
                {job.status !== "pending_review" && (
                  <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-text-muted">
                    {isAr ? "🔒 العرض للقراءة فقط (تم الاعتماد)" : "🔒 Read-only view (already committed)"}
                  </span>
                )}
              </div>
              {job.status === "pending_review" && ((mapping.name === undefined || mapping.name < 0) ||
                (mapping.phone === undefined || mapping.phone < 0) ||
                (mapping.amount === undefined || mapping.amount < 0)) && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-bold text-amber-700 dark:text-amber-300">
                  {isAr
                    ? "⚠️ تنبيه: يلزم تحديد أعمدة (الاسم، الهاتف، المبلغ) للاستيراد. حددها من القوائم واضغط «مطابقة الأعمدة»."
                    : "⚠️ Note: Name, Phone, and Amount columns are required. Please assign them and click «Mapping»."}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {FIELDS.map((f) => (
                  <label key={f} className="flex flex-col gap-1.5 text-sm font-semibold"><span>{t(`fields.${f}`)}</span>
                    <select data-testid={`import-map-${f}`} className={inputCls} value={mapping[f] ?? -1}
                      disabled={busy || job.status !== "pending_review"}
                      onChange={(e) => setMapping((m) => ({ ...m, [f]: Number(e.target.value) }))}>
                      <option value={-1}>{t("fields.none")}</option>
                      {Array.from({ length: columns }, (_, i) => {
                        const lbl = job.headerLabels?.[i];
                        const text = lbl ? `${i + 1} - ${lbl}` : `${i + 1}`;
                        return <option key={i} value={i}>{text}</option>;
                      })}
                    </select></label>
                ))}
              </div>
              {job.status === "pending_review" && (
                <div>
                  <button data-testid="import-remap" onClick={() => void onRemap()} disabled={busy} className={btnGhost}>{t("mapping")}</button>
                </div>
              )}
            </fieldset>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-muted/70 text-start">
                    <th className="px-3 py-2.5 text-start font-bold">{t("row")}</th>
                    <th className="px-3 py-2.5 text-start font-bold">{t("fields.name")}</th>
                    <th className="px-3 py-2.5 text-start font-bold">{t("fields.phone")}</th>
                    <th className="px-3 py-2.5 text-start font-bold">{t("fields.amount")}</th>
                    <th className="px-3 py-2.5 text-start font-bold">{t("errors")}</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.slice(0, 100).map((r) => (
                    <tr key={r.rowNumber} data-testid="import-row" data-status={r.status} className="border-t border-border">
                      <td className="px-3 py-2" dir="ltr">{r.rowNumber}</td>
                      <td className="px-3 py-2 font-semibold">{r.data?.name ?? "—"}</td>
                      <td className="px-3 py-2" dir="ltr">{r.data?.phoneE164 ?? "—"}</td>
                      <td className="tnum px-3 py-2" dir="ltr">{r.data ? formatEgp(BigInt(r.data.amountMinor)) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className="me-2"><StatusPill status={r.status === "valid" ? "paid" : r.status === "duplicate" ? "disputed" : "open"} label={r.status} /></span>
                        {r.errors.length > 0 ? r.errors.map((e) => `${e.field}: ${e.reason}`).join("; ") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {job.status === "pending_review" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  data-testid="import-commit"
                  onClick={() => void onCommit()}
                  disabled={busy}
                  className={`${btnPrimary} flex items-center gap-2`}
                >
                  <CheckCircle size={18} weight="fill" />
                  <span>{t("commit")}</span>
                </button>
                <button
                  type="button"
                  data-testid="import-discard"
                  onClick={() => void onDelete(job.id)}
                  disabled={busy}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-border bg-surface px-4 text-xs font-bold text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger active:scale-95 disabled:opacity-50"
                >
                  <Trash size={16} weight="bold" />
                  <span>{t("discard")}</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 pt-2">
                <span className="text-xs font-semibold text-text-muted">
                  {job.status === "committed" ? t("statusCommitted") : t("statusUndone")}
                </span>
                {job.status === "committed" && (
                  <button
                    data-testid="import-undo"
                    onClick={() => void onUndo(job.id)}
                    disabled={busy}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-border bg-surface px-4 text-xs font-bold text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger active:scale-95"
                  >
                    <ArrowCounterClockwise size={16} weight="bold" />
                    <span>{t("undo")}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{t("jobs")}</h2>
        {jobs.length === 0 ? (
          <div className="panel-shadow flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface p-8 text-center">
            <FileText size={32} weight="fill" className="text-text-subtle" />
            <p className="font-bold text-text">{isAr ? "لا توجد عمليات استيراد سابقة" : "No previous import jobs"}</p>
            <p className="max-w-md text-xs leading-relaxed text-text-muted">
              {isAr
                ? "عند رفع أي ملف إكسل أو CSV، ستظهر هنا سجلات المعالجة وحالة الفواتير المستوردة وإمكانية التراجع عنها."
                : "When you upload an Excel or CSV file, processing history and rollback options will appear here."}
            </p>
          </div>
        ) : (
          <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
            <ul className="flex flex-col divide-y divide-border">
              {jobs.map((j) => {
                const isSelected = jobId === j.id;
                const isPendingReview = j.status === "pending_review";
                const isCommitted = j.status === "committed";
                const isUndone = j.status === "undone";

                return (
                  <li
                    key={j.id}
                    data-testid="import-job"
                    className={`flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5 transition-colors ${
                      isSelected ? "bg-primary/5 border-s-4 border-s-primary" : "hover:bg-surface-muted/40"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                        <FileCsv size={22} weight="fill" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-bold text-text">{j.fileName}</p>
                          {isSelected && (
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                              {t("currentlyReviewing")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 pt-0.5 text-xs text-text-muted">
                          {isPendingReview && (
                            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                              {t("statusPending")}
                            </span>
                          )}
                          {isCommitted && (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                              {t("statusCommitted")}
                            </span>
                          )}
                          {isUndone && (
                            <span className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-text-muted">
                              {t("statusUndone")}
                            </span>
                          )}
                          {j.stats && (
                            <span className="tnum" dir="ltr">
                              ({j.stats.valid ?? 0}/{j.stats.total ?? 0})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ms-auto">
                      {isPendingReview ? (
                        <>
                          <button
                            type="button"
                            data-testid="import-review-btn"
                            onClick={() => {
                              setJobId(j.id);
                              void loadJob(j.id);
                            }}
                            disabled={busy}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-fg shadow-xs transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                          >
                            <Eye size={15} weight="bold" />
                            <span>{t("review")}</span>
                          </button>
                          <button
                            type="button"
                            data-testid="import-delete-btn"
                            onClick={() => void onDelete(j.id)}
                            disabled={busy}
                            title={t("deleteDraft")}
                            aria-label={t("deleteDraft")}
                            className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger active:scale-95 disabled:opacity-50"
                          >
                            <Trash size={16} weight="bold" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            data-testid="import-view-btn"
                            onClick={() => {
                              setJobId(j.id);
                              void loadJob(j.id);
                            }}
                            disabled={busy}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary active:scale-95 disabled:opacity-50"
                          >
                            <Eye size={15} weight="bold" />
                            <span>{t("viewDetails")}</span>
                          </button>
                          {isCommitted && (
                            <button
                              type="button"
                              data-testid="import-undo"
                              onClick={() => void onUndo(j.id)}
                              disabled={busy}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger active:scale-95 disabled:opacity-50"
                            >
                              <ArrowCounterClockwise size={15} weight="bold" />
                              <span>{t("undo")}</span>
                            </button>
                          )}
                          {isUndone && (
                            <button
                              type="button"
                              onClick={() => void onDelete(j.id)}
                              disabled={busy}
                              title={t("deleteDraft")}
                              aria-label={t("deleteDraft")}
                              className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger active:scale-95 disabled:opacity-50"
                            >
                              <Trash size={16} weight="bold" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
