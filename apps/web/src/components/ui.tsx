"use client";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle, Clock, Coins, Prohibit, WarningCircle, XCircle,
  type IconProps,
} from "@phosphor-icons/react";

/**
 * Shared design-system primitives for the v0.9.0 premium redesign.
 * One filled icon set (Phosphor, weight="fill"), token colors only,
 * consistent spacing/radius so every screen composes the same way.
 */

export const inputCls =
  "w-full min-h-touch rounded-md border border-border bg-surface px-3 text-text placeholder:text-text-subtle focus:border-focus";
export const labelCls = "flex flex-col gap-1.5 text-sm font-semibold";
export const labelTextCls = "text-text-muted";

export const btnPrimary =
  "inline-flex min-h-touch items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-60";
export const btnAccent =
  "inline-flex min-h-touch items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 font-bold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60";
export const btnGhost =
  "inline-flex min-h-touch items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 font-bold text-text transition-colors hover:border-border-strong disabled:opacity-60";
export const btnDanger =
  "inline-flex min-h-touch items-center justify-center gap-2 rounded-md bg-danger px-4 py-2 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60";
export const btnSmall =
  "inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1 text-sm font-bold text-text transition-colors hover:border-border-strong disabled:opacity-60";
export const linkAction = "inline-flex items-center gap-1 font-bold text-link underline-offset-4 hover:underline";

type IconType = ComponentType<IconProps>;

/** Panel: the standard content surface — border, radius-xl, soft elevation. */
export function Panel({
  title, icon: Icon, actions, children, className = "", padded = true, testId,
}: {
  title?: ReactNode;
  icon?: IconType;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={`rounded-xl border border-border bg-surface panel-shadow ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
          {title && (
            <h2 className="flex items-center gap-2.5 text-base font-bold">
              {Icon && (
                <span className="flex size-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-surface-muted dark:text-teal-300">
                  <Icon size={19} weight="fill" aria-hidden />
                </span>
              )}
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className={padded ? "p-5 sm:p-6" : ""}>{children}</div>
    </section>
  );
}

/** Page header pattern used by every authenticated screen. */
export function PageHeader({
  title, subtitle, actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold leading-snug sm:text-[28px]">{title}</h1>
        {subtitle && <p className="text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, { fg: string; bg: string; Icon: IconType }> = {
  paid: { fg: "text-status-paid-fg", bg: "bg-status-paid-bg", Icon: CheckCircle },
  partially_paid: { fg: "text-status-partial-fg", bg: "bg-status-partial-bg", Icon: Coins },
  open: { fg: "text-status-due-fg", bg: "bg-status-due-bg", Icon: Clock },
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

/** Status pill: filled icon + label on the semantic status tokens. */
export function StatusPill({ status, label, testId }: { status: string; label: string; testId?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open!;
  const { Icon } = s;
  return (
    <span data-testid={testId} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${s.bg} ${s.fg}`}>
      <Icon size={13} weight="fill" aria-hidden />
      {label}
    </span>
  );
}

/** Back link for detail screens; the arrow flips in RTL. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 font-bold text-link underline-offset-4 hover:underline">
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
      className="flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-bold text-navy-700 dark:bg-surface-muted dark:text-teal-200"
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
    <div data-testid={testId} className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      {illustration}
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="max-w-md text-text-muted">{body}</p>}
      {children}
    </div>
  );
}
