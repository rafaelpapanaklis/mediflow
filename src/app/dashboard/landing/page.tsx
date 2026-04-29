export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LandingConfigClient } from "./landing-config-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";

export default async function LandingConfigPage() {
  const user   = await getCurrentUser();
  requirePermissionOrRedirect(user, "landing.view");
  const clinic = await prisma.clinic.findUnique({
    where:   { id: user.clinicId },
    include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
  });
  return <LandingConfigClient clinic={clinic as any} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />;
}
