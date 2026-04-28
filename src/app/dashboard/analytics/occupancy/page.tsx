export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OccupancyClient } from "./occupancy-client";

export const metadata: Metadata = { title: "Ocupación — Analytics" };

export default async function OccupancyPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>Solo admin.</div>;
  }

  const [resources, doctors] = await Promise.all([
    prisma.resource.findMany({
      where: { clinicId: user.clinicId, isActive: true, kind: "CHAIR" },
      select: { id: true, name: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
  ]);

  return <OccupancyClient resources={resources} doctors={doctors} />;
}
