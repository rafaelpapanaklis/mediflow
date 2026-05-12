// Orthodontics rediseño Fase 1 — adapter Prisma rows → ViewModel TS.
//
// Aísla la UI de la forma de Prisma. Mantiene el patrón Decimal → number,
// Date → ISO string, y compone OrthoRedesignViewModel desde los modelos
// existentes (legacy) + los nuevos (wireSteps, treatmentCards, etc.).
//
// Resilient: si los modelos nuevos no existen aún en la BD (porque la
// migración Fase 1 no se aplicó), las arrays llegan vacías y la UI
// renderiza empty states.

import type {
  OrthodonticDiagnosis,
  OrthodonticTreatmentPlan,
  OrthodonticPhase,
  OrthoPhaseKey,
  OrthoTAD,
  OrthoAuxMechanics,
  OrthoPhaseTransition,
  PatientFlow,
} from "@prisma/client";
import type { OrthoTabData } from "@/lib/orthodontics/load-data";
import type {
  AuxMechanicsDTO,
  DiagnosisDTO,
  ElasticDTO,
  IPRPointDTO,
  BrokenBracketDTO,
  OrthoRedesignViewModel,
  OrthoTreatmentDTO,
  PatientFlowDTO,
  PhaseTransitionDTO,
  TADDTO,
  TreatmentCardDTO,
  WireStepDTO,
} from "@/components/specialties/orthodontics/redesign/types";
import { PHASE_LABELS } from "@/components/specialties/orthodontics/redesign/types";

// Tipos auxiliares para include shapes que load-data devolverá.

export interface AdapterInput {
  legacy: OrthoTabData;
  // Nuevos modelos Fase 1. Todos opcionales; cuando faltan, la UI muestra empty.
  wireSteps?: Array<{
    id: string;
    orderIndex: number;
    phaseKey: OrthoPhaseKey;
    material: string;
    shape: string;
    gauge: string;
    purpose: string | null;
    archUpper: boolean;
    archLower: boolean;
    durationWeeks: number;
    auxiliaries: string[];
    notes: string | null;
    status: string;
    plannedDate: Date | null;
    appliedDate: Date | null;
    completedDate: Date | null;
  }>;
  treatmentCards?: Array<{
    id: string;
    cardNumber: number;
    visitDate: Date;
    durationMin: number;
    phaseKey: OrthoPhaseKey;
    monthAt: { toString(): string }; // Decimal
    wireFromId: string | null;
    wireToId: string | null;
    soapS: string;
    soapO: string;
    soapA: string;
    soapP: string;
    hygienePlaquePct: number | null;
    hygieneGingivitis: string | null;
    hygieneWhiteSpots: boolean;
    hasProgressPhoto: boolean;
    photoSetId: string | null;
    nextDate: Date | null;
    nextDurationMin: number | null;
    status: string;
    signedAt: Date | null;
    signedBy?: { firstName: string; lastName: string } | null;
    elastics: Array<{
      id: string;
      elasticClass: string;
      config: string;
      zone: string;
    }>;
    iprPoints: Array<{
      id: string;
      toothA: number;
      toothB: number;
      amountMm: { toString(): string };
      done: boolean;
    }>;
    brokenBrackets: Array<{
      id: string;
      toothFdi: number;
      brokenDate: Date;
      reBondedDate: Date | null;
      notes: string | null;
    }>;
  }>;
  tads?: OrthoTAD[];
  auxMechanics?: OrthoAuxMechanics | null;
  phaseTransitions?: Array<
    OrthoPhaseTransition & { signedBy?: { firstName: string; lastName: string } | null }
  >;
  patientFlow?: PatientFlow | null;
  // Métricas calculadas.
  attendancePct: number;
  elasticsCompliancePct: number;
  /**
   * Doctor que atenderá la próxima cita. Se resuelve en el loader vía
   * lookup del `attendedById` del control con scheduledAt > now más
   * cercano. Sin él, deriveNextAppointment caía en el bug de mostrar
   * `patientName` como doctor (heredado del Fase 1, comentario placeholder
   * en línea 410 antes del fix).
   */
  nextAppointmentDoctor?: {
    firstName: string;
    lastName: string;
  } | null;
  /** Sillón de la próxima cita (si la próxima cita tiene controlAppointmentId
   *  con metadata adicional). Por ahora se hereda del PatientFlow activo. */
  nextAppointmentChair?: string | null;
}

