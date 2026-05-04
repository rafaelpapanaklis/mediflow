// Periodontics — detalle del paciente. SPEC §6, §8.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { PeriodonticsClient } from "@/components/specialties/periodontics/PeriodonticsClient";
import { computePerioMetrics } from "@/lib/periodontics/periodontogram-math";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";

export default async function PeriodonticsPatientDetailPage({
  params,
}: {
  params: { patientId: string };
}) {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PERIODONTICS_MODULE_KEY}`);
  }

  const patient = await prisma.patient.findFirst({
    where: { id: params.patientId, clinicId: user.clinicId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      chronicConditions: true,
      allergies: true,
      currentMedications: true,
    },
  });
  if (!patient) redirect("/dashboard/specialties/periodontics");

  // Cargas paralelas: último record + plan + cirugías + mantenimientos + riesgo + recesiones.
  const [latestRecord, plan, surgeries, maintenanceRecords, lastRisk, allBopRecords] =
    await Promise.all([
      prisma.periodontalRecord.findFirst({
        where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { classification: true },
      }),
      prisma.periodontalTreatmentPlan.findFirst({
        where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
      }),
      prisma.periodontalSurgery.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        orderBy: { surgeryDate: "desc" },
        take: 30,
      }),
      prisma.periodontalRecord.findMany({
        where: {
          patientId: patient.id,
          clinicId: user.clinicId,
          deletedAt: null,
          recordType: "MANTENIMIENTO",
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          createdAt: true,
          bopPercentage: true,
          plaqueIndexOleary: true,
        },
      }),
      prisma.periodontalRiskAssessment.findFirst({
        where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        orderBy: { evaluatedAt: "desc" },
      }),
      prisma.periodontalRecord.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { createdAt: true, bopPercentage: true },
      }),
    ]);

  const sites = ((latestRecord?.sites as unknown as Site[] | null) ?? []) as Site[];
  const teeth = ((latestRecord?.toothLevel as unknown as ToothLevel[] | null) ?? []) as ToothLevel[];
  const metrics = latestRecord ? computePerioMetrics(sites, teeth) : null;

  const fmt = (d: Date) => d.toLocaleDateString("es-MX");

  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const initials = fullName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div className="ped-detail">
      <div className="ped-detail__topbar">
        <Link href="/dashboard/specialties/periodontics" className="pedi-btn ped-detail__back">
          <ArrowLeft size={14} aria-hidden /> Volver a la lista
        </Link>
        <Link href={`/dashboard/patients/${patient.id}`} className="pedi-btn">
          <FileText size={14} aria-hidden /> Ver expediente completo
        </Link>
      </div>

      <header className="ped-detail__header">
        <div className="ped-detail__avatar" aria-hidden>{initials || "?"}</div>
        <div className="ped-detail__title-block">
          <h1 className="ped-detail__name">{fullName}</h1>
          <p className="ped-detail__meta">
            <span>Periodoncia · clasificación 2017 + riesgo Berna</span>
          </p>
        </div>
      </header>

      <PeriodonticsClient
        patientId={patient.id}
        patientName={fullName}
        recordId={latestRecord?.id}
        initialSites={sites}
        initialTeeth={teeth}
        initialMetrics={metrics}
        classification={
          latestRecord?.classification
            ? {
                id: latestRecord.classification.id,
                stage: latestRecord.classification.stage,
                grade: latestRecord.classification.grade,
                extension: latestRecord.classification.extension,
                overridden: latestRecord.classification.overriddenByDoctor,
              }
            : null
        }
        riskCategory={lastRisk?.riskCategory ?? null}
        recallMonths={
          lastRisk
            ? ((lastRisk.recommendedRecallMonths === 3 || lastRisk.recommendedRecallMonths === 4 || lastRisk.recommendedRecallMonths === 6)
                ? (lastRisk.recommendedRecallMonths as 3 | 4 | 6)
                : null)
            : null
        }
        nextMaintenanceAt={plan?.nextEvaluationAt ? fmt(plan.nextEvaluationAt) : null}
        bopHistory={allBopRecords.map((r) => ({
          date: fmt(r.createdAt),
          bopPct: r.bopPercentage ?? 0,
        }))}
        alerts={buildAlerts(metrics, surgeries.length)}
        systemicFactors={buildSystemicFactors(patient)}
        plan={
          plan
            ? {
                currentPhase: plan.currentPhase,
                phaseDates: {
                  phase1StartedAt: plan.phase1StartedAt ? fmt(plan.phase1StartedAt) : null,
                  phase1CompletedAt: plan.phase1CompletedAt ? fmt(plan.phase1CompletedAt) : null,
                  phase2StartedAt: plan.phase2StartedAt ? fmt(plan.phase2StartedAt) : null,
                  phase2CompletedAt: plan.phase2CompletedAt ? fmt(plan.phase2CompletedAt) : null,
                  phase3StartedAt: plan.phase3StartedAt ? fmt(plan.phase3StartedAt) : null,
                  phase3CompletedAt: plan.phase3CompletedAt ? fmt(plan.phase3CompletedAt) : null,
                  phase4StartedAt: plan.phase4StartedAt ? fmt(plan.phase4StartedAt) : null,
                },
              }
            : null
        }
        surgeries={surgeries.map((s) => ({
          id: s.id,
          surgeryDate: fmt(s.surgeryDate),
          surgeryType: s.surgeryType,
          teeth: extractTeethFromTreatedSites(s.treatedSites),
          sutureRemovalDate: s.sutureRemovalDate ? fmt(s.sutureRemovalDate) : null,
          hasConsent: Boolean(s.consentSignedFileId),
        }))}
        maintenanceHistory={maintenanceRecords.map((m) => ({
          id: m.id,
          date: fmt(m.createdAt),
          bopPct: m.bopPercentage ?? 0,
          plaquePct: m.plaqueIndexOleary ?? 0,
        }))}
      />
    </div>
  );
}

function buildAlerts(
  metrics: ReturnType<typeof computePerioMetrics> | null,
  surgeryCount: number,
): string[] {
  const alerts: string[] = [];
  if (!metrics) return alerts;
  if (metrics.sites6plus > 5) alerts.push(`${metrics.sites6plus} sitios con bolsa ≥6 mm — terapia activa pendiente.`);
  if (metrics.bopPct > 25) alerts.push(`BoP ${metrics.bopPct}% — inflamación generalizada.`);
  if (metrics.plaquePct > 30) alerts.push(`Índice de placa ${metrics.plaquePct}% — refuerza higiene.`);
  if (surgeryCount > 0) alerts.push(`${surgeryCount} cirugía(s) periodontal(es) registrada(s).`);
  return alerts;
}

function buildSystemicFactors(patient: {
  chronicConditions: string[];
  allergies: string[];
  currentMedications: string[];
}): string[] {
  const out: string[] = [];
  for (const c of patient.chronicConditions) out.push(c);
  if (patient.allergies.length > 0) out.push(`Alergias: ${patient.allergies.join(", ")}`);
  if (patient.currentMedications.length > 0)
    out.push(`Medicación: ${patient.currentMedications.join(", ")}`);
  return out;
}

function extractTeethFromTreatedSites(treated: unknown): number[] {
  if (!Array.isArray(treated)) return [];
  return treated
    .map((t: unknown) => {
      if (typeof t === "object" && t !== null && "fdi" in t) {
        const v = (t as { fdi: unknown }).fdi;
        return typeof v === "number" ? v : null;
      }
      return null;
    })
    .filter((n): n is number => n !== null);
}
