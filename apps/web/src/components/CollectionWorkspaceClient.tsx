"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ClipboardText, Handshake, Robot, ShieldCheck, X } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { parseMoney } from "@tahseel/core";
import { useCurrency } from "./CurrencyContext";
import { Panel, btnPrimary, btnGhost, inputCls, labelCls } from "./ui";

type Task = Awaited<ReturnType<typeof trpc.collections.tasks.query>>[number];
type PromiseRow = Awaited<ReturnType<typeof trpc.collections.promises.query>>[number];
type Approval = Awaited<ReturnType<typeof trpc.aiActions.list.query>>[number];
type Member = Awaited<ReturnType<typeof trpc.collections.team.query>>[number];
type Debtor = Awaited<ReturnType<typeof trpc.debtors.list.query>>["items"][number];
type Tab = "tasks" | "promises" | "approvals";
export function CollectionWorkspaceClient({ locale, role }: { locale: string; role: "owner" | "staff" }) {
  const isAr = locale === "ar";
  const { formatAmountOnly, currency } = useCurrency();
  // F-06: amounts render in the tenant currency, not hardcoded EGP.
  const fmt = (minor: string | bigint) => formatAmountOnly(BigInt(minor));
  const t = useTranslations("tasks");
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [promises, setPromises] = useState<PromiseRow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [debtorId, setDebtorId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState(() => { const d = new Date(Date.now() + 24 * 60 * 60 * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent" | "low">("normal");
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [promiseInvoiceId, setPromiseInvoiceId] = useState("");
  const [promiseNote, setPromiseNote] = useState("");
  const [selectedPromiseDebtor, setSelectedPromiseDebtor] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRows, promiseRows, approvalRows, members, debtorsPage] = await Promise.all([
        trpc.collections.tasks.query(), trpc.collections.promises.query(), trpc.aiActions.list.query(),
        trpc.collections.team.query(), trpc.debtors.list.query({ limit: 200 }),
      ]);
      setTasks(taskRows); setPromises(promiseRows); setApprovals(approvalRows); setTeam(members); setDebtors(debtorsPage.items);
      if (!debtorId && debtorsPage.items[0]) setDebtorId(debtorsPage.items[0].id);
      if (!selectedPromiseDebtor && debtorsPage.items[0]) setSelectedPromiseDebtor(debtorsPage.items[0].id);
    } catch {
      setError(isAr ? "تعذر تحميل بيانات مساحة التحصيل. تحقق من الاتصال والصلاحيات." : "Could not load collection workspace data. Check connection and permissions.");
    } finally { setLoading(false); }
  }, [debtorId, selectedPromiseDebtor, isAr]);
  useEffect(() => { void refresh(); }, [refresh]);

  const pendingApprovals = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const pendingPromises = useMemo(() => promises.filter((p) => p.status === "pending"), [promises]);
  const activeTasks = useMemo(() => tasks.filter((task) => task.status === "open" || task.status === "in_progress"), [tasks]);

  async function mutateAction(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(null); setSuccess(null);
    try { await action(); setSuccess(message); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : (isAr ? "تعذر تنفيذ العملية" : "Action failed")); }
    finally { setBusy(false); }
  }

  async function createTask() {
    if (!debtorId || !title.trim()) return;
    await mutateAction(() => trpc.collections.createTask.mutate({
      debtorId, title: title.trim(), description: description.trim() || undefined, priority,
      assignedToUserId: assignee || null, dueAt: new Date(dueAt).toISOString(),
    }), isAr ? "تم إنشاء المهمة وإضافتها لقائمة التحصيل." : "Task created and added to the collection queue.");
    setTitle(""); setDescription("");
  }

  async function createPromise() {
    let minor: bigint;
    try {
      minor = parseMoney(promiseAmount, currency);
    } catch {
      setError(isAr ? "المبلغ غير صالح." : "Invalid amount.");
      return;
    }
    if (!selectedPromiseDebtor || minor <= 0n) return;
    await mutateAction(() => trpc.collections.createPromise.mutate({
      debtorId: selectedPromiseDebtor, invoiceId: promiseInvoiceId || undefined,
      amountMinor: String(minor), promisedOn: promiseDate, note: promiseNote || undefined,
    }), isAr ? "تم تسجيل تعهد السداد." : "Promise to pay recorded.");
    setPromiseAmount(""); setPromiseNote(""); setPromiseInvoiceId("");
  }

  const tabs: { id: Tab; label: string; count: number; Icon: typeof ClipboardText }[] = [
    { id: "tasks", label: isAr ? "مهام التحصيل" : "Collection tasks", count: activeTasks.length, Icon: ClipboardText },
    { id: "promises", label: isAr ? "وعود السداد" : "Promises to pay", count: pendingPromises.length, Icon: Handshake },
    { id: "approvals", label: isAr ? "موافقات AI" : "AI approvals", count: pendingApprovals.length, Icon: ShieldCheck },
  ];

  return <div className="flex flex-col gap-6" dir={isAr ? "rtl" : "ltr"}>
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-wider text-primary">DAFQLY WORKSPACE</p><h1 className="mt-1 text-2xl font-extrabold text-text">{t("title")}</h1><p className="mt-1 max-w-2xl text-sm text-text-muted">{t("subtitle")}</p></div>
      <button onClick={() => void refresh()} disabled={loading} className={btnGhost}>{isAr ? "تحديث البيانات" : "Refresh data"}</button>
    </header>

    <section className="grid gap-3 sm:grid-cols-3">
      <Metric label={isAr ? "مهام مفتوحة" : "Open tasks"} value={String(activeTasks.length)} detail={isAr ? "تحتاج متابعة من الفريق" : "Need team follow-up"} />
      <Metric label={isAr ? "تعهدات بانتظار المراجعة" : "Promises awaiting review"} value={String(pendingPromises.length)} detail={isAr ? "طلبات واردة من بوابة العميل" : "Requests from customer portal"} />
      <Metric label={isAr ? "إجراءات AI بانتظار الموافقة" : "AI actions awaiting approval"} value={String(pendingApprovals.length)} detail={isAr ? "لن تُنفذ دون موافقة المالك" : "Never execute without owner approval"} />
    </section>
    {role === "owner" && team.length > 0 && <Panel title={isAr ? "توزيع عبء العمل على الفريق" : "Team workload distribution"}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {team.map((member) => {
          const assigned = tasks.filter((task) => task.assignedToUserId === member.userId);
          const open = assigned.filter((task) => task.status === "open" || task.status === "in_progress").length;
          const overdue = assigned.filter((task) => (task.status === "open" || task.status === "in_progress") && new Date(task.dueAt).getTime() < Date.now()).length;
          const done = assigned.filter((task) => task.status === "done").length;
          const completion = assigned.length ? Math.round(done / assigned.length * 100) : 0;
          return <article key={member.userId} className="rounded-xl border border-border bg-surface-muted/35 p-3">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-extrabold">{member.name}</p><p className="truncate text-xs text-text-muted">{member.role}</p></div><span className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-extrabold text-primary" dir="ltr">{open}</span></div>
            <div className="mt-3 flex items-center justify-between text-xs"><span className="text-text-muted">{isAr ? "إنجاز المهام" : "Task completion"}</span><strong dir="ltr">{completion}%</strong></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }}/></div>
            <p className={`mt-2 text-xs font-semibold ${overdue ? "text-danger" : "text-text-muted"}`}>{overdue ? (isAr ? `${overdue} مهمة متأخرة` : `${overdue} overdue`) : (isAr ? `${done} مكتملة · ${open} نشطة` : `${done} completed · ${open} active`)}</p>
          </article>;
        })}
        <article className="flex flex-col justify-center rounded-xl border border-dashed border-border p-3"><p className="text-xs font-bold text-text-muted">{isAr ? "مهام غير مسندة" : "Unassigned tasks"}</p><p className="mt-1 text-2xl font-extrabold" dir="ltr">{tasks.filter((task) => !task.assignedToUserId && (task.status === "open" || task.status === "in_progress")).length}</p><p className="mt-1 text-xs text-text-muted">{isAr ? "تحتاج تعيين مسؤول" : "Need an owner"}</p></article>
      </div>
    </Panel>}

    <nav className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-2" aria-label={isAr ? "أقسام مساحة التحصيل" : "Collection workspace sections"}>
      {tabs.map(({ id, label, count, Icon }) => <button key={id} onClick={() => setTab(id)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${tab === id ? "bg-primary text-primary-fg shadow-sm" : "text-text-muted hover:bg-surface-muted hover:text-text"}`}><Icon size={18}/>{label}<span className={`rounded-full px-2 py-0.5 text-xs ${tab === id ? "bg-white/15" : "bg-surface-muted"}`}>{count}</span></button>)}
    </nav>

    {(error || success) && <p role="status" className={`rounded-xl border p-3 text-sm font-semibold ${error ? "border-danger/30 bg-danger-bg text-danger" : "border-status-paid-fg/20 bg-status-paid-bg text-status-paid-fg"}`}>{error || success}</p>}

    {tab === "tasks" && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)]">
      <Panel title={isAr ? "قائمة العمل" : "Work queue"}>
        {loading ? <LoadingState isAr={isAr}/> : activeTasks.length === 0 ? <EmptyState title={isAr ? "لا توجد مهام مفتوحة" : "No open collection tasks"} body={isAr ? "أضف متابعة يدوية أو اطلب من AI تجهيز مهمة للموافقة." : "Create a manual follow-up or ask AI to propose one for approval."}/> : <div className="divide-y divide-border">
          {activeTasks.map((task) => <article key={task.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><Link href={`/${locale}/debtors/${task.debtorId}`} className="text-sm font-extrabold text-primary hover:underline">{task.debtorName}</Link><p className="mt-0.5 font-semibold text-text">{task.title}</p>{task.description && <p className="mt-0.5 text-xs text-text-muted">{task.description}</p>}<p className="mt-1 flex flex-wrap gap-2 text-xs text-text-muted"><span>{task.assignedToName || (isAr ? "غير مسندة" : "Unassigned")}</span><span>·</span><span dir="ltr">{new Date(task.dueAt).toLocaleString(isAr ? "ar-EG" : "en-GB")}</span><Priority value={task.priority} isAr={isAr}/></p></div>
            <div className="flex gap-1.5"><button disabled={busy} onClick={() => void mutateAction(() => trpc.collections.updateTask.mutate({ id: task.id, status: task.status === "open" ? "in_progress" : "done" }), isAr ? "تم تحديث المهمة." : "Task updated.")} className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:border-primary hover:text-primary">{task.status === "open" ? (isAr ? "بدء" : "Start") : (isAr ? "إتمام" : "Complete")}</button></div>
          </article>)}
        </div>}
      </Panel>
      <Panel title={isAr ? "إنشاء مهمة تحصيل" : "Create collection task"}>
        <div className="flex flex-col gap-3">
          <Field label={isAr ? "العميل" : "Customer"}><select className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)}><option value="">{isAr ? "اختر العميل" : "Select customer"}</option>{debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></Field>
          <Field label={isAr ? "عنوان المهمة" : "Task title"}><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} placeholder={isAr ? "مثال: متابعة وعد السداد" : "e.g. Follow up on payment promise"}/></Field>
          <Field label={isAr ? "تفاصيل" : "Description"}><textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000}/></Field>
          {role === "owner" ? <Field label={isAr ? "المسؤول" : "Assignee"}><select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">{isAr ? "غير مسندة" : "Unassigned"}</option>{team.map((m) => <option key={m.userId} value={m.userId}>{m.name} · {m.role}</option>)}</select></Field> : <p className="rounded-xl bg-surface-muted/50 p-3 text-xs text-text-muted">{isAr ? "سيتم إسناد المهمة إلى حسابك تلقائياً." : "This task will be assigned to you automatically."}</p>}
          <div className="grid grid-cols-2 gap-3"><Field label={isAr ? "الأولوية" : "Priority"}><select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}><option value="normal">{isAr ? "عادية" : "Normal"}</option><option value="high">{isAr ? "مرتفعة" : "High"}</option><option value="urgent">{isAr ? "عاجلة" : "Urgent"}</option><option value="low">{isAr ? "منخفضة" : "Low"}</option></select></Field><Field label={isAr ? "موعد المتابعة" : "Due at"}><input type="datetime-local" className={inputCls} value={dueAt} onChange={(e) => setDueAt(e.target.value)}/></Field></div>
          <button disabled={busy || !debtorId || title.trim().length < 3} onClick={() => void createTask()} className={btnPrimary}>{isAr ? "إضافة إلى قائمة العمل" : "Add to work queue"}</button>
        </div>
      </Panel>
    </div>}

    {tab === "promises" && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
      <Panel title={isAr ? "سجل تعهدات السداد" : "Promise-to-pay register"}>
        {loading ? <LoadingState isAr={isAr}/> : promises.length === 0 ? <EmptyState title={isAr ? "لا توجد تعهدات مسجلة" : "No promises recorded"} body={isAr ? "سجّل اتفاق السداد أو راجع طلباً أرسله العميل من بوابته." : "Record a merchant-agreed commitment or review a request from the customer portal."}/> : <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-start text-sm"><thead className="text-xs text-text-muted"><tr><th className="pb-3">{isAr ? "العميل" : "Customer"}</th><th className="pb-3">{isAr ? "المبلغ" : "Amount"}</th><th className="pb-3">{isAr ? "موعد السداد" : "Promised date"}</th><th className="pb-3">{isAr ? "الحالة" : "Status"}</th><th className="pb-3">{isAr ? "إجراء" : "Action"}</th></tr></thead><tbody className="divide-y divide-border">{promises.map((p) => <tr key={p.id}><td className="py-3 font-bold"><Link href={`/${locale}/debtors/${p.debtorId}`} className="hover:text-primary">{p.debtorName}</Link><p className="text-xs font-normal text-text-muted">{p.invoiceReference || (p.source === "customer_portal" ? (isAr ? "بوابة العميل" : "Customer portal") : (isAr ? "اتفاق داخلي" : "Merchant recorded"))}</p></td><td className="py-3 font-extrabold" dir="ltr">{fmt(p.amountMinor)}</td><td className="py-3" dir="ltr">{p.promisedOn}</td><td className="py-3"><div className="flex flex-col items-start gap-1"><Status value={p.status} isAr={isAr}/>{p.overdue && <span className="rounded-md bg-danger-bg px-2 py-0.5 text-[10px] font-bold text-danger">{isAr ? "تجاوز الموعد" : "Overdue"}</span>}</div></td><td className="py-3"><div className="flex flex-wrap gap-1">{p.status === "pending" && <><button disabled={busy || role !== "owner"} onClick={() => void mutateAction(() => trpc.collections.decidePromise.mutate({ id: p.id, status: "accepted" }), isAr ? "تم قبول التعهد." : "Promise accepted.")} className="rounded-lg bg-status-paid-bg px-2.5 py-1.5 text-xs font-bold text-status-paid-fg">{isAr ? "قبول" : "Accept"}</button><button disabled={busy || role !== "owner"} onClick={() => void mutateAction(() => trpc.collections.decidePromise.mutate({ id: p.id, status: "rejected" }), isAr ? "تم رفض الطلب." : "Request rejected.")} className="rounded-lg bg-danger-bg px-2.5 py-1.5 text-xs font-bold text-danger">{isAr ? "رفض" : "Reject"}</button></>}{p.status === "accepted" && <>{p.overdue && <button disabled={busy || role !== "owner"} title={role !== "owner" ? (isAr ? "تغيير حالة التعهد يتطلب موافقة المالك" : "Owner approval required to change promise status") : undefined} onClick={() => void mutateAction(() => trpc.collections.decidePromise.mutate({ id: p.id, status: "broken" }), isAr ? "تم تسجيل عدم الوفاء بالتعهد بعد تجاوز موعده." : "Promise marked broken after its due date.")} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold text-danger">{isAr ? "لم يلتزم" : "Broken"}</button>}</>}</div></td></tr>)}</tbody></table></div>}
      </Panel>
      <Panel title={isAr ? "تسجيل تعهد من المنشأة" : "Record merchant-side promise"}>
        <div className="flex flex-col gap-3"><Field label={isAr ? "العميل" : "Customer"}><select className={inputCls} value={selectedPromiseDebtor} onChange={(e) => setSelectedPromiseDebtor(e.target.value)}><option value="">—</option>{debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></Field><Field label={isAr ? "المبلغ بالجنيه" : "Amount (EGP)"}><input inputMode="decimal" className={inputCls} value={promiseAmount} onChange={(e) => setPromiseAmount(e.target.value)} placeholder="1250.00"/></Field><Field label={isAr ? "تاريخ السداد" : "Promised date"}><input type="date" className={inputCls} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)}/></Field><Field label={isAr ? "ملاحظة" : "Note"}><textarea className={inputCls} rows={2} value={promiseNote} onChange={(e) => setPromiseNote(e.target.value)}/></Field><button disabled={busy || !selectedPromiseDebtor || Number(promiseAmount) <= 0} onClick={() => void createPromise()} className={btnPrimary}>{isAr ? "تسجيل التعهد" : "Record promise"}</button><p className="text-xs text-text-muted">{isAr ? "تعهد السداد مؤشر متابعة وليس ضماناً لوصول الأموال. سجّل الوفاء بعد التحقق من الدفعة." : "A promise is a follow-up signal, not proof of funds. Mark it kept only after verifying the payment."}</p></div>
      </Panel>
    </div>}

    {tab === "approvals" && <Panel title={isAr ? "الإجراءات التي اقترحها AI" : "AI-proposed actions"}>
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><Robot size={22} className="mt-0.5 shrink-0 text-primary"/><div><strong>{isAr ? "الموافقة مطلوبة قبل التنفيذ" : "Owner approval required"}</strong><p className="mt-0.5 text-text-muted">{isAr ? "AI يقترح مهمة أو جدولة تذكير. بعد موافقة المالك يعيد النظام التحقق من العميل والفاتورة وسياسة التواصل؛ وجدولة التذكير لا تعني إرساله فوراً." : "AI proposes a task or reminder schedule. After owner approval, the system rechecks customer, invoice and messaging policy; scheduling does not send the reminder immediately."}</p></div></div>
      {loading ? <LoadingState isAr={isAr}/> : pendingApprovals.length === 0 ? <EmptyState title={isAr ? "لا توجد موافقات معلقة" : "No pending approvals"} body={isAr ? "عندما يقترح AI إنشاء مهمة أو جدولة تذكير، ستظهر هنا لمراجعتها." : "AI-proposed tasks and reminder schedules appear here for review."}/> : <div className="divide-y divide-border">{pendingApprovals.map((item) => <article key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><p className="font-extrabold">{item.title}</p><p className="mt-1 text-sm text-text-muted">{item.rationale}</p><p className="mt-1 text-xs text-text-muted">{item.requestedByName || "AI"} · {new Date(item.createdAt).toLocaleString(isAr ? "ar-EG" : "en-GB")}</p></div><div className="flex shrink-0 gap-2"><button disabled={busy || role !== "owner"} title={role !== "owner" ? (isAr ? "موافقة المالك مطلوبة" : "Owner approval required") : undefined} onClick={() => void mutateAction(() => trpc.aiActions.decide.mutate({ id: item.id, decision: "approve" }), isAr ? "تمت الموافقة على الإجراء وتنفيذه ضمن الحدود." : "Action approved and executed within policy.")} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-status-paid-bg px-3 text-xs font-bold text-status-paid-fg"><Check size={16}/>{isAr ? "موافقة" : "Approve"}</button><button disabled={busy || role !== "owner"} onClick={() => void mutateAction(() => trpc.aiActions.decide.mutate({ id: item.id, decision: "reject" }), isAr ? "تم رفض الاقتراح." : "Proposal rejected.")} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-danger"><X size={16}/>{isAr ? "رفض" : "Reject"}</button></div></article>)}</div>}
      {role !== "owner" && <p className="mt-3 text-xs font-semibold text-text-muted">{isAr ? "الموظفون يمكنهم الاطلاع، لكن الموافقة متاحة لمالك مساحة العمل فقط." : "Staff can review but only the workspace owner can approve actions."}</p>}
    </Panel>}
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bento-card rounded-[24px] p-4"><p className="text-xs font-bold text-text-muted">{label}</p><p className="mt-2 text-3xl font-extrabold tracking-tight text-text" dir="ltr">{value}</p><p className="mt-1 text-xs text-text-muted">{detail}</p></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="flex flex-col gap-1.5"><span className={labelCls}>{label}</span>{children}</label>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="rounded-2xl border border-dashed border-border bg-surface-muted/40 px-5 py-9 text-center"><p className="font-bold text-text">{title}</p><p className="mx-auto mt-1 max-w-lg text-sm text-text-muted">{body}</p></div>; }
function LoadingState({ isAr }: { isAr: boolean }) { return <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><span className="size-2 animate-pulse rounded-full bg-primary"/>{isAr ? "جارٍ تحميل بيانات التحصيل…" : "Loading collection data…"}</div>; }
function Priority({ value, isAr }: { value: string; isAr: boolean }) { const labels: Record<string,string> = { low: isAr ? "منخفضة" : "Low", normal: isAr ? "عادية" : "Normal", high: isAr ? "مرتفعة" : "High", urgent: isAr ? "عاجلة" : "Urgent" }; return <span className={`rounded-full px-2 py-0.5 font-bold ${value === "urgent" || value === "high" ? "bg-danger-bg text-danger" : "bg-surface-muted text-text-muted"}`}>{labels[value] ?? value}</span>; }
function Status({ value, isAr }: { value: string; isAr: boolean }) { const labels: Record<string,string> = { pending: isAr ? "بانتظار المراجعة" : "Pending", accepted: isAr ? "معتمد" : "Accepted", kept: isAr ? "تم الوفاء" : "Kept", broken: isAr ? "لم يتم الوفاء" : "Broken", rejected: isAr ? "مرفوض" : "Rejected", cancelled: isAr ? "ملغي" : "Cancelled" }; return <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold">{labels[value] ?? value}</span>; }
