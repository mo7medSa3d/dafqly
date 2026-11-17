// Stress-test seed: SYNTHETIC demo data only (no real people, phones or
// amounts owed by anyone real). A THIRD tenant — it never touches the
// default demo tenant (demo@tahseel.test), the rich tenant
// (rich@tahseel.test), or their asserted totals.
//
// Login: stress@tahseel.test — password from STRESS_PASSWORD, else
// DEMO_PASSWORD, else a random one printed once.
// Public statement: /s/stress-statement-demo-2026 (fixed dev-only token).
//
// Coverage: 32 debtors (opted-out, risk-flagged, credit balances),
// 64 invoices across every status (open incl. overdue, partially_paid,
// paid, disputed, written_off, cancelled) in EGP/USD/SAR, cheques in
// every lifecycle state, tasks in every state incl. overdue, promises
// in every state, unread notifications, pending AI action approvals,
// inbound AI-inbox messages + intents, and scheduled reminders.
//
// Idempotent: safe to run repeatedly (a second run prints "already
// exists" and does nothing). RESET_STRESS_SEED=1 (or --reset) wipes the
// stress tenant and user first, then re-seeds. Dev/test only: refuses
// production unless ALLOW_PROD_SEED=1, same as the other seeds.
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
  notifications, aiActionApprovals,
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
export const STRESS_EMAIL = "stress@tahseel.test";
export const STRESS_PASSWORD = process.env.STRESS_PASSWORD ?? process.env.DEMO_PASSWORD ?? randomBytes(16).toString("hex");
if (!process.env.STRESS_PASSWORD && !process.env.DEMO_PASSWORD) {
  console.log(`seed-stress: no STRESS_PASSWORD/DEMO_PASSWORD — generated a random stress password (dev only): ${STRESS_PASSWORD}`);
}
export const STRESS_STATEMENT_TOKEN = "stress-statement-demo-2026";

