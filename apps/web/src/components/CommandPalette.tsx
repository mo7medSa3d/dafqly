"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bank,
  Bell,
  CalendarCheck,
  CaretRight,
  ClipboardText,
  CloudArrowUp,
  CreditCard,
  Lightning,
  MagnifyingGlass,
  Plus,
  Receipt,
  Robot,
  Scan,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  UsersThree,
  X,
} from "@/components/ui/solid-icons";
import { WhatsappLogo } from "@/components/ui/icons";
import { trpc } from "@/lib/trpc-client";
import { useCurrency } from "./CurrencyContext";
import { openAiCopilot } from "./copilot-events";

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
  currency: string;
  status: string;
  dueOn: string;
  description: string | null;
}

interface SearchChequeResult {
  id: string;
  debtorId: string;
  number: string;
  bank: string;
  amountMinor: string;
  dueDate: string;
  status: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  locale: string;
}

export function CommandPalette({ isOpen, onClose, locale }: CommandPaletteProps) {
  const t = useTranslations("search");
  const isEn = locale === "en";
  const { format } = useCurrency();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [debtors, setDebtors] = useState<SearchDebtorResult[]>([]);
  const [invoices, setInvoices] = useState<SearchInvoiceResult[]>([]);
  const [cheques, setCheques] = useState<SearchChequeResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const quickActions = useMemo(
    () => [
      {
        id: "cmd-ai-assistant",
        labelAr: "فتح شات الذكاء الاصطناعي (AI Copilot)",
        labelEn: "Open AI Chat & Ledger Assistant",
        keywords: "ai copilot chat assistant شات مساعد ذكي",
        Icon: Robot,
        run: () => {
          onClose();
          openAiCopilot({ tab: "assistant" });
        },
      },
      {
        id: "cmd-ai-briefing",
        labelAr: "فتح الملخص التنفيذي والمساعد الذكي (AI Briefing)",
        labelEn: "Open AI Executive Briefing",
        keywords: "ai briefing executive summary ملخص تنفيذي سيولة",
        Icon: Sparkle,
        run: () => {
          onClose();
          openAiCopilot({ tab: "briefing" });
        },
      },
      {
        id: "cmd-ai-reminder",
        labelAr: "صياغة تذكير سداد ذكي (WhatsApp / AI)",
        labelEn: "Draft Smart Payment Reminder",
        keywords: "ai reminder whatsapp message تذكير واتساب رسالة",
        Icon: WhatsappLogo,
        run: () => {
          onClose();
          openAiCopilot({ tab: "composer", mode: "reminder" });
        },
      },
      {
        id: "cmd-ai-installment",
        labelAr: "جدولة مديونية متأخرة على أقساط (AI Installment Planner)",
        labelEn: "Build Smart Installment Settlement Plan",
        keywords: "ai installment plan settlement تقسيط جدولة",
        Icon: CalendarCheck,
        run: () => {
          onClose();
          openAiCopilot({ tab: "composer", mode: "installment" });
        },
      },
      {
        id: "cmd-dashboard",
        labelAr: "لوحة التحكم والنظرة العامة",
        labelEn: "Go to Overview & Dashboard",
        keywords: "dashboard overview home لوحة التحكم الرئيسية",
        Icon: SquaresFour,
        run: () => {
          router.push(`/${locale}/dashboard`);
          onClose();
        },
      },
      {
        id: "cmd-debtors",
        labelAr: "العملاء والمدينون",
        labelEn: "Go to Customers & Debtors",
        keywords: "customers debtors clients عملاء مدينون",
        Icon: UsersThree,
        run: () => {
          router.push(`/${locale}/debtors`);
          onClose();
        },
      },
      {
        id: "cmd-new-invoice",
        labelAr: "الفواتير وإصدار فاتورة جديدة",
        labelEn: "Invoices & Issue New Invoice",
        keywords: "invoices new issue فاتورة فواتير",
        Icon: Plus,
        run: () => {
          router.push(`/${locale}/invoices`);
          onClose();
        },
      },
      {
        id: "cmd-cheques",
        labelAr: "حافظة الشيكات",
        labelEn: "Go to Cheques Portfolio",
        keywords: "cheques checks bank شيكات بنك",
        Icon: Bank,
        run: () => {
          router.push(`/${locale}/cheques`);
          onClose();
        },
      },
      {
        id: "cmd-tasks",
        labelAr: "المهام والتذاكر",
        labelEn: "Go to Tasks & Tickets",
        keywords: "tasks tickets promises مهام تذاكر متابعة",
        Icon: ClipboardText,
        run: () => {
          router.push(`/${locale}/tasks`);
          onClose();
        },
      },
      {
        id: "cmd-tasks-reminders",
        labelAr: "التذكيرات والمواعيد المجدولة",
        labelEn: "Go to Scheduled Reminders",
        keywords: "reminders schedule followup tasks تذكيرات متابعة جدولة",
        Icon: Bell,
        run: () => {
          router.push(`/${locale}/tasks?tab=reminders`);
          onClose();
        },
      },
      {
        id: "cmd-tasks-approvals",
        labelAr: "موافقات الذكاء الاصطناعي",
        labelEn: "Go to AI Approvals",
        keywords: "ai approvals review tasks موافقات ذكاء اعتماد",
        Icon: ShieldCheck,
        run: () => {
          router.push(`/${locale}/tasks?tab=approvals`);
          onClose();
        },
      },
      {
        id: "cmd-inbox",
        labelAr: "صندوق الوارد الذكي ومراجعة الإيصالات",
        labelEn: "AI Inbox & Receipt Verification",
        keywords: "ai inbox receipts صندوق الوارد إيصالات",
        Icon: Lightning,
        run: () => {
          router.push(`/${locale}/ai-inbox`);
          onClose();
        },
      },
      {
        id: "cmd-import",
        labelAr: "استيراد فواتير من Excel أو CSV",
        labelEn: "Import Invoices from Excel / CSV",
        keywords: "import excel csv استيراد إكسل",
        Icon: CloudArrowUp,
        run: () => {
          router.push(`/${locale}/import`);
          onClose();
        },
      },
      {
        id: "cmd-scan",
        labelAr: "المسح الضوئي الذكي لدفاتر الحسابات",
        labelEn: "Smart AI Ledger Photo Scan",
        keywords: "scan ocr ledger photo مسح ضوئي دفتر",
        Icon: Scan,
        run: () => {
          router.push(`/${locale}/ledger-photo`);
          onClose();
        },
      },
      {
        id: "cmd-billing",
        labelAr: "الاشتراك والفوترة",
        labelEn: "Go to Billing & Plan",
        keywords: "billing subscription plan اشتراك باقة فوترة",
        Icon: CreditCard,
        run: () => {
          router.push(`/${locale}/billing`);
          onClose();
        },
      },
      {
        id: "cmd-settings",
        labelAr: "إعدادات المنشأة والعملة والنسخ الاحتياطي",
        labelEn: "Workspace Settings & Preferences",
        keywords: "settings currency backup إعدادات عملة نسخ",
        Icon: SlidersHorizontal,
        run: () => {
          router.push(`/${locale}/settings`);
          onClose();
        },
      },
    ],
    [locale, onClose, router],
  );

  // Filter commands instantly by the live query
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickActions;
    return quickActions.filter(
      (cmd) =>
        cmd.labelEn.toLowerCase().includes(q) ||
        cmd.labelAr.includes(q) ||
        cmd.keywords.toLowerCase().includes(q),
    );
  }, [query, quickActions]);

  // Debounce search input by 200ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Focus input and reset state on open; restore focus on close
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setDebouncedQuery("");
      setSelectedIndex(0);
      setDebtors([]);
      setInvoices([]);
      setCheques([]);
      setHasError(false);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // Fetch search results via tRPC vanilla client
  useEffect(() => {
    if (!isOpen || !debouncedQuery.trim()) {
      setDebtors([]);
      setInvoices([]);
      setCheques([]);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    setHasError(false);

    void trpc.search.global
      .query({ q: debouncedQuery.trim() })
      .then((res) => {
        if (!active) return;
        setDebtors(res.debtors);
        setInvoices(res.invoices);
        setCheques(res.cheques ?? []);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setDebtors([]);
        setInvoices([]);
        setCheques([]);
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, debouncedQuery]);

  const hasQuery = Boolean(debouncedQuery.trim());
  const totalItems =
    filteredCommands.length + (hasQuery ? debtors.length + invoices.length + cheques.length : 0);

  // Clamp selectedIndex if result count shrinks
  useEffect(() => {
    if (totalItems === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= totalItems) {
      setSelectedIndex(totalItems - 1);
    }
  }, [totalItems, selectedIndex]);

  // Keep keyboard-selected item visible inside the scrollable container
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [isOpen, selectedIndex]);

  const navigateToItem = useCallback(
    (index: number) => {
      if (index < filteredCommands.length) {
        filteredCommands[index]?.run();
        return;
      }
      if (!hasQuery) return;
      const offset = index - filteredCommands.length;
      if (offset < debtors.length) {
        const d = debtors[offset];
        if (d) {
          router.push(`/${locale}/debtors/${d.id}`);
          onClose();
        }
      } else if (offset < debtors.length + invoices.length) {
        const inv = invoices[offset - debtors.length];
        if (inv) {
          router.push(`/${locale}/debtors/${inv.debtorId}`);
          onClose();
        }
      } else {
        const chq = cheques[offset - debtors.length - invoices.length];
        if (chq) {
          router.push(`/${locale}/cheques`);
          onClose();
        }
      }
    },
    [filteredCommands, hasQuery, debtors, invoices, cheques, locale, onClose, router],
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
        className="fixed inset-0 bg-foreground/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette Modal */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface transition-all">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border/80 px-4 py-3 transition-colors focus-within:border-primary/60 sm:px-5">
          <MagnifyingGlass size={20} strokeWidth={2.5} className="shrink-0 text-primary" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls="command-palette-list"
            aria-activedescendant={totalItems > 0 ? `cmd-item-${selectedIndex}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("placeholder")}
            className={cn(inputVariants, "w-full border-0 bg-transparent shadow-none focus-visible:outline-none focus-visible:ring-0 sm:text-base")}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className={cn(buttonVariants({ variant: "ghost", size: "iconSm" }), "size-6 text-text-subtle hover:bg-callout hover:text-text")}
              aria-label={t("close")}
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          ) : (
            <kbd className="hidden rounded border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-text-subtle sm:inline-block">
              ESC
            </kbd>
          )}
        </div>

        {/* Results Body */}
        <div id="command-palette-list" role="listbox" ref={listRef} className="max-h-[380px] overflow-y-auto p-2">
          {/* Quick Actions & AI Commands */}
          {filteredCommands.length > 0 && (
            <div className={hasQuery && (debtors.length > 0 || invoices.length > 0 || cheques.length > 0) ? "mb-2" : ""}>
              <div className="flex items-center justify-between px-3 py-1.5 text-xs font-bold text-text-subtle">
                <span className="flex items-center gap-1.5">
                  <Sparkle size={14} className="text-primary" />
                  <span>{isEn ? "Quick Commands & AI Actions" : "الأوامر السريعة ومهام الذكاء الاصطناعي"}</span>
                </span>
                {!hasQuery && <span className="text-[11px] font-medium text-text-muted">{t("quickHint")}</span>}
              </div>
              <ul className="flex flex-col gap-1">
                {filteredCommands.map((cmd, idx) => {
                  const isSelected = selectedIndex === idx;
                  const CmdIcon = cmd.Icon;
                  return (
                    <li
                      key={cmd.id}
                      id={`cmd-item-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      data-cmd-index={idx}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => cmd.run()}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-xs transition-colors sm:text-sm ${
                        isSelected ? "bg-primary text-primary-foreground ring-1 ring-primary/30" : "text-text hover:bg-callout"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                            isSelected ? "bg-primary-foreground/15 text-primary-foreground" : "bg-callout text-primary"
                          }`}
                        >
                          <CmdIcon size={15} aria-hidden />
                        </span>
                        <span className="truncate font-semibold">{isEn ? cmd.labelEn : cmd.labelAr}</span>
                      </div>
                      <CaretRight
                        size={15}
                        className={`shrink-0 rtl:rotate-180 ${isSelected ? "text-primary-foreground" : "text-text-subtle"}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {isLoading && (
            <div role="status" aria-live="polite" className="py-6 text-center text-xs text-text-muted">
              <span className="inline-block animate-pulse motion-reduce:animate-none">...</span>
            </div>
          )}

          {!isLoading && hasError && hasQuery && (
            <div className="py-6 text-center text-xs font-medium text-destructive">
              {isEn ? "Search failed. Please try again." : "تعذر البحث الآن. حاول مرة أخرى."}
            </div>
          )}

          {!isLoading && !hasError && hasQuery && totalItems === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-text-muted">{t("noResults", { query: debouncedQuery })}</p>
              <p className="mt-1.5 text-xs text-text-subtle">
                {isEn
                  ? "Try searching by customer name, phone number, invoice reference, or cheque number."
                  : "جرّب البحث باسم العميل أو رقم الهاتف أو مرجع الفاتورة أو رقم الشيك."}
              </p>
            </div>
          )}

          {/* Debtors Group */}
          {hasQuery && debtors.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-text-subtle">
                <UsersThree size={14} />
                <span>{t("customers")}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {debtors.map((d: SearchDebtorResult, idx: number) => {
                  const globalIdx = filteredCommands.length + idx;
                  const isSelected = selectedIndex === globalIdx;
                  return (
                    <li
                      key={d.id}
                      id={`cmd-item-${globalIdx}`}
                      role="option"
                      aria-selected={isSelected}
                      data-cmd-index={globalIdx}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      onClick={() => {
                        router.push(`/${locale}/debtors/${d.id}`);
                        onClose();
                      }}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        isSelected ? "bg-primary text-primary-foreground ring-1 ring-primary/30" : "text-text hover:bg-callout"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded text-xs font-bold ${
                            isSelected ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary/10 text-primary"
                          }`}
                        >
                          {d.displayName.slice(0, 1)}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-bold">{d.displayName}</span>
                          <span className={`text-xs ${isSelected ? "text-primary-foreground/80" : "text-text-muted"}`} dir="ltr">
                            {d.phoneE164}
                          </span>
                        </div>
                      </div>
                      <CaretRight size={16} className={`shrink-0 rtl:rotate-180 ${isSelected ? "text-primary-foreground" : "text-text-subtle"}`} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Invoices Group */}
          {hasQuery && invoices.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-text-subtle">
                <Receipt size={14} />
                <span>{t("invoices")}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {invoices.map((inv: SearchInvoiceResult, idx: number) => {
                  const globalIdx = filteredCommands.length + debtors.length + idx;
                  const isSelected = selectedIndex === globalIdx;
                  return (
                    <li
                      key={inv.id}
                      id={`cmd-item-${globalIdx}`}
                      role="option"
                      aria-selected={isSelected}
                      data-cmd-index={globalIdx}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      onClick={() => {
                        router.push(`/${locale}/debtors/${inv.debtorId}`);
                        onClose();
                      }}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        isSelected ? "bg-primary text-primary-foreground ring-1 ring-primary/30" : "text-text hover:bg-callout"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded text-xs font-bold ${
                            isSelected ? "bg-primary-foreground/15 text-primary-foreground" : "bg-accent/20 text-accent-fg"
                          }`}
                        >
                          #
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-bold" dir="ltr">
                            {inv.reference ?? inv.id.slice(0, 8)}
                          </span>
                          {inv.description && (
                            <span className={`max-w-xs truncate text-xs ${isSelected ? "text-primary-foreground/80" : "text-text-muted"}`}>
                              {inv.description}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`text-xs font-bold ${isSelected ? "text-primary-foreground" : "text-primary"}`} dir="ltr">
                          {format(BigInt(inv.amountMinor), { currency: inv.currency })}
                        </span>
                        <CaretRight size={16} className={`shrink-0 rtl:rotate-180 ${isSelected ? "text-primary-foreground" : "text-text-subtle"}`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Cheques Group */}
          {hasQuery && cheques.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-text-subtle">
                <Bank size={14} />
                <span>{isEn ? "Cheques" : "الشيكات"}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {cheques.map((chq: SearchChequeResult, idx: number) => {
                  const globalIdx = filteredCommands.length + debtors.length + invoices.length + idx;
                  const isSelected = selectedIndex === globalIdx;
                  return (
                    <li
                      key={chq.id}
                      id={`cmd-item-${globalIdx}`}
                      role="option"
                      aria-selected={isSelected}
                      data-cmd-index={globalIdx}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      onClick={() => {
                        router.push(`/${locale}/cheques`);
                        onClose();
                      }}
                      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        isSelected ? "bg-primary text-primary-foreground ring-1 ring-primary/30" : "text-text hover:bg-callout"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded text-xs font-bold ${
                            isSelected ? "bg-primary-foreground/15 text-primary-foreground" : "bg-callout text-primary"
                          }`}
                        >
                          <Bank size={14} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-bold" dir="ltr">
                            #{chq.number}
                          </span>
                          <span className={`max-w-xs truncate text-xs ${isSelected ? "text-primary-foreground/80" : "text-text-muted"}`}>
                            {chq.bank} · {chq.dueDate}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`text-xs font-bold ${isSelected ? "text-primary-foreground" : "text-primary"}`} dir="ltr">
                          {format(BigInt(chq.amountMinor))}
                        </span>
                        <CaretRight size={16} className={`shrink-0 rtl:rotate-180 ${isSelected ? "text-primary-foreground" : "text-text-subtle"}`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-surface-muted/60 px-4 py-2 text-[11px] text-text-subtle">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5">↑</kbd>
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5">↓</kbd>
              <span>{t("navigate")}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5">↵</kbd>
              <span>{t("select")}</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5">ESC</kbd>
            <span>{t("close")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
