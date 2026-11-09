"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";

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

  const inputCls = "rounded-md border border-border bg-surface px-3 min-h-touch text-text";
  return (
    <section className="flex flex-col gap-6">
      <label className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <span className="font-bold">{t("pick")}</span>
        <input data-testid="import-file" type="file" accept=".xlsx,.xls,.csv" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
      </label>
      {msg && <p role="status" data-testid="import-msg" className="text-sm">{msg}</p>}

      {job && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-bold">{t("preview")} — {job.fileName}</h2>
          {job.stats && (
            <p data-testid="import-stats" className="text-sm">
              {t("total")}: {job.stats.total} · {t("valid")}: {job.stats.valid} · {t("invalid")}: {job.stats.invalid} · {t("duplicate")}: {job.stats.duplicate} · {t("emptyRows")}: {job.stats.empty}
            </p>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="font-bold">{t("mapping")}</legend>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {FIELDS.map((f) => (
                <label key={f} className="flex flex-col gap-1 text-sm"><span>{t(`fields.${f}`)}</span>
                  <select data-testid={`import-map-${f}`} className={inputCls} value={mapping[f] ?? -1}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: Number(e.target.value) }))}>
                    <option value={-1}>{t("fields.none")}</option>
                    {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
                  </select></label>
              ))}
            </div>
            <button data-testid="import-remap" onClick={() => void onRemap()} disabled={busy} className="min-h-touch rounded-md border border-border px-4 font-bold">{t("mapping")}</button>
          </fieldset>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th>{t("row")}</th><th>{t("fields.name")}</th><th>{t("fields.phone")}</th><th>{t("fields.amount")}</th><th>{t("errors")}</th></tr></thead>
              <tbody>
                {job.rows.slice(0, 100).map((r) => (
                  <tr key={r.rowNumber} data-testid="import-row" data-status={r.status} className="border-t border-border">
                    <td dir="ltr">{r.rowNumber}</td>
                    <td>{r.data?.name ?? "—"}</td>
                    <td dir="ltr">{r.data?.phoneE164 ?? "—"}</td>
                    <td dir="ltr">{r.data ? formatEgp(BigInt(r.data.amountMinor)) : "—"}</td>
                    <td>{r.status}{r.errors.length > 0 ? ` — ${r.errors.map((e) => `${e.field}: ${e.reason}`).join("; ")}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {job.status === "pending_review" && (
            <button data-testid="import-commit" onClick={() => void onCommit()} disabled={busy}
              className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">{t("commit")}</button>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 font-bold">{t("jobs")}</h2>
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <li key={j.id} data-testid="import-job" className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
              <span className="text-sm">{j.fileName} — {j.status}</span>
              {j.status === "committed" && (
                <button data-testid="import-undo" onClick={() => void onUndo(j.id)} disabled={busy} className="min-h-touch rounded-md border border-border px-3 font-bold">{t("undo")}</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
