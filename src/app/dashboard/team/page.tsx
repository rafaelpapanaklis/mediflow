export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { TeamClient } from "./team-client";

export const metadata: Metadata = { title: "Equipo — MediFlow" };

export default async function TeamPage() {
  const user = await getCurrentUser();

  // Only admins can access this page
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  const team = await prisma.user.findMany({
    where: { clinicId: user.clinicId },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      role: true, specialty: true, color: true, avatarUrl: true,
      phone: true, isActive: true, createdAt: true, services: true,
      _count: {
        select: {
          appointments: { where: { status: { not: "CANCELLED" } } },
          records: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
  });

  return (
    <TeamClient
      team={team as any}
      currentUserId={user.id}
      clinicName={user.clinic.name}
    />
  );
}
