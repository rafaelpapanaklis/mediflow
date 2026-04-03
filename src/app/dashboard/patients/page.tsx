import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PatientsClient } from "./patients-client";
export const metadata: Metadata = { title: "Pacientes — MediFlow" };

export default async function PatientsPage() {
  const user = await getCurrentUser();
  const patients = await prisma.patient.findMany({
    where: { clinicId: user.clinicId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: {
      appointments: { orderBy: { date: "desc" }, take: 1, select: { date: true, status: true } },
      _count: { select: { appointments: true } },
    },
  });
  return <PatientsClient patients={patients as any} />;
}
