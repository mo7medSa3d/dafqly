import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppShell } from "@/components/AppShell";
import { BillingClient } from "@/components/BillingClient";

export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) redirect(`/${locale}/onboarding`);

  return (
    <AppShell locale={locale} businessName={tenant.businessNameAr} currency={tenant.settings?.currency ?? "EGP"} testId="billing-page">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <BillingClient locale={locale} />
      </div>
    </AppShell>
  );
}
