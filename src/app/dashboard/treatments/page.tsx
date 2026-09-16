export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { patientVisibilityAnd, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { TreatmentsClient } from "./treatments-client";

export const metadata: Metadata = { title: "Tratamientos — DaleControl" };

export default async function TreatmentsPage() {
  const user = await getCurrentUser();
  // EQ-07: misma puerta que GET /api/treatments.
  requirePermissionOrRedirect(user, "treatments.view");
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la pantalla de hoy, tal cual).
  // Las tres consultas de siempre no dependen entre sí, pero iban en cascada
  // (tres viajes en fila): aquí van juntas con el interruptor en un solo
  // Promise.all (4 consultas, por debajo del tope de 7), sin añadir ninguna.
  const [treatments, patients, doctors, rediseno] = await Promise.all([
    prisma.treatmentPlan.findMany({
      where: {
        clinicId: user.clinicId,
        ...(user.role === "DOCTOR" ? { doctorId: user.id } : {}),
        // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
        AND: [...relatedPatientVisibilityAnd(viewer)],
      },
      include: {
        patient:  { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
        sessions: { where: { completedAt: { not: null } }, orderBy: { sessionNumber: "asc" } },
      },
      orderBy: [{ status: "asc" }, { nextExpectedDate: "asc" }],
    }),
    prisma.patient.findMany({
      where: {
        clinicId: user.clinicId,
        status:   "ACTIVE",
        ...(user.role === "DOCTOR" ? { primaryDoctorId: user.id } : {}),
        // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
        AND: [...patientVisibilityAnd(viewer)],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.user.findMany({
      where:  { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
      select: { id: true, firstName: true, lastName: true, color: true },
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  // Serialize dates
  const serialized = treatments.map(t => ({
    ...t,
    startDate:        t.startDate.toISOString(),
    endDate:          t.endDate?.toISOString()          ?? null,
    nextExpectedDate: t.nextExpectedDate?.toISOString() ?? null,
    lastFollowUpSent: t.lastFollowUpSent?.toISOString() ?? null,
    createdAt:        t.createdAt.toISOString(),
    updatedAt:        t.updatedAt.toISOString(),
    sessions:         t.sessions.map(s => ({
      ...s,
      completedAt: s.completedAt?.toISOString() ?? null,
      createdAt:   s.createdAt.toISOString(),
    })),
  }));

  return (
    <TreatmentsClient
      key={user.clinicId}
      treatments={serialized as any}
      patients={patients}
      doctors={doctors}
      currentUserId={user.id}
      isAdmin={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
      clinicSlug={user.clinic.slug}
      canEdit={hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride ?? [] }, "treatments.edit")}
      rediseno={rediseno}
    />
  );
}
