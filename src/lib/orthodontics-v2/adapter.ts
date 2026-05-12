// Adapter Prisma row → ViewModel · convierte tipos Decimal/Date a strings
// serializables y normaliza Json fields a tipos discriminados.

import type {
  OrthoCase,
  OrthoDiagnosis,
  OrthoTreatmentPlan,
  ArchPlanned,
  PhotoSet,
  Photo,
  TreatmentCard,
  FinancialPlan,
  Installment,
  RetentionPlan,
  OrthoDocument,
  OrthoLabOrder,
  CommunicationLog,
} from "@prisma/client";
import type {
  OrthoCaseVM,
  OrthoDiagnosisVM,
  TreatmentPlanVM,
  ArchVM,
  PhotoSetVM,
  PhotoVM,
  TreatmentCardVM,
  FinancialPlanVM,
  InstallmentVM,
  RetentionPlanVM,
  OrthoDocumentVM,
  OrthoLabOrderVM,
  CommunicationLogVM,
  Annotation,
  Measurement,
  FinancialScenario,
} from "./types";

type PatientLite = { id: string; firstName: string; lastName: string; patientNumber: string };

export function toCaseVM(c: OrthoCase, patient: PatientLite): OrthoCaseVM {
  return {
    id: c.id,
    caseCode: c.caseCode,
    status: c.status,
    currentPhase: c.currentPhase,
    primaryDoctorId: c.primaryDoctorId,
    startedAt: c.startedAt?.toISOString() ?? null,
    estimatedEnd: c.estimatedEnd?.toISOString() ?? null,
    debondedAt: c.debondedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    patient,
  };
}

export function toDiagnosisVM(d: OrthoDiagnosis): OrthoDiagnosisVM {
  return {
    id: d.id,
    caseId: d.caseId,
    angleClass: d.angleClass,
    subCaninoR: d.subCaninoR,
    subCaninoL: d.subCaninoL,
    subMolarR: d.subMolarR,
    subMolarL: d.subMolarL,
    overjetMm: d.overjetMm,
    overbiteMm: d.overbiteMm,
    openBite: d.openBite,
    crossBite: d.crossBite,
    crowdingMaxMm: d.crowdingMaxMm,
    crowdingMandMm: d.crowdingMandMm,
    diastemas: Array.isArray(d.diastemas) ? (d.diastemas as never) : [],
    midlineDeviation: d.midlineDeviation,
    facialProfile: d.facialProfile,
    skeletalPattern: d.skeletalPattern,
    skeletalIssues: d.skeletalIssues,
    tmjFindings: (d.tmjFindings ?? {}) as { noise: boolean; pain: boolean; deflexionMm?: number; openingMm?: number },
    habits: d.habits,
    narrative: d.narrative,
  };
}

export function toArchVM(a: ArchPlanned): ArchVM {
  return {
    id: a.id,
    order: a.order,
    phase: a.phase,
    material: a.material,
    gauge: a.gauge,
    durationW: a.durationW,
    startDate: a.startDate?.toISOString() ?? null,
    endDate: a.endDate?.toISOString() ?? null,
    status: a.status,
    notes: a.notes,
  };
}

export function toPlanVM(
  p: OrthoTreatmentPlan & { archesPlanned: ArchPlanned[] },
): TreatmentPlanVM {
  return {
    id: p.id,
    caseId: p.caseId,
    appliances: p.appliances,
    extractions: p.extractions,
    elastics: (p.elastics ?? {}) as Record<string, unknown>,
    expanders: (p.expanders ?? {}) as Record<string, unknown>,
    tads: (p.tads ?? {}) as Record<string, unknown>,
    objectives: p.objectives,
    notes: p.notes,
    templateId: p.templateId,
    iprPlan: (p.iprPlan ?? {}) as Record<string, number>,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    signedDocUrl: p.signedDocUrl,
    arches: [...p.archesPlanned]
      .sort((a, b) => a.order - b.order)
      .map(toArchVM),
  };
}

export function toPhotoVM(p: Photo): PhotoVM {
  return {
    id: p.id,
    kind: p.kind,
    url: p.url,
    thumbUrl: p.thumbUrl,
    isFavorite: p.isFavorite,
    annotations: Array.isArray(p.annotations) ? (p.annotations as Annotation[]) : [],
    measurements: Array.isArray(p.measurements) ? (p.measurements as Measurement[]) : [],
    teethRef: p.teethRef,
    width: p.width,
    height: p.height,
  };
}