export function adaptToOrthoRedesignViewModel(
  input: AdapterInput,
): OrthoRedesignViewModel {
  const l = input.legacy;
  const wireSteps = (input.wireSteps ?? []).map(adaptWireStep);
  const wireById = new Map(wireSteps.map((w) => [w.id, w]));
  const wireCurrent = wireSteps.find((w) => w.status === "ACTIVE") ?? null;

  const treatment = adaptTreatment({
    legacy: l,
    wireCurrent,
    attendancePct: input.attendancePct,
    elasticsCompliancePct: input.elasticsCompliancePct,
  });

  const diagnosis = l.diagnosis ? adaptDiagnosis(l.diagnosis) : null;

  return {
    patient: {
      id: l.patientId,
      firstName: l.patientName.split(/\s+/)[0] ?? l.patientName,
      fullName: l.patientName,
      avatarInitials: avatarInitialsFrom(l.patientName),
    },
    treatment,
    diagnosis,
    wireSequence: wireSteps,
    treatmentCards: (input.treatmentCards ?? []).map((c) => adaptCard(c, wireById)),
    tads: (input.tads ?? []).map(adaptTad),
    auxMechanics: input.auxMechanics ? adaptAux(input.auxMechanics) : null,
    phaseTransitions: (input.phaseTransitions ?? []).map(adaptTransition),
    patientFlow: input.patientFlow ? adaptFlow(input.patientFlow) : null,
    nextAppointment: deriveNextAppointment(l, {
      doctor: input.nextAppointmentDoctor ?? null,
      chair: input.nextAppointmentChair ?? null,
    }),
    aiSuggestions: [],
    whatsappRecent: [],
  };
}

function adaptTreatment(args: {
  legacy: OrthoTabData;
  wireCurrent: WireStepDTO | null;
  attendancePct: number;
  elasticsCompliancePct: number;
}): OrthoTreatmentDTO {
  const l = args.legacy;
  const plan = l.plan;
  const phaseInProgress = l.phases.find((p) => p.status === "IN_PROGRESS")?.phaseKey ?? null;
  const totalCost = plan ? toNumber(plan.totalCostMxn) : 0;
  const paid = l.paymentPlan ? toNumber(l.paymentPlan.paidAmount) : 0;

  let status: OrthoTreatmentDTO["status"] = "no-iniciado";
  if (plan) {
    if (plan.status === "RETENTION") status = "retencion";
    else if (plan.status === "COMPLETED") status = "completado";
    else status = "en-tratamiento";
  }

  return {
    patientId: l.patientId,
    treatmentPlanId: plan?.id ?? null,
    status,
    phase: phaseInProgress,
    monthCurrent: l.monthInTreatment,
    monthTotal: plan?.estimatedDurationMonths ?? 0,
    appliance: {
      type: plan ? humanTechnique(plan.technique) : null,
      prescriptionSlot: plan?.prescriptionSlot ?? null,
      bonding: plan?.bondingType ?? null,
      notes: plan?.prescriptionNotes ?? plan?.techniqueNotes ?? null,
    },
    wireCurrent: args.wireCurrent,
    startDate: plan?.installedAt
      ? plan.installedAt.toISOString()
      : plan?.startDate
        ? plan.startDate.toISOString()
        : null,
    estimatedEndDate: deriveEstimatedEndDate(plan),
    attendancePct: args.attendancePct,
    elasticsCompliancePct: args.elasticsCompliancePct,
    totalCost,
    paid,
  };
}

