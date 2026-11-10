import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/ui";
import { DebtorDetailClient } from "@/components/DebtorDetailClient";

export default async function DebtorDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  if (!mine[0]) redirect(`/${locale}/onboarding`);
  const tc = await getTranslations("common");
  const t = await getTranslations("debtors");
  return (
    <AppShell locale={locale} businessName={mine[0].businessNameAr}>
      <div className="flex flex-col gap-2">
        <BackLink href={`/${locale}/debtors`} label={tc("back")} />
        <h1 className="text-2xl font-extrabold leading-snug sm:text-[28px]">{t("title")}</h1>
      </div>
      <DebtorDetailClient debtorId={id} businessName={mine[0].businessNameAr} />
    </AppShell>
  );
}
