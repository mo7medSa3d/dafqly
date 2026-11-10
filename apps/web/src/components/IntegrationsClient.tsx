"use client";
import { useEffect, useState } from "react";
import { Check, Sliders } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel, btnPrimary, inputCls, labelCls } from "./ui";

interface TenantPrefs {
  businessNameAr: string;
  businessNameEn?: string | null;
  timezone: string;
  settings: {
    quietStart: string;
    quietEnd: string;
    fridayMorningSkip: boolean;
    defaultTermsDays: number;
    tone: "polite" | "firm";
  };
}

export function IntegrationsClient({ locale }: { locale: string }) {
  const isAr = locale === "ar";
  const [data, setData] = useState<TenantPrefs | null>(null);
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [defaultTermsDays, setDefaultTermsDays] = useState(14);
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("09:00");
  const [fridaySkip, setFridaySkip] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void trpc.tenant.integrations.query().then((res) => {
      const d = res as TenantPrefs;
      setData(d);
      setBusinessNameAr(d.businessNameAr);
      setDefaultTermsDays(d.settings.defaultTermsDays);
      setTone(d.settings.tone);
      setQuietStart(d.settings.quietStart);
      setQuietEnd(d.settings.quietEnd);
      setFridaySkip(d.settings.fridayMorningSkip);
    }).catch(() => {});
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await trpc.tenant.updateSettings.mutate({
        businessNameAr: businessNameAr.trim() || undefined,
        defaultTermsDays,
        tone,
        quietStart,
        quietEnd,
        fridayMorningSkip: fridaySkip,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <Panel title={isAr ? "تفضيلات النشاط والتذكيرات" : "Business & Reminder Preferences"} icon={Sliders}>
      <form onSubmit={onSave} className="flex flex-col gap-3.5">
        <label className={labelCls}>
          <span>{isAr ? "اسم النشاط التجاري" : "Business Name"}</span>
          <input className={inputCls} value={businessNameAr} onChange={(e) => setBusinessNameAr(e.target.value)} required />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            <span>{isAr ? "مهلة السداد الافتراضية (يوم)" : "Default Terms (days)"}</span>
            <input type="number" min={0} max={120} dir="ltr" className={inputCls} value={defaultTermsDays} onChange={(e) => setDefaultTermsDays(Number(e.target.value))} />
          </label>
          <label className={labelCls}>
            <span>{isAr ? "نبرة التذكيرات" : "Reminder Tone"}</span>
            <select className={inputCls} value={tone} onChange={(e) => setTone(e.target.value as "polite" | "firm")}>
              <option value="polite">{isAr ? "ودودة ومهذبة" : "Polite & Friendly"}</option>
              <option value="firm">{isAr ? "حازمة رسمية" : "Firm & Formal"}</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            <span>{isAr ? "بداية ساعات الهدوء" : "Quiet Hours Start"}</span>
            <input type="time" dir="ltr" className={inputCls} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
          </label>
          <label className={labelCls}>
            <span>{isAr ? "نهاية ساعات الهدوء" : "Quiet Hours End"}</span>
            <input type="time" dir="ltr" className={inputCls} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs font-bold">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={fridaySkip} onChange={(e) => setFridaySkip(e.target.checked)} />
          <span>{isAr ? "إيقاف إرسال التذكيرات صباح يوم الجمعة" : "Skip reminders on Friday mornings"}</span>
        </label>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
            <Check size={16} weight="bold" aria-hidden />
            <span>{saved ? (isAr ? "تم حفظ التفضيلات" : "Preferences Saved") : (isAr ? "حفظ التفضيلات" : "Save Preferences")}</span>
          </button>
        </div>
      </form>
    </Panel>
  );
}