function adaptDiagnosis(d: OrthodonticDiagnosis): DiagnosisDTO {
  return {
    id: d.id,
    angleClassRight: d.angleClassRight,
    angleClassLeft: d.angleClassLeft,
    overbiteMm: toNumber(d.overbiteMm),
    overjetMm: toNumber(d.overjetMm),
    crowdingUpperMm: d.crowdingUpperMm != null ? toNumber(d.crowdingUpperMm) : null,
    crowdingLowerMm: d.crowdingLowerMm != null ? toNumber(d.crowdingLowerMm) : null,
    midlineDeviationMm: d.midlineDeviationMm != null ? toNumber(d.midlineDeviationMm) : null,
    crossbite: d.crossbite,
    crossbiteDetails: d.crossbiteDetails,
    openBite: d.openBite,
    openBiteDetails: d.openBiteDetails,
    skeletalPattern: d.skeletalPattern ?? null,
    habits: d.habits as unknown as string[],
    habitsDescription: d.habitsDescription,
    tmjPainPresent: d.tmjPainPresent,
    tmjClickingPresent: d.tmjClickingPresent,
    tmjNotes: d.tmjNotes,
    clinicalSummary: d.clinicalSummary,
  };
}

function adaptWireStep(w: NonNullable<AdapterInput["wireSteps"]>[number]): WireStepDTO {
  return {
    id: w.id,
    orderIndex: w.orderIndex,
    phaseKey: w.phaseKey,
    material: w.material as WireStepDTO["material"],
    shape: w.shape as WireStepDTO["shape"],
    gauge: w.gauge,
    purpose: w.purpose,
    archUpper: w.archUpper,
    archLower: w.archLower,
    durationWeeks: w.durationWeeks,
    auxiliaries: w.auxiliaries,
    notes: w.notes,
    status: w.status as WireStepDTO["status"],
    plannedDate: w.plannedDate ? w.plannedDate.toISOString() : null,
    appliedDate: w.appliedDate ? w.appliedDate.toISOString() : null,
    completedDate: w.completedDate ? w.completedDate.toISOString() : null,
  };
}

function adaptCard(
  c: NonNullable<AdapterInput["treatmentCards"]>[number],
  wireById: Map<string, WireStepDTO>,
): TreatmentCardDTO {
  return {
    id: c.id,
    cardNumber: c.cardNumber,
    visitDate: c.visitDate.toISOString(),
    durationMin: c.durationMin,
    phaseKey: c.phaseKey,
    monthAt: parseFloat(c.monthAt.toString()),
    wireFrom: c.wireFromId ? wireById.get(c.wireFromId) ?? null : null,
    wireTo: c.wireToId ? wireById.get(c.wireToId) ?? null : null,
    soap: { s: c.soapS, o: c.soapO, a: c.soapA, p: c.soapP },
    hygiene: {
      plaquePct: c.hygienePlaquePct,
      gingivitis: c.hygieneGingivitis as TreatmentCardDTO["hygiene"]["gingivitis"],
      whiteSpots: c.hygieneWhiteSpots,
    },
    hasProgressPhoto: c.hasProgressPhoto,
    photoSetId: c.photoSetId,
    nextDate: c.nextDate ? c.nextDate.toISOString() : null,
    nextDurationMin: c.nextDurationMin,
    status: c.status as TreatmentCardDTO["status"],
    signedAt: c.signedAt ? c.signedAt.toISOString() : null,
    signedByName: c.signedBy ? `${c.signedBy.firstName} ${c.signedBy.lastName}`.trim() : null,
    elastics: c.elastics.map(
      (e): ElasticDTO => ({
        id: e.id,
        elasticClass: e.elasticClass as ElasticDTO["elasticClass"],
        config: e.config,
        zone: e.zone as ElasticDTO["zone"],
      }),
    ),
    iprPoints: c.iprPoints.map(
      (p): IPRPointDTO => ({
        id: p.id,
        toothA: p.toothA,
        toothB: p.toothB,
        amountMm: parseFloat(p.amountMm.toString()),
        done: p.done,
      }),
    ),
    brokenBrackets: c.brokenBrackets.map(
      (b): BrokenBracketDTO => ({
        id: b.id,
        toothFdi: b.toothFdi,
        brokenDate: b.brokenDate.toISOString(),
        reBondedDate: b.reBondedDate ? b.reBondedDate.toISOString() : null,
        notes: b.notes,
      }),
    ),
  };
}

function adaptTad(t: OrthoTAD): TADDTO {
  return {
    id: t.id,
    brand: t.brand,
    size: t.size,
    location: t.location,
    torqueNcm: t.torqueNcm,
    placedDate: t.placedDate.toISOString(),
    failed: t.failed,
    failedDate: t.failedDate ? t.failedDate.toISOString() : null,
    failureReason: t.failureReason,
  };
}

