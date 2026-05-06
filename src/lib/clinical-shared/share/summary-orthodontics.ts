// clinical-shared/share — summary corto Orto para vista pública del paciente.

import { prisma } from "@/lib/prisma";

export interface OrthoShareStats {
  monthInTreatment: number | null;
  estimatedDurationMonths: number | null;
  remainingMonths: number | null;
  currentPhase: string | null;
  totalPhotoSets: number;
  initialPhotoSetId: string | null;
  lastPhotoSetId: string | null;
  paymentStatus: string | null;
  technique: string | null;
}

export interface BuildShareReturn {
  summary: string;
  stats: OrthoShareStats;
}

export async function buildShortOrthoSummary(args: {
  patientId: string;
  clinicId: string;
}): Promise<BuildShareReturn> {
  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { patientId: args.patientId, clinicId: args.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      phases: { orderBy: { orderIndex: "asc" } },
      paymentPlan: { select: { status: true } },
      photoSets: {
        orderBy: { capturedAt: "asc" },
        select: { id: true, setType: true, capturedAt: true },
      },
    },
  });

  if (!plan) {
    return {
      summary:
        "Aún no hay plan de ortodoncia activo. Tu doctor pronto te compartirá tu resumen.",
      stats: {
        monthInTreatment: null,
        estimatedDurationMonths: null,
        remainingMonths: null,
        currentPhase: null,
        totalPhotoSets: 0,
        initialPhotoSetId: null,
        lastPhotoSetId: null,
        paymentStatus: null,
        technique: null,
      },
    };
  }

  const inProgress = plan.phases.find((p) => p.status === "IN_PROGRESS");
  const installed = plan.installedAt ?? plan.startDate;
  const monthInTreatment = installed
    ? Math.max(
        0,
        Math.round((Date.now() - installed.getTime()) / (30.44 * 24 * 3600 * 1000)),
      )
    : null;
  const remaining =
    monthInTreatment != null
      ? Math.max(0, plan.estimatedDurationMonths - monthInTreatment)
      : null;

  const initial = plan.photoSets.find((p) => p.setType === "T0") ?? null;
  const last = plan.photoSets[plan.photoSets.length - 1] ?? null;

  const lines = [
    `Vas en el mes ${monthInTreatment ?? 0} de un plan estimado de ${
      plan.estimatedDurationMonths
    } meses.`,
    inProgress
      ? `Estás en la fase ${inProgress.phaseKey}. Sigue así con tu higiene y tus elásticos.`
      : `El plan está pausado entre fases.`,
    plan.photoSets.length > 0
      ? `Hemos registrado ${plan.photoSets.length} sesión(es) fotográfica(s) para que puedas ver tu progreso.`
      : `Próximamente registraremos tu primera sesión fotográfica.`,
  ];

  return {
    summary: lines.join("\n\n"),
    stats: {
      monthInTreatment,
      estimatedDurationMonths: plan.estimatedDurationMonths,
      remainingMonths: remaining,
      currentPhase: inProgress?.phaseKey ?? null,
      totalPhotoSets: plan.photoSets.length,
      initialPhotoSetId: initial?.id ?? null,
      lastPhotoSetId: last?.id ?? null,
      paymentStatus: plan.paymentPlan?.status ?? null,
      technique: plan.technique,
    },
  };
}
