export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { AffiliateShell } from "@/components/afiliados/affiliate-shell";

export default async function AffiliatePanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");
  if (ctx.status !== "APPROVED") redirect("/afiliados/pendiente");

  return <AffiliateShell affiliateName={ctx.affiliate.name}>{children}</AffiliateShell>;
}
