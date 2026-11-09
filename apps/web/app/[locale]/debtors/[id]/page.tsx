import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppNav } from "@/components/AppNav";
import { DebtorDetailClient } from "@/components/DebtorDetailClient";

export default async function DebtorDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  if (!mine[0]) redirect(`/${locale}/onboarding`);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-6">
      <AppNav locale={locale} />
      <DebtorDetailClient debtorId={id} />
    </main>
  );
}
