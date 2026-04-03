export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppointmentsClient } from "./appointments-client";

export const metadata: Metadata = { title: "Agenda — MediFlow" };

export default async function AppointmentsPage() {
  const user = await getCurrentUser();

  const [appointments, patients, doctors] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId: user.clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    prisma.patient.findMany({
      where: { clinicId: user.clinicId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.user.findMany({
      where: { clinicId: user.clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
    }),
  ]);

  return (
    <AppointmentsClient
      appointments={appointments as any}
      patients={patients}
      doctors={doctors}
      currentUserId={user.id}
      clinicId={user.clinicId}
      waConnected={user.clinic.waConnected ?? false}
    />
  );
}
