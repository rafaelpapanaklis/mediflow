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

  // Serialize dates to strings for client component
  const serializedAppts = appointments.map(a => ({
    ...a,
    date:        a.date instanceof Date ? a.date.toISOString() : String(a.date),
    createdAt:   a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt:   a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
    confirmedAt: a.confirmedAt instanceof Date ? a.confirmedAt.toISOString() : a.confirmedAt,
    cancelledAt: a.cancelledAt instanceof Date ? a.cancelledAt.toISOString() : a.cancelledAt,
  }));

  return (
    <AppointmentsClient
      appointments={serializedAppts as any}
      patients={patients}
      doctors={doctors}
      currentUserId={user.id}
      clinicId={user.clinicId}
      waConnected={user.clinic.waConnected ?? false}
    />
  );
}
