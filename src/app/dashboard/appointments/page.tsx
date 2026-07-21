export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeePatient, patientVisibilityAnd } from "@/lib/patient-visibility";
import { AppointmentsClient } from "./appointments-client";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";
import { getServerT } from "@/i18n/server";

export const metadata: Metadata = { title: "Agenda — DaleControl" };

export default async function AppointmentsPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  const tz = user.clinic.timezone;
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  const [appointments, patients, doctors] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId: user.clinicId },
      include: {
        // visibleUserIds viaja para poder enmascarar (ver serializedAppts abajo).
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, visibleUserIds: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.patient.findMany({
      // Visibilidad: el picker no lista pacientes restringidos a quien no está en su visibleUserIds.
      where: { clinicId: user.clinicId, status: "ACTIVE", AND: [...patientVisibilityAnd(viewer)] },
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
  const serializedAppts = appointments.map(a => {
    // Visibilidad: si este usuario no puede ver al paciente, la cita se conserva
    // (el hueco existe, hay que respetarlo) pero enmascarada — "Paciente privado",
    // sin id ni teléfono. Y como `...a` derrama TODOS los escalares de la cita,
    // para el restringido también ocultamos `notes` (PHI, NOM-024) y el
    // `patientId` real. Se strippea visibleUserIds en ambas ramas.
    const p: any = a.patient;
    const hidden = !!p && !canSeePatient(viewer, p.visibleUserIds);
    const patient = !p
      ? p
      : hidden
        ? { id: null, firstName: "Paciente privado", lastName: "", phone: null }
        : { id: p.id, firstName: p.firstName, lastName: p.lastName, phone: p.phone };
    return {
    ...a,
    patient,
    ...(hidden ? { notes: null, patientId: null } : {}),
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
    };
  });

  return (
    <ErrorBoundary fallbackTitle={t("appointments.page.loadError")}>
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
