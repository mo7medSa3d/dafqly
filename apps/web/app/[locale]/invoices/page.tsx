import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/server/auth";
import { runtimeModeFlags } from "@/server/env";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import { InvoicesClient } from "@/components/InvoicesClient";
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ overdue?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  if (!mine[0]) redirect(`/${locale}/onboarding`);
  const t = await getTranslations("invoices");
  return (
    <AppShell locale={locale} demoMode={runtimeModeFlags()} digits={mine[0].settings?.easternDigits ? "eastern" : "latin"} businessName={mine[0].businessNameAr} currency={mine[0].settings?.currency ?? "EGP"}>
      <PageHeader title={t("title")} />
      <InvoicesClient key={query.overdue === "true" ? "overdue" : "all"} businessName={mine[0].businessNameAr} initialOverdueOnly={query.overdue === "true"} />
    </AppShell>
  );
}