const { db, client } = createDb(url);
const today = new Date();
const iso = (daysFromNow: number) => new Date(today.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
const ts = (daysFromNow: number, hour = 10) => {
  const d = new Date(today.getTime() + daysFromNow * 86_400_000);
  d.setUTCHours(hour, 15, 0, 0);
  return d;
};

const DEBTOR_NAMES = [
  "شركة النيل للتوريدات الغذائية", "مؤسسة الأمل للمقاولات", "شركة الفيروز للتجارة",
  "مكتب النور للاستشارات الهندسية", "شركة السلام للحديد والصلب", "مؤسسة الصفا للملابس",
  "شركة البركة للأسمدة", "شركة الماسة للإلكترونيات", "مؤسسة الفجر للمواد الغذائية",
  "شركة الوادي للنقل والشحن", "مكتب الإبداع للتصميم", "شركة النجمة للأدوات المنزلية",
  "شركة الأفق للتجارة العامة", "مؤسسة النخبة للأغذية", "شركة العدالة للمحاماة",
  "شركة النورس للشحن", "مؤسسة الزهراء للمفروشات", "شركة الدلتا للتجارة",
  "شركة المستقبل للبلاستيك", "مؤسسة الشروق للأدوات الصحية", "شركة القاهرة للكيماويات",
  "مكتب الحكمة للمحاسبة", "شركة البحر الأحمر للسياحة", "مؤسسة التوفيق للسيارات",
  "شركة الخليج للاستيراد والتصدير", "شركة الريان للدواجن", "مؤسسة الإخلاص للأخشاب",
  "شركة النخيل للتمور", "مكتب الأمانة للخدمات", "شركة الفجر الجديد للطاقة",
  "مؤسسة الهدى للسيراميك", "شركة العبور للصناعات الغذائية",
];

try {
  if (process.env.RESET_STRESS_SEED === "1" || process.argv.includes("--reset")) {
    const existingUsers = await db.select().from(user).where(eq(user.email, STRESS_EMAIL));
    for (const u of existingUsers) {
      const ms = await db.select().from(memberships).where(eq(memberships.userId, u.id));
      for (const m of ms) await db.delete(tenants).where(eq(tenants.id, m.tenantId));
      await db.delete(user).where(eq(user.id, u.id));
    }
    console.log("seed-stress: previous stress tenant wiped (RESET_STRESS_SEED=1)");
  }

  const existing = await db.select().from(user).where(eq(user.email, STRESS_EMAIL));
  if (existing.length > 0) {
    console.log("seed-stress: stress user already exists, nothing to do");
  } else {
    const tenantId = uuidv7();
    const userId = randomUUID().replace(/-/g, "");
    const settings: TenantSettings = {
      quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false,
      autoCloseEnabled: false, defaultChannel: "whatsapp", tone: "polite",
      defaultTermsDays: 14, easternDigits: false, currency: "EGP",
      businessNameEn: "Stress Test Trading Co.",
    };
    await db.insert(tenants).values({
      id: tenantId, name: "شركة اختبار الضغط للتجارة", businessNameAr: "شركة اختبار الضغط للتجارة",
      timezone: "Africa/Cairo", plan: "trial", trialEndsAt: new Date(Date.now() + 14 * 86_400_000), settings,
    });
    await db.insert(user).values({ id: userId, name: "مدير الحسابات", email: STRESS_EMAIL, emailVerified: true });
    await db.insert(account).values({
      id: randomUUID().replace(/-/g, ""), userId, accountId: userId, providerId: "credential",
      password: await argon2Hash(STRESS_PASSWORD, { type: argon2id }),
    });
    await db.insert(memberships).values({ tenantId, userId, role: "owner" });

    // ------------------------------------------------------------ debtors (32)
    // optedOut: #3, #13, #23. riskFlag: #5, #15, #25, #29.
    // Credit balances (consistent by construction — see payments below):
    // #30 EGP 25_000 overpayment, #31 USD 10_000 overpayment.
    const d: string[] = [];
    for (let i = 0; i < 32; i++) {
      const phone = `+2010${(10000000 + i * 7919).toString().padStart(8, "0")}`;
      const idv = uuidv7();
      d.push(idv);
      await db.insert(debtors).values({
        id: idv, tenantId, displayName: DEBTOR_NAMES[i]!, phoneE164: phone, phoneHash: phoneHash(phone),
        whatsappStatus: i % 5 === 4 ? "unreachable" : i % 3 === 0 ? "unknown" : "reachable",
        riskFlag: [5, 15, 25, 29].includes(i),
        optedOutAt: [3, 13, 23].includes(i) ? ts(-5) : null,
        notes: [5, 15, 25, 29].includes(i) ? "عميل عالي المخاطر — متابعة أسبوعية" : null,
        creditMinor: i === 30 ? 25_000n : i === 31 ? 10_000n : 0n,
        creditCurrency: i === 31 ? "USD" : "EGP",
      });
    }

    // ----------------------------------------------------------- invoices (64)
    // Statuses: open 22 (12 of them overdue), partially_paid 10 (4 overdue),
    // paid 14, disputed 6, written_off 6, cancelled 6. Currencies: EGP
    // mostly, every 9th USD, every 13th SAR.
    type InvStatus = "open" | "partially_paid" | "paid" | "disputed" | "written_off" | "cancelled";
    const statusPlan: InvStatus[] = [
      ...Array<InvStatus>(22).fill("open"),
      ...Array<InvStatus>(10).fill("partially_paid"),
      ...Array<InvStatus>(14).fill("paid"),
      ...Array<InvStatus>(6).fill("disputed"),
      ...Array<InvStatus>(6).fill("written_off"),
      ...Array<InvStatus>(6).fill("cancelled"),
    ];
    const invIds: string[] = [];
    const invStatus: InvStatus[] = [];
    const invDebtor: number[] = [];
    const invCurrency: string[] = [];
    for (let i = 0; i < 64; i++) {
      const status = statusPlan[i]!;
      const debtorIdx = i % 32;
      const currency = i % 9 === 8 ? "USD" : i % 13 === 12 ? "SAR" : "EGP";
      const amount = BigInt(75_000 + ((i * 137_000) % 1_900_000));
      // Aging: open/partially_paid spread across current, 0-7d, 8-30d,
      // 31-60d, 60+d overdue; closed statuses mostly old.
      const due = status === "open" || status === "partially_paid"
        ? [-45, -30, -12, -5, -2, 2, 5, 10, 21, 35][i % 10]!
        : [-90, -60, -40, -25, -15, -8][i % 6]!;
      const paid = status === "paid" ? amount : status === "partially_paid" ? amount / 2n : 0n;
      const ref = `STR-2026-${String(i + 1).padStart(3, "0")}`;
      const idv = uuidv7();
      invIds.push(idv); invStatus.push(status);
      invDebtor.push(debtorIdx); invCurrency.push(currency);
      await db.insert(invoices).values({
        id: idv, tenantId, debtorId: d[debtorIdx]!, reference: ref,
        description: "توريد بضاعة وخامات — بيانات اختبار ضغط",
        amountMinor: amount, currency, issuedOn: iso(due - 25), dueOn: iso(due),
        status, paidMinor: paid, source: "manual",
      });
    }
    const inv = (idx: number) => invIds[idx]!;

    // ------------------------------------------------------- payments + credit
    // One confirmed payment + allocation per paid / partially_paid invoice.
    // Overpayments (unallocated confirmed payments) create the two credit
    // balances above: debtor #30 +25_000 EGP, debtor #31 +10_000 USD.
    let payN = 0;
    const addPayment = async (debtorIdx: number, invoiceIdx: number, amount: bigint, status: "claimed" | "confirmed" | "rejected", method: "cash" | "instapay" | "bank" | "wallet" | "cheque" | "gateway" | "other", received: number, allocate: boolean, reversalOf?: string) => {
      const idv = uuidv7();
      payN++;
      await db.insert(payments).values({
        id: idv, tenantId, debtorId: d[debtorIdx]!, invoiceId: inv(invoiceIdx),
        amountMinor: amount, currency: invCurrency[invoiceIdx]!, idempotencyKey: `stress-pay-${payN}`,
        method, receivedOn: iso(received), status, source: "manual",
        reversalOf: reversalOf ?? null,
      });
      if (allocate && status === "confirmed") {
        await db.insert(paymentAllocations).values({
          id: uuidv7(), tenantId, paymentId: idv, invoiceId: inv(invoiceIdx), amountMinor: amount,
        });
      }
      return idv;
    };
    for (let i = 0; i < 64; i++) {
      if (invStatus[i] === "paid" || invStatus[i] === "partially_paid") {
        const amount = invStatus[i] === "paid"
          ? BigInt(75_000 + ((i * 137_000) % 1_900_000))
          : BigInt(75_000 + ((i * 137_000) % 1_900_000)) / 2n;
        await addPayment(invDebtor[i]!, i, amount, "confirmed", ["cash", "instapay", "bank", "wallet"][i % 4] as never, -3, true);
      }
    }
    // Overpayments: pick debtor #30's first paid invoice (index 30 is paid?
    // index 30 -> statusPlan[30] is "partially_paid"; use its paid part plus
    // an extra unallocated payment) and debtor #31's paid invoice.
    const paidIdx30 = invStatus.findIndex((s, i) => s === "paid" && invDebtor[i] === 30);
    const paidIdx31 = invStatus.findIndex((s, i) => s === "paid" && invDebtor[i] === 31 && invCurrency[i] === "USD");
    const overpay30 = paidIdx30 >= 0 ? paidIdx30 : 30;
    const overpay31 = paidIdx31 >= 0 ? paidIdx31 : 31;
    await addPayment(30, overpay30, 25_000n, "confirmed", "instapay", -1, false);
    await addPayment(31, overpay31, 10_000n, "confirmed", "bank", -1, false);
    // One claimed + one rejected payment for inbox realism.
    await addPayment(0, 0, 50_000n, "claimed", "cash", -1, false);
    await addPayment(2, 2, 40_000n, "rejected", "cash", -2, false);

    // ------------------------------------------------------------ cheques (8)
    // held x3, deposited, cleared, bounced, returned, cancelled.
    // deposited -> claimed cheque payment; cleared -> confirmed + allocation;
    // bounced -> confirmed + full reversal (mirrors the rich seed).
    const chequePayClaimed = await addPayment(4, 4, 150_000n, "claimed", "cheque", -1, false);
    const chequePayCleared = await addPayment(7, 7, 200_000n, "confirmed", "cheque", -5, true);
    const chequePayBounced = await addPayment(5, 5, 300_000n, "confirmed", "cheque", -10, true);
    await db.insert(payments).values({
      id: uuidv7(), tenantId, debtorId: d[5]!, invoiceId: inv(5),
      amountMinor: -300_000n, currency: invCurrency[5]!, idempotencyKey: "stress-pay-bounce-reversal",
      method: "cheque", receivedOn: iso(-9), status: "confirmed", source: "manual",
      reversalOf: chequePayBounced,
    });
    type Chq = { debtor: number; invoice: number; number: string; bank: string; amount: bigint; issue: number; due: number; status: "held" | "deposited" | "cleared" | "bounced" | "returned" | "cancelled"; payment?: string };
    const chqDefs: Chq[] = [
      { debtor: 1, invoice: 1, number: "0099001", bank: "البنك الأهلي المصري", amount: 320_000n, issue: -30, due: -10, status: "held" },
      { debtor: 4, invoice: 4, number: "0099002", bank: "بنك مصر", amount: 150_000n, issue: -20, due: 5, status: "deposited", payment: chequePayClaimed },
      { debtor: 7, invoice: 7, number: "0099003", bank: "البنك التجاري الدولي", amount: 200_000n, issue: -35, due: -5, status: "cleared", payment: chequePayCleared },
      { debtor: 5, invoice: 5, number: "0099004", bank: "بنك القاهرة", amount: 300_000n, issue: -40, due: -10, status: "bounced", payment: chequePayBounced },
      { debtor: 8, invoice: 8, number: "0099005", bank: "البنك الأهلي المصري", amount: 88_000n, issue: -22, due: -2, status: "returned" },
      { debtor: 2, invoice: 2, number: "0099006", bank: "بنك الإسكندرية", amount: 100_000n, issue: -50, due: -40, status: "cancelled" },
      { debtor: 9, invoice: 9, number: "0099007", bank: "بنك مصر", amount: 210_000n, issue: -12, due: 8, status: "held" },
      { debtor: 10, invoice: 10, number: "0099008", bank: "البنك التجاري الدولي", amount: 470_000n, issue: -15, due: 12, status: "held" },
    ];
    for (const c of chqDefs) {
      await db.insert(cheques).values({
        id: uuidv7(), tenantId, debtorId: d[c.debtor]!, direction: "receivable", invoiceId: inv(c.invoice),
        number: c.number, bank: c.bank, amountMinor: c.amount,
        issueDate: iso(c.issue), dueDate: iso(c.due), status: c.status,
        paymentId: c.payment ?? null,
      });
    }

    // ----------------------------------------------------------- promises (8)
    type Prm = { debtor: number; invoice?: number; amount: bigint; on: number; status: "pending" | "accepted" | "kept" | "broken" | "rejected" | "cancelled"; source?: "manual" | "customer_portal" | "ai"; fulfilled?: number };
    const prmDefs: Prm[] = [
      { debtor: 0, invoice: 0, amount: 500_000n, on: 5, status: "pending" },
      { debtor: 1, invoice: 1, amount: 200_000n, on: 10, status: "pending", source: "customer_portal" },
      { debtor: 4, invoice: 4, amount: 300_000n, on: 3, status: "accepted" },
      { debtor: 7, invoice: 7, amount: 250_000n, on: 6, status: "accepted", source: "ai" },
      { debtor: 8, invoice: 8, amount: 410_000n, on: -3, status: "kept", fulfilled: -3 },
      { debtor: 2, invoice: 2, amount: 1_000_000n, on: -10, status: "broken" },
      { debtor: 3, amount: 100_000n, on: 7, status: "rejected" },
      { debtor: 6, invoice: 6, amount: 150_000n, on: -4, status: "cancelled" },
    ];
    for (const p of prmDefs) {
      await db.insert(promisesToPay).values({
        id: uuidv7(), tenantId, debtorId: d[p.debtor]!, invoiceId: p.invoice !== undefined ? inv(p.invoice) : null,
        amountMinor: p.amount, promisedOn: iso(p.on), status: p.status, source: p.source ?? "manual",
        note: null, fulfilledAt: p.fulfilled !== undefined ? ts(p.fulfilled) : null,
      });
    }

    // ----------------------------------------------------------- disputes (4)
    const disputedIdx = invStatus.map((s, i) => (s === "disputed" ? i : -1)).filter((i) => i >= 0);
    await db.insert(disputes).values([
      { id: uuidv7(), tenantId, debtorId: d[invDebtor[disputedIdx[0]!]!]!, invoiceId: inv(disputedIdx[0]!), raisedBy: "debtor", reason: "المبلغ غير صحيح — تم الاتفاق على خصم ولم يُطبَّق", status: "open" },
      { id: uuidv7(), tenantId, debtorId: d[invDebtor[disputedIdx[1]!]!]!, invoiceId: inv(disputedIdx[1]!), raisedBy: "debtor", reason: "البضاعة وصلت تالفة — نطلب الاستبدال", status: "open" },
      { id: uuidv7(), tenantId, debtorId: d[invDebtor[disputedIdx[2]!]!]!, invoiceId: inv(disputedIdx[2]!), raisedBy: "merchant", reason: "اختلاف على تاريخ الاستحقاق", status: "open" },
      { id: uuidv7(), tenantId, debtorId: d[invDebtor[disputedIdx[3]!]!]!, invoiceId: inv(disputedIdx[3]!), raisedBy: "debtor", reason: "تم الاتفاق على التسوية", status: "resolved", resolution: "reopen_invoice" },
    ]);

    // ---------------------------------------------------------- reminders (15)
    // Scheduled steps for open invoices (due -2..+5d), plus 2 sent, 1 queued.
    const openIdx = invStatus.map((s, i) => (s === "open" || s === "partially_paid" ? i : -1)).filter((i) => i >= 0).slice(0, 12);
    const remSteps: { step: string; template: string; due: number; status: "scheduled" | "queued" | "sent" }[] = [
      { step: "d-3", template: "invoice_upcoming", due: -2, status: "scheduled" },
      { step: "d0", template: "invoice_due_today", due: 0, status: "scheduled" },
      { step: "d+3", template: "invoice_overdue", due: 2, status: "scheduled" },
      { step: "d+7", template: "invoice_overdue", due: 5, status: "scheduled" },
      { step: "d-3", template: "invoice_upcoming", due: -1, status: "scheduled" },
      { step: "d0", template: "invoice_due_today", due: 1, status: "scheduled" },
      { step: "d+3", template: "invoice_overdue", due: 3, status: "scheduled" },
      { step: "d+7", template: "invoice_overdue", due: 4, status: "scheduled" },
      { step: "d-3", template: "invoice_upcoming", due: -2, status: "scheduled" },
      { step: "d0", template: "invoice_due_today", due: 0, status: "scheduled" },
      { step: "d+3", template: "invoice_overdue", due: 2, status: "scheduled" },
      { step: "d+7", template: "invoice_overdue", due: 5, status: "scheduled" },
      { step: "d+3", template: "invoice_overdue", due: -3, status: "sent" },
      { step: "d+7", template: "invoice_overdue", due: -1, status: "sent" },
      { step: "d0", template: "invoice_due_today", due: 0, status: "queued" },
    ];
    for (let i = 0; i < remSteps.length; i++) {
      const r = remSteps[i]!;
      const idx = openIdx[i % openIdx.length]!;
      await db.insert(reminders).values({
        id: uuidv7(), tenantId, invoiceId: inv(idx), debtorId: d[invDebtor[idx]!]!,
        stepKey: r.step, channel: "whatsapp", templateKey: r.template, dueAt: ts(r.due),
        status: r.status, skipReason: null, attempts: 0,
        idempotencyKey: `${inv(idx)}:${r.step}:whatsapp:stress-${i}`,
      });
    }

    // ----------------------------------------------------- messages + intents
    const msgIds: string[] = [];
    const msgDefs: { dir: "out" | "in"; debtor: number; invoice?: number; status: "queued" | "sent" | "delivered" | "read" | "failed" | "received"; template?: string; body: string }[] = [
      { dir: "out", debtor: 0, invoice: 0, status: "delivered", template: "invoice_overdue", body: "تذكير: فاتورة STR-2026-001 مستحقة منذ 3 أيام. برجاء السداد أو التواصل معنا." },
      { dir: "out", debtor: 1, invoice: 1, status: "read", template: "invoice_upcoming", body: "تذكير: فاتورة STR-2026-002 تستحق خلال 5 أيام." },
      { dir: "out", debtor: 2, invoice: 2, status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة STR-2026-003 مستحقة منذ 10 أيام." },
      { dir: "out", debtor: 4, invoice: 4, status: "delivered", template: "invoice_overdue", body: "تذكير: فاتورة STR-2026-005 — تم سداد جزء، والمتبقي مستحق." },
      { dir: "out", debtor: 7, invoice: 7, status: "sent", template: "invoice_overdue", body: "تذكير: فاتورة STR-2026-008 مستحقة منذ 55 يوماً." },
      { dir: "out", debtor: 8, invoice: 8, status: "failed", template: "invoice_overdue", body: "تذكير: فاتورة STR-2026-009 مستحقة." },
      { dir: "in", debtor: 0, invoice: 0, status: "received", body: "سأدفع يوم الخميس إن شاء الله" },
      { dir: "in", debtor: 1, invoice: 1, status: "received", body: "تم التحويل اليوم" },
      { dir: "in", debtor: 3, invoice: 3, status: "received", body: "المبلغ غير صحيح، تم الاتفاق على خصم" },
      { dir: "in", debtor: 3, status: "received", body: "إيقاف" },
      { dir: "in", debtor: 8, invoice: 8, status: "received", body: "دفعت أمس عن طريق إنستاباي" },
    ];
    for (let i = 0; i < msgDefs.length; i++) {
      const m = msgDefs[i]!;
      const idv = uuidv7();
      msgIds.push(idv);
      await db.insert(messages).values({
        id: idv, tenantId, debtorId: d[m.debtor]!, invoiceId: m.invoice !== undefined ? inv(m.invoice) : null,
        direction: m.dir, channel: "whatsapp", provider: "whatsapp",
        providerMessageId: `stress-wa-${m.dir}-${String(i + 1).padStart(3, "0")}`,
        templateKey: m.template ?? null, bodyText: m.body, status: m.status,
      });
    }
    const intentDefs: { msg: number; intent: string; confidence: number; resolvedBy: string; action: string }[] = [
      { msg: 6, intent: "promise_to_pay", confidence: 0.92, resolvedBy: "auto", action: "replan_after_promise" },
      { msg: 8, intent: "dispute", confidence: 0.88, resolvedBy: "human", action: "human_inbox" },
      { msg: 9, intent: "opt_out", confidence: 0.99, resolvedBy: "auto", action: "opt_out" },
    ];
    for (const it of intentDefs) {
      await db.insert(messageIntents).values({
        id: uuidv7(), tenantId, messageId: msgIds[it.msg]!, intent: it.intent,
        extracted: { promised_date: null, amount_minor: null, model: "seed", promptVersion: "seed" } as never,
        confidence: it.confidence, resolvedBy: it.resolvedBy, actionTaken: it.action,
      });
    }

    // -------------------------------------------------------------- tasks (12)
    type Tsk = { debtor: number; invoice?: number; title: string; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "in_progress" | "done" | "cancelled"; due: number; done?: number; assignee?: boolean };
    const taskDefs: Tsk[] = [
      { debtor: 2, invoice: 2, title: "اتصال هاتفي لمتابعة فاتورة متأخرة 75 يوماً", priority: "high", status: "open", due: 2, assignee: true },
      { debtor: 0, invoice: 0, title: "زيارة العميل لتحصيل المستحق", priority: "normal", status: "in_progress", due: 1, assignee: true },
      { debtor: 8, invoice: 8, title: "تأكيد استلام التحويل", priority: "normal", status: "done", due: -3, done: -3, assignee: true },
      { debtor: 7, invoice: 7, title: "تصعيد: عميل متأخر 55 يوماً", priority: "urgent", status: "open", due: 0, assignee: true },
      { debtor: 5, title: "مراجعة بيانات العميل", priority: "low", status: "cancelled", due: -5 },
      { debtor: 1, invoice: 1, title: "متابعة وعد الدفع", priority: "high", status: "open", due: -2, assignee: true },
      { debtor: 3, invoice: 3, title: "إرسال كشف حساب محدث", priority: "normal", status: "in_progress", due: -1, assignee: true },
      { debtor: 4, invoice: 4, title: "مكالمة تأكيد موعد السداد", priority: "normal", status: "open", due: -4 },
      { debtor: 9, invoice: 9, title: "مراجعة الشيك المرتجع", priority: "urgent", status: "in_progress", due: -3, assignee: true },
      { debtor: 10, invoice: 10, title: "أرشفة فاتورة مسددة", priority: "low", status: "done", due: -6, done: -6 },
      { debtor: 11, invoice: 11, title: "تحديث بيانات التواصل", priority: "low", status: "done", due: -2, done: -2 },
      { debtor: 12, title: "مهمة ملغاة — عميل أغلق النشاط", priority: "normal", status: "cancelled", due: -7 },
    ];
    for (const t of taskDefs) {
      await db.insert(collectionTasks).values({
        id: uuidv7(), tenantId, debtorId: d[t.debtor]!, invoiceId: t.invoice !== undefined ? inv(t.invoice) : null,
        title: t.title, description: null, priority: t.priority, status: t.status,
        assignedToUserId: t.assignee ? userId : null, dueAt: ts(t.due), createdBy: userId,
        completedAt: t.done !== undefined ? ts(t.done) : null,
      });
    }

    // -------------------------------------------------------- notifications (8)
    for (let i = 0; i < 8; i++) {
      const kinds = ["dispute_opened", "cheque_bounced", "promise_broken", "payment_received", "reminder_failed", "invoice_overdue", "task_overdue", "ai_approval_pending"];
      const titles: [string, string][] = [
        ["نزاع جديد على فاتورة", "New dispute on an invoice"],
        ["شيك مرتجع", "Cheque bounced"],
        ["وعد دفع لم يُنفَّذ", "Promise to pay broken"],
        ["تم استلام دفعة", "Payment received"],
        ["فشل إرسال تذكير", "Reminder failed to send"],
        ["فاتورة تجاوزت موعد الاستحقاق", "Invoice past due"],
        ["مهمة متأخرة", "Task overdue"],
        ["إجراء ذكاء اصطناعي بانتظار الموافقة", "AI action awaiting approval"],
      ];
      await db.insert(notifications).values({
        id: uuidv7(), tenantId, kind: kinds[i]!, severity: i % 3 === 0 ? "warning" : "info",
        titleAr: titles[i]![0], titleEn: titles[i]![1],
        bodyAr: "تنبيه اختبار ضغط — بيانات اصطناعية", bodyEn: "Stress-test alert — synthetic data",
        actionUrl: i === 0 ? "/ar/tasks" : i === 1 ? "/ar/cheques" : "/ar/dashboard",
        entityType: i === 0 ? "dispute" : i === 1 ? "cheque" : null, entityId: null,
        dedupeKey: `stress-notif-${i}`,
        readAt: i < 6 ? null : ts(-1),
      });
    }

    // --------------------------------------------------- AI action approvals (5)
    const approvalDefs: { type: "create_collection_task" | "schedule_reminder"; status: "pending" | "approved" | "rejected" | "executed" | "failed"; title: string; rationale: string; debtor: number; invoice?: number }[] = [
      { type: "create_collection_task", status: "pending", title: "مهمة متابعة للعميل المتأخر 75 يوماً", rationale: "العميل تجاوز 60 يوماً دون سداد؛ يقترح الذكاء الاصطناعي مهمة اتصال عاجلة.", debtor: 2, invoice: 2 },
      { type: "schedule_reminder", status: "pending", title: "تذكير إضافي قبل موعد الاستحقاق", rationale: "الفاتورة كبيرة؛ تذكير إضافي قبل 3 أيام يرفع احتمال السداد.", debtor: 0, invoice: 0 },
      { type: "create_collection_task", status: "pending", title: "زيارة ميدانية للعميل عالي المخاطر", rationale: "عميل موسوم عالي المخاطر مع رصيد مستحق كبير.", debtor: 5, invoice: 5 },
      { type: "schedule_reminder", status: "approved", title: "تذكير أسبوعي للفاتورة المتأخرة", rationale: "تمت الموافقة على الجدولة الأسبوعية.", debtor: 7, invoice: 7 },
      { type: "create_collection_task", status: "rejected", title: "تصعيد قانوني مبكر", rationale: "رُفض: التصعيد القانوني سابق لأوانه لهذا العميل.", debtor: 3, invoice: 3 },
    ];
    for (const a of approvalDefs) {
      await db.insert(aiActionApprovals).values({
        id: uuidv7(), tenantId, requestedBy: userId, actionType: a.type, status: a.status,
        title: a.title, rationale: a.rationale,
        payload: { debtorId: d[a.debtor]!, invoiceId: a.invoice !== undefined ? inv(a.invoice) : null } as never,
        approvedBy: a.status === "approved" ? userId : null,
        approvedAt: a.status === "approved" ? ts(-1) : null,
      });
    }

    // ------------------------------------------- public statement link (d0)
    await db.insert(statementLinks).values({
      id: uuidv7(), tenantId, debtorId: d[0]!,
      tokenHash: createHash("sha256").update(STRESS_STATEMENT_TOKEN, "utf8").digest("hex"),
      expiresAt: ts(30), createdBy: userId,
    });

    await db.insert(auditLog).values({
      tenantId, actorUserId: userId, action: "tenant.seeded", entity: "tenant", entityId: tenantId,
      after: { synthetic: true, note: "stress dataset seed" },
    });
    console.log(`seed-stress: tenant ${tenantId} seeded, login ${STRESS_EMAIL}`);
    console.log("seed-stress: counts: debtors 32, invoices 64, cheques 8, promises 8, disputes 4, reminders 15, messages 11, intents 3, tasks 12, notifications 8, ai approvals 5, statement links 1");
    console.log(`seed-stress: public statement: /s/${STRESS_STATEMENT_TOKEN}`);
  }
} finally {
  await client.end();
}
