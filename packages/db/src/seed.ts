// Seed: SYNTHETIC demo data only (no real people, phones or amounts owed by
// anyone real). Demo login: demo@tahseel.test / demo-password-123 — dev only,
// documented in RUNBOOK.md. Idempotent: safe to run repeatedly.
import "./load-env";
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
// Password hashing MUST match the web auth config (argon2id, BUILD_PLAN §3):
// the seed writes credential rows directly, so it hashes exactly like
// apps/web/src/server/auth.ts does. (better-auth/crypto would produce the
// library default scrypt hash, which argon2 verify would reject.)
import { hash as argon2Hash, argon2id } from "argon2";
import { v7 as uuidv7 } from "uuid";
import { createDb } from "./client";
import { tenants, user, account, memberships, debtors, invoices, auditLog, type TenantSettings } from "./schema";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
const pepper = process.env.PHONE_HASH_PEPPER ?? "";
if (pepper.length < 32) { console.error("PHONE_HASH_PEPPER must be set (>=32 chars) to seed phone hashes"); process.exit(1); }

const phoneHash = (e164: string) => createHmac("sha256", pepper).update(e164).digest("hex");
export const DEMO_EMAIL = "demo@tahseel.test";
export const DEMO_PASSWORD = "demo-password-123";

const { db, client } = createDb(url);
try {
  if (process.env.RESET_SEED === "1" || process.argv.includes("--reset")) {
    const existingUsers = await db.select().from(user).where(eq(user.email, DEMO_EMAIL));
    for (const u of existingUsers) {
      const ms = await db.select().from(memberships).where(eq(memberships.userId, u.id));
      for (const m of ms) {
        await db.delete(tenants).where(eq(tenants.id, m.tenantId));
      }
      await db.delete(user).where(eq(user.id, u.id));
    }
  }

  const existing = await db.select().from(user).where(eq(user.email, DEMO_EMAIL));
  if (existing.length > 0) {
    console.log("seed: demo user already exists, nothing to do");
  } else {
    const tenantId = uuidv7();
    const userId = randomUUID().replace(/-/g, "");
    const settings: TenantSettings = {
      quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false,
      autoCloseEnabled: false, defaultChannel: "whatsapp", tone: "polite",
      defaultTermsDays: 14, easternDigits: false,
    };
    await db.insert(tenants).values({
      id: tenantId, name: "Nile Trading", businessNameAr: "شركة النيل للتجارة والتوريدات",
      timezone: "Africa/Cairo", plan: "trial", trialEndsAt: new Date(Date.now() + 14 * 86_400_000), settings,
    });
    await db.insert(user).values({ id: userId, name: "Demo Owner", email: DEMO_EMAIL, emailVerified: true });
    await db.insert(account).values({
      id: randomUUID().replace(/-/g, ""), userId, accountId: userId, providerId: "credential",
      password: await argon2Hash(DEMO_PASSWORD, { type: argon2id }),
    });
    await db.insert(memberships).values({ tenantId, userId, role: "owner" });

    const demoDebtors = [
      { displayName: "مؤسسة الأمل للتوريدات", phoneE164: "+201001111111" },
      { displayName: "شركة الفيروز للمقاولات", phoneE164: "+201002222222" },
      { displayName: "مكتب النور للاستشارات", phoneE164: "+201003333333" },
    ];
    const debtorIds: string[] = [];
    for (const d of demoDebtors) {
      const idv = uuidv7();
      debtorIds.push(idv);
      await db.insert(debtors).values({ id: idv, tenantId, displayName: d.displayName, phoneE164: d.phoneE164, phoneHash: phoneHash(d.phoneE164) });
    }
    const today = new Date();
    const iso = (daysFromNow: number) => new Date(today.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
    await db.insert(invoices).values([
      { tenantId, debtorId: debtorIds[0]!, reference: "INV-DEMO-1", description: "توريد بضاعة وخامات", amountMinor: 125_050n, issuedOn: iso(-20), dueOn: iso(-5), status: "open", source: "manual" },
      { tenantId, debtorId: debtorIds[1]!, reference: "INV-DEMO-2", description: "دفعة أعمال وتجهيزات", amountMinor: 500_000n, issuedOn: iso(-10), dueOn: iso(3), status: "partially_paid", paidMinor: 200_000n, source: "manual" },
      { tenantId, debtorId: debtorIds[2]!, reference: "INV-DEMO-3", description: "صيانة دورية وقطع غيار", amountMinor: 75_000n, issuedOn: iso(-40), dueOn: iso(-30), status: "paid", paidMinor: 75_000n, source: "manual" },
    ]);
    await db.insert(auditLog).values({
      tenantId, actorUserId: userId, action: "tenant.seeded", entity: "tenant", entityId: tenantId,
      after: { synthetic: true, note: "demo seed data" },
    });
    console.log(`seed: demo tenant ${tenantId} created (SYNTHETIC data), login ${DEMO_EMAIL}`);
  }
} finally {
  await client.end();
}
