"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Buildings, CheckCircle, Clock, CurrencyDollar, FloppyDisk, GearSix, ShieldCheck, WarningCircle } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";
import { signOut } from "@/lib/auth-client";
import { ExportButtons } from "./ExportButtons";
import { DangerZone } from "./DangerZone";
import { AuditTrail } from "./AuditTrail";
import { Panel, btnPrimary, inputCls, labelCls } from "./ui";
import { SecurityLockBadge } from "./illustrations";

interface SettingsData {
  businessNameAr: string;
  timezone: string;
  settings: {
    quietStart: string;
    quietEnd: string;
    fridayMorningSkip: boolean;
    autoCloseEnabled: boolean;
    tone: "polite" | "firm";
    defaultTermsDays: number;
    businessNameEn?: string;
    taxId?: string;
    currency?: "EGP" | "SAR" | "USD" | "AED" | "EUR" | "KWD" | "JPY";
    easternDigits?: boolean;
    exportLanguage?: "ar" | "en";
    statementLinksEnabled?: boolean;
    paymentInstructions?: string;
    whatsapp?: {
      phoneNumberId?: string;
      wabaId?: string;
      connected?: boolean;
    };
  };
  integrations: {
    aiConfigured: boolean;
    llmModelFast: string;
    llmModelVision: string;
    whatsappConfigured: boolean;
    whatsappConnected?: boolean;
    dryRunMessaging: boolean;
    webhooks: { whatsapp: string };
  };
}

const CURRENCIES = [
  { code: "EGP", nameAr: "جنيه مصري (EGP)", nameEn: "Egyptian Pound (EGP)", symbol: "ج.م." },
  { code: "SAR", nameAr: "ريال سعودي (SAR)", nameEn: "Saudi Riyal (SAR)", symbol: "ر.س." },
  { code: "USD", nameAr: "دولار أمريكي (USD)", nameEn: "US Dollar (USD)", symbol: "$" },
  { code: "AED", nameAr: "درهم إماراتي (AED)", nameEn: "UAE Dirham (AED)", symbol: "د.إ." },
  { code: "EUR", nameAr: "يورو (EUR)", nameEn: "Euro (EUR)", symbol: "€" },
  { code: "KWD", nameAr: "دينار كويتي (KWD)", nameEn: "Kuwaiti Dinar (KWD)", symbol: "د.ك." },
  { code: "JPY", nameAr: "ين ياباني (JPY)", nameEn: "Japanese Yen (JPY)", symbol: "¥" },
] as const;

const TIMEZONES = [
  { id: "Africa/Cairo", labelAr: "القاهرة — Africa/Cairo", labelEn: "Cairo — Africa/Cairo" },
  { id: "Africa/Casablanca", labelAr: "الدار البيضاء — Africa/Casablanca", labelEn: "Casablanca — Africa/Casablanca" },
  { id: "Africa/Johannesburg", labelAr: "جوهانسبرغ — Africa/Johannesburg", labelEn: "Johannesburg — Africa/Johannesburg" },
  { id: "Europe/London", labelAr: "لندن — Europe/London", labelEn: "London — Europe/London" },
  { id: "Europe/Paris", labelAr: "باريس — Europe/Paris", labelEn: "Paris — Europe/Paris" },
  { id: "Europe/Berlin", labelAr: "برلين — Europe/Berlin", labelEn: "Berlin — Europe/Berlin" },
  { id: "Europe/Istanbul", labelAr: "إسطنبول — Europe/Istanbul", labelEn: "Istanbul — Europe/Istanbul" },
  { id: "Asia/Riyadh", labelAr: "الرياض — Asia/Riyadh", labelEn: "Riyadh — Asia/Riyadh" },
  { id: "Asia/Dubai", labelAr: "دبي — Asia/Dubai", labelEn: "Dubai — Asia/Dubai" },
  { id: "Asia/Kuwait", labelAr: "الكويت — Asia/Kuwait", labelEn: "Kuwait — Asia/Kuwait" },
  { id: "Asia/Amman", labelAr: "عمّان — Asia/Amman", labelEn: "Amman — Asia/Amman" },
  { id: "Asia/Beirut", labelAr: "بيروت — Asia/Beirut", labelEn: "Beirut — Asia/Beirut" },
  { id: "Asia/Karachi", labelAr: "كراتشي — Asia/Karachi", labelEn: "Karachi — Asia/Karachi" },
  { id: "Asia/Kolkata", labelAr: "كولكاتا — Asia/Kolkata", labelEn: "Kolkata — Asia/Kolkata" },
  { id: "Asia/Singapore", labelAr: "سنغافورة — Asia/Singapore", labelEn: "Singapore — Asia/Singapore" },
  { id: "Asia/Tokyo", labelAr: "طوكيو — Asia/Tokyo", labelEn: "Tokyo — Asia/Tokyo" },
  { id: "Australia/Sydney", labelAr: "سيدني — Australia/Sydney", labelEn: "Sydney — Australia/Sydney" },
  { id: "America/New_York", labelAr: "نيويورك — America/New_York", labelEn: "New York — America/New_York" },
  { id: "America/Chicago", labelAr: "شيكاغو — America/Chicago", labelEn: "Chicago — America/Chicago" },
  { id: "America/Los_Angeles", labelAr: "لوس أنجلوس — America/Los_Angeles", labelEn: "Los Angeles — America/Los_Angeles" },
  { id: "UTC", labelAr: "التوقيت العالمي — UTC", labelEn: "Coordinated Universal Time — UTC" },
] as const;

