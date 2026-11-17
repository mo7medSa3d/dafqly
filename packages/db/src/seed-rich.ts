// Rich dataset seed: SYNTHETIC demo data only (no real people, phones or
// amounts owed by anyone real). A SECOND tenant — it never touches the
// default demo tenant (demo@tahseel.test) or its asserted totals: the e2e
// specs that assert demo totals (m0, m3) keep passing untouched.
//
// Login: rich@tahseel.test — password from RICH_DEMO_PASSWORD, else
// DEMO_PASSWORD (the e2e runner sets DEMO_PASSWORD=test, so the rich login
// is rich@tahseel.test / test under e2e), else a random one printed once.
// Public statement: /s/rich-statement-demo-2026 (fixed dev-only token,
// documented in docs/FINAL_VERIFICATION_EVIDENCE.md and RUNBOOK.md).
//
// Idempotent: safe to run repeatedly (a second run prints "already exists"
// and does nothing). RESET_RICH_SEED=1 (or --reset) wipes the rich tenant
// and user first, then re-seeds. Dev/test only: refuses production unless
// ALLOW_PROD_SEED=1, same as the demo seed.
import "./load-env";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hash as argon2Hash, argon2id } from "argon2";
import { v7 as uuidv7 } from "uuid";
import { createDb } from "./client";
import {
  tenants, user, account, memberships, debtors, invoices, payments,
  paymentAllocations, cheques, promisesToPay, disputes, reminders,
  messages, messageIntents, collectionTasks, statementLinks, auditLog,
  type TenantSettings,
} from "./schema";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
const pepper = process.env.PHONE_HASH_PEPPER ?? "";
if (pepper.length < 32) { console.error("PHONE_HASH_PEPPER must be set (>=32 chars) to seed phone hashes"); process.exit(1); }
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
  console.error("Refusing to seed synthetic data into production database. Set ALLOW_PROD_SEED=1 if intentional.");
  process.exit(1);
}

const phoneHash = (e164: string) => createHmac("sha256", pepper).update(e164).digest("hex");
export const RICH_EMAIL = "rich@tahseel.test";
export const RICH_PASSWORD = process.env.RICH_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD ?? randomBytes(16).toString("hex");
if (!process.env.RICH_DEMO_PASSWORD && !process.env.DEMO_PASSWORD) {
  console.log(`seed-rich: no RICH_DEMO_PASSWORD/DEMO_PASSWORD — generated a random rich password (dev only): ${RICH_PASSWORD}`);
}
// Fixed dev-only public-statement token (synthetic tenant, local dev/e2e only).
export const RICH_STATEMENT_TOKEN = "rich-statement-demo-2026";

