// Pediatrics — helper compartido que arma PediatricsTabData. Spec: §7 (sprint 2)
//
// Usado por:
//   - /dashboard/patients/[id]/page.tsx       (tab embebida)
//   - /dashboard/specialties/pediatrics/[id]  (página dedicada)
//
// Multi-tenant: el caller pasa clinicId; este helper lo respeta en todas
// las queries. El gating (canAccessModule + categoría + edad) se asume
// validado por el caller — esta función solo carga datos.

import { prisma } from "@/lib/prisma";
import { calculateAge } from "./age";
import { classifyDentition } from "./dentition";
import type { PediatricsTabData } from "@/components/patient-detail/pediatrics/PediatricsTab";

export interface LoadPediatricsDataInput {
  clinicId: string;
  patientId: string;
}

/**
 * Devuelve `null` si el paciente no existe, fue eliminado, no pertenece a
 * la clínica o no tiene `dob`. El caller decide qué hacer (404, redirect,
 * o renderizar fallback).
 */
export async function loadPediatricsData(
  input: LoadPediatricsDataInput,
): Promise<PediatricsTabData | null> {
  const patient = await prisma.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
      allergies: true,
      chronicConditions: true,
    },
  });
  if (!patient || !patient.dob) return null;

  const dob = patient.dob;
  const age = calculateAge(dob);

  const [
    record,
    guardiansList,
    behaviorHistory,
    latestCambra,
    oralHabits,
    eruptionRecords,
    sealants,
    maintainers,
    fluorideHistory,
    pendingConsents,
    futureAppt,
  ] = await Promise.all([
    prisma.pediatricRecord.findUnique({
      where: { patientId: patient.id },
      include: { primaryGuardian: true },
    }),
    prisma.guardian.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { principal: "desc" },
    }),
    prisma.behaviorAssessment.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { recordedAt: "desc" },
      take: 50,
    }),
    prisma.cariesRiskAssessment.findFirst({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { scoredAt: "desc" },
    }),
    prisma.oralHabit.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { startedAt: "desc" },
    }),
    prisma.eruptionRecord.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
    }),
    prisma.sealant.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
    }),
    prisma.spaceMaintainer.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { placedAt: "desc" },
    }),
    prisma.fluorideApplication.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      orderBy: { appliedAt: "desc" },
      take: 30,
    }),
    prisma.pediatricConsent.findMany({
      where: {
        patientId: patient.id,
        clinicId: input.clinicId,
        deletedAt: null,
        revokedAt: null,
        guardianSignedAt: null,
      },
      include: { guardian: true },
    }),
    prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        clinicId: input.clinicId,
        startsAt: { gt: new Date() },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { startsAt: "asc" },
      select: { type: true, startsAt: true },
    }),
  ]);

  const eruptedPermanent = eruptionRecords.filter(
    (r) => r.toothFdi >= 11 && r.toothFdi <= 48,
  ).length;
  const dentition = classifyDentition({ ageDecimal: age.decimal, eruptedPermanent });
  const primaryGuardian =
    record?.primaryGuardian ?? guardiansList.find((g) => g.principal) ?? guardiansList[0] ?? null;
  const nextAppointmentLabel = futureAppt
    ? `${futureAppt.type} · ${futureAppt.startsAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`
    : undefined;

  return {
    patientId: patient.id,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    patientDob: dob,
    ageFormatted: age.formatted,
    ageMonths: age.totalMonths,
    dentition,
    primaryGuardian,
    guardiansCount: guardiansList.length,
    allergies: patient.allergies,
    conditions: patient.chronicConditions,
    latestCambra,
    behaviorHistory,
    oralHabits,
    eruptionRecords,
    sealants,
    maintainers,
    fluorideHistory,
    pendingConsents,
    nextAppointmentLabel,
  };
}
