"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { CheckCircle, DownloadSimple, FileCsv, FileText, UploadSimple, WarningCircle } from "@phosphor-icons/react";
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
    const list = await trpc.imports.list.query();
    setJobs(list as JobLite[]);
  }, []);
  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const loadJob = useCallback(async (id: string) => {
    const j = await trpc.imports.job.query({ jobId: id });
    setJob(j as Job);
    if (j.mapping) {
      setMapping(j.mapping as Partial<Record<Field, number>>);
      const maxCol = Math.max(-1, ...Object.values(j.mapping as Record<string, number>));
      setColumns(Math.max(maxCol + 1, 4));
    }
  }, []);

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
    if (!jobId) return;
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
    if (!jobId) return;
    setBusy(true); setMsg(null);
    try {
      await trpc.imports.commit.mutate({ jobId });
      setMsg(t("committed"));
      await loadJob(jobId);
      await loadJobs();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
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
                {isAr ? "تجهيز ملف الفواتير" : "Preparing Your Invoice File"}
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-text-muted">
              {isAr
                ? "يمكنك رفع أي ملف إكسل أو CSV يحتوي على أسماء العملاء وأرقامهم والمبالغ المستحقة. سيتعرف النظام تلقائياً على الأعمدة ويمنحك فرصة مراجعتها قبل التأكيد."
                : "Upload any Excel or CSV file with customer names, phones, and amounts due. The system automatically detects columns and gives you a chance to review before confirming."}
            </p>
            <ul className="flex flex-col gap-1.5 pt-1 text-xs text-text-muted">
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "الاسم (العميل أو الشركة المدين)" : "Name (Customer or Debtor Company)"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "الهاتف (محلي أو بصيغة دولية)" : "Phone (Local or International)"}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-teal-500" />
                <span>{isAr ? "المبلغ بالجنيه المصري" : "Amount (EGP)"}</span>
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
                <span>{isAr ? "تحميل نموذج تجريبي جاهز (CSV)" : "Download Sample Template (CSV)"}</span>
              </button>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-surface-muted/60 p-3 text-[11px] text-text-muted">
            {isAr
              ? "🛡️ يتم فحص الملف تلقائياً لمنع أي تكرار وتنبيهك قبل حفظ البيانات."
              : "🛡️ Files are automatically checked to prevent duplicates and warn you before saving."}
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
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-bold">{t("mapping")}</legend>
              {((mapping.name === undefined || mapping.name < 0) ||
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
              <div>
                <button data-testid="import-remap" onClick={() => void onRemap()} disabled={busy} className={btnGhost}>{t("mapping")}</button>
              </div>
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

            {job.status === "pending_review" && (
              <div>
                <button data-testid="import-commit" onClick={() => void onCommit()} disabled={busy} className={btnPrimary}>
                  {t("commit")}
                </button>
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
                {jobs.map((j) => (
                  <li key={j.id} data-testid="import-job" className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                    <FileCsv size={20} weight="fill" aria-hidden className="shrink-0 text-teal-600 dark:text-teal-300" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{j.fileName} <span className="font-normal text-text-muted">— {j.status}</span></span>
                    {j.status === "committed" && (
                      <button data-testid="import-undo" onClick={() => void onUndo(j.id)} disabled={busy} className={btnGhost}>{t("undo")}</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    </section>
  );
}
