"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bell, CalendarCheck, Check, ClipboardText, Clock, Copy, Handshake, Lightning, Robot, ShieldCheck, X } from "@/components/ui/solid-icons";
import { parseMoney } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";
import { useCurrency } from "./CurrencyContext";
import { Panel, btnPrimary, btnGhost, inputCls, labelCls } from "./ui";
import { ReminderScheduleIllustration } from "./illustrations";

type Task = Awaited<ReturnType<typeof trpc.collections.tasks.query>>[number];
type PromiseRow = Awaited<ReturnType<typeof trpc.collections.promises.query>>[number];
type Approval = Awaited<ReturnType<typeof trpc.aiActions.list.query>>[number];
type Member = Awaited<ReturnType<typeof trpc.collections.team.query>>[number];
type Debtor = Awaited<ReturnType<typeof trpc.debtors.list.query>>["items"][number];
type SmartReminderResult = Awaited<ReturnType<typeof trpc.aiWorkspace.dispatchSmartReminder.mutate>>;
type OptimizeResult = Awaited<ReturnType<typeof trpc.aiWorkspace.optimizeReminders.mutate>>;
type Tab = "tasks" | "reminders" | "promises" | "approvals";
type TaskFilter = "active" | "overdue" | "done" | "all";

export function CollectionWorkspaceClient({ locale, role }: { locale: string; role: "owner" | "staff" }) {
  const isAr = locale === "ar";
  const { formatAmountOnly, currency } = useCurrency();
  const fmt = (minor: string | bigint) => formatAmountOnly(BigInt(minor));
  const t = useTranslations("tasks");
  const [tab, setTab] = useState<Tab>("tasks");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("active");
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
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent" | "low">("normal");
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [promiseInvoiceId, setPromiseInvoiceId] = useState("");
  const [promiseNote, setPromiseNote] = useState("");
  const [selectedPromiseDebtor, setSelectedPromiseDebtor] = useState("");

  // Smart Reminder Tool state
  const [reminderDebtorId, setReminderDebtorId] = useState("");
  const [reminderTone, setReminderTone] = useState<"friendly" | "polite" | "firm" | "urgent">("polite");
  const [reminderResult, setReminderResult] = useState<SmartReminderResult | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRows, promiseRows, approvalRows, members, debtorsPage] = await Promise.all([
        trpc.collections.tasks.query(),
        trpc.collections.promises.query(),
        trpc.aiActions.list.query(),
        trpc.collections.team.query(),
        trpc.debtors.list.query({ limit: 200 }),
      ]);
      setTasks(taskRows);
      setPromises(promiseRows);
      setApprovals(approvalRows);
      setTeam(members);
      setDebtors(debtorsPage.items);
      if (!debtorId && debtorsPage.items[0]) setDebtorId(debtorsPage.items[0].id);
      if (!selectedPromiseDebtor && debtorsPage.items[0]) setSelectedPromiseDebtor(debtorsPage.items[0].id);
      if (!reminderDebtorId && debtorsPage.items[0]) setReminderDebtorId(debtorsPage.items[0].id);
    } catch {
      setError(
        isAr
          ? "تعذر تحميل بيانات مساحة عمل دفقلي. تحقق من الاتصال والصلاحيات."
          : "Could not load Dafqly workspace data. Check connection and permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [debtorId, selectedPromiseDebtor, reminderDebtorId, isAr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingApprovals = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const pendingPromises = useMemo(() => promises.filter((p) => p.status === "pending"), [promises]);
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === "open" || task.status === "in_progress"),
    [tasks],
  );
  const overdueTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (task.status === "open" || task.status === "in_progress") &&
          new Date(task.dueAt).getTime() < Date.now(),
      ),
    [tasks],
  );
  const filteredTasks = useMemo(() => {
    if (taskFilter === "active") return activeTasks;
    if (taskFilter === "overdue") return overdueTasks;
    if (taskFilter === "done") return tasks.filter((t) => t.status === "done");
    return tasks;
  }, [tasks, activeTasks, overdueTasks, taskFilter]);

  async function mutateAction(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : isAr ? "تعذر تنفيذ العملية" : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTask() {
    if (!debtorId || !title.trim()) return;
    await mutateAction(
      () =>
        trpc.collections.createTask.mutate({
          debtorId,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          assignedToUserId: assignee || null,
          dueAt: new Date(dueAt).toISOString(),
        }),
      isAr ? "تم إنشاء التذكرة وإضافتها لقائمة مهام دفقلي." : "Task created and added to the Dafqly work queue.",
    );
    setTitle("");
    setDescription("");
  }

  async function rescheduleTask(task: Task, addDays: number) {
    const base = Math.max(Date.now(), new Date(task.dueAt).getTime());
    const nextDue = new Date(base + addDays * 86400000).toISOString();
    await mutateAction(
      () => trpc.collections.updateTask.mutate({ id: task.id, dueAt: nextDue }),
      isAr ? `تمت إعادة جدولة التذكرة (+${addDays} يوم).` : `Task rescheduled (+${addDays}d).`,
    );
  }

  async function runSmartReminder() {
    if (!reminderDebtorId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await trpc.aiWorkspace.dispatchSmartReminder.mutate({
        debtorId: reminderDebtorId,
        tone: reminderTone,
      });
      setReminderResult(res);
      setSuccess(
        res.ok
          ? isAr
            ? `تمت جدولة التذكير الذكي للعميل ${res.debtorName} في ${res.localDateFormatted} (${res.localTimeFormatted}).`
            : `Smart reminder scheduled for ${res.debtorName} at ${res.localDateFormatted} ${res.localTimeFormatted}.`
          : isAr
            ? `تعذر جدولة التذكير: ${res.reasonAr}`
            : `Reminder blocked: ${res.reasonEn}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : isAr ? "تعذر تشغيل أداة التذكير" : "Failed to run reminder tool");
    } finally {
      setBusy(false);
    }
  }

  async function runOptimizeAllReminders() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await trpc.aiWorkspace.optimizeReminders.mutate();
      setOptimizeResult(res);
      setSuccess(isAr ? res.summaryAr : res.summaryEn);
    } catch (e) {
      setError(e instanceof Error ? e.message : isAr ? "تعذر تحسين جدول التذكيرات" : "Failed to optimize reminders");
    } finally {
      setBusy(false);
    }
  }

  async function createPromise() {
    if (!selectedPromiseDebtor) return;
    let minor: bigint;
    try {
      minor = parseMoney(promiseAmount, currency);
    } catch {
      return;
    }
    if (minor <= 0n) return;
    await mutateAction(
      () =>
        trpc.collections.createPromise.mutate({
          debtorId: selectedPromiseDebtor,
          invoiceId: promiseInvoiceId || undefined,
          amountMinor: minor.toString(),
          promisedOn: promiseDate,
          note: promiseNote || undefined,
        }),
      isAr ? "تم تسجيل تعهد السداد." : "Promise to pay recorded.",
    );
    setPromiseAmount("");
    setPromiseNote("");
    setPromiseInvoiceId("");
  }

  const promiseAmountValid = (() => {
    try {
      return parseMoney(promiseAmount, currency) > 0n;
    } catch {
      return false;
    }
  })();

  const tabs: { id: Tab; label: string; count?: number; Icon: typeof ClipboardText }[] = [
    { id: "tasks", label: isAr ? "المهام والتذاكر" : "Tasks & tickets", count: activeTasks.length, Icon: ClipboardText },
    { id: "reminders", label: isAr ? "أداة التذكير والجدولة" : "Reminder scheduler", count: debtors.length, Icon: Bell },
    { id: "promises", label: isAr ? "وعود السداد" : "Promises to pay", count: pendingPromises.length, Icon: Handshake },
    { id: "approvals", label: isAr ? "موافقات AI" : "AI approvals", count: pendingApprovals.length, Icon: ShieldCheck },
  ];

  return (
    <div className="flex flex-col gap-6" dir={isAr ? "rtl" : "ltr"}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">DAFQLY WORKSPACE</p>
          <h1 className="mt-1 text-2xl font-extrabold text-text">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runOptimizeAllReminders()}
            disabled={busy || loading}
            className={cn(buttonVariants({ variant: "outline", size: "default" }))}
          >
            <Lightning size={16} className="text-[var(--chart-1)]" />
            {isAr ? "جدولة التذكيرات الذكية" : "Optimize reminders"}
          </button>
          <button onClick={() => void refresh()} disabled={loading} className={btnGhost}>
            {isAr ? "تحديث البيانات" : "Refresh data"}
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Metric
          label={isAr ? "تذاكر نشطة" : "Active tickets"}
          value={String(activeTasks.length)}
          detail={isAr ? "تحتاج متابعة من الفريق" : "Need team follow-up"}
        />
        <Metric
          label={isAr ? "تذاكر متأخرة" : "Overdue tickets"}
          value={String(overdueTasks.length)}
          detail={isAr ? "تجاوزت موعد المتابعة" : "Past scheduled due time"}
        />
        <Metric
          label={isAr ? "تعهدات بانتظار المراجعة" : "Promises awaiting review"}
          value={String(pendingPromises.length)}
          detail={isAr ? "طلبات واردة من بوابة العميل" : "Requests from customer portal"}
        />
        <Metric
          label={isAr ? "إجراءات AI بانتظار الموافقة" : "AI actions awaiting approval"}
          value={String(pendingApprovals.length)}
          detail={isAr ? "لن تُنفذ دون موافقة المالك" : "Never execute without owner approval"}
        />
      </section>

      {role === "owner" && team.length > 0 && (
        <Panel title={isAr ? "توزيع عبء العمل على الفريق" : "Team workload distribution"}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {team.map((member) => {
              const assigned = tasks.filter((task) => task.assignedToUserId === member.userId);
              const open = assigned.filter((task) => task.status === "open" || task.status === "in_progress").length;
              const overdue = assigned.filter(
                (task) =>
                  (task.status === "open" || task.status === "in_progress") &&
                  new Date(task.dueAt).getTime() < Date.now(),
              ).length;
              const done = assigned.filter((task) => task.status === "done").length;
              const completion = assigned.length ? Math.round((done / assigned.length) * 100) : 0;
              return (
                <article key={member.userId} className="rounded-xl border border-border bg-surface-muted/35 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold">{member.name}</p>
                      <p className="truncate text-xs text-text-muted">{member.role}</p>
                    </div>
                    <span className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-extrabold text-primary" dir="ltr">
                      {open}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-text-muted">{isAr ? "إنجاز التذاكر" : "Ticket completion"}</span>
                    <strong dir="ltr">{completion}%</strong>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
                  </div>
                  <p className={`mt-2 text-xs font-semibold ${overdue ? "text-danger" : "text-text-muted"}`}>
                    {overdue
                      ? isAr
                        ? `${overdue} تذكرة متأخرة`
                        : `${overdue} overdue`
                      : isAr
                        ? `${done} مكتملة · ${open} نشطة`
                        : `${done} completed · ${open} active`}
                  </p>
                </article>
              );
            })}
            <article className="flex flex-col justify-center rounded-xl border border-dashed border-border p-3.5">
              <p className="text-xs font-bold text-text-muted">{isAr ? "تذاكر غير مسندة" : "Unassigned tickets"}</p>
              <p className="mt-1 text-2xl font-extrabold" dir="ltr">
                {tasks.filter((task) => !task.assignedToUserId && (task.status === "open" || task.status === "in_progress")).length}
              </p>
              <p className="mt-1 text-xs text-text-muted">{isAr ? "تحتاج تعيين مسؤول" : "Need an owner"}</p>
            </article>
          </div>
        </Panel>
      )}

      <nav
        className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-2"
        aria-label={isAr ? "أقسام مساحة عمل دفقلي" : "Dafqly workspace sections"}
      >
        {tabs.map(({ id, label, count, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              buttonVariants({ variant: tab === id ? "default" : "ghost", size: "default" }),
              !(tab === id) && "text-text-muted",
            )}
          >
            <Icon size={18} />
            {label}
            {typeof count === "number" && (
              <span className={`rounded-md px-2 py-0.5 text-xs ${tab === id ? "bg-primary-foreground/15" : "bg-muted"}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {(error || success) && (
        <p
          role="status"
          className={`rounded-xl border p-3.5 text-sm font-semibold ${
            error
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-status-paid-fg/20 bg-status-paid-bg text-status-paid-fg"
          }`}
        >
          {error || success}
        </p>
      )}

      {tab === "tasks" && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)]">
          <Panel
            title={isAr ? "قائمة التذاكر وجدولة المهام" : "Ticket queue & scheduling"}
            actions={
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "active", label: isAr ? "نشطة" : "Active", count: activeTasks.length },
                    { id: "overdue", label: isAr ? "متأخرة" : "Overdue", count: overdueTasks.length },
                    { id: "done", label: isAr ? "مكتملة" : "Completed", count: tasks.filter((t) => t.status === "done").length },
                    { id: "all", label: isAr ? "الكل" : "All", count: tasks.length },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTaskFilter(f.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors",
                      taskFilter === f.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-text-muted hover:text-text",
                    )}
                  >
                    <span>{f.label}</span>
                    <span className="font-mono text-[10px] opacity-80">{f.count}</span>
                  </button>
                ))}
              </div>
            }
          >
            {loading ? (
              <LoadingState isAr={isAr} />
            ) : filteredTasks.length === 0 ? (
              <EmptyState
                title={isAr ? "لا توجد تذاكر مطابقة" : "No matching tickets"}
                body={
                  isAr
                    ? "أضف تذكرة متابعة جديدة من النموذج الجانبي أو اطلب من المساعد الذكي اقتراح مهام."
                    : "Create a follow-up ticket from the side form or ask the AI Copilot to propose tasks."
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {filteredTasks.map((task) => {
                  const isOverdue =
                    (task.status === "open" || task.status === "in_progress") &&
                    new Date(task.dueAt).getTime() < Date.now();
                  return (
                    <article key={task.id} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/${locale}/debtors/${task.debtorId}`}
                            className="text-sm font-extrabold text-primary hover:underline"
                          >
                            {task.debtorName}
                          </Link>
                          <Priority value={task.priority} isAr={isAr} />
                          {isOverdue && (
                            <span className="rounded-md bg-danger-bg px-2 py-0.5 text-[10px] font-bold text-danger">
                              {isAr ? "متأخرة" : "Overdue"}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-semibold text-text">{task.title}</p>
                        {task.description && <p className="mt-0.5 text-xs text-text-muted">{task.description}</p>}
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                          <span>{task.assignedToName || (isAr ? "غير مسندة" : "Unassigned")}</span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1" dir="ltr">
                            <Clock size={12} />
                            {new Date(task.dueAt).toLocaleString(isAr ? "ar-EG" : "en-GB")}
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(task.status === "open" || task.status === "in_progress") && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void rescheduleTask(task, 1)}
                              title={isAr ? "تأجيل يوم واحد" : "Postpone 1 day"}
                              className="rounded-lg border border-border bg-card px-2 py-1 font-mono text-[11px] font-bold text-text-muted hover:border-foreground/40 hover:text-text"
                            >
                              +1d
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void rescheduleTask(task, 3)}
                              title={isAr ? "تأجيل 3 أيام" : "Postpone 3 days"}
                              className="rounded-lg border border-border bg-card px-2 py-1 font-mono text-[11px] font-bold text-text-muted hover:border-foreground/40 hover:text-text"
                            >
                              +3d
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void mutateAction(
                                  () =>
                                    trpc.collections.updateTask.mutate({
                                      id: task.id,
                                      status: task.status === "open" ? "in_progress" : "done",
                                    }),
                                  isAr ? "تم تحديث حالة التذكرة." : "Ticket status updated.",
                                )
                              }
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                            >
                              {task.status === "open" ? (isAr ? "بدء" : "Start") : isAr ? "إتمام" : "Complete"}
                            </button>
                          </>
                        )}
                        {task.status === "done" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void mutateAction(
                                () => trpc.collections.updateTask.mutate({ id: task.id, status: "open" }),
                                isAr ? "تمت إعادة فتح التذكرة." : "Ticket reopened.",
                              )
                            }
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                          >
                            {isAr ? "إعادة فتح" : "Reopen"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title={isAr ? "إنشاء تذكرة وجدولة متابعة" : "Create & schedule follow-up ticket"}>
            <div className="flex flex-col gap-3">
              <Field label={isAr ? "العميل" : "Customer"}>
                <select className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
                  <option value="">{isAr ? "اختر العميل" : "Select customer"}</option>
                  {debtors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={isAr ? "عنوان التذكرة" : "Ticket title"}>
                <input
                  className={inputCls}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={180}
                  placeholder={isAr ? "مثال: متابعة موعد سداد الفاتورة" : "e.g. Follow up on invoice settlement"}
                />
              </Field>
              <Field label={isAr ? "تفاصيل المتابعة" : "Description"}>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                />
              </Field>
              {role === "owner" ? (
                <Field label={isAr ? "المسؤول" : "Assignee"}>
                  <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">{isAr ? "غير مسندة" : "Unassigned"}</option>
                    {team.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} · {m.role}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="rounded-xl bg-surface-muted/50 p-3 text-xs text-text-muted">
                  {isAr ? "سيتم إسناد التذكرة إلى حسابك تلقائياً." : "This ticket will be assigned to you automatically."}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label={isAr ? "الأولوية" : "Priority"}>
                  <select
                    className={inputCls}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                  >
                    <option value="normal">{isAr ? "عادية" : "Normal"}</option>
                    <option value="high">{isAr ? "مرتفعة" : "High"}</option>
                    <option value="urgent">{isAr ? "عاجلة" : "Urgent"}</option>
                    <option value="low">{isAr ? "منخفضة" : "Low"}</option>
                  </select>
                </Field>
                <Field label={isAr ? "موعد المتابعة" : "Scheduled at"}>
                  <input
                    type="datetime-local"
                    className={inputCls}
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                  />
                </Field>
              </div>
              <button
                disabled={busy || !debtorId || title.trim().length < 3}
                onClick={() => void createTask()}
                className={btnPrimary}
              >
                {isAr ? "إضافة وجدولة التذكرة" : "Schedule ticket"}
              </button>
            </div>
          </Panel>
        </div>
      )}

      {tab === "reminders" && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
          <Panel title={isAr ? "أداة التذكير الذكي وجدولة الأوقات المثالية" : "Smart Reminder Tool & Optimal Window Scheduler"}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface-muted/40 p-4 sm:flex-row">
                <ReminderScheduleIllustration size={96} />
                <div className="flex-1 text-sm">
                  <p className="font-extrabold text-text">
                    {isAr
                      ? "توقيت ذكي يحترم ساعات الهدوء وسياسة المنشأة"
                      : "Optimal-time scheduling respecting quiet hours & workspace policy"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {isAr
                      ? "تقوم أداة التذكير بحساب أفضل نافذة إرسال لكل عميل حسب حالة الفاتورة، ساعات الهدوء، وتخطي صباح الجمعة، مع توليد نص التذكير المناسب."
                      : "Computes the best delivery slot per customer based on invoice aging, quiet hours, and Friday skip policy, with ready-to-send bilingual copy."}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={isAr ? "اختر العميل" : "Select customer"}>
                  <select
                    className={inputCls}
                    value={reminderDebtorId}
                    onChange={(e) => setReminderDebtorId(e.target.value)}
                  >
                    <option value="">{isAr ? "اختر العميل" : "Select customer"}</option>
                    {debtors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={isAr ? "نبرة التذكير" : "Reminder tone"}>
                  <select
                    className={inputCls}
                    value={reminderTone}
                    onChange={(e) => setReminderTone(e.target.value as typeof reminderTone)}
                  >
                    <option value="friendly">{isAr ? "ودّية ولطيفة" : "Friendly"}</option>
                    <option value="polite">{isAr ? "مهذبة ورسمية" : "Polite"}</option>
                    <option value="firm">{isAr ? "حازمة" : "Firm"}</option>
                    <option value="urgent">{isAr ? "عاجلة" : "Urgent"}</option>
                  </select>
                </Field>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !reminderDebtorId}
                  onClick={() => void runSmartReminder()}
                  className={btnPrimary}
                >
                  <CalendarCheck size={17} />
                  {isAr ? "حساب الموعد وجدولة التذكير" : "Compute slot & schedule reminder"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runOptimizeAllReminders()}
                  className={btnGhost}
                >
                  <Lightning size={16} />
                  {isAr ? "تحسين جدول كل العملاء" : "Optimize all accounts"}
                </button>
              </div>
            </div>
          </Panel>

          <Panel title={isAr ? "نتيجة الجدولة ومعاينة الرسالة" : "Schedule slot & message preview"}>
            {reminderResult ? (
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between rounded-xl border border-border bg-surface-muted/40 p-3">
                  <div>
                    <p className="font-extrabold text-text">{reminderResult.debtorName}</p>
                    <p className="text-xs text-text-muted">
                      {isAr ? reminderResult.windowLabelAr : reminderResult.windowLabelEn}
                    </p>
                  </div>
                  <span className="rounded-lg bg-primary px-2.5 py-1 font-mono text-xs font-bold text-primary-foreground" dir="ltr">
                    {reminderResult.localDateFormatted} · {reminderResult.localTimeFormatted}
                  </span>
                </div>
                <p className="text-xs text-text-muted">
                  {isAr ? reminderResult.reasonAr : reminderResult.reasonEn}
                </p>
                {(reminderResult.messagePreviewAr || reminderResult.messagePreviewEn) && (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-muted">
                        {isAr ? "نص التذكير الجاهز" : "Generated reminder copy"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const text =
                            (isAr ? reminderResult.messagePreviewAr : reminderResult.messagePreviewEn) ?? "";
                          navigator.clipboard?.writeText(text).catch(() => {});
                          setCopiedPreview(true);
                          window.setTimeout(() => setCopiedPreview(false), 1800);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-bold hover:bg-accent"
                      >
                        <Copy size={13} />
                        {copiedPreview ? (isAr ? "تم النسخ" : "Copied") : isAr ? "نسخ النص" : "Copy"}
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-text">
                      {isAr ? reminderResult.messagePreviewAr : reminderResult.messagePreviewEn}
                    </p>
                  </div>
                )}
              </div>
            ) : optimizeResult ? (
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted/40 p-4 text-sm">
                <p className="font-bold text-text">{isAr ? optimizeResult.summaryAr : optimizeResult.summaryEn}</p>
              </div>
            ) : (
              <EmptyState
                title={isAr ? "اختر عميلاً لجدولة تذكيره" : "Select a customer to schedule"}
                body={
                  isAr
                    ? "ستظهر هنا نافذة الإرسال المثالية ومعاينة الرسالة بعد فحص الفواتير وساعات الهدوء."
                    : "The optimal delivery window and message preview will appear here after checking open invoices and quiet hours."
                }
              />
            )}
          </Panel>
        </div>
      )}

      {tab === "promises" && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
          <Panel title={isAr ? "سجل تعهدات السداد" : "Promise-to-pay register"}>
            {loading ? (
              <LoadingState isAr={isAr} />
            ) : promises.length === 0 ? (
              <EmptyState
                title={isAr ? "لا توجد تعهدات مسجلة" : "No promises recorded"}
                body={
                  isAr
                    ? "سجّل اتفاق السداد أو راجع طلباً أرسله العميل من بوابته."
                    : "Record a merchant-agreed commitment or review a request from the customer portal."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-start text-sm">
                  <thead className="sticky top-0 bg-surface text-xs text-text-muted">
                    <tr>
                      <th className="pb-3">{isAr ? "العميل" : "Customer"}</th>
                      <th className="pb-3">{isAr ? "المبلغ" : "Amount"}</th>
                      <th className="pb-3">{isAr ? "موعد السداد" : "Promised date"}</th>
                      <th className="pb-3">{isAr ? "الحالة" : "Status"}</th>
                      <th className="pb-3">{isAr ? "إجراء" : "Action"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {promises.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 font-bold">
                          <Link href={`/${locale}/debtors/${p.debtorId}`} className="hover:text-primary">
                            {p.debtorName}
                          </Link>
                          <p className="text-xs font-normal text-text-muted">
                            {p.invoiceReference ||
                              (p.source === "customer_portal"
                                ? isAr
                                  ? "بوابة العميل"
                                  : "Customer portal"
                                : isAr
                                  ? "اتفاق داخلي"
                                  : "Merchant recorded")}
                          </p>
                        </td>
                        <td className="py-3 font-extrabold" dir="ltr">
                          {fmt(p.amountMinor)}
                        </td>
                        <td className="py-3" dir="ltr">
                          {p.promisedOn}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-col items-start gap-1">
                            <Status value={p.status} isAr={isAr} />
                            {p.overdue && (
                              <span className="rounded-md bg-danger-bg px-2 py-0.5 text-[10px] font-bold text-danger">
                                {isAr ? "تجاوز الموعد" : "Overdue"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {p.status === "pending" && (
                              <>
                                <button
                                  disabled={busy || role !== "owner"}
                                  onClick={() =>
                                    void mutateAction(
                                      () => trpc.collections.decidePromise.mutate({ id: p.id, status: "accepted" }),
                                      isAr ? "تم قبول التعهد." : "Promise accepted.",
                                    )
                                  }
                                  className={cn(buttonVariants({ variant: "success", size: "sm" }), "text-status-paid-fg")}
                                >
                                  {isAr ? "قبول" : "Accept"}
                                </button>
                                <button
                                  disabled={busy || role !== "owner"}
                                  onClick={() =>
                                    void mutateAction(
                                      () => trpc.collections.decidePromise.mutate({ id: p.id, status: "rejected" }),
                                      isAr ? "تم رفض الطلب." : "Request rejected.",
                                    )
                                  }
                                  className={cn(buttonVariants({ variant: "dangerSoft", size: "sm" }), "text-danger")}
                                >
                                  {isAr ? "رفض" : "Reject"}
                                </button>
                              </>
                            )}
                            {p.status === "accepted" && (
                              <>
                                {p.overdue && (
                                  <button
                                    disabled={busy || role !== "owner"}
                                    title={
                                      role !== "owner"
                                        ? isAr
                                          ? "تغيير حالة التعهد يتطلب موافقة المالك"
                                          : "Owner approval required to change promise status"
                                        : undefined
                                    }
                                    onClick={() =>
                                      void mutateAction(
                                        () => trpc.collections.decidePromise.mutate({ id: p.id, status: "broken" }),
                                        isAr
                                          ? "تم تسجيل عدم الوفاء بالتعهد بعد تجاوز موعده."
                                          : "Promise marked broken after its due date.",
                                      )
                                    }
                                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                                  >
                                    {isAr ? "لم يلتزم" : "Broken"}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title={isAr ? "تسجيل تعهد من المنشأة" : "Record merchant-side promise"}>
            <div className="flex flex-col gap-3">
              <Field label={isAr ? "العميل" : "Customer"}>
                <select
                  className={inputCls}
                  value={selectedPromiseDebtor}
                  onChange={(e) => setSelectedPromiseDebtor(e.target.value)}
                >
                  <option value="">—</option>
                  {debtors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={isAr ? "المبلغ بالجنيه" : "Amount (EGP)"}>
                <input
                  inputMode="decimal"
                  className={inputCls}
                  value={promiseAmount}
                  onChange={(e) => setPromiseAmount(e.target.value)}
                  placeholder="1250.00"
                />
              </Field>
              <Field label={isAr ? "تاريخ السداد" : "Promised date"}>
                <input
                  type="date"
                  className={inputCls}
                  value={promiseDate}
                  onChange={(e) => setPromiseDate(e.target.value)}
                />
              </Field>
              <Field label={isAr ? "ملاحظة" : "Note"}>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={promiseNote}
                  onChange={(e) => setPromiseNote(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !selectedPromiseDebtor || !promiseAmountValid}
                onClick={() => void createPromise()}
                className={btnPrimary}
              >
                {isAr ? "تسجيل التعهد" : "Record promise"}
              </button>
              <p className="text-xs text-text-muted">
                {isAr
                  ? "تعهد السداد مؤشر متابعة وليس ضماناً لوصول الأموال. سجّل الوفاء بعد التحقق من الدفعة."
                  : "A promise is a follow-up signal, not proof of funds. Mark it kept only after verifying the payment."}
              </p>
            </div>
          </Panel>
        </div>
      )}

      {tab === "approvals" && (
        <Panel title={isAr ? "الإجراءات التي اقترحها AI" : "AI-proposed actions"}>
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-sm">
            <Robot size={22} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <strong>{isAr ? "الموافقة مطلوبة قبل التنفيذ" : "Owner approval required"}</strong>
              <p className="mt-0.5 text-text-muted">
                {isAr
                  ? "يقترح المساعد الذكي تذكرة متابعة أو جدولة تذكير. بعد موافقة المالك يعيد النظام التحقق من العميل والفاتورة وسياسة التواصل."
                  : "AI proposes a follow-up ticket or reminder schedule. After owner approval, the system rechecks customer, invoice and messaging policy."}
              </p>
            </div>
          </div>
          {loading ? (
            <LoadingState isAr={isAr} />
          ) : pendingApprovals.length === 0 ? (
            <EmptyState
              title={isAr ? "لا توجد موافقات معلقة" : "No pending approvals"}
              body={
                isAr
                  ? "عندما يقترح AI إنشاء تذكرة أو جدولة تذكير، ستظهر هنا لمراجعتها."
                  : "AI-proposed tickets and reminder schedules appear here for review."
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {pendingApprovals.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold">{item.title}</p>
                    <p className="mt-1 text-sm text-text-muted">{item.rationale}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {item.requestedByName || "AI"} ·{" "}
                      {new Date(item.createdAt).toLocaleString(isAr ? "ar-EG" : "en-GB")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={busy || role !== "owner"}
                      title={
                        role !== "owner"
                          ? isAr
                            ? "موافقة المالك مطلوبة"
                            : "Owner approval required"
                          : undefined
                      }
                      onClick={() =>
                        void mutateAction(
                          () => trpc.aiActions.decide.mutate({ id: item.id, decision: "approve" }),
                          isAr
                            ? "تمت الموافقة على الإجراء وتنفيذه ضمن الحدود."
                            : "Action approved and executed within policy.",
                        )
                      }
                      className={cn(buttonVariants({ variant: "success", size: "sm" }), "text-status-paid-fg")}
                    >
                      <Check size={16} />
                      {isAr ? "موافقة" : "Approve"}
                    </button>
                    <button
                      disabled={busy || role !== "owner"}
                      onClick={() =>
                        void mutateAction(
                          () => trpc.aiActions.decide.mutate({ id: item.id, decision: "reject" }),
                          isAr ? "تم رفض الاقتراح." : "Proposal rejected.",
                        )
                      }
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <X size={16} />
                      {isAr ? "رفض" : "Reject"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {role !== "owner" && (
            <p className="mt-3 text-xs font-semibold text-text-muted">
              {isAr
                ? "الموظفون يمكنهم الاطلاع، لكن الموافقة متاحة لمالك مساحة العمل فقط."
                : "Staff can review but only the workspace owner can approve actions."}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-bold text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-text" dir="ltr">
        {value}
      </p>
      <p className="mt-1 text-xs text-text-muted">{detail}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-5 py-9 text-center">
      <p className="font-bold text-text">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-text-muted">{body}</p>
    </div>
  );
}
function LoadingState({ isAr }: { isAr: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
      <span className="size-2 animate-pulse rounded-full bg-primary" />
      {isAr ? "جارٍ تحميل بيانات دفقلي…" : "Loading Dafqly workspace…"}
    </div>
  );
}
function Priority({ value, isAr }: { value: string; isAr: boolean }) {
  const labels: Record<string, string> = {
    low: isAr ? "منخفضة" : "Low",
    normal: isAr ? "عادية" : "Normal",
    high: isAr ? "مرتفعة" : "High",
    urgent: isAr ? "عاجلة" : "Urgent",
  };
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-bold ${
        value === "urgent" || value === "high"
          ? "bg-danger-bg text-danger"
          : "bg-surface-muted text-text-subtle"
      }`}
    >
      {labels[value] ?? value}
    </span>
  );
}
function Status({ value, isAr }: { value: string; isAr: boolean }) {
  const labels: Record<string, string> = {
    pending: isAr ? "بانتظار المراجعة" : "Pending",
    accepted: isAr ? "معتمد" : "Accepted",
    kept: isAr ? "تم الوفاء" : "Kept",
    broken: isAr ? "لم يتم الوفاء" : "Broken",
    rejected: isAr ? "مرفوض" : "Rejected",
    cancelled: isAr ? "ملغي" : "Cancelled",
  };
  return <span className="rounded-md bg-surface-muted px-2.5 py-1 text-xs font-bold">{labels[value] ?? value}</span>;
}
