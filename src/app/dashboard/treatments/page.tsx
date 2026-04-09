export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TreatmentsClient } from "./treatments-client";

export const metadata: Metadata = { title: "Tratamientos — MediFlow" };

export default async function TreatmentsPage() {
  const user = await getCurrentUser();

  const treatments = await prisma.treatmentPlan.findMany({
    where: {
      clinicId: user.clinicId,
      ...(user.role === "DOCTOR" ? { doctorId: user.id } : {}),
    },
    include: {
      patient:  { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
      sessions: { where: { completedAt: { not: null } }, orderBy: { sessionNumber: "asc" } },
    },
    orderBy: [{ status: "asc" }, { nextExpectedDate: "asc" }],
  });

  const patients = await prisma.patient.findMany({
    where: {
      clinicId: user.clinicId,
      status:   "ACTIVE",
      ...(user.role === "DOCTOR" ? { primaryDoctorId: user.id } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });

  const doctors = await prisma.user.findMany({
    where:  { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
    select: { id: true, firstName: true, lastName: true, color: true },
  });

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
      treatments={serialized as any}
      patients={patients}
      doctors={doctors}
      currentUserId={user.id}
      isAdmin={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
      clinicSlug={user.clinic.slug}
    />
  );
}
