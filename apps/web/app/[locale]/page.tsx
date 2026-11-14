import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { DafqlyLanding } from "@/components/DafqlyLanding";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) {
    const mine = await listTenantsForUser(ownerDb(), session.user.id);
    redirect(mine.length > 0 ? `/${locale}/dashboard` : `/${locale}/onboarding`);
  }
  return <DafqlyLanding />;
}
