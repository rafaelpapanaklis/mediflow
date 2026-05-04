// Periodontics — página index del módulo. SPEC §6 + §11.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { differenceInDays } from "date-fns";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import {
  PerioPatientList,
  type PerioPatientRow,
} from "@/components/specialties/periodontics/PerioPatientList";
import {
  OverdueMaintenanceWidget,
  type OverdueMaintenanceRow,
} from "@/components/specialties/periodontics/OverdueMaintenanceWidget";

export default async function PeriodonticsIndexPage() {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PERIODONTICS_MODULE_KEY}`);
  }

  const [patientsWithRecords, plansWithMaintenance] = await Promise.all([
    prisma.patient.findMany({
      where: {
        clinicId: user.clinicId,
        deletedAt: null,
        periodontalRecords: { some: { deletedAt: null } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        periodontalRecords: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            bopPercentage: true,
            classification: { select: { stage: true } },
          },
        },
      },
      orderBy: { lastName: "asc" },
      take: 60,
    }),
    prisma.periodontalTreatmentPlan.findMany({
      where: {
        clinicId: user.clinicId,
        deletedAt: null,
        nextEvaluationAt: { not: null },
      },
      select: {
        id: true,
        patientId: true,
        nextEvaluationAt: true,
        patient: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const riskByPatient = await prisma.periodontalRiskAssessment.findMany({
    where: { clinicId: user.clinicId, deletedAt: null },
    orderBy: { evaluatedAt: "desc" },
    select: {
      patientId: true,
      riskCategory: true,
      recommendedRecallMonths: true,
    },
    take: 200,
  });
  const lastRiskByPatient = new Map<
    string,
    { riskCategory: "BAJO" | "MODERADO" | "ALTO"; recallMonths: number }
  >();
  for (const r of riskByPatient) {
    if (!lastRiskByPatient.has(r.patientId)) {
      lastRiskByPatient.set(r.patientId, {
        riskCategory: r.riskCategory,
        recallMonths: r.recommendedRecallMonths,
      });
    }
  }

  const fmt = (d: Date) => d.toLocaleDateString("es-MX");

  const rows: PerioPatientRow[] = patientsWithRecords.map((p) => {
    const lastRecord = p.periodontalRecords[0];
    const risk = lastRiskByPatient.get(p.id);
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      lastRecordAt: lastRecord ? fmt(lastRecord.createdAt) : null,
      classificationStage: lastRecord?.classification?.stage ?? null,
      riskCategory: risk?.riskCategory ?? null,
      bopPct: lastRecord?.bopPercentage ?? null,
    };
  });

  const now = new Date();
  const overdue: OverdueMaintenanceRow[] = plansWithMaintenance
    .filter((p) => p.nextEvaluationAt && p.nextEvaluationAt < now)
    .map((p) => {
      const risk = lastRiskByPatient.get(p.patientId);
      return {
        patientId: p.patientId,
        patientName: `${p.patient.firstName} ${p.patient.lastName}`.trim(),
        riskCategory: risk?.riskCategory ?? "MODERADO",
        daysOverdue: differenceInDays(now, p.nextEvaluationAt!),
        recallMonths: risk?.recallMonths ?? 4,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      <header>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text-1)",
            margin: 0,
          }}
        >
          Periodoncia
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            marginTop: 4,
          }}
        >
          Pacientes con expediente periodontal · clasificación 2017 AAP/EFP · riesgo Berna.
        </p>
      </header>

      <OverdueMaintenanceWidget rows={overdue} />

      <PerioPatientList patients={rows} />
    </div>
  );
}
