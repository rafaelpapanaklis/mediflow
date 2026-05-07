// Orthodontics rediseño Fase 1 + 1.5 — loader resiliente.
//
// Combina loadOrthoData (legacy) + queries opcionales a las tablas nuevas.
// Si las nuevas tablas aún no existen en la BD (migración no aplicada),
// devuelve arrays vacíos sin romper la UI.
//
// Devuelve además el `bundle` con los DTOs que las secciones E/F/G/H/I del
// orchestrator esperan como props (historicalPhotoSets, installments,
// quoteScenarios, cfdiRecords, retentionRegimen, retainerCheckups,
// npsSchedules, referralCode, consents, labOrders, referralLetters,
// whatsappLog) + treatmentStatus derivado del plan.

import { prisma } from "@/lib/prisma";
import { loadOrthoData, type OrthoTabData } from "@/lib/orthodontics/load-data";
import {
  adaptToOrthoRedesignViewModel,
  type AdapterInput,
} from "./adapter";
import type {
  OrthoRedesignViewModel,
  WhatsAppEntryDTO,
} from "@/components/specialties/orthodontics/redesign/types";
import type {
  PhotoSetSummary,
  PhotoStage,
} from "@/components/specialties/orthodontics/redesign/sections/SectionPhotos";
import type {
  ConsentRow,
  LabOrderRow,
  ReferralLetterRow,
  WhatsAppLogEntry,
} from "@/components/specialties/orthodontics/redesign/sections/SectionDocs";
import type {
  RetainerCheckupDTO,
  RetentionRegimenDTO,
  RetainerArchwireGauge,
} from "@/components/specialties/orthodontics/redesign/sections/SectionRetention";
import type {
  NpsScheduleDTO,
  ReferralCodeDTO,
} from "@/components/specialties/orthodontics/redesign/sections/SectionPostTreatment";
import type {
  CFDIRecordDTO,
  OrthoInstallmentDTO,
  QuoteScenarioDTO,
} from "@/components/specialties/orthodontics/redesign/types-finance";

export interface LoadOrthoRedesignInput {
  clinicId: string;
  patientId: string;
}

export type OrthoTreatmentStatus =
  | "no-iniciado"
  | "en-tratamiento"
  | "retencion"
  | "completado";

/**
 * Bundle con todos los DTOs que las secciones E/F/G/H/I del orchestrator
 * esperan como props. Se construye en el loader y se serializa al cliente
 * vía la página server-component.
 */
export interface OrthoRedesignBundle {
  historicalPhotoSets: PhotoSetSummary[];
  installments: OrthoInstallmentDTO[];
  quoteScenarios: QuoteScenarioDTO[];
  cfdiRecords: CFDIRecordDTO[];
  retentionRegimen: RetentionRegimenDTO | null;
  retainerCheckups: RetainerCheckupDTO[];
  npsSchedules: NpsScheduleDTO[];
  referralCode: ReferralCodeDTO | null;
  consents: ConsentRow[];
  labOrders: LabOrderRow[];
  referralLetters: ReferralLetterRow[];
  whatsappLog: WhatsAppLogEntry[];
  /** Top-3 más recientes para el RightRail. */
  whatsappRecent: WhatsAppEntryDTO[];
  treatmentStatus: OrthoTreatmentStatus;
}

export interface LoadOrthoRedesignResult {
  viewModel: OrthoRedesignViewModel;
  legacy: OrthoTabData;
  bundle: OrthoRedesignBundle;
}

