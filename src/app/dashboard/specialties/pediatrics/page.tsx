// Pediatrics — página index del módulo de Odontopediatría. Spec: §7 (sprint 2)

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { calculateAge } from "@/lib/pediatrics/age";
import { classifyDentition } from "@/lib/pediatrics/dentition";
import { PEDIATRICS_MODULE_KEY, DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";
import type { CambraCategory } from "@/lib/pediatrics/cambra";
import { PediatricPatientList } from "@/components/specialties/pediatrics/PediatricPatientList";
import type { PediatricPatientCardData } from "@/components/specialties/pediatrics/PediatricPatientCard";

export default async function PediatricsIndexPage() {
  const user = await getCurrentUser();

  if (user.clinic.category !== "DENTAL" && user.clinic.category !== "MEDICINE") {
    redirect("/dashboard");
  }

  const access = await canAccessModule(user.clinicId, PEDIATRICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PEDIATRICS_MODULE_KEY}`);
  }

  // Pacientes pediátricos: edad < cutoff años, no eliminados, con DOB.
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - DEFAULT_PEDIATRICS_CUTOFF_YEARS);

  const patients = await prisma.patient.findMany({
    where: {
      clinicId: user.clinicId,
      deletedAt: null,
      dob: { not: null, gt: cutoffDate },
    },
    include: {
      pediatricRecord: {
        include: { primaryGuardian: true },
      },
      behaviorAssessments: {
        where: { scale: "frankl", deletedAt: null },
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { value: true },
      },
      cariesAssessments: {
        where: { deletedAt: null },
        orderBy: { scoredAt: "desc" },
        take: 1,
        select: { category: true },
      },
      eruptionRecords: {
        where: { deletedAt: null },
        select: { toothFdi: true },
      },
      appointments: {
        where: {
          startsAt: { gt: new Date() },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { type: true, startsAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const data: PediatricPatientCardData[] = patients.map((p) => {
    const age = calculateAge(p.dob!);
    const eruptedPermanent = p.eruptionRecords.filter(
      (r) => r.toothFdi >= 11 && r.toothFdi <= 48,
    ).length;
    const dentition = classifyDentition({ ageDecimal: age.decimal, eruptedPermanent });
    const next = p.appointments[0];
    const guardian = p.pediatricRecord?.primaryGuardian ?? null;

    return {
      id: p.id,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      ageFormatted: age.long,
      ageDecimal: age.decimal,
      dentition,
      cambraCategory: (p.cariesAssessments[0]?.category as CambraCategory | undefined) ?? null,
      latestFranklValue: p.behaviorAssessments[0]?.value ?? null,
      primaryGuardianName: guardian?.fullName ?? null,
      primaryGuardianPhone: guardian?.phone ?? null,
      hasPediatricRecord: p.pediatricRecord !== null,
      nextAppointmentLabel: next
        ? `${next.type} · ${next.startsAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`
        : null,
    };
  });

  return <PediatricPatientList patients={data} />;
}
