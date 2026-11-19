"use client";

import { cn, toSafeLocalePath } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, Bell, BellRinging, CheckCircle, Checks, Sparkle, Warning, WarningCircle, X, type LucideIcon } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";

interface NotificationItem {
  id: string;
  kind: string;
  severity: "info" | "warning" | "urgent" | "success";
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  actionUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

type FilterTab = "all" | "unread" | "urgent";

function formatRelativeTime(iso: string, isEn: boolean): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return isEn ? "Just now" : "الآن";
  if (mins < 60) return isEn ? `${mins}m ago` : `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isEn ? `${hrs}h ago` : `منذ ${hrs} س`;
  const days = Math.floor(hrs / 24);
  return isEn ? `${days}d ago` : `منذ ${days} ي`;
}

const SEVERITY_STYLE: Record<NotificationItem["severity"], { box: string; Icon: LucideIcon }> = {
  urgent: { box: "bg-status-overdue-bg text-status-overdue-fg", Icon: WarningCircle },
  warning: { box: "bg-status-due-bg text-status-due-fg", Icon: Warning },
  success: { box: "bg-status-paid-bg text-status-paid-fg", Icon: CheckCircle },
  info: { box: "bg-callout text-primary", Icon: Sparkle },
};

export function NotificationBell({ locale }: { locale: string }) {
  const isEn = locale === "en";
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const res = await trpc.notifications.list.query({ limit: 30 });
      setItems(res.items as NotificationItem[]);
      setUnreadCount(res.unreadCount);
      setUrgentCount(res.urgentCount);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await trpc.notifications.sync.mutate();
      await fetchList();
    } catch {
      setFetchError(true);
    } finally {
      setSyncing(false);
    }
  }, [fetchList]);

  // Initial load, 60s refresh when visible, and live refresh on workspace mutations
  useEffect(() => {
    void fetchList();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchList();
      }
    }, 60_000);

    const onMutated = () => {
      void fetchList();
    };
    window.addEventListener("dafqly:data-mutated", onMutated);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("dafqly:data-mutated", onMutated);
    };
  }, [fetchList]);

  // Focus panel on open; close on Escape (restoring focus) or outside click
  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const filteredItems = useMemo(() => {
    if (filter === "unread") return items.filter((n) => !n.readAt);
    if (filter === "urgent") return items.filter((n) => n.severity === "urgent");
    return items;
  }, [items, filter]);

  const handleMarkRead = async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.readAt) return;

    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: nowIso } : item)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    if (target.severity === "urgent") {
      setUrgentCount((c) => Math.max(0, c - 1));
    }
    try {
      await trpc.notifications.markRead.mutate({ id });
    } catch {
      void fetchList();
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    const nowIso = new Date().toISOString();
    setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? nowIso })));
    setUnreadCount(0);
    setUrgentCount(0);
    try {
      await trpc.notifications.markAllRead.mutate();
    } catch {
      void fetchList();
    }
  };

  const handleDismiss = async (e: React.MouseEvent, id: string, wasUnread: boolean, wasUrgent: boolean) => {
    e.stopPropagation();
    setItems((prev) => prev.filter((item) => item.id !== id));
    if (wasUnread) {
      setUnreadCount((c) => Math.max(0, c - 1));
      if (wasUrgent) setUrgentCount((c) => Math.max(0, c - 1));
    }
    try {
      await trpc.notifications.dismiss.mutate({ id });
    } catch {
      void fetchList();
    }
  };

  const handleItemClick = (item: NotificationItem) => {
    if (!item.readAt) {
      void handleMarkRead(item.id);
    }
    setOpen(false);
    const normalized = toSafeLocalePath(item.actionUrl, locale);
    if (normalized) router.push(normalized);
  };

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);
  // WCAG 2.5.3: the visible badge count must be part of the accessible
  // name, otherwise axe flags label-content-name-mismatch.
  const bellLabel =
    unreadCount > 0
      ? isEn
        ? `Notifications, ${badge} unread`
        : `الإشعارات، ${badge} غير مقروءة`
      : isEn
        ? "Notifications"
        : "الإشعارات";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="notification-bell-btn"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) void fetchList();
            return next;
          });
        }}
        aria-label={bellLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(buttonVariants({ variant: open ? "soft" : "outline", size: "icon" }), "relative size-9", !open && "text-text-muted hover:border-border")}
      >
        {unreadCount > 0 ? (
          <BellRinging size={17} aria-hidden className={urgentCount > 0 ? "text-status-overdue-fg" : "text-primary"} />
        ) : (
          <Bell size={17} aria-hidden />
        )}
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className={`absolute -top-1 -end-1 flex min-w-[18px] items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold leading-none text-primary-fg ${
              urgentCount > 0 ? "bg-danger" : "bg-primary"
            }`}
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={isEn ? "Workspace Notifications" : "إشعارات مساحة العمل"}
          data-testid="notification-popover"
          className="fixed inset-x-3 top-14 z-50 w-auto overflow-hidden rounded-xl border border-border bg-surface panel-shadow focus:outline-none sm:absolute sm:inset-x-auto sm:top-11 sm:end-0 sm:w-[min(92vw,390px)]"
        >
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text">
                {isEn ? "Notifications" : "الإشعارات"}
              </span>
              {unreadCount > 0 && (
                <span className="rounded bg-callout px-2 py-0.5 text-[11px] font-bold text-primary">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void syncNow()}
                disabled={syncing}
                title={isEn ? "Refresh alerts" : "تحديث التنبيهات"}
                className={cn(buttonVariants({ variant: "outline", size: "xs" }), "text-text-muted")}
              >
                <ArrowsClockwise
                  size={13}
                  aria-hidden
                  className={syncing ? "animate-spin text-primary" : ""}
                />
                <span>{isEn ? "Sync" : "تحديث"}</span>
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className={cn(buttonVariants({ variant: "soft", size: "xs" }))}
                >
                  <Checks size={13} aria-hidden />
                  <span>{isEn ? "Read all" : "قراءة الكل"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-surface-muted/40 px-4 py-2">
            {(
              [
                { id: "all", labelEn: "All", labelAr: "الكل" },
                { id: "unread", labelEn: "Unread", labelAr: "غير مقروء" },
                { id: "urgent", labelEn: "Urgent", labelAr: "عاجل" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={cn(buttonVariants({ variant: filter === tab.id ? "default" : "ghost", size: "sm" }), filter !== tab.id && "text-text-muted")}
              >
                {isEn ? tab.labelEn : tab.labelAr}
              </button>
            ))}
          </div>

          {/* Notification Items */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/50">
            {loading ? (
              <div className="px-4 py-8 text-center text-xs text-text-muted">
                {isEn ? "Loading notifications..." : "جاري تحميل الإشعارات..."}
              </div>
            ) : fetchError && filteredItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <p className="text-xs font-semibold text-danger">
                  {isEn ? "Could not load notifications." : "تعذر تحميل الإشعارات."}
                </p>
                <button
                  type="button"
                  onClick={() => void fetchList()}
                  className={cn(buttonVariants({ variant: "outline", size: "xs" }))}
                >
                  {isEn ? "Retry" : "إعادة المحاولة"}
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-9 text-center">
                <span className="flex size-10 items-center justify-center rounded bg-callout text-primary">
                  <CheckCircle size={20} aria-hidden />
                </span>
                <p className="text-sm font-semibold text-text">
                  {isEn ? "You're all caught up" : "لا توجد تنبيهات جديدة"}
                </p>
                <p className="text-xs text-text-muted">
                  {isEn
                    ? "Disputes, receipt claims, cheques, and AI briefings appear here."
                    : "تظهر هنا الاعتراضات وإيصالات السداد والشيكات وملخصات الذكاء الاصطناعي."}
                </p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const { box, Icon } = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.info;
                const unread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleItemClick(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleItemClick(item);
                      }
                    }}
                    className={`group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:bg-surface-muted/60 ${
                      unread ? "bg-callout/35" : ""
                    }`}
                  >
                    <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${box}`}>
                      <Icon size={16} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-bold leading-snug ${unread ? "text-text" : "text-text-muted"}`}>
                          {isEn ? item.titleEn : item.titleAr}
                        </p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {unread && <span className="size-2 rounded-full bg-primary" aria-hidden />}
                          <button
                            type="button"
                            onClick={(e) => void handleDismiss(e, item.id, unread, item.severity === "urgent")}
                            aria-label={isEn ? "Dismiss" : "إخفاء"}
                            className={cn(
                              buttonVariants({ variant: "ghost", size: "iconSm" }),
                              "size-6 text-text-subtle opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100",
                            )}
                          >
                            <X size={12} aria-hidden />
                          </button>
                        </div>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-muted">
                        {isEn ? item.bodyEn : item.bodyAr}
                      </p>
                      <span className="mt-1 inline-block text-[10px] font-medium text-text-subtle">
                        {formatRelativeTime(item.createdAt, isEn)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
