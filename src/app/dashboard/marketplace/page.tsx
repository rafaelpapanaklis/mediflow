import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { getTrialStatus } from "@/lib/marketplace/access-control";
import { MarketplaceContent } from "@/components/marketplace/MarketplaceContent";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const [modules, clinicModules, trialStatus, cart] = await Promise.all([
    prisma.module.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.clinicModule.findMany({
      where: { clinicId: ctx.clinicId },
    }),
    getTrialStatus(ctx.clinicId),
    prisma.cart.findUnique({
      where: { clinicId: ctx.clinicId },
      select: { moduleIds: true },
    }),
  ]);

  return (
    <MarketplaceContent
      modules={modules}
      clinicModules={clinicModules}
      trialStatus={trialStatus}
      initialCart={cart?.moduleIds ?? []}
    />
  );
}
