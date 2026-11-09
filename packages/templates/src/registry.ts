import { z } from "zod";

/**
 * Message template registry (BUILD_PLAN F3): versioned keys, per-locale text,
 * Zod variable schemas. NEVER hardcode message text outside this registry.
 * Arabic texts are the plan's drafts (polite, short, no threats). English
 * texts are DRAFT translations pending review. Categories are decided by
 * Meta at submission time; `categoryHint` is only our expectation.
 * A submission script (`pnpm --filter @tahseel/templates submit`) prints what
 * to submit to Meta; actual submission is a human step (RUNBOOK).
 */
export const OPT_OUT_LINE = {
  ar: "للإيقاف رد بـ «إيقاف».",
  en: "To stop these messages, reply STOP.",
} as const;

const vars = {
  businessAmountDue: z.object({ business: z.string().min(1), amount: z.string().min(1), due_date: z.string().min(1) }),
  businessAmount: z.object({ business: z.string().min(1), amount: z.string().min(1) }),
  amountRemaining: z.object({ amount: z.string().min(1), remaining: z.string().min(1) }),
  amountOnly: z.object({ amount: z.string().min(1) }),
};

export interface TemplateDef {
  key: string;
  version: number;
  categoryHint: "utility";
  reminder: boolean; // reminders always carry the opt-out line
  variables: z.ZodTypeAny;
  body: { ar: string; en: string };
}

export const TEMPLATES = {
  invoice_upcoming: {
    key: "invoice_upcoming", version: 1, categoryHint: "utility", reminder: true,
    variables: vars.businessAmountDue,
    body: {
      ar: "تذكير ودّي من {{business}}: مستحق عليكم مبلغ {{amount}} بتاريخ {{due_date}}. شكرًا لتعاونكم.",
      en: "A friendly reminder from {{business}}: an amount of {{amount}} is due on {{due_date}}. Thank you for your cooperation.",
    },
  },
  invoice_due_today: {
    key: "invoice_due_today", version: 1, categoryHint: "utility", reminder: true,
    variables: vars.businessAmount,
    body: {
      ar: "من {{business}}: نذكّركم بأن مبلغ {{amount}} مستحق اليوم. للاستفسار أو التسوية يمكنكم الرد على هذه الرسالة.",
      en: "From {{business}}: we remind you that {{amount}} is due today. You can reply to this message with any question.",
    },
  },
  invoice_overdue: {
    key: "invoice_overdue", version: 1, categoryHint: "utility", reminder: true,
    variables: vars.businessAmountDue,
    body: {
      ar: "من {{business}}: لاحظنا تأخر سداد مبلغ {{amount}} المستحق في {{due_date}}. إن كان قد تم السداد، برجاء إرسال إيصال التحويل هنا. شكرًا لكم.",
      en: "From {{business}}: we noticed a delay in paying {{amount}}, which was due on {{due_date}}. If you have already paid, please send the transfer receipt here. Thank you.",
    },
  },
  payment_received: {
    key: "payment_received", version: 1, categoryHint: "utility", reminder: false,
    variables: vars.amountRemaining,
    body: {
      ar: "وصلنا مبلغ {{amount}}، شكرًا لكم. المتبقي: {{remaining}}.",
      en: "We received {{amount}}, thank you. Remaining: {{remaining}}.",
    },
  },
  payment_received_pending: {
    key: "payment_received_pending", version: 1, categoryHint: "utility", reminder: true,
    variables: vars.amountOnly,
    body: {
      ar: "استلمنا الإيصال وجارٍ التأكد من التحويل. شكرًا لكم.",
      en: "We received the receipt and are verifying the transfer. Thank you.",
    },
  },
} as const satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;

export function renderTemplate(key: TemplateKey, locale: "ar" | "en", variables: Record<string, string>): string {
  const def: TemplateDef = TEMPLATES[key];
  const parsed = def.variables.safeParse(variables);
  if (!parsed.success) {
    throw new Error(`Template ${key} variable mismatch: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  let text = def.body[locale].replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = variables[name];
    if (value === undefined) throw new Error(`Template ${key}: missing variable ${name}`);
    return value;
  });
  if (def.reminder) text = `${text} ${OPT_OUT_LINE[locale]}`;
  return text;
}

/** Prints every template (both locales, with placeholders) for Meta submission review. */
export function submissionSheet(): string {
  return Object.values(TEMPLATES)
    .map((t: TemplateDef) => `# ${t.key} v${t.version} (category decided by Meta; hint: ${t.categoryHint})\nAR: ${t.body.ar}${t.reminder ? ` ${OPT_OUT_LINE.ar}` : ""}\nEN: ${t.body.en}${t.reminder ? ` ${OPT_OUT_LINE.en}` : ""}`)
    .join("\n\n");
}
