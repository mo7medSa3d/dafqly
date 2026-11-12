"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowsClockwise,
  Bell,
  BellRinging,
  CheckCircle,
  Checks,
  Sparkle,
  Warning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
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

function severityStyles(severity: NotificationItem["severity"]) {
  switch (severity) {
    case "urgent":
      return {
        box: "bg-status-overdue-bg text-status-overdue-fg",
        Icon: WarningCircle,
      };
    case "warning":
      return {
        box: "bg-status-due-bg text-status-due-fg",
        Icon: Warning,
      };
    case "success":
      return {
        box: "bg-status-paid-bg text-status-paid-fg",
        Icon: CheckCircle,
      };
    default:
      return {
        box: "bg-callout text-primary",
        Icon: Sparkle,
      };
  }
}

export function NotificationBell({ locale }: { locale: string }) {
  const isEn = locale === "en";
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  
  const fetchList = useCallback(async () => {
    try {
      const res = await trpc.notifications.list.query({ limit: 30 });
      setItems(res.items as NotificationItem[]);
      setUnreadCount(res.unreadCount);
      setUrgentCount(res.urgentCount);
    } catch {
      // Fail silently in background poll so shell stays resilient
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
      // Ignore transient network errors
    } finally {
      setSyncing(false);
    }
  }, [fetchList]);

  // Initial load + 60s refresh when visible
  useEffect(() => {
    let active = true;
    if (active) void fetchList();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchList();
      }
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [fetchList]);

  // Close on Escape or outside click
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
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
    setItems((prev) =>
      prev.map((item) =>
        item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await trpc.notifications.markRead.mutate({ id });
    } catch {
      void fetchList();
    }
  };

  const handleMarkAllRead = async () => {
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

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.readAt) {
      await handleMarkRead(item.id);
    }
    setOpen(false);
    if (item.actionUrl) {
      const normalized = item.actionUrl.startsWith(`/${locale}/`)
        ? item.actionUrl
        : `/${locale}${item.actionUrl.startsWith("/") ? item.actionUrl : `/${item.actionUrl}`}`;
      router.push(normalized);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="notification-bell-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={isEn ? "Notifications" : "الإشعارات"}
        aria-expanded={open}
        className={`relative flex size-9 items-center justify-center rounded-full border transition-all ${
          open
            ? "border-primary bg-callout text-primary"
            : "border-border/70 bg-surface-muted/60 text-text-muted hover:border-border hover:bg-surface-muted hover:text-text"
        }`}
      >
        {unreadCount > 0 ? (
          <BellRinging size={17} weight="fill" aria-hidden className={urgentCount > 0 ? "text-status-overdue-fg" : "text-primary"} />
        ) : (
          <Bell size={17} weight="fill" aria-hidden />
        )}
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className={`absolute -top-1 ${isEn ? "-right-1" : "-left-1"} flex min-w-[18px] items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-bold leading-none text-primary-fg ${
              urgentCount > 0 ? "bg-danger" : "bg-primary"
            }`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={isEn ? "Workspace Notifications" : "إشعارات مساحة العمل"}
          data-testid="notification-popover"
          className={`absolute top-11 z-50 w-[min(92vw,390px)] overflow-hidden rounded-2xl border border-border bg-surface panel-shadow ${
            isEn ? "right-0" : "left-0"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text">
                {isEn ? "Notifications" : "الإشعارات"}
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-callout px-2 py-0.5 text-[11px] font-bold text-primary">
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
                className="flex items-center gap-1 rounded-full border border-border/70 bg-surface-muted/60 px-2.5 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:text-text disabled:opacity-50"
              >
                <ArrowsClockwise
                  size={13}
                  weight="fill"
                  aria-hidden
                  className={syncing ? "animate-spin text-primary" : ""}
                />
                <span>{isEn ? "Sync" : "تحديث"}</span>
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="flex items-center gap-1 rounded-full bg-callout px-2.5 py-1 text-[11px] font-semibold text-primary transition-opacity hover:opacity-85"
                >
                  <Checks size={13} weight="fill" aria-hidden />
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
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  filter === tab.id
                    ? "bg-primary text-primary-fg"
                    : "text-text-muted hover:bg-surface hover:text-text"
                }`}
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
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-9 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-callout text-primary">
                  <CheckCircle size={20} weight="fill" aria-hidden />
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
                const { box, Icon } = severityStyles(item.severity);
                const unread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    onClick={() => void handleItemClick(item)}
                    className={`group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60 ${
                      unread ? "bg-callout/35" : ""
                    }`}
                  >
                    <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${box}`}>
                      <Icon size={16} weight="fill" aria-hidden />
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
                            className="rounded-full p-0.5 text-text-subtle opacity-0 transition-opacity hover:bg-surface-muted hover:text-text group-hover:opacity-100"
                          >
                            <X size={12} weight="fill" aria-hidden />
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
