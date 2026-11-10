"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Buildings, CheckCircle, Clock, CurrencyDollar,
  FloppyDisk, GearSix, ShieldCheck, WarningCircle,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { ExportButtons } from "./ExportButtons";
import { DangerZone } from "./DangerZone";
import { SecurityLockBadge } from "./illustrations";
import { Panel, btnPrimary, inputCls, labelCls } from "./ui";

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
    currency?: "EGP" | "SAR" | "USD" | "AED" | "EUR" | "KWD";
    exportLanguage?: "ar" | "en";
    statementLinksEnabled?: boolean;
    includePayLinkInReminders?: boolean;
    gatewayEnabled?: boolean;
  };
  integrations: {
    aiConfigured: boolean;
    llmModelFast: string;
    llmModelVision: string;
    paymobConfigured: boolean;
    whatsappConfigured: boolean;
    smsConfigured: boolean;
    dryRunMessaging: boolean;
    webhooks: { paymob: string; whatsapp: string };
  };
}

const CURRENCIES = [
  { code: "EGP", nameAr: "جنيه مصري (EGP)", nameEn: "Egyptian Pound (EGP)", symbol: "ج.م." },
  { code: "SAR", nameAr: "ريال سعودي (SAR)", nameEn: "Saudi Riyal (SAR)", symbol: "ر.س." },
  { code: "USD", nameAr: "دولار أمريكي (USD)", nameEn: "US Dollar (USD)", symbol: "$" },
  { code: "AED", nameAr: "درهم إماراتي (AED)", nameEn: "UAE Dirham (AED)", symbol: "د.إ." },
  { code: "EUR", nameAr: "يورو (EUR)", nameEn: "Euro (EUR)", symbol: "€" },
  { code: "KWD", nameAr: "دينار كويتي (KWD)", nameEn: "Kuwaiti Dinar (KWD)", symbol: "د.ك." },
] as const;

const TIMEZONES = [
  { id: "Africa/Cairo", labelAr: "القاهرة (GMT+2)", labelEn: "Cairo (GMT+2)" },
  { id: "Asia/Riyadh", labelAr: "الرياض (GMT+3)", labelEn: "Riyadh (GMT+3)" },
  { id: "Asia/Dubai", labelAr: "دبي (GMT+4)", labelEn: "Dubai (GMT+4)" },
  { id: "Europe/London", labelAr: "لندن (GMT+0)", labelEn: "London (GMT+0)" },
  { id: "UTC", labelAr: "توقيت جرينتش العالمي (UTC)", labelEn: "Coordinated Universal Time (UTC)" },
] as const;

