import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { runtimeModeFlags } from "@/server/env";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppShell } from "@/components/AppShell";
import { SettingsClient } from "@/components/SettingsClient";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) redirect(`/${locale}/onboarding`);

  return (
    <AppShell locale={locale} demoMode={runtimeModeFlags()} digits={tenant.settings?.easternDigits ? "eastern" : "latin"} businessName={tenant.businessNameAr} currency={tenant.settings?.currency ?? "EGP"} testId="settings">
      <SettingsClient locale={locale} />
    </AppShell>
  );
}
