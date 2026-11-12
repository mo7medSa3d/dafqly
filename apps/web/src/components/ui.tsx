"use client";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle, Clock, Coins, LockKey, Prohibit, ShieldCheck, WarningCircle, XCircle,
  type IconProps,
} from "@phosphor-icons/react";
import { SecurityLockBadge } from "./illustrations";

/**
 * Shared design-system primitives implementing Yaseir Design Guide v2.1
 * (https://ui.yaseir.site/):
 * - Pill/Capsule Buttons (border-radius: 9999px, height: 44px, px: 24px)
 * - Form Inputs (border-radius: 10px, border: --border-strong #7A8190)
 * - Cards & Panels (border-radius: 16px, multi-layer soft shadow)
 * - Status Badges (capsule pills with semantic status icons)
 * - Security Badges & Security Notice bars
 */

export const inputCls =
  "w-full min-h-[44px] rounded-[10px] border border-border-strong/60 bg-surface px-3.5 text-[14px] text-text placeholder:text-text-subtle transition-colors focus:border-primary focus:outline-none";
export const labelCls = "flex flex-col gap-1.5 text-[14px] font-medium";
export const labelTextCls = "text-text-muted";

export const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 text-[14px] font-medium text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50";
export const btnInverse =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy-700 px-6 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
export const btnAccent =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-accent px-6 py-2.5 text-[14px] font-bold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50";
export const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-border-strong/70 bg-surface px-6 py-2.5 text-[14px] font-medium text-text transition-colors hover:border-primary hover:bg-callout disabled:opacity-50";
export const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-danger px-6 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
export const btnSmall =
  "inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-full border border-border-strong/60 bg-surface px-4 py-1 text-xs font-medium text-text transition-colors hover:border-primary hover:bg-callout disabled:opacity-50";
export const linkAction = "inline-flex items-center gap-1 text-[14px] font-medium text-link underline-offset-4 hover:underline";

type IconType = ComponentType<IconProps>;

/** Panel: Yaseir standard card surface — 16px radius, soft elevation. */
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
    <section data-testid={testId} className={`rounded-2xl border border-border bg-surface panel-shadow ${className}`}>
      {(title || actions || badge) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h2 className="flex items-center gap-2.5 text-[18px] font-bold text-text">
                {Icon && (
                  <span className="flex size-9 items-center justify-center rounded-xl border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] text-[var(--icon-box-fg)]">
                    <Icon size={20} weight="fill" aria-hidden />
                  </span>
                )}
                {title}
                {badge}
              </h2>
            )}
            {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-5 sm:p-6" : ""}>{children}</div>
    </section>
  );
}

/** Page header pattern matching Yaseir 32px–40px display titles (weight 500/700). */
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
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-callout px-3 py-1 text-xs font-bold text-primary">
            {eyebrow}
          </span>
        )}
        <h1 className="text-[32px] font-bold leading-tight sm:text-[36px]">{title}</h1>
        {subtitle && <p className="text-base text-text-muted">{subtitle}</p>}
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

/** Status pill: Yaseir capsule badge with semantic status tokens. */
export function StatusPill({ status, label, testId }: { status: string; label: string; testId?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open!;
  const { Icon } = s;
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${s.bg} ${s.fg}`}>
      <Icon size={13} weight="fill" aria-hidden />
      {label}
    </span>
  );
}

/** Security badge pill used in headers, statements, and auth screens. */
export function SecurityBadge({ label }: { label: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-callout px-3 py-1 text-xs font-bold text-primary">
      <ShieldCheck size={15} weight="fill" aria-hidden />
      {label}
    </span>
  );
}

/** Yaseir Security & Trust Callout Bar (used on Receivables, Auth, Statement, Payments). */
export function SecurityNotice({
  title, body, compact = false,
}: {
  title?: ReactNode;
  body: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3.5 rounded-2xl border border-primary/20 bg-callout ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
      {compact ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKey size={17} weight="fill" aria-hidden />
        </span>
      ) : (
        <SecurityLockBadge size={38} />
      )}
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
      <ArrowLeft size={17} weight="fill" aria-hidden className="rtl:-scale-x-100" />
      {label}
    </Link>
  );
}

/** Circular initial avatar used in list rows (debtor/customer identity). */
export function InitialAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const initial = (name.trim()[0] ?? "؟").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] font-bold text-[var(--icon-box-fg)]"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
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
    <div data-testid={testId} className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-surface px-6 py-10 text-center shadow-xs">
      {illustration}
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="max-w-md text-sm text-text-muted">{body}</p>}
      {children}
    </div>
  );
}
