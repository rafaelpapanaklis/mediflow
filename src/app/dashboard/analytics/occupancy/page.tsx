export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { OccupancyClient } from "./occupancy-client";
import { getServerT } from "@/i18n/server";

export const metadata: Metadata = { title: "Ocupación — Analytics" };

export default async function OccupancyPage() {
  const user = await getCurrentUser();
  const { t } = await getServerT();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.occupancyPage.adminOnly")}</div>;
  }

  const [resources, doctors] = await Promise.all([
    prisma.resource.findMany({
      where: { clinicId: user.clinicId, isActive: true, kind: { in: [...TREATMENT_KINDS] } },
      select: { id: true, name: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
  ]);

  return <OccupancyClient key={user.clinicId} resources={resources} doctors={doctors} />;
}
