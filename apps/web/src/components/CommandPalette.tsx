"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CaretRight,
  MagnifyingGlass,
  Receipt,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { formatEgp } from "@tahseel/core";

interface SearchDebtorResult {
  id: string;
  displayName: string;
  phoneE164: string;
}

interface SearchInvoiceResult {
  id: string;
  debtorId: string;
  reference: string | null;
  amountMinor: string;
  status: string;
  dueOn: string;
  description: string | null;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  locale: string;
}

export function CommandPalette({ isOpen, onClose, locale }: CommandPaletteProps) {
  const t = useTranslations("search");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [debtors, setDebtors] = useState<SearchDebtorResult[]>([]);
  const [invoices, setInvoices] = useState<SearchInvoiceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Debounce search input by 200ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setDebouncedQuery("");
      setSelectedIndex(0);
      setDebtors([]);
      setInvoices([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Fetch search results via tRPC vanilla client
  useEffect(() => {
    if (!isOpen || !debouncedQuery.trim()) {
      setDebtors([]);
      setInvoices([]);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    void trpc.search.global
      .query({ q: debouncedQuery.trim() })
      .then((res) => {
        if (!active) return;
        setDebtors(res.debtors);
        setInvoices(res.invoices);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setDebtors([]);
        setInvoices([]);
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, debouncedQuery]);

  const totalItems = debtors.length + invoices.length;

  const navigateToItem = useCallback(
    (index: number) => {
      if (index < debtors.length) {
        const d = debtors[index];
        if (d) {
          router.push(`/${locale}/debtors/${d.id}`);
          onClose();
        }
      } else {
        const invIndex = index - debtors.length;
        const inv = invoices[invIndex];
        if (inv) {
          router.push(`/${locale}/invoices`);
          onClose();
        }
      }
    },
    [debtors, invoices, locale, onClose, router],
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (totalItems > 0 ? (prev + 1) % totalItems : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (totalItems > 0 ? (prev - 1 + totalItems) % totalItems : 0));
      } else if (e.key === "Enter" && totalItems > 0) {
        e.preventDefault();
        navigateToItem(selectedIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, totalItems, selectedIndex, navigateToItem, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-24"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-navy-950/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette Modal */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl transition-all">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border/80 px-4 py-3 sm:px-5">
          <MagnifyingGlass size={20} weight="bold" className="text-primary shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("placeholder")}
            className="w-full bg-transparent text-sm sm:text-base font-medium text-text placeholder:text-text-subtle focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="rounded-full p-1 text-text-subtle hover:bg-callout hover:text-text"
              aria-label={t("close")}
            >
              <X size={16} weight="bold" />
            </button>
          ) : (
            <kbd className="hidden rounded border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-text-subtle sm:inline-block">
              ESC
            </kbd>
          )}
        </div>

        {/* Results Body */}
        <div className="max-h-[380px] overflow-y-auto p-2">
          {isLoading && (
            <div className="py-8 text-center text-xs text-text-muted">
              <span className="inline-block animate-pulse">...</span>
            </div>
          )}

          {!isLoading && debouncedQuery && totalItems === 0 && (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-text-muted">{t("noResults", { query: debouncedQuery })}</p>
            </div>
          )}

          {!debouncedQuery && (
            <div className="py-8 text-center text-xs text-text-muted">
              <p>{t("quickHint")}</p>
            </div>
          )}

          {/* Debtors Group */}
          {debtors.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-text-subtle">
                <UsersThree size={14} weight="fill" />
                <span>{t("customers")}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {debtors.map((d: SearchDebtorResult, idx: number) => {
                  const isSelected = selectedIndex === idx;
                  return (
                    <li
                      key={d.id}
                      onClick={() => {
                        router.push(`/${locale}/debtors/${d.id}`);
                        onClose();
                      }}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        isSelected ? "bg-primary text-white" : "hover:bg-callout text-text"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                          isSelected ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                        }`}>
                          {d.displayName.slice(0, 1)}
                        </span>
                        <div className="flex flex-col">
                          <span className="font-bold">{d.displayName}</span>
                          <span className={`text-xs ${isSelected ? "text-white/80" : "text-text-muted"}`} dir="ltr">
                            {d.phoneE164}
                          </span>
                        </div>
                      </div>
                      <CaretRight size={16} className={`shrink-0 ${isSelected ? "text-white" : "text-text-subtle"}`} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Invoices Group */}
          {invoices.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-text-subtle">
                <Receipt size={14} weight="fill" />
                <span>{t("invoices")}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {invoices.map((inv: SearchInvoiceResult, idx: number) => {
                  const globalIdx = debtors.length + idx;
                  const isSelected = selectedIndex === globalIdx;
                  return (
                    <li
                      key={inv.id}
                      onClick={() => {
                        router.push(`/${locale}/invoices`);
                        onClose();
                      }}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        isSelected ? "bg-primary text-white" : "hover:bg-callout text-text"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                          isSelected ? "bg-white/20 text-white" : "bg-accent/20 text-accent-fg"
                        }`}>
                          #
                        </span>
                        <div className="flex flex-col">
                          <span className="font-bold" dir="ltr">{inv.reference ?? inv.id.slice(0, 8)}</span>
                          {inv.description && (
                            <span className={`truncate text-xs max-w-xs ${isSelected ? "text-white/80" : "text-text-muted"}`}>
                              {inv.description}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${isSelected ? "text-white" : "text-primary"}`} dir="ltr">
                          {formatEgp(BigInt(inv.amountMinor))}
                        </span>
                        <CaretRight size={16} className={`shrink-0 ${isSelected ? "text-white" : "text-text-subtle"}`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="flex items-center justify-between border-t border-border/60 bg-surface-muted/60 px-4 py-2 text-[11px] text-text-subtle">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-surface px-1.5 py-0.5 border border-border">↑</kbd>
              <kbd className="rounded bg-surface px-1.5 py-0.5 border border-border">↓</kbd>
              <span>{t("navigate")}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-surface px-1.5 py-0.5 border border-border">↵</kbd>
              <span>{t("select")}</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface px-1.5 py-0.5 border border-border">ESC</kbd>
            <span>{t("close")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
