export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PatientDetailClient } from "./patient-detail-client";
import { PatientContextPanel } from "@/components/dashboard/patient-context";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { isPediatric, calculateAge } from "@/lib/pediatrics/age";
import { classifyDentition } from "@/lib/pediatrics/dentition";
import { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import type { PediatricsTabData } from "@/components/patient-detail/pediatrics/PediatricsTab";

export default async function PatientDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  const tz = user.clinic.timezone;

  const [patient, doctors] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: params.id, clinicId: user.clinicId },
      include: {
        primaryDoctor: { select: { id: true, firstName: true, lastName: true, color: true } },
        appointments: {
          orderBy: { startsAt: "desc" },
          take: 30,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        records: {
          orderBy: { visitDate: "desc" },
          take: 20,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        invoices: { include: { payments: true } },
        // FIX: fetch treatment plans for the Tratamientos tab
        treatments: {
          orderBy: { createdAt: "desc" },
          include: {
            doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
            sessions: { orderBy: { sessionNumber: "asc" } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where:  { clinicId: user.clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);

  if (!patient) notFound();

  const portalUrl = patient.portalToken
    ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/${patient.portalToken}`
    : null;

  // ── Pediatrics module gating ─────────────────────────────────────────────
  // Visible cuando: módulo PEDIATRICS activo en la clínica + categoría
  // DENTAL_CLINIC|MEDICINE + paciente con DOB + paciente <14 años.
  const pediatricsEligible =
    isPediatric(patient.dob, 14) &&
    (user.clinic.category === "DENTAL" || user.clinic.category === "MEDICINE");

  let pediatricsData: PediatricsTabData | null = null;
  if (pediatricsEligible) {
    const access = await canAccessModule(user.clinicId, PEDIATRICS_MODULE_KEY);
    if (access.hasAccess) {
      const dob = patient.dob!;
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
      ] = await Promise.all([
        prisma.pediatricRecord.findUnique({
          where: { patientId: patient.id },
          include: { primaryGuardian: true },
        }),
        prisma.guardian.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { principal: "desc" },
        }),
        prisma.behaviorAssessment.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { recordedAt: "desc" },
          take: 50,
        }),
        prisma.cariesRiskAssessment.findFirst({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { scoredAt: "desc" },
        }),
        prisma.oralHabit.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { startedAt: "desc" },
        }),
        prisma.eruptionRecord.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        }),
        prisma.sealant.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        }),
        prisma.spaceMaintainer.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { placedAt: "desc" },
        }),
        prisma.fluorideApplication.findMany({
          where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
          orderBy: { appliedAt: "desc" },
          take: 30,
        }),
        prisma.pediatricConsent.findMany({
          where: {
            patientId: patient.id,
            clinicId: user.clinicId,
            deletedAt: null,
            revokedAt: null,
            guardianSignedAt: null,
          },
          include: { guardian: true },
        }),
      ]);

      const eruptedPermanent = eruptionRecords.filter((r) => r.toothFdi >= 11 && r.toothFdi <= 48).length;
      const dentition = classifyDentition({ ageDecimal: age.decimal, eruptedPermanent });
      const primaryGuardian =
        record?.primaryGuardian ?? guardiansList.find((g) => g.principal) ?? guardiansList[0] ?? null;

      const futureAppt = patient.appointments.find(
        (a) => a.startsAt > new Date() && (a.status === "PENDING" || a.status === "CONFIRMED"),
      );
      const nextAppointmentLabel = futureAppt
        ? `${futureAppt.type} · ${futureAppt.startsAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`
        : undefined;

      pediatricsData = {
        patientId: patient.id,
        patientName: `${patient.firstName} ${patient.lastName}`,
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
  }

  const totalPaid    = patient.invoices.reduce((s, i) => s + i.paid, 0);
  const totalBalance = patient.invoices.reduce((s, i) => s + i.balance, 0);
  const totalPlan    = patient.invoices.reduce((s, i) => s + i.total, 0);

  const lastVisit  = patient.appointments[0]?.startsAt?.toISOString() ?? null;
  const visitCount = patient.appointments.filter(a => a.status === "COMPLETED").length;

  // Serialize + override legacy strings derivados de startsAt/endsAt en clinic tz.
  const serializedAppts = patient.appointments.map(a => ({
    ...a,
    date:         dateISOInTz(a.startsAt, tz),
    startTime:    timeHHMMInTz(a.startsAt, tz),
    endTime:      timeHHMMInTz(a.endsAt, tz),
    durationMins: durationMinutes(a.startsAt, a.endsAt),
    startsAt:     a.startsAt.toISOString(),
    endsAt:       a.endsAt.toISOString(),
    createdAt:    a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt:    a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
  }));

  const serializedRecords = patient.records.map(r => ({
    ...r,
    visitDate: r.visitDate instanceof Date ? r.visitDate.toISOString() : String(r.visitDate),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }));

  const serializedTreatments = patient.treatments.map(t => ({
    ...t,
    startDate:        t.startDate instanceof Date ? t.startDate.toISOString() : String(t.startDate),
    endDate:          t.endDate instanceof Date ? t.endDate.toISOString() : (t.endDate ?? null),
    nextExpectedDate: t.nextExpectedDate instanceof Date ? t.nextExpectedDate.toISOString() : (t.nextExpectedDate ?? null),
    lastFollowUpSent: t.lastFollowUpSent instanceof Date ? t.lastFollowUpSent.toISOString() : (t.lastFollowUpSent ?? null),
    createdAt:        t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    updatedAt:        t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
    sessions: t.sessions.map(s => ({
      ...s,
      completedAt: s.completedAt instanceof Date ? s.completedAt.toISOString() : (s.completedAt ?? null),
      createdAt:   s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    })),
  }));

  return (
    <div>
      <PatientContextPanel patient={{
        firstName:          patient.firstName,
        lastName:           patient.lastName,
        patientNumber:      patient.patientNumber,
        bloodType:          patient.bloodType,
        dob:                patient.dob?.toISOString() ?? null,
        gender:             patient.gender,
        allergies:          patient.allergies,
        chronicConditions:  patient.chronicConditions,
        currentMedications: patient.currentMedications,
        lastVisit,
        visitCount,
      }} />

      <ErrorBoundary fallbackTitle="Error al cargar detalle del paciente">
        <PatientDetailClient
          patient={patient as any}
          records={serializedRecords as any}
          appointments={serializedAppts as any}
          invoices={patient.invoices as any}
          treatments={serializedTreatments as any}
          doctors={doctors}
          currentUser={{ id: user.id, firstName: user.firstName, lastName: user.lastName }}
          specialty={user.clinic.specialty}
          totalPaid={totalPaid}
          totalBalance={totalBalance}
          totalPlan={totalPlan}
          portalUrl={portalUrl}
          pediatricsData={pediatricsData}
        />
      </ErrorBoundary>
    </div>
  );
}
