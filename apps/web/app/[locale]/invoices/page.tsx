import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { AppNav } from "@/components/AppNav";
import { InvoicesClient } from "@/components/InvoicesClient";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  if (!mine[0]) redirect(`/${locale}/onboarding`);
  const t = await getTranslations("invoices");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <AppNav locale={locale} />
      </header>
      <InvoicesClient />
    </main>
  );
}
