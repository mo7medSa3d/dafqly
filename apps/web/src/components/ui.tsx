"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { SecurityLockBadge } from "./illustrations";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle, Clock, Coins, LockKey, Prohibit, WarningCircle, XCircle, type LucideIcon } from "@/components/ui/solid-icons";

/**
 * Shared design-system primitives implementing the Quiet Ledger direction
 * (DESIGN.md):
 * - Rectangular buttons (border-radius: 8px, height: 40px, px: 16px)
 * - Form Inputs (border-radius: 8px, border: --border-strong)
 * - Panels (border-radius: 12px, border-first elevation — no shadows)
 * - Status Badges (rectangular 4px, semantic status tokens, icon + label)
 * - Security Badges & Security Notice bars
 */

/** Legacy class-string API, now backed by shadcn/ui (see ui/styles.ts). */
export { inputCls, labelCls, btnPrimary, btnGhost, btnDanger, btnSmall, linkAction } from "./ui/styles";
export { Button, Card, Badge };

type IconType = LucideIcon;

/** Panel: Quiet Ledger surface — 12px radius, hairline border, no shadow. */
export function Panel({
  title, subtitle, icon: Icon, badge, actions, children, className = "", padded = true, testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconType;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} className={className}>
      {(title || actions || badge) && (
        <CardHeader>
          <div className="flex flex-col gap-0.5">
            {title && (
              <CardTitle>
                {Icon && (
                  <span className="flex size-8 items-center justify-center rounded-lg border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] text-[var(--icon-box-fg)]">
                    <Icon size={18} aria-hidden />
                  </span>
                )}
                {title}
                {badge}
              </CardTitle>
            )}
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(!padded && "p-0 sm:p-0")}>{children}</CardContent>
    </Card>
  );
}

/** Page header pattern: 28px title, rectangular eyebrow, actions right. */
export function PageHeader({
  eyebrow, title, subtitle, actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        {eyebrow && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 font-mono text-[11px] font-bold uppercase text-foreground">
            {eyebrow}
          </span>
        )}
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, { fg: string; bg: string; Icon: IconType }> = {
  paid: { fg: "text-status-paid-fg", bg: "bg-status-paid-bg", Icon: CheckCircle },
  partially_paid: { fg: "text-status-due-fg", bg: "bg-status-due-bg", Icon: Coins },
  open: { fg: "text-status-partial-fg", bg: "bg-status-partial-bg", Icon: Clock },
  due_soon: { fg: "text-status-due-fg", bg: "bg-status-due-bg", Icon: Clock },
  overdue: { fg: "text-status-overdue-fg", bg: "bg-status-overdue-bg", Icon: WarningCircle },
  disputed: { fg: "text-status-disputed-fg", bg: "bg-status-disputed-bg", Icon: WarningCircle },
  written_off: { fg: "text-status-draft-fg", bg: "bg-status-draft-bg", Icon: Prohibit },
  cancelled: { fg: "text-status-draft-fg", bg: "bg-status-draft-bg", Icon: XCircle },
  held: { fg: "text-status-draft-fg", bg: "bg-status-draft-bg", Icon: Clock },
  deposited: { fg: "text-status-partial-fg", bg: "bg-status-partial-bg", Icon: Coins },
  cleared: { fg: "text-status-paid-fg", bg: "bg-status-paid-bg", Icon: CheckCircle },
  bounced: { fg: "text-status-overdue-fg", bg: "bg-status-overdue-bg", Icon: WarningCircle },
  returned: { fg: "text-status-draft-fg", bg: "bg-status-draft-bg", Icon: XCircle },
  confirmed: { fg: "text-status-paid-fg", bg: "bg-status-paid-bg", Icon: CheckCircle },
  claimed: { fg: "text-status-due-fg", bg: "bg-status-due-bg", Icon: Clock },
  rejected: { fg: "text-status-overdue-fg", bg: "bg-status-overdue-bg", Icon: XCircle },
};

/** Status badge: rectangular 4px, semantic status tokens, icon + label. */
export function StatusPill({ status, label, testId }: { status: string; label: string; testId?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open!;
  const { Icon } = s;
  return (
    <Badge data-testid={testId} variant={undefined} className={`${s.bg} ${s.fg}`}>
      <Icon size={13} aria-hidden />
      {label}
    </Badge>
  );
}

/** Security & Trust Callout Bar (used on Receivables, Auth, Statement, Payments). */
export function SecurityNotice({
  title, body, compact = false,
}: {
  title?: ReactNode;
  body: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-border bg-muted/60 ${compact ? "px-4 py-3" : "px-4 py-3"}`}>
      {compact ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><LockKey size={17} aria-hidden /></span>
      ) : <SecurityLockBadge size={38} />}
      <div className="min-w-0 flex-1 text-xs leading-relaxed sm:text-sm">
        {title && <p className="font-bold text-text">{title}</p>}
        <p className="text-text-muted">{body}</p>
      </div>
    </div>
  );
}

/** Back link for detail screens; the arrow flips in RTL. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-bold text-link underline-offset-4 hover:underline">
      <ArrowLeft size={17} aria-hidden className="rtl:-scale-x-100" />
      {label}
    </Link>
  );
}

/** Initial avatar used in list rows (debtor/customer identity). */
export function InitialAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const initial = (name.trim()[0] ?? "؟").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] font-bold text-[var(--icon-box-fg)]"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}

/** First-load skeleton (F-17): shown while the first tRPC round-trip is in
 * flight so a list never flashes its empty state before data arrives.
 * EmptyState is only for genuinely-empty-after-load. The label is generic;
 * pass a specific one when the panel has its own wording. */
export function LoadingState({ isAr, label }: { isAr: boolean; label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
      <span className="size-2 animate-pulse rounded-full bg-primary" />
      {label ?? (isAr ? "جارٍ تحميل البيانات…" : "Loading data…")}
    </div>
  );
}

/** Empty state composition: illustration, title, body, optional CTA. */
export function EmptyState({
  illustration, title, body, children, testId,
}: {
  illustration?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong/40 bg-surface px-6 py-12 text-center">
      {illustration}
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="max-w-md text-sm text-text-muted">{body}</p>}
      {children}
    </div>
  );
}