export function SettingsClient({ locale }: { locale: string }) {
  const router = useRouter();
  const isAr = locale === "ar";
  const [data, setData] = useState<SettingsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  /** H5: sign out everywhere — revokes every session, including this one. */
  async function onRevokeAllSessions() {
    if (!window.confirm(isAr
      ? "سيتم تسجيل خروجك من كل الأجهزة والجلسات، بما فيها هذه الجلسة. متابعة؟"
      : "This signs you out on every device and session, including this one. Continue?")) return;
    setRevoking(true);
    try {
      await trpc.auth.revokeAllSessions.mutate();
      try { await signOut(); } catch { /* revocation already happened */ }
      window.location.assign(`/${locale}/login`);
    } catch {
      setError(isAr ? "تعذّر إنهاء الجلسات. حاول مرة أخرى." : "Could not end the sessions. Try again.");
      setRevoking(false);
    }
  }

  // Form states
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [taxId, setTaxId] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState<"EGP" | "SAR" | "USD" | "AED" | "EUR" | "KWD" | "JPY">("USD");
  const [defaultTermsDays, setDefaultTermsDays] = useState(14);
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("09:00");
  const [fridayMorningSkip, setFridayMorningSkip] = useState(true);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(false);
  const [statementLinksEnabled, setStatementLinksEnabled] = useState(true);
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [exportLanguage, setExportLanguage] = useState<"ar" | "en">(isAr ? "ar" : "en");
  const [easternDigits, setEasternDigits] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = (await trpc.tenant.integrations.query()) as unknown as SettingsData;
      setData(res);
      setBusinessNameAr(res.businessNameAr);
      setTimezone(res.timezone);
      setBusinessNameEn(res.settings.businessNameEn ?? "");
      setTaxId(res.settings.taxId ?? "");
      setCurrency(res.settings.currency ?? "USD");
      setDefaultTermsDays(res.settings.defaultTermsDays ?? 14);
      setTone(res.settings.tone ?? "polite");
      setQuietStart(res.settings.quietStart ?? "21:00");
      setQuietEnd(res.settings.quietEnd ?? "09:00");
      setFridayMorningSkip(res.settings.fridayMorningSkip ?? true);
      setAutoCloseEnabled(res.settings.autoCloseEnabled ?? false);
      setStatementLinksEnabled(res.settings.statementLinksEnabled ?? true);
      setPaymentInstructions(res.settings.paymentInstructions ?? "");
      setWaPhoneNumberId(res.settings.whatsapp?.phoneNumberId ?? "");
      setWaWabaId(res.settings.whatsapp?.wabaId ?? "");
      setWaAccessToken("");
      setExportLanguage(res.settings.exportLanguage ?? (isAr ? "ar" : "en"));
      setEasternDigits(res.settings.easternDigits ?? false);
    } catch {
      setError(isAr ? "تعذّر تحميل إعدادات الحساب." : "Failed to load account settings.");
    }
  }, [isAr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!businessNameAr.trim()) {
      setError(isAr ? "اسم المنشأة بالعربية مطلوب." : "Business name (Arabic) is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const whatsappPatch =
        waPhoneNumberId.trim() || waWabaId.trim() || waAccessToken.trim()
          ? {
              phoneNumberId: waPhoneNumberId.trim() || undefined,
              wabaId: waWabaId.trim() || undefined,
              ...(waAccessToken.trim() ? { accessToken: waAccessToken.trim() } : {}),
            }
          : undefined;
      await trpc.tenant.updateSettings.mutate({
        businessNameAr: businessNameAr.trim(),
        businessNameEn: businessNameEn.trim(),
        taxId: taxId.trim(),
        timezone,
        currency,
        easternDigits,
        defaultTermsDays,
        tone,
        quietStart,
        quietEnd,
        fridayMorningSkip,
        autoCloseEnabled,
        statementLinksEnabled,
        exportLanguage,
        paymentInstructions: paymentInstructions.trim(),
        ...(whatsappPatch ? { whatsapp: whatsappPatch } : {}),
      } as Parameters<typeof trpc.tenant.updateSettings.mutate>[0]);
      setSaved(true);
      await load();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (isAr ? "تعذّر حفظ التعديلات" : "Failed to save settings"));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    if (error) {
      return (
        <div role="alert" className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-xl border border-danger/30 bg-danger-bg p-6 text-center">
          <p className="text-sm font-bold text-danger">{error}</p>
          <button type="button" onClick={() => { setError(null); void load(); }} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {isAr ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      );
    }
    return (
      <div className="flex min-h-[350px] items-center justify-center">
        <span className="text-sm font-semibold text-text-muted">{isAr ? "جارٍ تحميل الإعدادات..." : "Loading settings..."}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Settings Header Band */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <GearSix size={22} />
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
                {isAr ? "إعدادات المنشأة والحساب" : "Business & Account Settings"}
              </h1>
            </div>
            <p className="text-sm text-text-muted max-w-2xl">
              {isAr
                ? "إدارة العملة المعتمدة، الملف التعريفي، أتمتة التذكيرات، لغة تصدير التقارير، والنسخ الاحتياطي."
                : "Manage your default currency, business profile, automated reminders, report exports, and backups."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-status-paid-fg/20 bg-status-paid-bg px-3.5 py-1 text-xs font-bold text-status-paid-fg dark:text-status-paid-fg">
              <ShieldCheck size={16} />
              <span>{isAr ? "حساب مؤكد" : "Verified Tenant"}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Notifications / Alerts */}
      {saved && (
        <div role="status" className="flex items-center gap-2.5 rounded-xl border border-status-paid-fg/30 bg-status-paid-bg px-4 py-3.5 text-sm font-bold text-status-paid-fg animate-in fade-in duration-200">
          <CheckCircle size={18} aria-hidden />
          <span>{isAr ? "تم حفظ جميع التغييرات بنجاح!" : "All preferences saved successfully!"}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3.5 text-sm font-bold text-danger">
          <WarningCircle size={18} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={onSave} className="flex flex-col gap-8">
        <div className="grid gap-8 lg:grid-cols-12 items-start">
          {/* Left Column: Business Profile & Currency (7 cols) */}
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
            {/* 1. Company Profile */}
            <Panel title={isAr ? "الملف التعريفي للمنشأة" : "Company Profile"} icon={Buildings}>
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={labelCls}>
                    <span>{isAr ? "اسم المنشأة بالعربية" : "Business Name (Arabic)"}</span>
                    <input
                      data-testid="business-name-ar"
                      className={inputCls}
                      value={businessNameAr}
                      onChange={(e) => setBusinessNameAr(e.target.value)}
                      required
                      placeholder="مثال: شركة النيل للتجارة"
                    />
                  </label>
                  <label className={labelCls}>
                    <span>{isAr ? "اسم المنشأة بالإنجليزية (اختياري)" : "Business Name (English)"}</span>
                    <input
                      className={inputCls}
                      dir="ltr"
                      value={businessNameEn}
                      onChange={(e) => setBusinessNameEn(e.target.value)}
                      placeholder="e.g. Nile Trading Co."
                    />
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={labelCls}>
                    <span>{isAr ? "السجل التجاري / الرقم الضريبي (اختياري)" : "Tax / Commercial Reg ID"}</span>
                    <input
                      className={cn(inputCls, "tabular-nums")}
                      dir="ltr"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      placeholder="e.g. 123-456-789"
                    />
                  </label>
                  <label className={labelCls}>
                    <span>{isAr ? "المنطقة الزمنية" : "Timezone"}</span>
                    <select
                      className={inputCls}
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    >
                      {!TIMEZONES.some((tz) => tz.id === timezone) && (
                        <option value={timezone}>{timezone}</option>
                      )}
                      {TIMEZONES.map((tz) => (
                        <option key={tz.id} value={tz.id}>
                          {isAr ? tz.labelAr : tz.labelEn}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </Panel>

            {/* 2. Currency & Invoice Rules */}
            <Panel title={isAr ? "العملة وسياسة الفواتير" : "Currency & Invoicing Terms"} icon={CurrencyDollar}>
              <div className="flex flex-col gap-5">
                <div>
                  <label className={labelCls}>
                    <span>{isAr ? "العملة الرئيسية للتعاملات" : "Primary Currency"}</span>
                    <p className="text-xs text-text-muted">
                      {isAr
                        ? "هذه العملة الافتراضية للفواتير الجديدة فقط؛ تحتفظ كل فاتورة بعملتها المسجلة بشكل مستقل."
                        : "This is the default for new invoices only. Each invoice retains its own recorded currency."}
                    </p>
                    <select
                      className={`${inputCls} mt-1`}
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as typeof currency)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {isAr ? c.nameAr : c.nameEn}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={labelCls}>
                    <span>{isAr ? "فترة الاستحقاق الافتراضية" : "Default Payment Terms"}</span>
                    <select
                      className={inputCls}
                      value={defaultTermsDays}
                      onChange={(e) => setDefaultTermsDays(Number(e.target.value))}
                    >
                      {![7, 14, 30, 60].includes(defaultTermsDays) && (
                        <option value={defaultTermsDays}>{isAr ? `${defaultTermsDays} يوماً` : `${defaultTermsDays} days`}</option>
                      )}
                      <option value={7}>{isAr ? "7 أيام" : "7 days"}</option>
                      <option value={14}>{isAr ? "14 يوماً (أسبوعان)" : "14 days (2 weeks)"}</option>
                      <option value={30}>{isAr ? "30 يوماً (شهر)" : "30 days (1 month)"}</option>
                      <option value={60}>{isAr ? "60 يوماً (شهران)" : "60 days (2 months)"}</option>
                    </select>
                  </label>

                  <label className={labelCls}>
                    <span>{isAr ? "لغة تصدير التقارير والفواتير" : "Report & Invoice Export Language"}</span>
                    <select
                      className={inputCls}
                      value={exportLanguage}
                      onChange={(e) => setExportLanguage(e.target.value as "ar" | "en")}
                    >
                      <option value="ar">{isAr ? "العربية (Arabic)" : "Arabic"}</option>
                      <option value="en">{isAr ? "الإنجليزية (English)" : "English"}</option>
                    </select>
                  </label>
                </div>

                <label className={labelCls}>
                  <span>{isAr ? "تعليمات السداد للعملاء (IBAN / InstaPay)" : "Customer Payment Instructions (Bank IBAN / InstaPay)"}</span>
                  <textarea
                    data-testid="settings-payment-instructions"
                    rows={3}
                    maxLength={1000}
                    className={inputCls}
                    value={paymentInstructions}
                    onChange={(e) => setPaymentInstructions(e.target.value)}
                    placeholder={isAr ? "مثال: التحويل البنكي IBAN: EG... أو InstaPay: name@instapay" : "e.g. Bank IBAN: EG... or InstaPay: name@instapay"}
                  />
                </label>
              </div>
            </Panel>
          </div>

          {/* Right Column: Reminders, Quiet Hours, Auto-Close (5 cols) */}
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
            {/* 3. WhatsApp & Automated Reminders */}
            <Panel title={isAr ? "أتمتة تذكيرات الواتساب" : "WhatsApp Reminders Automation"} icon={Clock}>
              <div className="flex flex-col gap-4">
                <label className={labelCls}>
                  <span>{isAr ? "نبرة الرسائل" : "Reminder Tone"}</span>
                  <select
                    className={inputCls}
                    value={tone}
                    onChange={(e) => setTone(e.target.value as "polite" | "firm")}
                  >
                    <option value="polite">{isAr ? "مهذبة ولطيفة (Polite)" : "Polite & Friendly"}</option>
                    <option value="firm">{isAr ? "حازمة ومباشرة (Firm)" : "Direct & Firm"}</option>
                  </select>
                </label>

                {/* Quiet Hours */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-text">
                    {isAr ? "ساعات الهدوء (منع إرسال الرسائل ليلاً)" : "Quiet Hours (No messages sent)"}
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex min-w-0 flex-col gap-1 text-xs text-text-muted">
                      <span>{isAr ? "من الساعة" : "From"}</span>
                      <input
                        type="time"
                        dir="ltr"
                        className={cn(inputCls, "tabular-nums")}
                        value={quietStart}
                        onChange={(e) => setQuietStart(e.target.value)}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1 text-xs text-text-muted">
                      <span>{isAr ? "إلى الساعة" : "To"}</span>
                      <input
                        type="time"
                        dir="ltr"
                        className={cn(inputCls, "tabular-nums")}
                        value={quietEnd}
                        onChange={(e) => setQuietEnd(e.target.value)}
                      />
                    </label>
                  </div>
                </div>

                {/* Checkbox Toggles */}
                <div className="flex flex-col gap-3 pt-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted/40 p-3 hover:bg-surface-muted/70 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4.5 rounded border border-border bg-surface text-primary focus:ring-1 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                      checked={fridayMorningSkip}
                      onChange={(e) => setFridayMorningSkip(e.target.checked)}
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text">
                        {isAr ? "تخطي صباح الجمعة" : "Skip Friday mornings"}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {isAr ? "مراعاة صلاة الجمعة وأوقات العطلة الأسبوعية." : "Respect prayer times and weekend quiet."}
                      </span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted/40 p-3 hover:bg-surface-muted/70 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4.5 rounded border border-border bg-surface text-primary focus:ring-1 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                      checked={autoCloseEnabled}
                      onChange={(e) => setAutoCloseEnabled(e.target.checked)}
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text">
                        {isAr ? "إغلاق الفاتورة تلقائياً عند اعتماد الإيصال" : "Auto-close invoices on payment claim"}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {isAr ? "اعتماد التحويل البنكي أو إيصال الدفع فور التحقق منه." : "Close matching invoice once a receipt is verified."}
                      </span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted/40 p-3 hover:bg-surface-muted/70 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4.5 rounded border border-border bg-surface text-primary focus:ring-1 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                      checked={easternDigits}
                      onChange={(e) => setEasternDigits(e.target.checked)}
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text">
                        {isAr ? "عرض الأرقام بالأرقام العربية المشرقية (١٢٣)" : "Show Eastern Arabic digits (١٢٣)"}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {isAr ? "تُعرض المبالغ والتواريخ بالأرقام المشرقية بدلاً من اللاتينية." : "Amounts and dates render in Eastern Arabic digits instead of Latin ones."}
                      </span>
                    </div>
                  </label>
                </div>

                {/* Per-Tenant WhatsApp Cloud API Connection */}
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-text">
                      {isAr ? "ربط رقم WhatsApp Cloud API الخاص بالمنشأة" : "Tenant WhatsApp Cloud API"}
                    </span>
                    <span
                      data-testid="wa-connected-badge"
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-bold",
                        data.integrations.whatsappConnected || data.settings.whatsapp?.connected || data.settings.whatsapp?.phoneNumberId
                          ? "bg-status-paid-bg text-status-paid-fg"
                          : "bg-surface-muted text-text-muted",
                      )}
                    >
                      {data.integrations.whatsappConnected || data.settings.whatsapp?.connected || data.settings.whatsapp?.phoneNumberId
                        ? (isAr ? "متصل" : "Connected")
                        : (isAr ? "غير مربوط" : "Not connected")}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelCls}>
                      <span>Phone Number ID</span>
                      <input
                        data-testid="wa-phone-number-id"
                        dir="ltr"
                        inputMode="numeric"
                        className={cn(inputCls, "tabular-nums")}
                        value={waPhoneNumberId}
                        onChange={(e) => setWaPhoneNumberId(e.target.value)}
                        placeholder="123456789012345"
                      />
                    </label>
                    <label className={labelCls}>
                      <span>WABA ID ({isAr ? "اختياري" : "Optional"})</span>
                      <input
                        data-testid="wa-waba-id"
                        dir="ltr"
                        inputMode="numeric"
                        className={cn(inputCls, "tabular-nums")}
                        value={waWabaId}
                        onChange={(e) => setWaWabaId(e.target.value)}
                        placeholder="987654321098765"
                      />
                    </label>
                  </div>
                  <label className={labelCls}>
                    <span>{isAr ? "Access Token (كتابة فقط)" : "Access Token (write-only)"}</span>
                    <input
                      data-testid="wa-access-token"
                      type="password"
                      dir="ltr"
                      autoComplete="new-password"
                      className={inputCls}
                      value={waAccessToken}
                      onChange={(e) => setWaAccessToken(e.target.value)}
                      placeholder={data.integrations.whatsappConnected || data.settings.whatsapp?.connected
                        ? (isAr ? "•••••••• (اتركه فارغاً للإبقاء على الرمز)" : "•••••••• (leave blank to keep current)")
                        : "EAAG..."}
                    />
                  </label>
                </div>
              </div>
            </Panel>
          </div>
        </div>

        {/* Floating / Sticky Save Bar */}
        <div className="sticky bottom-4 z-20 flex flex-col items-stretch justify-between gap-3 rounded-xl border border-border bg-surface/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2">
            <SecurityLockBadge size={32}/>
            <span className="text-xs font-medium text-text-muted">
              {isAr ? "تُحفظ الإعدادات بأمان وتُطبق فوراً على الحساب." : "Settings are saved securely and applied immediately."}
            </span>
          </div>

          <button
            type="submit"
            data-testid="settings-submit"
            disabled={busy}
            className={`${btnPrimary} min-h-[40px] px-6 text-sm`}
          >
            <FloppyDisk size={18} strokeWidth={2.5} />
            <span>{busy ? (isAr ? "جارٍ الحفظ..." : "Saving...") : (isAr ? "حفظ التغييرات" : "Save Changes")}</span>
          </button>
        </div>
      </form>

      {/* Secondary Operations: CSV Exports & Danger Zone */}
      <div className="mt-4 border-t border-border pt-8">
        <h2 className="mb-4 text-lg font-bold text-text">
          {isAr ? "النسخ الاحتياطي وتصدير البيانات" : "Backups & Data Management"}
        </h2>
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          <div className="min-w-0 lg:col-span-6">
            <ExportButtons />
          </div>
          <div className="min-w-0 lg:col-span-6">
            <DangerZone />
          </div>
        </div>
        <div className="mt-6">
          <Panel
            title={isAr ? "الجلسات والأمان" : "Sessions & security"}
            subtitle={isAr
              ? "إذا شككت أن حسابك مفتوح على جهاز آخر، أنهِ كل الجلسات دفعة واحدة."
              : "If you suspect your account is open on another device, end every session at once."}
            icon={ShieldCheck}
            testId="sessions-panel"
          >
            <button
              type="button"
              data-testid="revoke-all-sessions"
              disabled={revoking}
              onClick={() => void onRevokeAllSessions()}
              className={cn(buttonVariants({ variant: "dangerSoft", size: "default" }), "border-danger/40 text-danger")}
            >
              <ShieldCheck size={18} />
              <span>{revoking
                ? (isAr ? "جارٍ إنهاء الجلسات..." : "Ending sessions...")
                : (isAr ? "تسجيل الخروج من كل الأجهزة" : "Sign out everywhere")}</span>
            </button>
          </Panel>
        </div>
        {/* F-16: the AuditTrail component existed but was never mounted
            anywhere — it now lives here, next to the security controls.
            audit.list is owner-only; for staff the query fails and the
            panel shows its empty state. */}
        <div className="mt-6">
          <AuditTrail />
        </div>
      </div>
    </div>
  );
}
