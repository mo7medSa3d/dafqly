"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { FileCsv, UploadSimple } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { ImportIllustration } from "./illustrations";
import { Panel, StatusPill, btnGhost, btnPrimary, inputCls } from "./ui";

const FIELDS = ["name", "phone", "amount", "dueDate", "issuedDate", "reference", "description", "notes"] as const;
type Field = (typeof FIELDS)[number];

interface JobRow { rowNumber: number; status: string; errors: { field: string; reason: string }[]; data: { name: string; phoneE164: string; amountMinor: string; dueOn: string | null } | null }
interface Job { id: string; fileName: string; status: string; stats: Record<string, number> | null; rows: JobRow[]; undoExpiresAt: string | null }
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
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onRemap() {
    if (!jobId) return;
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined && v >= 0));
      await trpc.imports.remap.mutate({ jobId, mapping: clean as never });
      await loadJob(jobId);
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
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

  async function onUndo(id: string) {
    setBusy(true); setMsg(null);
    try {
      await trpc.imports.undo.mutate({ jobId: id });
      setMsg(t("undone"));
      if (jobId === id) await loadJob(id);
      await loadJobs();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  return (
    <section className="flex flex-col gap-6">
      <label className="brand-pattern-light panel-shadow flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-8 text-center transition-colors hover:bg-surface-muted/40">
        <ImportIllustration size={76} />
        <span className="flex items-center gap-2 text-lg font-extrabold">
          <UploadSimple size={20} weight="fill" aria-hidden className="text-teal-600 dark:text-teal-300" />
          {t("pick")}
        </span>
        <input data-testid="import-file" type="file" accept=".xlsx,.xls,.csv" disabled={busy} className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
      </label>
      {msg && <p role="status" data-testid="import-msg" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-bold">{msg}</p>}

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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {FIELDS.map((f) => (
                  <label key={f} className="flex flex-col gap-1.5 text-sm font-semibold"><span>{t(`fields.${f}`)}</span>
                    <select data-testid={`import-map-${f}`} className={inputCls} value={mapping[f] ?? -1}
                      onChange={(e) => setMapping((m) => ({ ...m, [f]: Number(e.target.value) }))}>
                      <option value={-1}>{t("fields.none")}</option>
                      {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
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
        {jobs.length === 0
          ? <p className="rounded-xl border border-dashed border-border-strong bg-surface px-5 py-6 text-center text-text-muted">—</p>
          : (
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