export function toPhotoSetVM(ps: PhotoSet & { photos: Photo[] }): PhotoSetVM {
  return {
    id: ps.id,
    stageCode: ps.stageCode,
    capturedAt: ps.capturedAt.toISOString(),
    notes: ps.notes,
    photos: ps.photos.map(toPhotoVM),
  };
}

export function toTreatmentCardVM(c: TreatmentCard): TreatmentCardVM {
  return {
    id: c.id,
    visitDate: c.visitDate.toISOString(),
    visitType: c.visitType,
    appointmentId: c.appointmentId,
    archPlacedId: c.archPlacedId,
    ligColor: c.ligColor,
    ligKind: c.ligKind,
    activations: c.activations,
    elasticUse: (c.elasticUse ?? {}) as { type?: string; prescribedHours?: string; reportedCompliance?: number },
    bracketsLost: c.bracketsLost,
    iprDoneDelta: (c.iprDoneDelta ?? {}) as Record<string, number>,
    soap: (c.soap ?? { s: "", o: "", a: "", p: "" }) as { s: string; o: string; a: string; p: string },
    homeInstr: c.homeInstr,
    nextSuggestedAt: c.nextSuggestedAt?.toISOString() ?? null,
    linkedPhotoSet: c.linkedPhotoSet,
    signedOffAt: c.signedOffAt?.toISOString() ?? null,
    createdBy: c.createdBy,
  };
}

export function toInstallmentVM(i: Installment): InstallmentVM {
  return {
    id: i.id,
    number: i.number,
    amount: i.amount.toString(),
    dueDate: i.dueDate.toISOString(),
    paidAt: i.paidAt?.toISOString() ?? null,
    invoiceId: i.invoiceId,
    status: i.status,
  };
}

export function toFinancialPlanVM(
  fp: FinancialPlan & { installments: Installment[] },
): FinancialPlanVM {
  return {
    id: fp.id,
    total: fp.total.toString(),
    downPayment: fp.downPayment.toString(),
    months: fp.months,
    monthly: fp.monthly.toString(),
    startDate: fp.startDate.toISOString(),
    scenarios: Array.isArray(fp.scenarios) ? (fp.scenarios as unknown as FinancialScenario[]) : [],
    activeScenarioId: fp.activeScenarioId,
    signAtHomeUrl: fp.signAtHomeUrl,
    signedByPatient: fp.signedByPatient,
    signedAt: fp.signedAt?.toISOString() ?? null,
    installments: [...fp.installments]
      .sort((a, b) => a.number - b.number)
      .map(toInstallmentVM),
  };
}

export function toRetentionPlanVM(rp: RetentionPlan): RetentionPlanVM {
  return {
    id: rp.id,
    retUpper: rp.retUpper,
    retLower: rp.retLower,
    fixedGauge: rp.fixedGauge,
    regimen: rp.regimen,
    checkpoints: rp.checkpoints.map((d) => d.toISOString()),
    checkpointsDone: (rp.checkpointsDone ?? {}) as Record<
      string,
      { doneAt: string; score?: number; comment?: string }
    >,
    beforeAfterPdf: rp.beforeAfterPdf,
    referralCode: rp.referralCode,
    referralReward: (rp.referralReward ?? { kind: "", label: "" }) as { kind: string; label: string },
    referralsCount: rp.referralsCount,
  };
}

export function toDocumentVM(d: OrthoDocument): OrthoDocumentVM {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    url: d.url,
    signedAt: d.signedAt?.toISOString() ?? null,
    signedToken: d.signedToken,
    createdAt: d.createdAt.toISOString(),
    createdBy: d.createdBy,
  };
}

export function toLabOrderVM(l: OrthoLabOrder): OrthoLabOrderVM {
  return {
    id: l.id,
    itemCode: l.itemCode,
    itemLabel: l.itemLabel,
    labPartner: l.labPartner,
    trackingCode: l.trackingCode,
    sentAt: l.sentAt?.toISOString() ?? null,
    receivedAt: l.receivedAt?.toISOString() ?? null,
    status: l.status,
    notes: l.notes,
  };
}

export function toCommVM(c: CommunicationLog): CommunicationLogVM {
  return {
    id: c.id,
    channel: c.channel,
    direction: (c.direction === "IN" ? "IN" : "OUT") as "IN" | "OUT",
    body: c.body,
    templateId: c.templateId,
    sentAt: c.sentAt.toISOString(),
    externalId: c.externalId,
  };
}
