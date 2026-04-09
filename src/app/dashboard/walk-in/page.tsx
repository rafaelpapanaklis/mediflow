export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WalkInClient } from "./walk-in-client";

export const metadata: Metadata = { title: "Fila de Espera — MediFlow" };

export default async function WalkInPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const queue = await prisma.walkInQueue.findMany({
    where: {
      clinicId,
      joinedAt: { gte: today, lt: tomorrow },
    },
    orderBy: [{ priority: "desc" }, { joinedAt: "asc" }],
  });

  return <WalkInClient initialQueue={queue as any} />;
}
