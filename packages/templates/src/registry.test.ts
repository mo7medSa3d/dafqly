import { describe, it, expect } from "vitest";
import { TEMPLATES, renderTemplate, OPT_OUT_LINE, type TemplateKey } from "./registry";

describe("template registry", () => {
  it("renders variables and appends the opt-out line to every reminder template", () => {
    const text = renderTemplate("invoice_overdue", "ar", { business: "محل النور", amount: "١٬٢٥٠", due_date: "2026-11-10" });
    expect(text).toContain("محل النور");
    expect(text).toContain(OPT_OUT_LINE.ar);
    expect(text).not.toContain("{{");
  });
  it("payment_received (not a reminder) has no opt-out line", () => {
    const text = renderTemplate("payment_received", "ar", { amount: "100", remaining: "50" });
    expect(text).not.toContain(OPT_OUT_LINE.ar);
  });
  it("rejects missing or extra-shaped variables (Zod schema per template)", () => {
    expect(() => renderTemplate("invoice_due_today", "en", { business: "Shop" })).toThrow();
  });
  it("every registered template renders in both locales with its schema's minimal variables", () => {
    const samples: Record<TemplateKey, Record<string, string>> = {
      invoice_upcoming: { business: "B", amount: "1", due_date: "2026-01-01" },
      invoice_due_today: { business: "B", amount: "1" },
      invoice_overdue: { business: "B", amount: "1", due_date: "2026-01-01" },
      payment_received: { amount: "1", remaining: "0" },
      payment_received_pending: { amount: "1" },
    };
    for (const key of Object.keys(TEMPLATES) as TemplateKey[]) {
      expect(renderTemplate(key, "ar", samples[key]).length).toBeGreaterThan(5);
      expect(renderTemplate(key, "en", samples[key]).length).toBeGreaterThan(5);
    }
  });
  it("tone guard: no threats, shaming or exclamation marks in any template body", () => {
    for (const def of Object.values(TEMPLATES)) {
      for (const body of [def.body.ar, def.body.en]) {
        expect(body).not.toMatch(/!|تهديد|عار|فضيحة/);
      }
    }
  });
});
