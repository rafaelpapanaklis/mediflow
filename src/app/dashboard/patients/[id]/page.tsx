export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PatientDetailClient } from "./patient-detail-client";
import { PatientContextPanel } from "@/components/dashboard/patient-context";

export default async function PatientDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();

  const [patient, doctors] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: params.id, clinicId: user.clinicId },
      include: {
        primaryDoctor: { select: { id: true, firstName: true, lastName: true, color: true } },
        appointments: {
          orderBy: { date: "desc" },
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
            sessions: { where: { completedAt: { not: null } }, orderBy: { sessionNumber: "asc" } },
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

  const totalPaid    = patient.invoices.reduce((s, i) => s + i.paid, 0);
  const totalBalance = patient.invoices.reduce((s, i) => s + i.balance, 0);
  const totalPlan    = patient.invoices.reduce((s, i) => s + i.total, 0);

  const lastVisit  = patient.appointments[0]?.date?.toISOString() ?? null;
  const visitCount = patient.appointments.filter(a => a.status === "COMPLETED").length;

  // Serialize all dates
  const serializedAppts = patient.appointments.map(a => ({
    ...a,
    date:      a.date instanceof Date ? a.date.toISOString() : String(a.date),
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt),
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
      />
    </div>
  );
}
