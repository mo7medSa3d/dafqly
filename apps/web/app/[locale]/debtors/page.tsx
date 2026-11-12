import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import { DebtorsClient } from "@/components/DebtorsClient";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  if (!mine[0]) redirect(`/${locale}/onboarding`);
  const t = await getTranslations("debtors");
  return (
    <AppShell locale={locale} businessName={mine[0].businessNameAr} currency={mine[0].settings?.currency ?? "EGP"}>
      <PageHeader title={t("title")} />
      <DebtorsClient businessName={mine[0].businessNameAr} />
    </AppShell>
  );
}
