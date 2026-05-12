// clinical-shared/share — summary corto Orto para vista pública del paciente.
//
// Ortodoncia v2 rewrite (feat/ortho-v2-rewrite) — re-cablear en Fase 4 v2
// con OrthoCase + OrthoTreatmentPlan v2 + PhotoSet/Photo + FinancialPlan.

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

export async function buildShortOrthoSummary(_args: {
  patientId: string;
  clinicId: string;
}): Promise<BuildShareReturn> {
  return {
    summary:
      "Tu plan de ortodoncia se cargará pronto. Estamos trabajando en una nueva experiencia.",
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