function adaptAux(a: OrthoAuxMechanics): AuxMechanicsDTO {
  return {
    id: a.id,
    expanderType: a.expanderType,
    expanderActivations: a.expanderActivations,
    expanderInstalledAt: a.expanderInstalledAt ? a.expanderInstalledAt.toISOString() : null,
    expanderRemovedAt: a.expanderRemovedAt ? a.expanderRemovedAt.toISOString() : null,
    distalizerType: a.distalizerType,
    distalizerInstalledAt: a.distalizerInstalledAt
      ? a.distalizerInstalledAt.toISOString()
      : null,
    distalizerRemovedAt: a.distalizerRemovedAt ? a.distalizerRemovedAt.toISOString() : null,
    notes: a.notes,
  };
}

function adaptTransition(
  t: OrthoPhaseTransition & { signedBy?: { firstName: string; lastName: string } | null },
): PhaseTransitionDTO {
  return {
    id: t.id,
    fromPhase: t.fromPhase,
    toPhase: t.toPhase,
    criteriaChecked: t.criteriaChecked,
    doctorNotes: t.doctorNotes,
    signedByName: t.signedBy ? `${t.signedBy.firstName} ${t.signedBy.lastName}`.trim() : "—",
    signedAt: t.signedAt.toISOString(),
    isOverride: t.isOverride,
    overrideReason: t.overrideReason,
  };
}

function adaptFlow(f: PatientFlow): PatientFlowDTO {
  return {
    id: f.id,
    status: f.status,
    chair: f.chair,
    enteredAt: f.enteredAt.toISOString(),
    exitedAt: f.exitedAt ? f.exitedAt.toISOString() : null,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  // Prisma Decimal
  const s = (v as { toString(): string }).toString();
  return parseFloat(s);
}

function avatarInitialsFrom(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

const TECHNIQUE_LABELS: Record<string, string> = {
  METAL_BRACKETS: "Brackets metálicos",
  CERAMIC_BRACKETS: "Brackets cerámicos",
  SELF_LIGATING_METAL: "Brackets metálicos auto-ligado",
  SELF_LIGATING_CERAMIC: "Brackets cerámicos auto-ligado",
  LINGUAL_BRACKETS: "Brackets linguales",
  CLEAR_ALIGNERS: "Alineadores transparentes",
  HYBRID: "Tratamiento híbrido",
};

function humanTechnique(t: OrthodonticTreatmentPlan["technique"]): string {
  return TECHNIQUE_LABELS[t] ?? t;
}

function deriveEstimatedEndDate(plan: OrthodonticTreatmentPlan | null): string | null {
  if (!plan) return null;
  const start = plan.installedAt ?? plan.startDate;
  if (!start || !plan.estimatedDurationMonths) return null;
  const d = new Date(start);
  d.setMonth(d.getMonth() + plan.estimatedDurationMonths);
  return d.toISOString();
}

function deriveNextAppointment(
  l: OrthoTabData,
  ctx: {
    doctor: { firstName: string; lastName: string } | null;
    chair: string | null;
  },
) {
  // Toma el próximo control con scheduledAt > now y attendance != NO_SHOW.
  const now = Date.now();
  const upcoming = l.controls
    .filter((c) => c.scheduledAt.getTime() >= now && c.attendance !== "NO_SHOW")
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  if (!upcoming) return null;
  // Doctor real (resuelto en loader desde attendedById). Antes el código
  // ponía l.patientName como placeholder — bug detectado en audit E2E.
  // Si no se pudo resolver, fallback "Doctor asignado" en vez de patientName.
  const doctorName = ctx.doctor
    ? `Dr/a. ${ctx.doctor.firstName} ${ctx.doctor.lastName}`.trim()
    : "Doctor asignado";
  return {
    date: upcoming.scheduledAt.toISOString(),
    durationMin: 30,
    type: "Control mensual ortodoncia",
    doctor: doctorName,
    chair: ctx.chair,
    prep: [],
  };
}

// ─── Re-exports para tipos auxiliares ──────────────────────────────────

export { PHASE_LABELS };

export type {
  OrthodonticDiagnosis,
  OrthodonticTreatmentPlan,
  OrthodonticPhase,
};
