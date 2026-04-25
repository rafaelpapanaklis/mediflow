export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppointmentsClient } from "./appointments-client";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";

export const metadata: Metadata = { title: "Agenda — MediFlow" };

export default async function AppointmentsPage() {
  const user = await getCurrentUser();
  const tz = user.clinic.timezone;

  const [appointments, patients, doctors] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId: user.clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "asc" },
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

  // Serialize dates a strings + override legacy fields derivados de startsAt/endsAt
  // en la tz de la clínica. Esto desacopla el client del shape legacy del DB —
  // post-B4 el client sigue recibiendo strings legacy aunque las columnas ya no existan.
  const serializedAppts = appointments.map(a => ({
    ...a,
    date:         dateISOInTz(a.startsAt, tz),
    startTime:    timeHHMMInTz(a.startsAt, tz),
    endTime:      timeHHMMInTz(a.endsAt, tz),
    durationMins: durationMinutes(a.startsAt, a.endsAt),
    startsAt:     a.startsAt.toISOString(),
    endsAt:       a.endsAt.toISOString(),
    createdAt:    a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt:    a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
    confirmedAt:  a.confirmedAt instanceof Date ? a.confirmedAt.toISOString() : a.confirmedAt,
    cancelledAt:  a.cancelledAt instanceof Date ? a.cancelledAt.toISOString() : a.cancelledAt,
  }));

  return (
    <ErrorBoundary fallbackTitle="Error al cargar la agenda">
      <AppointmentsClient
        appointments={serializedAppts as any}
        patients={patients}
        doctors={doctors}
        currentUserId={user.id}
        clinicId={user.clinicId}
        waConnected={user.clinic.waConnected ?? false}
      />
    </ErrorBoundary>
  );
}
