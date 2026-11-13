"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Buildings, CheckCircle, Clock, CurrencyDollar, Database,
  FloppyDisk, GearSix, ShieldCheck, Sparkle, WarningCircle, X,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { signOut } from "@/lib/auth-client";
import { ExportButtons } from "./ExportButtons";
import { DangerZone } from "./DangerZone";
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
  const isAr = locale === "ar";
  const [data, setData] = useState<SettingsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [confirmRevokeModalOpen, setConfirmRevokeModalOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState<string | null>(null);

  /** H5: sign out everywhere — revokes every session, including this one. */
  async function executeRevokeAllSessions() {
    setRevoking(true);
    try {
      await trpc.auth.revokeAllSessions.mutate();
      try { await signOut(); } catch { /* revocation already happened */ }
      window.location.assign(`/${locale}/login`);
    } catch {
      setError(isAr ? "تعذّر إنهاء الجلسات. حاول مرة أخرى." : "Could not end the sessions. Try again.");
      setRevoking(false);
      setConfirmRevokeModalOpen(false);
    }
  }

  async function onSeedComprehensive() {
    setSeeding(true);
    setSeedSuccess(null);
    setError(null);
    try {
      const res = await trpc.tenant.seedComprehensive.mutate();
      setSeedSuccess(
        isAr
          ? `تم بنجاح تحميل البيانات التجريبية: ${res.debtorsAdded} عملاء، ${res.invoicesAdded} فواتير، ${res.chequesAdded} شيكات بمختلف الحالات.`
          : `Successfully loaded comprehensive demo data: ${res.debtorsAdded} debtors, ${res.invoicesAdded} invoices, ${res.chequesAdded} cheques across multiple statuses.`
      );
    } catch {
      setError(isAr ? "تعذرت إضافة البيانات التجريبية." : "Failed to seed demo data.");
    } finally {
      setSeeding(false);
    }
  }

  // Form states
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [taxId, setTaxId] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [interfaceLanguage, setInterfaceLanguage] = useState<"ar" | "en">(isAr ? "ar" : "en");
  const [currency, setCurrency] = useState<"EGP" | "SAR" | "USD" | "AED" | "EUR" | "KWD" | "JPY">("EGP");
  const [defaultTermsDays, setDefaultTermsDays] = useState(14);
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("09:00");
  const [fridayMorningSkip, setFridayMorningSkip] = useState(true);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(false);
  const [includePayLinkInReminders, setIncludePayLinkInReminders] = useState(true);
  const [statementLinksEnabled, setStatementLinksEnabled] = useState(true);
  const [exportLanguage, setExportLanguage] = useState<"ar" | "en">("ar");
  const [easternDigits, setEasternDigits] = useState(false);

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
        easternDigits,
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
      setTimeout(() => {
        if (interfaceLanguage !== locale) {
          window.location.assign(`/${interfaceLanguage}/settings`);
        } else {
          window.location.reload();
        }
      }, 700);
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
      {/* Settings Signature Blue Hero Band */}
      <section className="hero-band panel-shadow relative overflow-hidden rounded-3xl text-white shadow-lg">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative z-10 flex flex-col gap-4 p-6 sm:p-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-[260px] flex-1 flex-col items-start gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-teal-200">
              <span className="size-2 rounded-full bg-teal-400 animate-pulse" />
              <span>{isAr ? "مركز التحكم في الحساب والمنشأة" : "Workspace Control & Settings"}</span>
              <span className="text-white/60">·</span>
              <span className="text-white/90">{data.businessNameAr}</span>
              <span className="text-white/60">·</span>
              <span className="text-white/80">{timezone}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur-sm">
                <GearSix size={24} weight="fill" />
              </span>
              <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {isAr ? "إعدادات المنشأة والحساب" : "Business & Account Settings"}
              </h1>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-navy-100">
              {isAr
                ? "إدارة العملة المعتمدة، الملف التعريفي، أتمتة التذكيرات، لغة تصدير التقارير، والنسخ الاحتياطي المشفر."
                : "Manage your default currency, business profile, automated reminders, report exports, and encrypted backups."}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300/30 bg-teal-400/20 px-4 py-1.5 text-xs font-bold text-teal-200 backdrop-blur-sm">
              <ShieldCheck size={16} weight="fill" />
              <span>{isAr ? "حساب مؤكد ومحمي" : "Verified & Protected"}</span>
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={labelCls}>
                    <span>{isAr ? "لغة واجهة المنصة والتطبيق" : "Platform Interface Language"}</span>
                    <select
                      className={inputCls}
                      value={interfaceLanguage}
                      onChange={(e) => setInterfaceLanguage(e.target.value as "ar" | "en")}
                    >
                      <option value="ar">{isAr ? "العربية (Arabic)" : "Arabic (العربية)"}</option>
                      <option value="en">{isAr ? "English (الإنجليزية)" : "English"}</option>
                    </select>
                  </label>
                  <div className="flex flex-col justify-end text-xs text-text-muted pb-1.5">
                    <span>{isAr ? "تغيير لغة واجهة النظام ولوحة التحكم فورياً." : "Changes the entire platform interface language immediately."}</span>
                  </div>
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
              </div>
            </Panel>
          </div>
        </div>

        {/* Floating / Sticky Save Bar */}
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur sm:px-6">
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
        <div className="mt-6 grid gap-6 lg:grid-cols-12 items-start">
          <div className="lg:col-span-6">
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
                onClick={() => setConfirmRevokeModalOpen(true)}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-danger/40 bg-danger-bg px-4 text-sm font-bold text-danger transition-all hover:bg-danger/10 disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck size={18} weight="fill" />
                <span>{revoking
                  ? (isAr ? "جارٍ إنهاء الجلسات..." : "Ending sessions...")
                  : (isAr ? "تسجيل الخروج من كل الأجهزة" : "Sign out everywhere")}</span>
              </button>
            </Panel>
          </div>

          <div className="lg:col-span-6">
            <Panel
              title={isAr ? "بيانات الاختبار والمحاكاة" : "Testing & Simulation Data"}
              subtitle={isAr
                ? "إضافة سيناريوهات وبيانات واقعية متكاملة (عملاء، فواتير بأعمار مختلفة، شيكات، ومطالبات) لاختبار المنصة بالكامل."
                : "Load rich realistic scenarios (debtors, aging invoices, cheques, and claims) to thoroughly test the platform."}
              icon={Database}
              testId="seed-data-panel"
            >
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  data-testid="seed-comprehensive-btn"
                  disabled={seeding}
                  onClick={() => void onSeedComprehensive()}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-primary/40 bg-callout px-4 text-sm font-bold text-primary transition-all hover:bg-primary hover:text-primary-fg disabled:opacity-50 cursor-pointer"
                >
                  <Sparkle size={18} weight="fill" />
                  <span>{seeding
                    ? (isAr ? "جارٍ توليد وتحميل البيانات..." : "Seeding demo data...")
                    : (isAr ? "إضافة بيانات تجريبية متكاملة للاختبار" : "Load Comprehensive Demo Data")}</span>
                </button>
                {seedSuccess && (
                  <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {seedSuccess}
                  </p>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* In-App Confirmation Modal for Revoking All Sessions (No Browser Default Alert) */}
      {confirmRevokeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="relative flex w-full max-w-md flex-col gap-4 rounded-3xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => !revoking && setConfirmRevokeModalOpen(false)}
              className="absolute end-4 top-4 rounded-full p-1.5 text-text-muted hover:bg-surface-muted hover:text-text cursor-pointer"
              aria-label={isAr ? "إغلاق" : "Close"}
            >
              <X size={18} weight="bold" />
            </button>

            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-danger-bg text-danger">
                <WarningCircle size={22} weight="fill" />
              </span>
              <div>
                <h3 id="revoke-modal-title" className="text-base font-black text-text">
                  {isAr ? "تسجيل الخروج من كل الأجهزة؟" : "Sign out on all devices?"}
                </h3>
                <p className="text-xs text-text-muted">
                  {isAr ? "إجراء أمني فوري ومباشر" : "Immediate security revocation"}
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-text-muted">
              {isAr
                ? "سيتم إنهاء كل الجلسات النشطة على جميع أجهزتك فوراً، بما في ذلك هذه الجلسة الحالية. سيتعين عليك تسجيل الدخول مجدداً للمتابعة."
                : "This will terminate all active sessions across all your devices immediately, including this current session. You will need to sign in again to continue."}
            </p>

            <div className="mt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={revoking}
                onClick={() => setConfirmRevokeModalOpen(false)}
                className="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-text-muted transition-colors hover:bg-surface-muted hover:text-text cursor-pointer"
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                data-testid="confirm-revoke-submit"
                disabled={revoking}
                onClick={() => void executeRevokeAllSessions()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-danger px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-danger/90 disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck size={16} weight="fill" />
                <span>
                  {revoking
                    ? (isAr ? "جارٍ الإنهاء..." : "Ending...")
                    : (isAr ? "تأكيد تسجيل الخروج" : "Confirm Sign Out")}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
