import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant, type Db } from "@tahseel/db";
import {
  debtors, invoices, cheques, payments, promisesToPay,
  collectionTasks, notifications, auditLog,
} from "@tahseel/db/schema";
import { hashPhone } from "./services";

export async function seedComprehensiveTestData(app: Db, tenantId: string, actorUserId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const today = new Date();
    const iso = (daysOffset: number) =>
      new Date(today.getTime() + daysOffset * 86_400_000).toISOString().slice(0, 10);

    const demoDebtors = [
      { name: "شركة الأهرام للتوريدات الهندسية", phone: "+201019911111", notes: "عميل صناعي كبير - توريدات مصانع العاشر من رمضان" },
      { name: "مجموعة الدلتا للصناعات الغذائية", phone: "+201019922222", notes: "فرع طنطا والمنصورة - سداد دوري منتظم" },
      { name: "شركة الإسكندرية للشحن واللوجستيات", phone: "+201019933333", notes: "خدمات نولون وتخليص جمركي بميناء الدخيلة" },
      { name: "مؤسسة النيل للتجهيزات الطبية", phone: "+201019944444", notes: "توريدات مستشفيات ومراكز أشعة - القاهرة" },
      { name: "شركة الفيروز للمقاولات العامة", phone: "+201019955555", notes: "مشروعات العاصمة الإدارية والتجمع الخامس" },
      { name: "مكتب الأمل للاستشارات والتصميم", phone: "+201019966666", notes: "استشارات معمارية وتراخيص بناء - المعادي" },
      { name: "شركة الصفا للتجارة والتوزيع", phone: "+201019977777", notes: "شبكة توزيع تجزئة وسوبر ماركت - الجيزة" },
      { name: "الرواد لحلول تقنية المعلومات", phone: "+201019988888", notes: "تطوير برمجيات وسيرفرات سحابية - القرية الذكية" },
    ];

    const insertedDebtorIds: string[] = [];

    for (const d of demoDebtors) {
      const [existing] = await tx
        .select()
        .from(debtors)
        .where(and(eq(debtors.phoneE164, d.phone), isNull(debtors.deletedAt)));

      if (existing) {
        insertedDebtorIds.push(existing.id);
      } else {
        const id = uuidv7();
        await tx.insert(debtors).values({
          id,
          tenantId,
          displayName: d.name,
          phoneE164: d.phone,
          phoneValid: true,
          whatsappStatus: "reachable",
          notes: d.notes,
          phoneHash: hashPhone(d.phone),
        });
        insertedDebtorIds.push(id);
      }
    }

    const [d0, d1, d2, d3, d4, d5, d6, d7] = insertedDebtorIds;

    // Rich Invoices across all statuses and aging categories
    const demoInvoices = [
      // 1. Overdue > 60 days
      {
        debtorId: d0!,
        reference: "INV-2026-101",
        description: "توريد معدات هيدروليكية ومحركات خط الإنتاج",
        amountMinor: 4_500_000n, // 45,000.00 EGP
        paidMinor: 0n,
        issuedOn: iso(-75),
        dueOn: iso(-62),
        status: "open" as const,
      },
      // 2. Overdue 31-60 days
      {
        debtorId: d1!,
        reference: "INV-2026-102",
        description: "شحنة مركزات وزيوت غذائية خام",
        amountMinor: 2_850_000n, // 28,500.00 EGP
        paidMinor: 0n,
        issuedOn: iso(-45),
        dueOn: iso(-35),
        status: "open" as const,
      },
      // 3. Overdue 8-30 days
      {
        debtorId: d2!,
        reference: "INV-2026-103",
        description: "نولون بحري ونقل بري للحاويات الجافة",
        amountMinor: 1_420_000n, // 14,200.00 EGP
        paidMinor: 0n,
        issuedOn: iso(-25),
        dueOn: iso(-12),
        status: "open" as const,
      },
      // 4. Overdue 1-7 days
      {
        debtorId: d3!,
        reference: "INV-2026-104",
        description: "مستلزمات تعقيم وأجهزة قياس حيوية",
        amountMinor: 890_000n, // 8,900.00 EGP
        paidMinor: 0n,
        issuedOn: iso(-14),
        dueOn: iso(-3),
        status: "open" as const,
      },
      // 5. Due Today / Current
      {
        debtorId: d4!,
        reference: "INV-2026-105",
        description: "دفعة أعمال خرسانات وتجهيزات الموقع",
        amountMinor: 6_500_000n, // 65,000.00 EGP
        paidMinor: 0n,
        issuedOn: iso(-10),
        dueOn: iso(0),
        status: "open" as const,
      },
      // 6. Partially paid
      {
        debtorId: d5!,
        reference: "INV-2026-106",
        description: "مخططات هندسية وتراخيص مجمع سكني",
        amountMinor: 8_000_000n, // 80,000.00 EGP
        paidMinor: 3_500_000n, // 35,000.00 EGP paid
        issuedOn: iso(-30),
        dueOn: iso(-5),
        status: "partially_paid" as const,
      },
      // 7. Disputed
      {
        debtorId: d6!,
        reference: "INV-2026-107",
        description: "توريد سلع استهلاكية وعبوات تغليف",
        amountMinor: 1_900_000n, // 19,000.00 EGP
        paidMinor: 0n,
        issuedOn: iso(-20),
        dueOn: iso(-8),
        status: "disputed" as const,
      },
      // 8. Fully Paid
      {
        debtorId: d7!,
        reference: "INV-2026-108",
        description: "تراخيص برمجيات سنوية وصيانة سحابية",
        amountMinor: 3_200_000n, // 32,000.00 EGP
        paidMinor: 3_200_000n,
        issuedOn: iso(-40),
        dueOn: iso(-25),
        status: "paid" as const,
      },
      // 9. Fully Paid
      {
        debtorId: d0!,
        reference: "INV-2026-109",
        description: "قطع غيار وصيانة فلاتر هواء",
        amountMinor: 1_200_000n, // 12,000.00 EGP
        paidMinor: 1_200_000n,
        issuedOn: iso(-50),
        dueOn: iso(-35),
        status: "paid" as const,
      },
    ];

    for (const inv of demoInvoices) {
      const [existingInv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.reference, inv.reference)));

      if (!existingInv) {
        await tx.insert(invoices).values({
          id: uuidv7(),
          tenantId,
          debtorId: inv.debtorId,
          reference: inv.reference,
          description: inv.description,
          amountMinor: inv.amountMinor,
          paidMinor: inv.paidMinor,
          currency: "EGP",
          issuedOn: inv.issuedOn,
          dueOn: inv.dueOn,
          status: inv.status,
          source: "manual",
        });
      }
    }

    // Rich Cheques in diverse lifecycle states
    const demoCheques = [
      {
        number: "CHQ-88201",
        bank: "البنك الأهلي المصري",
        direction: "receivable" as const,
        amountMinor: 3_500_000n, // 35,000.00 EGP
        issueDate: iso(-10),
        dueDate: iso(5),
        status: "held" as const,
        debtorId: d0!,
      },
      {
        number: "CHQ-88202",
        bank: "بنك مصر",
        direction: "receivable" as const,
        amountMinor: 2_850_000n, // 28,500.00 EGP
        issueDate: iso(-25),
        dueDate: iso(-10),
        status: "cleared" as const,
        debtorId: d1!,
      },
      {
        number: "CHQ-88203",
        bank: "البنك التجاري الدولي (CIB)",
        direction: "receivable" as const,
        amountMinor: 1_850_000n, // 18,500.00 EGP
        issueDate: iso(-15),
        dueDate: iso(-3),
        status: "bounced" as const,
        debtorId: d4!,
      },
      {
        number: "CHQ-88204",
        bank: "بنك قطر الوطني (QNB AlAhli)",
        direction: "receivable" as const,
        amountMinor: 2_200_000n, // 22,000.00 EGP
        issueDate: iso(-8),
        dueDate: iso(2),
        status: "deposited" as const,
        debtorId: d7!,
      },
    ];

    for (const c of demoCheques) {
      const [existingChq] = await tx
        .select()
        .from(cheques)
        .where(and(eq(cheques.tenantId, tenantId), eq(cheques.number, c.number)));

      if (!existingChq) {
        await tx.insert(cheques).values({
          id: uuidv7(),
          tenantId,
          debtorId: c.debtorId,
          number: c.number,
          bank: c.bank,
          direction: c.direction,
          amountMinor: c.amountMinor,
          issueDate: c.issueDate,
          dueDate: c.dueDate,
          status: c.status,
        });
      }
    }

    // Payment Promises
    if (d2) {
      await tx.insert(promisesToPay).values({
        id: uuidv7(),
        tenantId,
        debtorId: d2,
        amountMinor: 1_420_000n,
        promisedOn: iso(6),
        status: "pending",
        source: "manual",
        note: "وعد بالتحويل البنكي بعد صرف مستخلص الميناء يوم الخميس القادم",
      });
    }

    // Collection Tasks
    if (d0) {
      await tx.insert(collectionTasks).values({
        id: uuidv7(),
        tenantId,
        debtorId: d0,
        title: "متابعة سداد فاتورة توريدات خط الإنتاج المتأخرة (62 يوماً)",
        description: "التواصل هاتفياً مع رئيس الحسابات لتأكيد موعد إصدار أمر الدفع",
        priority: "urgent",
        status: "open",
        assignedToUserId: actorUserId,
        createdBy: actorUserId,
        dueAt: new Date(Date.now() + 86_400_000),
      });
    }

    // Payment Claim (AI Inbox item)
    if (d1) {
      await tx.insert(payments).values({
        id: uuidv7(),
        tenantId,
        debtorId: d1,
        amountMinor: 1_500_000n, // 15,000.00 EGP
        currency: "EGP",
        method: "instapay",
        status: "claimed",
        source: "receipt_ai",
        receivedOn: iso(0),
        referenceNo: "INSTA-8849102",
      });
    }

    // Notification
    await tx.insert(notifications).values({
      id: uuidv7(),
      tenantId,
      kind: "cheque_alert",
      severity: "warn",
      titleAr: "تنبيه: ارتداد شيك بمبلغ 18,500 ج.م من البنك التجاري الدولي",
      titleEn: "Alert: Bounced cheque 18,500 EGP from CIB",
      bodyAr: "أفاد البنك بعدم كفاية الرصيد للشيك رقم CHQ-88203 الصادر من شركة الفيروز للمقاولات العامة.",
      bodyEn: "Bank reported insufficient funds for cheque CHQ-88203 from Al-Fairouz Contracting.",
      actionUrl: "/cheques",
      dedupeKey: `cheque_bounced_CHQ-88203_${tenantId}`,
    }).onConflictDoNothing();

    // Audit log entry
    await tx.insert(auditLog).values({
      tenantId,
      actorUserId,
      action: "tenant.seed_comprehensive",
      entity: "tenant",
      entityId: tenantId,
      after: {
        debtorsCount: demoDebtors.length,
        invoicesCount: demoInvoices.length,
        chequesCount: demoCheques.length,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      debtorsAdded: demoDebtors.length,
      invoicesAdded: demoInvoices.length,
      chequesAdded: demoCheques.length,
    };
  });
}