export async function loadOrthoRedesignData(
  input: LoadOrthoRedesignInput,
): Promise<LoadOrthoRedesignResult | null> {
  const legacy = await loadOrthoData(input);
  if (!legacy) return null;

  const planId = legacy.plan?.id ?? null;

  // Queries Fase 1 + Fase 1.5. Resilientes a tabla inexistente.
  const [
    wireSteps,
    treatmentCards,
    tads,
    auxMechanics,
    phaseTransitions,
    patientFlow,
    quoteScenariosRaw,
    retentionRegimenRaw,
    npsSchedulesRaw,
    referralCodeRaw,
    consentsRaw,
    labOrdersRaw,
    referralLettersRaw,
    whatsappThreads,
  ] = await Promise.all([
    planId
      ? safeArray(() =>
          prisma.orthoWireStep.findMany({
            where: { treatmentPlanId: planId },
            orderBy: { orderIndex: "asc" },
          }),
        )
      : Promise.resolve([]),
    planId
      ? safeArray(() =>
          prisma.orthoTreatmentCard.findMany({
            where: { treatmentPlanId: planId, deletedAt: null },
            orderBy: { cardNumber: "asc" },
            include: {
              elastics: true,
              iprPoints: true,
              brokenBrackets: true,
              signedBy: { select: { firstName: true, lastName: true } },
            },
          }),
        )
      : Promise.resolve([]),
    planId
      ? safeArray(() =>
          prisma.orthoTAD.findMany({
            where: { treatmentPlanId: planId, deletedAt: null },
            orderBy: { placedDate: "desc" },
          }),
        )
      : Promise.resolve([]),
    planId
      ? safeOne(() =>
          prisma.orthoAuxMechanics.findUnique({
            where: { treatmentPlanId: planId },
          }),
        )
      : Promise.resolve(null),
    planId
      ? safeArray(() =>
          prisma.orthoPhaseTransition.findMany({
            where: { treatmentPlanId: planId },
            orderBy: { signedAt: "desc" },
            take: 20,
            include: { signedBy: { select: { firstName: true, lastName: true } } },
          }),
        )
      : Promise.resolve([]),
    safeOne(() =>
      prisma.patientFlow.findFirst({
        where: {
          clinicId: input.clinicId,
          patientId: input.patientId,
          exitedAt: null,
        },
        orderBy: { enteredAt: "desc" },
      }),
    ),
    planId
      ? safeArray(() =>
          prisma.orthoQuoteScenario.findMany({
            where: { treatmentPlanId: planId, clinicId: input.clinicId },
            orderBy: { createdAt: "asc" },
          }),
        )
      : Promise.resolve([]),
    planId
      ? safeOne(() =>
          prisma.orthoRetentionRegimen.findUnique({
            where: { treatmentPlanId: planId },
            include: { checkups: { orderBy: { monthsFromDebond: "asc" } } },
          }),
        )
      : Promise.resolve(null),
    planId
      ? safeArray(() =>
          prisma.orthoNpsSchedule.findMany({
            where: { treatmentPlanId: planId, clinicId: input.clinicId },
            orderBy: { scheduledAt: "asc" },
          }),
        )
      : Promise.resolve([]),
    planId
      ? safeOne(() =>
          prisma.orthoReferralCode.findUnique({
            where: { treatmentPlanId: planId },
          }),
        )
      : Promise.resolve(null),
    planId
      ? safeArray(() =>
          prisma.orthodonticConsent.findMany({
            where: { treatmentPlanId: planId, clinicId: input.clinicId },
            orderBy: { signedAt: "desc" },
          }),
        )
      : Promise.resolve([]),
    safeArray(() =>
      prisma.labOrder.findMany({
        where: {
          clinicId: input.clinicId,
          patientId: input.patientId,
          module: "orthodontics",
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      }),
    ),
    safeArray(() =>
      prisma.referral.findMany({
        where: { clinicId: input.clinicId, patientId: input.patientId },
        orderBy: { sentAt: "desc" },
      }),
    ),
    safeArray(() =>
      prisma.inboxThread.findMany({
        where: {
          clinicId: input.clinicId,
          patientId: input.patientId,
          channel: "WHATSAPP",
        },
        orderBy: { lastMessageAt: "desc" },
        include: {
          messages: {
            orderBy: { sentAt: "desc" },
            take: 30,
            select: {
              id: true,
              direction: true,
              body: true,
              sentAt: true,
              isInternal: true,
            },
          },
        },
        take: 5,
      }),
    ),
  ]);

  const attendancePct = computeAttendancePct(legacy);
  const elasticsCompliancePct = 0;

  // ── Construye bundle ──────────────────────────────────────────────────
  const historicalPhotoSets = adaptPhotoSets(legacy.photoSets);
  const installments = legacy.installments.map(adaptInstallment);
  // CFDI 4.0 (M1) — el timbrado real con Facturapi llega en Fase 2; mientras
  // tanto exponemos lista vacía. La UI muestra empty state con CTA disabled.
  const cfdiRecords: CFDIRecordDTO[] = [];

  const quoteScenarios = (quoteScenariosRaw as Array<Record<string, unknown>>).map(
    adaptQuoteScenario,
  );
  const retentionRegimen = retentionRegimenRaw
    ? adaptRetentionRegimen(retentionRegimenRaw as Record<string, unknown>)
    : null;
  const retainerCheckups = retentionRegimenRaw
    ? adaptRetainerCheckups(
        ((retentionRegimenRaw as { checkups?: unknown[] }).checkups ?? []) as Array<
          Record<string, unknown>
        >,
      )
    : [];
  const npsSchedules = (npsSchedulesRaw as Array<Record<string, unknown>>).map(
    adaptNpsSchedule,
  );
  const referralCode = referralCodeRaw
    ? adaptReferralCode(referralCodeRaw as Record<string, unknown>)
    : null;
  const consents = (consentsRaw as Array<Record<string, unknown>>).map(adaptConsent);
  const labOrders = (labOrdersRaw as Array<Record<string, unknown>>).map(adaptLabOrder);
  const referralLetters = (referralLettersRaw as Array<Record<string, unknown>>).map(
    adaptReferralLetter,
  );

  const allWhatsApp = flattenWhatsAppMessages(
    whatsappThreads as Array<Record<string, unknown>>,
    legacy.patientName,
  );
  const whatsappLog = allWhatsApp.log;
  const whatsappRecent = allWhatsApp.recent;

  const treatmentStatus = deriveTreatmentStatus(legacy);

  const adapterInput: AdapterInput = {
    legacy,
    wireSteps: wireSteps as AdapterInput["wireSteps"],
    treatmentCards: treatmentCards as AdapterInput["treatmentCards"],
    tads: tads as AdapterInput["tads"],
    auxMechanics: auxMechanics as AdapterInput["auxMechanics"],
    phaseTransitions: phaseTransitions as AdapterInput["phaseTransitions"],
    patientFlow: patientFlow as AdapterInput["patientFlow"],
    attendancePct,
    elasticsCompliancePct,
  };

  const viewModel = adaptToOrthoRedesignViewModel(adapterInput);
  // Inyecta whatsappRecent en el viewModel para que RightRail lo lea desde vm.
  viewModel.whatsappRecent = whatsappRecent;

  const bundle: OrthoRedesignBundle = {
    historicalPhotoSets,
    installments,
    quoteScenarios,
    cfdiRecords,
    retentionRegimen,
    retainerCheckups,
    npsSchedules,
    referralCode,
    consents,
    labOrders,
    referralLetters,
    whatsappLog,
    whatsappRecent,
    treatmentStatus,
  };

  return { viewModel, legacy, bundle };
}

// ─── Adapters Fase 1.5 ──────────────────────────────────────────────────

function adaptPhotoSets(sets: OrthoTabData["photoSets"]): PhotoSetSummary[] {
  const STAGE_LABELS: Record<PhotoStage, string> = {
    T0: "Inicial",
    T1: "3 meses",
    T2: "6 meses",
    CONTROL: "Control",
  };
  return sets.map((s) => {
    const stage = (s.setType as PhotoStage) ?? "T0";
    const photoIds = [
      s.photoFrontalId,
      s.photoProfileId,
      s.photoSmileId,
      s.photoIntraFrontalId,
      s.photoIntraLateralRId,
      s.photoIntraLateralLId,
      s.photoOcclusalUpperId,
      s.photoOcclusalLowerId,
    ];
    const photoCount = photoIds.filter(Boolean).length;
    return {
      stage,
      date: s.capturedAt instanceof Date ? s.capturedAt.toISOString() : null,
      label: STAGE_LABELS[stage] ?? stage,
      photoCount,
      hasRxPan: false,
      hasRxLatCef: false,
    };
  });
}

function adaptInstallment(i: OrthoTabData["installments"][number]): OrthoInstallmentDTO {
  const status = (i.status as OrthoInstallmentDTO["status"]) ?? "PENDING";
  return {
    id: i.id,
    installmentNumber: i.installmentNumber,
    amount: toNumber(i.amount),
    dueDate: i.dueDate.toISOString(),
    status,
    paidAt: i.paidAt ? i.paidAt.toISOString() : null,
    // cfdiUuid se llenará en Fase 2 cuando Facturapi timbre el comprobante.
    cfdiUuid: null,
  };
}

function adaptQuoteScenario(s: Record<string, unknown>): QuoteScenarioDTO {
  return {
    id: String(s.id),
    label: String(s.label ?? ""),
    paymentMode: s.paymentMode as QuoteScenarioDTO["paymentMode"],
    downPayment: toNumber(s.downPayment),
    monthlyAmount: toNumber(s.monthlyAmount),
    monthsCount: Number(s.monthsCount ?? 0),
    totalAmount: toNumber(s.totalAmount),
    discountPct:
      s.discountPct == null ? null : Number(s.discountPct),
    badge: (s.badge as string | null) ?? null,
    includes: ((s.includes as string[] | undefined) ?? []) as string[],
    status: s.status as QuoteScenarioDTO["status"],
  };
}

function adaptRetentionRegimen(r: Record<string, unknown>): RetentionRegimenDTO {
  const RETAINER_LABELS: Record<string, string> = {
    HAWLEY_SUP: "Hawley sup",
    HAWLEY_INF: "Hawley inf",
    ESSIX_SUP: "Essix sup",
    ESSIX_INF: "Essix inf",
    OTHER: "Otro",
  };
  const upperRetainer = r.upperRetainer as string | null;
  const lowerRetainer = r.lowerRetainer as string | null;
  return {
    id: (r.id as string | null) ?? null,
    upperLabel: upperRetainer ? RETAINER_LABELS[upperRetainer] ?? upperRetainer : null,
    upperDescription: (r.upperDescription as string | null) ?? null,
    lowerLabel: lowerRetainer ? RETAINER_LABELS[lowerRetainer] ?? lowerRetainer : null,
    lowerDescription: (r.lowerDescription as string | null) ?? null,
    fixedLingualPresent: Boolean(r.fixedLingualPresent),
    fixedLingualGauge: (r.fixedLingualGauge as RetainerArchwireGauge | null) ?? null,
    regimenDescription:
      (r.regimenDescription as string | null) ??
      "24/7 año 1 · nocturno años 2-5",
    preSurveyEnabled: Boolean(r.preSurveyEnabled ?? true),
    debondedAt:
      r.debondedAt instanceof Date ? r.debondedAt.toISOString() : null,
  };
}

function adaptRetainerCheckups(
  checkups: Array<Record<string, unknown>>,
): RetainerCheckupDTO[] {
  return checkups.map((c) => ({
    id: String(c.id),
    monthsFromDebond: Number(c.monthsFromDebond ?? 0),
    scheduledDate:
      c.scheduledDate instanceof Date
        ? c.scheduledDate.toISOString()
        : String(c.scheduledDate ?? ""),
    status: c.status as RetainerCheckupDTO["status"],
  }));
}

function adaptNpsSchedule(n: Record<string, unknown>): NpsScheduleDTO {
  return {
    npsType: n.npsType as NpsScheduleDTO["npsType"],
    status: n.status as NpsScheduleDTO["status"],
    scheduledAt:
      n.scheduledAt instanceof Date
        ? n.scheduledAt.toISOString()
        : String(n.scheduledAt ?? ""),
    npsScore: n.npsScore == null ? null : Number(n.npsScore),
    googleReviewTriggered: Boolean(n.googleReviewTriggered),
  };
}

function adaptReferralCode(r: Record<string, unknown>): ReferralCodeDTO {
  return {
    code: String(r.code ?? ""),
    referralCount: Number(r.referralCount ?? 0),
    rewardLabel: (r.rewardLabel as string | null) ?? null,
  };
}

function adaptConsent(c: Record<string, unknown>): ConsentRow {
  const TYPE_LABELS: Record<string, string> = {
    TREATMENT: "Consentimiento de tratamiento",
    FINANCIAL: "Acuerdo financiero",
    MINOR_ASSENT: "Asentimiento menor de edad",
    PHOTO_USE: "Uso de fotografía clínica",
  };
  const consentType = (c.consentType as string | null) ?? "TREATMENT";
  return {
    name: TYPE_LABELS[consentType] ?? consentType,
    signed: Boolean(c.signedAt),
    date:
      c.signedAt instanceof Date ? c.signedAt.toISOString() : null,
    risks:
      (c.notes as string | null) ?? "Consentimiento informado del paciente.",
  };
}

function adaptLabOrder(o: Record<string, unknown>): LabOrderRow {
  const STATUS_MAP: Record<string, LabOrderRow["status"]> = {
    draft: "borrador",
    sent: "enviada",
    in_progress: "en proceso",
    received: "recibida",
    cancelled: "cancelada",
  };
  const spec = (o.spec as Record<string, unknown> | null) ?? null;
  const catalog = (spec?.catalog as string | undefined) ?? "Orden de laboratorio";
  const description =
    (spec?.description as string | undefined) ??
    (o.notes as string | null) ??
    "—";
  const lab =
    (spec?.lab as string | undefined) ?? "Laboratorio sin asignar";
  return {
    id: String(o.id),
    catalog,
    description,
    lab,
    orderedAt:
      o.sentAt instanceof Date
        ? o.sentAt.toISOString()
        : o.createdAt instanceof Date
          ? o.createdAt.toISOString()
          : null,
    status: STATUS_MAP[String(o.status)] ?? "borrador",
  };
}

function adaptReferralLetter(r: Record<string, unknown>): ReferralLetterRow {
  const STATUS_MAP: Record<string, ReferralLetterRow["status"]> = {
    SENT: "enviada",
    ACCEPTED: "en proceso",
    REJECTED: "borrador",
    COMPLETED: "enviada",
  };
  return {
    id: String(r.id),
    recipient: String(r.toClinicName ?? r.toDoctorName ?? "Especialista externo"),
    reason: String(r.reason ?? ""),
    sentAt: r.sentAt instanceof Date ? r.sentAt.toISOString() : null,
    status: STATUS_MAP[String(r.status)] ?? "borrador",
  };
}

interface FlattenedWhatsApp {
  log: WhatsAppLogEntry[];
  recent: WhatsAppEntryDTO[];
}

function flattenWhatsAppMessages(
  threads: Array<Record<string, unknown>>,
  patientName: string,
): FlattenedWhatsApp {
  type RawMsg = {
    id: string;
    direction: string;
    body: string;
    sentAt: Date;
    isInternal: boolean;
  };
  const all: Array<{ msg: RawMsg }> = [];
  for (const t of threads) {
    const msgs = ((t.messages as RawMsg[] | undefined) ?? []).filter(
      (m) => !m.isInternal,
    );
    for (const m of msgs) all.push({ msg: m });
  }
  all.sort((a, b) => b.msg.sentAt.getTime() - a.msg.sentAt.getTime());

  const log: WhatsAppLogEntry[] = all.map(({ msg }) => ({
    id: msg.id,
    at: relativeLabel(msg.sentAt),
    direction: msg.direction === "OUT" ? "out" : "in",
    template: null,
    preview: truncate(msg.body, 140),
    patientName,
  }));

  const recent: WhatsAppEntryDTO[] = all.slice(0, 3).map(({ msg }) => ({
    id: msg.id,
    at: relativeLabel(msg.sentAt),
    direction: msg.direction === "OUT" ? "out" : "in",
    template: null,
    preview: truncate(msg.body, 80),
  }));

  return { log, recent };
}

function relativeLabel(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  if (hr < 24) return `hace ${hr} h`;
  if (day < 7) return `hace ${day} d`;
  if (day < 30) return `hace ${Math.floor(day / 7)} sem`;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function deriveTreatmentStatus(legacy: OrthoTabData): OrthoTreatmentStatus {
  const plan = legacy.plan;
  if (!plan) return "no-iniciado";
  if (plan.status === "RETENTION") return "retencion";
  if (plan.status === "COMPLETED") return "completado";
  return "en-tratamiento";
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  const s = (v as { toString(): string }).toString();
  return parseFloat(s);
}

// ─── Helpers genéricos ─────────────────────────────────────────────────

async function safeArray<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTableError(e)) return [];
    console.error("[ortho-redesign loader] query failed:", e);
    return [];
  }
}

async function safeOne<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTableError(e)) return null;
    console.error("[ortho-redesign loader] query failed:", e);
    return null;
  }
}

function isMissingTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  // Postgres / Prisma codes para tabla / relación inexistente.
  return code === "P2021" || code === "P2022";
}

function computeAttendancePct(legacy: OrthoTabData): number {
  const last = legacy.controls
    .slice()
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
    .slice(0, 6);
  if (last.length === 0) return 100;
  const attended = last.filter((c) => c.attendance === "ATTENDED").length;
  return Math.round((attended / last.length) * 100);
}
