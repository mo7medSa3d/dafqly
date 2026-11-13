import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { runtimeModeFlags } from "@/server/env";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppShell } from "@/components/AppShell";
import { CollectionWorkspaceClient } from "@/components/CollectionWorkspaceClient";

export const dynamic = "force-dynamic";

export default async function TasksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) redirect(`/${locale}/onboarding`);
  return (
    <AppShell locale={locale} demoMode={runtimeModeFlags()} digits={tenant.settings?.easternDigits ? "eastern" : "latin"} businessName={tenant.businessNameAr} currency={tenant.settings?.currency ?? "EGP"} testId="tasks">
      <CollectionWorkspaceClient locale={locale} role={tenant.role} />
    </AppShell>
  );
}