const { db, client } = createDb(url);
const today = new Date();
const iso = (daysFromNow: number) => new Date(today.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
const ts = (daysFromNow: number, hour = 10) => {
  const d = new Date(today.getTime() + daysFromNow * 86_400_000);
  d.setUTCHours(hour, 15, 0, 0);
  return d;
};

try {
  if (process.env.RESET_RICH_SEED === "1" || process.argv.includes("--reset")) {
    const existingUsers = await db.select().from(user).where(eq(user.email, RICH_EMAIL));
    for (const u of existingUsers) {
      const ms = await db.select().from(memberships).where(eq(memberships.userId, u.id));
      for (const m of ms) await db.delete(tenants).where(eq(tenants.id, m.tenantId));
      await db.delete(user).where(eq(user.id, u.id));
    }
    console.log("seed-rich: previous rich tenant wiped (RESET_RICH_SEED=1)");
  }

  const existing = await db.select().from(user).where(eq(user.email, RICH_EMAIL));
  if (existing.length > 0) {
    console.log("seed-rich: rich user already exists, nothing to do");
  } else {
    const tenantId = uuidv7();
    const userId = randomUUID().replace(/-/g, "");
    const settings: TenantSettings = {
      quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false,
      autoCloseEnabled: false, defaultChannel: "whatsapp", tone: "polite",
      defaultTermsDays: 14, easternDigits: false, currency: "EGP",
      businessNameEn: "Delta Trading Co.",
    };
    await db.insert(tenants).values({
      id: tenantId, name: "شركة الدلتا للتجارة والمقاولات", businessNameAr: "شركة الدلتا للتجارة والمقاولات",
      timezone: "Africa/Cairo", plan: "trial", trialEndsAt: new Date(Date.now() + 14 * 86_400_000), settings,
    });
    await db.insert(user).values({ id: userId, name: "مدير الحسابات", email: RICH_EMAIL, emailVerified: true });
    await db.insert(account).values({
      id: randomUUID().replace(/-/g, ""), userId, accountId: userId, providerId: "credential",
      password: await argon2Hash(RICH_PASSWORD, { type: argon2id }),
    });
    await db.insert(memberships).values({ tenantId, userId, role: "owner" });

    // ------------------------------------------------------------ debtors (12)
    const debtorDefs: { name: string; phone: string; whatsapp?: "unknown" | "reachable" | "unreachable"; risk?: boolean; optedOutDaysAgo?: number; creditMinor?: bigint; notes?: string }[] = [
      { name: "شركة الأفق للتجارة العامة", phone: "+201004444444", whatsapp: "reachable" },
      { name: "مؤسسة النخبة للأغذية", phone: "+201005555555", whatsapp: "reachable" },
      { name: "شركة السلام للحديد والصلب", phone: "+201006666666", whatsapp: "reachable", risk: true, notes: "عميل متعثر سابقاً — متابعة أسبوعية" },
      { name: "مكتب العدالة للمحاماة والاستشارات", phone: "+201007777777", whatsapp: "unknown" },
      { name: "شركة النورس للنقل والشحن", phone: "+201008888888", whatsapp: "reachable" },
      { name: "مؤسسة الصفا للملابس الجاهزة", phone: "+201009999999", whatsapp: "unreachable" },
      { name: "شركة البركة للأسمدة والمبيدات", phone: "+201010111111", whatsapp: "reachable", optedOutDaysAgo: 10 },
      { name: "شركة الماسة للإلكترونيات", phone: "+201011222222", whatsapp: "reachable" },
      { name: "مؤسسة الفجر للمقاولات العامة", phone: "+201012333333", whatsapp: "unknown" },
      { name: "شركة الوادي للمواد الغذائية", phone: "+201013444444", whatsapp: "reachable" },
      { name: "مكتب الإبداع للتصميم والديكور", phone: "+201014555555", whatsapp: "reachable" },
      { name: "شركة النجمة للأدوات المنزلية", phone: "+201015666666", whatsapp: "reachable", creditMinor: 5000n },
    ];
    const d: string[] = [];
    for (const def of debtorDefs) {
      const idv = uuidv7();
      d.push(idv);
      await db.insert(debtors).values({
        id: idv, tenantId, displayName: def.name, phoneE164: def.phone, phoneHash: phoneHash(def.phone),
        whatsappStatus: def.whatsapp ?? "unknown", riskFlag: def.risk ?? false,
        optedOutAt: def.optedOutDaysAgo !== undefined ? ts(-def.optedOutDaysAgo) : null,
        notes: def.notes ?? null, creditMinor: def.creditMinor ?? 0n, creditCurrency: "EGP",
      });
    }

    // ----------------------------------------------------------- invoices (32)
    // Statuses: open 18, partially_paid 4, paid 6, disputed 2, written_off 1, cancelled 1.
    // Aging (EGP open/partial): current 8, 0-7d 4, 8-30d 3, 31-60d 3, 60+d 2.
    // Forecast: due dates spread +2..+45d across the 8-week horizon.
    type Inv = { debtor: number; ref: string; amount: bigint; due: number; issued: number; status: "open" | "partially_paid" | "paid" | "disputed" | "written_off" | "cancelled"; paid?: bigint; currency?: string; remindedDaysAgo?: number; desc: string };
    const invDefs: Inv[] = [
      { debtor: 0, ref: "RICH-2026-001", amount: 850_000n, due: -3, issued: -33, status: "open", desc: "توريد بضاعة وخامات" },
      { debtor: 0, ref: "RICH-2026-002", amount: 450_000n, due: 5, issued: -10, status: "open", desc: "توريد أجهزة ومعدات" },
      { debtor: 0, ref: "RICH-2026-003", amount: 1_200_000n, due: -20, issued: -50, status: "paid", paid: 1_200_000n, remindedDaysAgo: 4, desc: "توريد بضاعة وخامات" },
      { debtor: 1, ref: "RICH-2026-004", amount: 320_000n, due: -10, issued: -25, status: "open", desc: "توريد مواد غذائية" },
      { debtor: 1, ref: "RICH-2026-005", amount: 600_000n, due: -5, issued: -20, status: "partially_paid", paid: 250_000n, desc: "توريد مواد غذائية" },
      { debtor: 1, ref: "RICH-2026-006", amount: 980_000n, due: 14, issued: -5, status: "open", desc: "توريد مواد غذائية" },
      { debtor: 2, ref: "RICH-2026-007", amount: 1_500_000n, due: -40, issued: -70, status: "open", desc: "توريد حديد تسليح" },
      { debtor: 2, ref: "RICH-2026-008", amount: 2_200_000n, due: -75, issued: -105, status: "open", desc: "توريد حديد وصاج" },
      { debtor: 2, ref: "RICH-2026-009", amount: 400_000n, due: -90, issued: -120, status: "written_off", desc: "توريد حديد — ديون معدومة" },
      { debtor: 3, ref: "RICH-2026-010", amount: 150_000n, due: 2, issued: -13, status: "open", desc: "استشارات قانونية" },
      { debtor: 3, ref: "RICH-2026-011", amount: 275_000n, due: -12, issued: -42, status: "paid", paid: 275_000n, remindedDaysAgo: 9, desc: "استشارات قانونية" },
      { debtor: 3, ref: "RICH-2026-012", amount: 500_000n, due: -15, issued: -45, status: "disputed", desc: "استشارات قانونية — متنازع عليه" },
      { debtor: 4, ref: "RICH-2026-013", amount: 750_000n, due: -120, issued: -150, status: "open", desc: "خدمات نقل وشحن" },
      { debtor: 4, ref: "RICH-2026-014", amount: 1_100_000n, due: 21, issued: -9, status: "open", desc: "خدمات نقل وشحن" },
      { debtor: 4, ref: "RICH-2026-015", amount: 900_000n, due: 3, issued: -12, status: "partially_paid", paid: 350_000n, desc: "خدمات نقل وشحن" },
      { debtor: 5, ref: "RICH-2026-016", amount: 640_000n, due: -20, issued: -50, status: "open", desc: "توريد ملابس جاهزة" },
      { debtor: 5, ref: "RICH-2026-017", amount: 95_000n, due: -30, issued: -60, status: "paid", paid: 95_000n, desc: "توريد ملابس جاهزة" },
      { debtor: 5, ref: "RICH-2026-018", amount: 300_000n, due: -8, issued: -38, status: "cancelled", desc: "توريد ملابس جاهزة — ملغاة" },
      { debtor: 6, ref: "RICH-2026-019", amount: 210_000n, due: -6, issued: -22, status: "open", desc: "توريد أسمدة" },
      { debtor: 6, ref: "RICH-2026-020", amount: 520_000n, due: 30, issued: -5, status: "open", desc: "توريد مبيدات" },
      { debtor: 7, ref: "RICH-2026-021", amount: 1_800_000n, due: -55, issued: -85, status: "partially_paid", paid: 200_000n, desc: "توريد إلكترونيات" },
      { debtor: 7, ref: "RICH-2026-022", amount: 1_234_000n, due: -6, issued: -36, status: "open", currency: "KWD", desc: "توريد إلكترونيات (د.ك)" },
      { debtor: 7, ref: "RICH-2026-023", amount: 50_000n, due: 7, issued: -8, status: "open", currency: "JPY", desc: "توريد إلكترونيات (¥)" },
      { debtor: 8, ref: "RICH-2026-024", amount: 88_000n, due: -2, issued: -17, status: "open", desc: "أعمال مقاولات" },
      { debtor: 8, ref: "RICH-2026-025", amount: 410_000n, due: -18, issued: -48, status: "paid", paid: 410_000n, remindedDaysAgo: 5, desc: "أعمال مقاولات" },
      { debtor: 8, ref: "RICH-2026-026", amount: 660_000n, due: -25, issued: -55, status: "disputed", desc: "أعمال مقاولات — متنازع عليه" },
      { debtor: 9, ref: "RICH-2026-027", amount: 340_000n, due: 10, issued: -5, status: "open", desc: "توريد مواد غذائية" },
      { debtor: 9, ref: "RICH-2026-028", amount: 1_050_000n, due: -45, issued: -75, status: "paid", paid: 1_050_000n, desc: "توريد مواد غذائية" },
      { debtor: 10, ref: "RICH-2026-029", amount: 470_000n, due: -33, issued: -63, status: "open", desc: "أعمال تصميم وديكور" },
      { debtor: 10, ref: "RICH-2026-030", amount: 720_000n, due: -12, issued: -27, status: "partially_paid", paid: 300_000n, desc: "أعمال تصميم وديكور" },
      { debtor: 11, ref: "RICH-2026-031", amount: 2_500_000n, due: 45, issued: -5, status: "open", desc: "توريد أدوات منزلية" },
      { debtor: 11, ref: "RICH-2026-032", amount: 130_000n, due: -6, issued: -21, status: "paid", paid: 130_000n, remindedDaysAgo: 3, desc: "توريد أدوات منزلية" },
    ];
    const invByRef = new Map<string, string>();
    for (const inv of invDefs) {
      const idv = uuidv7();
      invByRef.set(inv.ref, idv);
      await db.insert(invoices).values({
        id: idv, tenantId, debtorId: d[inv.debtor]!, reference: inv.ref, description: inv.desc,
        amountMinor: inv.amount, currency: inv.currency ?? "EGP",
        issuedOn: iso(inv.issued), dueOn: iso(inv.due), status: inv.status,
        paidMinor: inv.paid ?? 0n, source: "manual",
        lastRemindedAt: inv.remindedDaysAgo !== undefined ? ts(-inv.remindedDaysAgo) : null,
      });
    }
    const inv = (ref: string) => invByRef.get(ref)!;

    // ----------------------------------------------------------- payments (16)
    // Confirmed payments get a payment_allocations row (the funnel, the
    // forecast paid-history and collected-by-invoice all read allocations).
    // Reversals are negative rows pointing at the original (p12 refunds part
    // of p4; p16 reverses the bounced cheque payment p15 in full).
    type Pay = { ref: string; amount: bigint; method: "cash" | "instapay" | "bank" | "wallet" | "cheque" | "gateway" | "other"; received: number; status: "claimed" | "confirmed" | "rejected"; debtor: number; invoice: string; reversalOf?: string; gwTxn?: string };
    const payDefs: Pay[] = [
      { ref: "RICH-2026-003", amount: 1_200_000n, method: "instapay", received: -2, status: "confirmed", debtor: 0, invoice: "RICH-2026-003" },
      { ref: "RICH-2026-005", amount: 250_000n, method: "cash", received: -4, status: "confirmed", debtor: 1, invoice: "RICH-2026-005" },
      { ref: "RICH-2026-011", amount: 275_000n, method: "bank", received: -8, status: "confirmed", debtor: 3, invoice: "RICH-2026-011" },
      { ref: "RICH-2026-015", amount: 400_000n, method: "wallet", received: -1, status: "confirmed", debtor: 4, invoice: "RICH-2026-015" },
      { ref: "RICH-2026-017", amount: 95_000n, method: "cash", received: -25, status: "confirmed", debtor: 5, invoice: "RICH-2026-017" },
      { ref: "RICH-2026-025", amount: 410_000n, method: "gateway", received: -3, status: "confirmed", debtor: 8, invoice: "RICH-2026-025", gwTxn: "rich-gw-001" },
      { ref: "RICH-2026-028", amount: 1_050_000n, method: "instapay", received: -40, status: "confirmed", debtor: 9, invoice: "RICH-2026-028" },
      { ref: "RICH-2026-030", amount: 300_000n, method: "bank", received: -6, status: "confirmed", debtor: 10, invoice: "RICH-2026-030" },
      { ref: "RICH-2026-032", amount: 130_000n, method: "cash", received: -1, status: "confirmed", debtor: 11, invoice: "RICH-2026-032" },
      { ref: "RICH-2026-001", amount: 100_000n, method: "instapay", received: -1, status: "claimed", debtor: 0, invoice: "RICH-2026-001" },
      { ref: "RICH-2026-007", amount: 50_000n, method: "cash", received: -2, status: "rejected", debtor: 2, invoice: "RICH-2026-007" },
      { ref: "RICH-2026-015", amount: -50_000n, method: "wallet", received: -1, status: "confirmed", debtor: 4, invoice: "RICH-2026-015", reversalOf: "p4" },
      { ref: "RICH-2026-021", amount: 200_000n, method: "cheque", received: -5, status: "confirmed", debtor: 7, invoice: "RICH-2026-021" },
      { ref: "RICH-2026-014", amount: 150_000n, method: "cheque", received: -1, status: "claimed", debtor: 4, invoice: "RICH-2026-014" },
      { ref: "RICH-2026-016", amount: 300_000n, method: "cheque", received: -10, status: "confirmed", debtor: 5, invoice: "RICH-2026-016" },
      { ref: "RICH-2026-016", amount: -300_000n, method: "cheque", received: -9, status: "confirmed", debtor: 5, invoice: "RICH-2026-016", reversalOf: "p15" },
    ];
    const payId = new Map<string, string>();
    for (let i = 0; i < payDefs.length; i++) {
      const p = payDefs[i]!;
      const key = `p${i + 1}`;
      const idv = uuidv7();
      payId.set(key, idv);
      await db.insert(payments).values({
        id: idv, tenantId, debtorId: d[p.debtor]!, invoiceId: inv(p.invoice),
        amountMinor: p.amount, currency: "EGP", idempotencyKey: `rich-pay-${i + 1}`,
        method: p.method, receivedOn: iso(p.received), status: p.status, source: "manual",
        gatewayTransactionId: p.gwTxn ?? null,
        reversalOf: p.reversalOf ? payId.get(p.reversalOf)! : null,
      });
    }
    // Allocations only for confirmed payments (claimed/rejected have none).
    const allocDefs: { pay: string; invoice: string; amount: bigint }[] = [
      { pay: "p1", invoice: "RICH-2026-003", amount: 1_200_000n },
      { pay: "p2", invoice: "RICH-2026-005", amount: 250_000n },
      { pay: "p3", invoice: "RICH-2026-011", amount: 275_000n },
      { pay: "p4", invoice: "RICH-2026-015", amount: 400_000n },
      { pay: "p5", invoice: "RICH-2026-017", amount: 95_000n },
      { pay: "p6", invoice: "RICH-2026-025", amount: 410_000n },
      { pay: "p7", invoice: "RICH-2026-028", amount: 1_050_000n },
      { pay: "p8", invoice: "RICH-2026-030", amount: 300_000n },
      { pay: "p9", invoice: "RICH-2026-032", amount: 130_000n },
      { pay: "p12", invoice: "RICH-2026-015", amount: -50_000n },
      { pay: "p13", invoice: "RICH-2026-021", amount: 200_000n },
      { pay: "p15", invoice: "RICH-2026-016", amount: 300_000n },
      { pay: "p16", invoice: "RICH-2026-016", amount: -300_000n },
    ];
    for (const a of allocDefs) {
      await db.insert(paymentAllocations).values({
        id: uuidv7(), tenantId, paymentId: payId.get(a.pay)!, invoiceId: inv(a.invoice), amountMinor: a.amount,
      });
    }

    // ------------------------------------------------------------ cheques (6)
    type Chq = { debtor: number; invoice: string; number: string; bank: string; amount: bigint; issue: number; due: number; status: "held" | "deposited" | "cleared" | "bounced" | "returned" | "cancelled"; payment?: string };
    const chqDefs: Chq[] = [
      { debtor: 1, invoice: "RICH-2026-004", number: "0001234", bank: "البنك الأهلي المصري", amount: 320_000n, issue: -30, due: -10, status: "held" },
      { debtor: 4, invoice: "RICH-2026-014", number: "0001235", bank: "بنك مصر", amount: 150_000n, issue: -20, due: 5, status: "deposited", payment: "p14" },
      { debtor: 7, invoice: "RICH-2026-021", number: "0001236", bank: "البنك التجاري الدولي", amount: 200_000n, issue: -35, due: -5, status: "cleared", payment: "p13" },
      { debtor: 5, invoice: "RICH-2026-016", number: "0001237", bank: "بنك القاهرة", amount: 300_000n, issue: -40, due: -10, status: "bounced", payment: "p15" },
      { debtor: 8, invoice: "RICH-2026-024", number: "0001238", bank: "البنك الأهلي المصري", amount: 88_000n, issue: -22, due: -2, status: "returned" },
      { debtor: 2, invoice: "RICH-2026-007", number: "0001239", bank: "بنك الإسكندرية", amount: 100_000n, issue: -50, due: -40, status: "cancelled" },
    ];
    for (const c of chqDefs) {
      await db.insert(cheques).values({
        id: uuidv7(), tenantId, debtorId: d[c.debtor]!, direction: "receivable", invoiceId: inv(c.invoice),
        number: c.number, bank: c.bank, amountMinor: c.amount,
        issueDate: iso(c.issue), dueDate: iso(c.due), status: c.status,
        paymentId: c.payment ? payId.get(c.payment)! : null,
      });
    }

    // ----------------------------------------------------------- promises (6)
    type Prm = { debtor: number; invoice?: string; amount: bigint; on: number; status: "pending" | "accepted" | "kept" | "broken" | "rejected" | "cancelled"; source?: "manual" | "customer_portal" | "ai"; fulfilled?: number };
    const prmDefs: Prm[] = [
      { debtor: 0, invoice: "RICH-2026-001", amount: 500_000n, on: 5, status: "pending" },
      { debtor: 1, invoice: "RICH-2026-005", amount: 200_000n, on: 10, status: "pending", source: "customer_portal" },
      { debtor: 4, invoice: "RICH-2026-015", amount: 300_000n, on: 3, status: "accepted" },
      { debtor: 8, invoice: "RICH-2026-025", amount: 410_000n, on: -3, status: "kept", fulfilled: -3 },
      { debtor: 2, invoice: "RICH-2026-008", amount: 1_000_000n, on: -10, status: "broken" },
      { debtor: 3, amount: 100_000n, on: 7, status: "rejected" },
    ];
    for (const p of prmDefs) {
      await db.insert(promisesToPay).values({
        id: uuidv7(), tenantId, debtorId: d[p.debtor]!, invoiceId: p.invoice ? inv(p.invoice) : null,
        amountMinor: p.amount, promisedOn: iso(p.on), status: p.status, source: p.source ?? "manual",
        note: null, fulfilledAt: p.fulfilled !== undefined ? ts(p.fulfilled) : null,
      });
    }

    // ----------------------------------------------------------- disputes (3)
    await db.insert(disputes).values([
      { id: uuidv7(), tenantId, debtorId: d[3]!, invoiceId: inv("RICH-2026-012"), raisedBy: "debtor", reason: "المبلغ غير صحيح — تم الاتفاق على خصم 10% ولم يُطبَّق", status: "open" },
      { id: uuidv7(), tenantId, debtorId: d[8]!, invoiceId: inv("RICH-2026-026"), raisedBy: "debtor", reason: "البضاعة وصلت تالفة — نطلب الاستبدال", status: "open" },
      { id: uuidv7(), tenantId, debtorId: d[9]!, invoiceId: inv("RICH-2026-027"), raisedBy: "merchant", reason: "اختلاف على تاريخ الاستحقاق", status: "resolved", resolution: "reopen_invoice" },
    ]);

    // ---------------------------------------------------------- reminders (14)
    type Rem = { invoice: string; step: string; channel: "whatsapp" | "sms"; template: string; due: number; status: "scheduled" | "queued" | "sent" | "skipped" | "cancelled" | "failed"; skip?: string; attempts?: number };
    const remDefs: Rem[] = [
      { invoice: "RICH-2026-001", step: "d+3", channel: "whatsapp", template: "invoice_overdue", due: -2, status: "sent" },
      { invoice: "RICH-2026-001", step: "d+7", channel: "whatsapp", template: "invoice_overdue", due: 2, status: "scheduled" },
      { invoice: "RICH-2026-004", step: "d+3", channel: "whatsapp", template: "invoice_overdue", due: -3, status: "sent" },
      { invoice: "RICH-2026-005", step: "d0", channel: "whatsapp", template: "invoice_due_today", due: -5, status: "sent" },
      { invoice: "RICH-2026-007", step: "d+14", channel: "whatsapp", template: "invoice_overdue", due: -1, status: "queued" },
      { invoice: "RICH-2026-010", step: "d-3", channel: "whatsapp", template: "invoice_upcoming", due: -1, status: "scheduled" },
      { invoice: "RICH-2026-013", step: "weekly", channel: "whatsapp", template: "invoice_overdue", due: -5, status: "sent" },
      { invoice: "RICH-2026-016", step: "d+7", channel: "whatsapp", template: "invoice_overdue", due: -4, status: "skipped", skip: "phone_invalid" },
      { invoice: "RICH-2026-019", step: "d0", channel: "whatsapp", template: "invoice_due_today", due: -6, status: "skipped", skip: "opted_out" },
      { invoice: "RICH-2026-021", step: "d+14", channel: "sms", template: "invoice_overdue", due: -6, status: "failed", attempts: 2 },
      { invoice: "RICH-2026-024", step: "d0", channel: "whatsapp", template: "invoice_due_today", due: -2, status: "scheduled" },
      { invoice: "RICH-2026-027", step: "d-3", channel: "whatsapp", template: "invoice_upcoming", due: 7, status: "scheduled" },
      { invoice: "RICH-2026-029", step: "d+7", channel: "whatsapp", template: "invoice_overdue", due: -10, status: "cancelled" },
      { invoice: "RICH-2026-031", step: "d-3", channel: "whatsapp", template: "invoice_upcoming", due: 42, status: "queued" },
    ];
    const invDebtor = new Map<string, number>(invDefs.map((x) => [x.ref, x.debtor]));
    for (const r of remDefs) {
      await db.insert(reminders).values({
        id: uuidv7(), tenantId, invoiceId: inv(r.invoice), debtorId: d[invDebtor.get(r.invoice)!]!,
        stepKey: r.step, channel: r.channel, templateKey: r.template, dueAt: ts(r.due),
        status: r.status, skipReason: r.skip ?? null, attempts: r.attempts ?? 0,
        idempotencyKey: `${inv(r.invoice)}:${r.step}:${r.channel}`,
      });
    }

    // ----------------------------------------------------------- messages (18)
    // Funnel (SQL path): sent = out sent/delivered/read (12), delivered =
    // out delivered/read (7), replied = distinct debtors with an inbound
    // reply who also got an outbound (5 — the opted-out debtor got an
    // inbound "إيقاف" but never an outbound, so it is excluded by design),
    // paidWithin7d = 4 paid invoices whose last reminder was 0-7 days
    // before the payment.
    type Msg = { dir: "out" | "in"; debtor: number; invoice?: string; status: "queued" | "sent" | "delivered" | "read" | "failed" | "received"; template?: string; body: string };
    const msgDefs: Msg[] = [
      { dir: "out", debtor: 0, invoice: "RICH-2026-001", status: "delivered", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-001 بمبلغ 8,500.00 ج.م مستحقة منذ 3 أيام. برجاء السداد أو التواصل معنا." },
      { dir: "out", debtor: 0, invoice: "RICH-2026-002", status: "read", template: "invoice_upcoming", body: "تذكير: فاتورة RICH-2026-002 بمبلغ 4,500.00 ج.م تستحق خلال 5 أيام." },
      { dir: "out", debtor: 1, invoice: "RICH-2026-004", status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-004 بمبلغ 3,200.00 ج.م مستحقة منذ 10 أيام." },
      { dir: "out", debtor: 1, invoice: "RICH-2026-005", status: "delivered", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-005 بمبلغ 6,000.00 ج.م — تم سداد 2,500.00 ج.م، والمتبقي 3,500.00 ج.م." },
      { dir: "out", debtor: 2, invoice: "RICH-2026-007", status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-007 بمبلغ 15,000.00 ج.م مستحقة منذ 40 يوماً." },
      { dir: "out", debtor: 2, invoice: "RICH-2026-008", status: "delivered", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-008 بمبلغ 22,000.00 ج.م مستحقة منذ 75 يوماً." },
      { dir: "out", debtor: 3, invoice: "RICH-2026-012", status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-012 بمبلغ 5,000.00 ج.م مستحقة منذ 15 يوماً." },
      { dir: "out", debtor: 4, invoice: "RICH-2026-015", status: "delivered", template: "invoice_due_today", body: "تذكير: فاتورة RICH-2026-015 بمبلغ 9,000.00 ج.م — المتبقي 5,500.00 ج.م بعد سداد جزئي." },
      { dir: "out", debtor: 7, invoice: "RICH-2026-021", status: "delivered", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-021 بمبلغ 18,000.00 ج.م مستحقة منذ 55 يوماً." },
      { dir: "out", debtor: 8, invoice: "RICH-2026-025", status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-025 بمبلغ 4,100.00 ج.م مستحقة منذ 18 يوماً." },
      { dir: "out", debtor: 9, invoice: "RICH-2026-027", status: "read", template: "invoice_upcoming", body: "تذكير: فاتورة RICH-2026-027 بمبلغ 3,400.00 ج.م تستحق خلال 10 أيام." },
      { dir: "out", debtor: 10, invoice: "RICH-2026-030", status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة RICH-2026-030 بمبلغ 7,200.00 ج.م — تم سداد 3,000.00 ج.م، والمتبقي 4,200.00 ج.م." },
      { dir: "in", debtor: 0, invoice: "RICH-2026-001", status: "received", body: "سأدفع يوم الخميس إن شاء الله" },
      { dir: "in", debtor: 1, invoice: "RICH-2026-005", status: "received", body: "تم التحويل اليوم" },
      { dir: "in", debtor: 3, invoice: "RICH-2026-012", status: "received", body: "المبلغ غير صحيح، تم الاتفاق على خصم" },
      { dir: "in", debtor: 6, status: "received", body: "إيقاف" },
      { dir: "in", debtor: 8, invoice: "RICH-2026-025", status: "received", body: "دفعت أمس عن طريق إنستاباي" },
      { dir: "in", debtor: 9, invoice: "RICH-2026-027", status: "received", body: "ممكن تفاصيل الفاتورة؟" },
    ];
    const msgIds: string[] = [];
    for (let i = 0; i < msgDefs.length; i++) {
      const m = msgDefs[i]!;
      const idv = uuidv7();
      msgIds.push(idv);
      await db.insert(messages).values({
        id: idv, tenantId, debtorId: d[m.debtor]!, invoiceId: m.invoice ? inv(m.invoice) : null,
        direction: m.dir, channel: "whatsapp", provider: "whatsapp",
        providerMessageId: `rich-wa-${m.dir}-${String(i + 1).padStart(3, "0")}`,
        templateKey: m.template ?? null, bodyText: m.body, status: m.status,
      });
    }
    // AI-inbox intents for 3 of the inbound replies (indexes: 12 = d1 promise,
    // 14 = d4 dispute, 15 = d7 opt-out).
    const intentDefs: { msg: number; intent: string; confidence: number; resolvedBy: string; action: string; extracted: Record<string, unknown> }[] = [
      { msg: 12, intent: "promise_to_pay", confidence: 0.92, resolvedBy: "auto", action: "replan_after_promise", extracted: { promised_date: iso(5), amount_minor: 500_000, model: "seed", promptVersion: "seed" } },
      { msg: 14, intent: "dispute", confidence: 0.88, resolvedBy: "human", action: "human_inbox", extracted: { promised_date: null, amount_minor: null, model: "seed", promptVersion: "seed" } },
      { msg: 15, intent: "opt_out", confidence: 0.99, resolvedBy: "auto", action: "opt_out", extracted: { promised_date: null, amount_minor: null, model: "seed", promptVersion: "seed" } },
    ];
    for (const it of intentDefs) {
      await db.insert(messageIntents).values({
        id: uuidv7(), tenantId, messageId: msgIds[it.msg]!, intent: it.intent,
        extracted: it.extracted as never, confidence: it.confidence,
        resolvedBy: it.resolvedBy, actionTaken: it.action,
      });
    }

    // -------------------------------------------------------------- tasks (5)
    type Tsk = { debtor?: number; invoice?: string; title: string; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "in_progress" | "done" | "cancelled"; due: number; done?: number };
    const taskDefs: Tsk[] = [
      { debtor: 2, invoice: "RICH-2026-008", title: "اتصال هاتفي لمتابعة فاتورة متأخرة 75 يوماً", priority: "high", status: "open", due: 2 },
      { debtor: 0, invoice: "RICH-2026-001", title: "زيارة العميل لتحصيل المستحق", priority: "normal", status: "in_progress", due: 1 },
      { debtor: 8, invoice: "RICH-2026-025", title: "تأكيد استلام التحويل", priority: "normal", status: "done", due: -3, done: -3 },
      { debtor: 7, invoice: "RICH-2026-021", title: "تصعيد: عميل متأخر 55 يوماً", priority: "urgent", status: "open", due: 0 },
      { debtor: 5, title: "مراجعة بيانات العميل", priority: "low", status: "cancelled", due: -5 },
    ];
    for (const t of taskDefs) {
      await db.insert(collectionTasks).values({
        id: uuidv7(), tenantId, debtorId: d[t.debtor ?? 0]!, invoiceId: t.invoice ? inv(t.invoice) : null,
        title: t.title, description: null, priority: t.priority, status: t.status,
        assignedToUserId: userId, dueAt: ts(t.due), createdBy: userId,
        completedAt: t.done !== undefined ? ts(t.done) : null,
      });
    }

    // ------------------------------------------- public statement link (d1)
    await db.insert(statementLinks).values({
      id: uuidv7(), tenantId, debtorId: d[0]!,
      tokenHash: createHash("sha256").update(RICH_STATEMENT_TOKEN, "utf8").digest("hex"),
      expiresAt: ts(30), createdBy: userId,
    });

    await db.insert(auditLog).values({
      tenantId, actorUserId: userId, action: "tenant.seeded", entity: "tenant", entityId: tenantId,
      after: { synthetic: true, note: "rich dataset seed" },
    });
    console.log(`seed-rich: tenant ${tenantId} seeded, login ${RICH_EMAIL}`);
    console.log("seed-rich: counts: debtors 12, invoices 32, payments 16, allocations 13, cheques 6, promises 6, disputes 3, reminders 14, messages 18, intents 3, tasks 5, statement links 1");
    console.log(`seed-rich: public statement: /s/${RICH_STATEMENT_TOKEN}`);
  }
} finally {
  await client.end();
}