export function SettingsClient({ locale }: { locale: string }) {
  const isAr = locale === "ar";
  const [data, setData] = useState<SettingsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [taxId, setTaxId] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [currency, setCurrency] = useState<"EGP" | "SAR" | "USD" | "AED" | "EUR" | "KWD">("EGP");
  const [defaultTermsDays, setDefaultTermsDays] = useState(14);
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("09:00");
  const [fridayMorningSkip, setFridayMorningSkip] = useState(true);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(false);
  const [includePayLinkInReminders, setIncludePayLinkInReminders] = useState(true);
  const [statementLinksEnabled, setStatementLinksEnabled] = useState(true);
  const [exportLanguage, setExportLanguage] = useState<"ar" | "en">("ar");

  const load = useCallback(async () => {
    try {
      const res = (await trpc.tenant.integrations.query()) as unknown as SettingsData;
      setData(res);
      setBusinessNameAr(res.businessNameAr);
      setTimezone(res.timezone);
      setBusinessNameEn(res.settings.businessNameEn ?? "");
      setTaxId(res.settings.taxId ?? "");
      setCurrency(res.settings.currency ?? "EGP");
      setDefaultTermsDays(res.settings.defaultTermsDays ?? 14);
      setTone(res.settings.tone ?? "polite");
      setQuietStart(res.settings.quietStart ?? "21:00");
      setQuietEnd(res.settings.quietEnd ?? "09:00");
      setFridayMorningSkip(res.settings.fridayMorningSkip ?? true);
      setAutoCloseEnabled(res.settings.autoCloseEnabled ?? false);
      setIncludePayLinkInReminders(res.settings.includePayLinkInReminders ?? true);
      setStatementLinksEnabled(res.settings.statementLinksEnabled ?? true);
      setExportLanguage(res.settings.exportLanguage ?? "ar");
    } catch {
      setError(isAr ? "تعذّر تحميل إعدادات الحساب." : "Failed to load account settings.");
    }
  }, [isAr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await trpc.tenant.updateSettings.mutate({
        businessNameAr: businessNameAr.trim(),
        businessNameEn: businessNameEn.trim(),
        taxId: taxId.trim(),
        timezone,
        currency,
        defaultTermsDays,
        tone,
        quietStart,
        quietEnd,
        fridayMorningSkip,
        autoCloseEnabled,
        includePayLinkInReminders,
        statementLinksEnabled,
        exportLanguage,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (isAr ? "تعذّر حفظ التعديلات" : "Failed to save settings"));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="flex min-h-[350px] items-center justify-center">
        <span className="text-sm font-semibold text-text-muted">{isAr ? "جارٍ تحميل الإعدادات..." : "Loading settings..."}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Settings Header Band */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <GearSix size={22} weight="fill" />
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-3.5 py-1 text-xs font-bold text-teal-700 dark:text-teal-300">
              <ShieldCheck size={16} weight="fill" />
              <span>{isAr ? "حساب مؤكد" : "Verified Tenant"}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Notifications / Alerts */}
      {saved && (
        <div role="status" className="flex items-center gap-2.5 rounded-2xl border border-status-paid-fg/30 bg-status-paid-bg px-4 py-3.5 text-sm font-bold text-status-paid-fg shadow-sm animate-in fade-in duration-200">
          <CheckCircle size={18} weight="fill" aria-hidden />
          <span>{isAr ? "تم حفظ جميع التغييرات بنجاح!" : "All preferences saved successfully!"}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-2xl border border-danger/30 bg-danger-bg px-4 py-3.5 text-sm font-bold text-danger shadow-sm">
          <WarningCircle size={18} weight="fill" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={onSave} className="flex flex-col gap-8">
        <div className="grid gap-8 lg:grid-cols-12 items-start">
          {/* Left Column: Business Profile & Currency (7 cols) */}
          <div className="flex flex-col gap-6 lg:col-span-7">
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
                      className={inputCls}
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
                        ? "تُعرض المبالغ والتقارير والفواتير بالعملة المحددة افتراضيًا."
                        : "Reports, outstanding amounts, and new invoices use this currency."}
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
                      <option value={7}>{isAr ? "٧ أيام" : "7 days"}</option>
                      <option value={14}>{isAr ? "١٤ يوماً (أسبوعان)" : "14 days (2 weeks)"}</option>
                      <option value={30}>{isAr ? "٣٠ يوماً (شهر)" : "30 days (1 month)"}</option>
                      <option value={60}>{isAr ? "٦٠ يوماً (شهران)" : "60 days (2 months)"}</option>
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
              </div>
            </Panel>
          </div>

          {/* Right Column: Reminders, Quiet Hours, Auto-Close (5 cols) */}
          <div className="flex flex-col gap-6 lg:col-span-5">
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
                    <label className="text-xs text-text-muted">
                      <span>{isAr ? "من الساعة" : "From"}</span>
                      <input
                        type="time"
                        dir="ltr"
                        className={inputCls}
                        value={quietStart}
                        onChange={(e) => setQuietStart(e.target.value)}
                      />
                    </label>
                    <label className="text-xs text-text-muted">
                      <span>{isAr ? "إلى الساعة" : "To"}</span>
                      <input
                        type="time"
                        dir="ltr"
                        className={inputCls}
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
                        {isAr ? "اعتماد التحويل البنكي أو إيصال إنستاباي فور التحقق منه." : "Close matching invoice once a receipt is verified."}
                      </span>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted/40 p-3 hover:bg-surface-muted/70 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4.5 rounded border border-border bg-surface text-primary focus:ring-1 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                      checked={includePayLinkInReminders}
                      onChange={(e) => setIncludePayLinkInReminders(e.target.checked)}
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text">
                        {isAr ? "تضمين رابط الدفع وكشف الحساب في رسائل التذكير" : "Include payment link in reminders"}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {isAr ? "يتيح للمدين الدفع إلكترونياً أو مراجعة كشف حسابه بضغطة زر." : "Allows debtor to pay or view statement directly."}
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </Panel>
          </div>
        </div>

        {/* Floating / Sticky Save Bar */}
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <SecurityLockBadge size={32} />
            <span className="text-xs font-medium text-text-muted">
              {isAr ? "تُحفظ الإعدادات بأمان وتُطبق فوراً على الحساب." : "Settings are saved securely and applied immediately."}
            </span>
          </div>

          <button
            type="submit"
            data-testid="settings-submit"
            disabled={busy}
            className={`${btnPrimary} min-h-[42px] px-6 text-sm`}
          >
            <FloppyDisk size={18} weight="bold" />
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
          <div className="lg:col-span-6">
            <ExportButtons />
          </div>
          <div className="lg:col-span-6">
            <DangerZone />
          </div>
        </div>
      </div>
    </div>
  );
}
