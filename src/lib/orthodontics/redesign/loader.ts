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
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import type { ElasticsLogEntry } from "@/lib/orthodontics/elastics/compliance";
import {
  VENTANA_ELASTICOS_DIAS,
  asistenciaDelCaso,
  proximaCitaDelCaso,
  usoDeElasticos,
  visitasDelCaso,
  type CitaDeControlDelCaso,
} from "./indicadores-del-caso";
import type { VisibilityViewer } from "@/lib/patient-visibility";
import { signMaybeUrls } from "@/lib/storage";
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
  /** Datos del plan financiero — para DrawerEditFinancialPlan (BUG 7). */
  financialPlan: {
    totalAmount: number;
    initialDownPayment: number;
    installmentCount: number;
    installmentAmount: number;
    paidAmount: number;
  } | null;
}

export interface LoadOrthoRedesignResult {
  viewModel: OrthoRedesignViewModel;
  legacy: OrthoTabData;
  bundle: OrthoRedesignBundle;
}

export async function loadOrthoRedesignData(
  input: LoadOrthoRedesignInput,
  viewer: VisibilityViewer,
): Promise<LoadOrthoRedesignResult | null> {
  // Visibilidad por paciente: propaga el viewer al loader legacy, que filtra su query raíz.
  const legacy = await loadOrthoData(input, viewer);
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
    // H61: Documentos lee el consentimiento GENERAL (ConsentForm, el mismo de
    // la ficha → Consentimientos), no el modelo propio de ortodoncia que el
    // alcance manda ocultar: antes una pantalla decía «FIRMADO» y esta «Sin
    // consentimientos».
    safeArray(() =>
      prisma.consentForm.findMany({
        where: {
          clinicId: input.clinicId,
          patientId: input.patientId,
          procedureKey: "ortodoncia",
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: {
          procedure: true,
          signedAt: true,
          revokedAt: true,
          signerName: true,
          signerRelation: true,
          doctorSignedAt: true,
        },
      }),
    ),
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

  // ws1-t4 ronda 6 (filas 8 y 9 de la revisión de lógica de uso): la
  // asistencia, el uso de elásticos, las visitas y la próxima cita salen de lo
  // que pasó de verdad —citas de control de la Agenda, hojas de control y lo
  // que marca el paciente en el portal—, no de tablas que ya nadie llena. La
  // cuenta es de `indicadores-del-caso.ts` (puro, con tests). Va DESPUÉS de la
  // tanda de arriba, no junto a ella: el pooler se satura por encima de 7.
  const ahora = new Date();
  const indicadores = await cargarIndicadoresDelCaso(input.clinicId, input.patientId, planId, ahora);
  const hojasDeControl = (treatmentCards as Array<{ appointmentId?: string | null; visitDate: Date }>).map((c) => ({
    appointmentId: c.appointmentId ?? null,
    visitDate: c.visitDate,
  }));
  const attendance = asistenciaDelCaso(indicadores.citas, hojasDeControl, ahora);
  const elastics = usoDeElasticos(indicadores.elasticos);
  const visitasReales = visitasDelCaso(indicadores.citas, hojasDeControl, ahora, indicadores.zona);
  // Los dos números de siempre se conservan para quien todavía los lee; ya no
  // se inventan: sin datos valen 0 y la pantalla pinta «—» (ver `attendance`).
  const attendancePct = attendance.pct ?? 0;
  const elasticsCompliancePct = elastics.pct ?? 0;

  // H10 (QA ws1-t9): la cita real que Recepción crea desde la Agenda vive
  // en `Appointment` (mismo origen que ya usan Tablero y Alertas,
  // tablero-data.ts) — `OrthodonticControlAppointment` es una tabla aparte
  // que solo llena el asistente del módulo de especialidad en pausa
  // (ControlAppointmentWizard) y que hoy nadie usa. Preferimos la cita real;
  // si no hay ninguna, caemos al resolve legacy (y `deriveNextAppointment`
  // sigue mirando `l.controls` como antes).
  // Fila 9: una cita de HOY cuya hora ya pasó sigue siendo «la de hoy»
  // mientras nadie la cierre (`proximaCitaDelCaso`); antes, a mediodía, el
  // control de las 10:00 desaparecía y la cabecera decía «Sin programar».
  const proxima = proximaCitaDelCaso(indicadores.citas, ahora, indicadores.zona);
  const nextRealAppointment = proxima
    ? { startsAt: proxima.startsAt, endsAt: proxima.endsAt, doctor: proxima.doctor, chair: proxima.chair }
    : null;
  const nextAppointmentDoctor =
    nextRealAppointment?.doctor ??
    (await resolveNextAppointmentDoctor(input.clinicId, input.patientId));
  // Sillón de la próxima cita — de la cita real si la tiene; si no, heredado
  // del PatientFlow activo.
  const nextAppointmentChair =
    nextRealAppointment?.chair ??
    (patientFlow as { chair?: string | null } | null)?.chair ??
    null;

  // ── Construye bundle ──────────────────────────────────────────────────
  const historicalPhotoSets = await adaptPhotoSets(legacy.photoSets);
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
    attendance,
    elastics,
    visitas: {
      total: visitasReales.total,
      ultima: visitasReales.ultima ? visitasReales.ultima.toISOString() : null,
      primera: visitasReales.primera ? visitasReales.primera.toISOString() : null,
    },
    nextAppointmentDoctor,
    nextAppointmentChair,
    nextRealAppointment,
    // Revisión cruzada (REPORTE-ws1-t1.md, "## Arreglos de la revisión"):
    // `legacy` ya trae la factura real resuelta (load-data.ts) — el adapter
    // solo la usa cuando `plan.invoiceId` no es null, así que pasarla aquí
    // siempre es seguro.
    realInvoiceTotal: legacy.invoiceTotal,
    realInvoicePaid: legacy.invoicePaid,
  };

  const viewModel = adaptToOrthoRedesignViewModel(adapterInput);
  // Inyecta whatsappRecent en el viewModel para que RightRail lo lea desde vm.
  viewModel.whatsappRecent = whatsappRecent;

  const financialPlan = legacy.paymentPlan
    ? {
        totalAmount: toNumber(legacy.paymentPlan.totalAmount),
        initialDownPayment: toNumber(legacy.paymentPlan.initialDownPayment),
        installmentCount: legacy.paymentPlan.installmentCount,
        installmentAmount: toNumber(legacy.paymentPlan.installmentAmount),
        paidAmount: toNumber(legacy.paymentPlan.paidAmount),
      }
    : null;

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
    financialPlan,
  };

  return { viewModel, legacy, bundle };
}

// ─── Adapters Fase 1.5 ──────────────────────────────────────────────────

/**
 * Adapter de OrthoPhotoSet → PhotoSetSummary. Hace dos cosas extra vs la
 * versión previa:
 *   1. Devuelve setId para que el cliente pueda invocar uploadPhotoToSet
 *      sin tener que crear el set primero.
 *   2. Mapea cada columna `photo*Id` a su URL firmada (Supabase Storage)
 *      o URL pública (placeholder picsum) usando signMaybeUrls. Las URLs
 *      van por slot en el campo `slots` para que SectionPhotos las muestre
 *      pre-pobladas y persistan al recargar.
 */
async function adaptPhotoSets(
  sets: OrthoTabData["photoSets"],
): Promise<PhotoSetSummary[]> {
  const STAGE_LABELS: Record<PhotoStage, string> = {
    T0: "Inicial",
    T1: "3 meses",
    T2: "6 meses",
    CONTROL: "Control",
  };
  // Map column → slot id que usa SectionPhotos. Las 8 vistas matchean los
  // 8 slots persistibles (los slots `sobremordida`/`resalte` del mockup
  // son extra-AAO y no tienen columna en OrthoPhotoSet).
  const COLUMN_TO_SLOT: Record<string, string> = {
    photoFrontal: "normal",
    photoProfile: "lateral",
    photoSmile: "sonrisa",
    photoIntraFrontal: "frontal",
    photoIntraLateralR: "lat_der",
    photoIntraLateralL: "lat_izq",
    photoOcclusalUpper: "oclusal_sup",
    photoOcclusalLower: "oclusal_inf",
  };

  // Collect all URLs across all sets for batch signing.
  const allUrls: Array<string | null> = [];
  const setSlotMap: Array<Array<{ slotId: string; idx: number }>> = [];
  for (const s of sets) {
    const cols = [
      ["photoFrontal", s.photoFrontal?.url ?? null],
      ["photoProfile", s.photoProfile?.url ?? null],
      ["photoSmile", s.photoSmile?.url ?? null],
      ["photoIntraFrontal", s.photoIntraFrontal?.url ?? null],
      ["photoIntraLateralR", s.photoIntraLateralR?.url ?? null],
      ["photoIntraLateralL", s.photoIntraLateralL?.url ?? null],
      ["photoOcclusalUpper", s.photoOcclusalUpper?.url ?? null],
      ["photoOcclusalLower", s.photoOcclusalLower?.url ?? null],
    ] as const;
    const setEntries: Array<{ slotId: string; idx: number }> = [];
    for (const [colName, url] of cols) {
      if (url) {
        const slotId = COLUMN_TO_SLOT[colName];
        if (slotId) {
          setEntries.push({ slotId, idx: allUrls.length });
          allUrls.push(url);
        }
      }
    }
    setSlotMap.push(setEntries);
  }

  const signed = await signMaybeUrls(allUrls);

  return sets.map((s, setIdx) => {
    const stage = (s.setType as PhotoStage) ?? "T0";
    const entries = setSlotMap[setIdx] ?? [];
    const slots: Record<string, { url: string; uploadedAt: string }> = {};
    for (const entry of entries) {
      const url = signed[entry.idx] ?? "";
      if (url) {
        slots[entry.slotId] = {
          url,
          uploadedAt:
            s.capturedAt instanceof Date
              ? s.capturedAt.toLocaleString("es-MX", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "",
        };
      }
    }
    return {
      setId: s.id,
      stage,
      date: s.capturedAt instanceof Date ? s.capturedAt.toISOString() : null,
      label: STAGE_LABELS[stage] ?? stage,
      photoCount: Object.keys(slots).length,
      slots,
      hasRxPan: false,
      hasRxLatCef: false,
    };
  });
}

interface CitaDelCasoCargada extends CitaDeControlDelCaso {
  doctor: { firstName: string; lastName: string } | null;
  chair: string | null;
}

/**
 * ws1-t4 ronda 6: lo que necesitan los indicadores del caso, en una tanda de
 * tres lecturas: la zona de la clínica, las citas de control del paciente y
 * lo que se ha registrado de elásticos. Todo por clínica. Si algo falla o la
 * tabla todavía no existe, esa parte sale vacía y la ficha se pinta igual.
 */
async function cargarIndicadoresDelCaso(
  clinicId: string,
  patientId: string,
  planId: string | null,
  ahora: Date,
): Promise<{ zona: string; citas: CitaDelCasoCargada[]; elasticos: ElasticsLogEntry[] }> {
  const vacio = { zona: "America/Mexico_City", citas: [], elasticos: [] };
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId || !patientId) return vacio;
  const desdeElasticos = new Date(ahora.getTime() - VENTANA_ELASTICOS_DIAS * 86_400_000);
  try {
    const [clinica, citas, elasticos] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } }),
      prisma.appointment.findMany({
        where: {
          clinicId,
          patientId,
          type: TIPO_CITA_CONTROL_ORTO,
          startsAt: {
            gte: new Date(ahora.getTime() - 3 * 366 * 86_400_000),
            lte: new Date(ahora.getTime() + 366 * 86_400_000),
          },
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          doctor: { select: { firstName: true, lastName: true } },
          resource: { select: { name: true } },
        },
        take: 500,
      }),
      planId
        ? safeArray(() =>
            prisma.orthodonticElasticsLog.findMany({
              where: { clinicId, treatmentPlanId: planId, logDate: { gte: desdeElasticos } },
              select: { logDate: true, wornHours: true, usedElastics: true },
              orderBy: { logDate: "desc" },
            }),
          )
        : Promise.resolve([]),
    ]);
    return {
      zona: clinica?.timezone || vacio.zona,
      citas: citas.map((c) => ({
        id: c.id,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        status: c.status,
        doctor: c.doctor,
        chair: c.resource?.name ?? null,
      })),
      elasticos: (elasticos as Array<{ logDate: Date; wornHours: number | null; usedElastics: boolean }>).map((e) => ({
        date: e.logDate.toISOString().slice(0, 10),
        wornHours: e.wornHours,
        usedElastics: e.usedElastics,
      })),
    };
  } catch (e) {
    console.error("[ortho-redesign] cargarIndicadoresDelCaso failed:", e);
    return vacio;
  }
}

/**
 * H10 (QA ws1-t9): la próxima cita de control REAL — la que Recepción crea
 * desde la Agenda normal (`Appointment`, type = TIPO_CITA_CONTROL_ORTO).
 * Mismo origen y mismo filtro que ya usa el Tablero
 * (`tablero-data.ts#loadTodayControlsWithIndications`): sin esto, la ficha
 * solo miraba `OrthodonticControlAppointment` (una tabla aparte que llena
 * un asistente del módulo de especialidad en pausa y que nadie usa hoy) y
 * decía "Sin programar" con una cita de hoy ya visible en Agenda/Tablero.
 */
async function resolveNextRealAppointment(
  clinicId: string,
  patientId: string,
): Promise<{
  startsAt: Date;
  endsAt: Date;
  doctor: { firstName: string; lastName: string } | null;
  chair: string | null;
} | null> {
  try {
    const next = await prisma.appointment.findFirst({
      where: {
        clinicId,
        patientId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: { gte: new Date() },
        status: { not: "CANCELLED" },
      },
      orderBy: { startsAt: "asc" },
      select: {
        startsAt: true,
        endsAt: true,
        doctor: { select: { firstName: true, lastName: true } },
        resource: { select: { name: true } },
      },
    });
    if (!next) return null;
    return {
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      doctor: next.doctor,
      chair: next.resource?.name ?? null,
    };
  } catch (e) {
    console.error("[ortho-redesign] resolveNextRealAppointment failed:", e);
    return null;
  }
}

/**
 * Resuelve el doctor (firstName + lastName) que atenderá la próxima cita
 * ortodóntica del paciente. Busca el OrthodonticControlAppointment con
 * scheduledAt > now más cercano, lee su `attendedById` y trae el User.
 *
 * Sin este resolve, el adapter usaba `l.patientName` como placeholder
 * (bug heredado del Fase 1) — la UI mostraba "Gabriela Hernández Ruiz"
 * como doctor de la próxima cita.
 *
 * H10: fallback si no hay cita REAL (ver `resolveNextRealAppointment`) —
 * clínicas que todavía usan el asistente legacy siguen viendo doctor.
 */
async function resolveNextAppointmentDoctor(
  clinicId: string,
  patientId: string,
): Promise<{ firstName: string; lastName: string } | null> {
  try {
    const next = await prisma.orthodonticControlAppointment.findFirst({
      where: {
        clinicId,
        patientId,
        scheduledAt: { gte: new Date() },
        attendance: { not: "NO_SHOW" },
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        attendedById: true,
        attendedBy: { select: { firstName: true, lastName: true } },
      },
    });
    return next?.attendedBy ?? null;
  } catch (e) {
    console.error("[ortho-redesign] resolveNextAppointmentDoctor failed:", e);
    return null;
  }
}

/**
 * Lee la última entry de audit log con action
 * `ortho.elastics.compliance.recorded` para este plan y devuelve el
 * compliancePct guardado en el JSON `changes._created.after`. Si no hay
 * entries (paciente sin reporte) devuelve 0.
 */
async function readLatestCompliancePct(
  clinicId: string,
  planId: string,
): Promise<number> {
  try {
    const entry = await prisma.auditLog.findFirst({
      where: {
        clinicId,
        entityType: "OrthodonticTreatmentPlan",
        entityId: planId,
        action: "ortho.elastics.compliance.recorded",
      },
      orderBy: { createdAt: "desc" },
      select: { changes: true },
    });
    if (!entry?.changes) return 0;
    const changes = entry.changes as {
      _created?: { after?: { compliancePct?: number } };
    };
    const pct = changes?._created?.after?.compliancePct;
    if (typeof pct === "number" && Number.isFinite(pct)) {
      return Math.max(0, Math.min(100, Math.round(pct)));
    }
    return 0;
  } catch (e) {
    console.error("[ortho-redesign] readLatestCompliancePct failed:", e);
    return 0;
  }
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
  const fecha = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  const revocado = c.revokedAt instanceof Date;
  const firmado = c.signedAt instanceof Date && !revocado;
  const porRepresentante = typeof c.signerName === "string" && c.signerName.length > 0;
  const faltaDoctor = firmado && !(c.doctorSignedAt instanceof Date);
  let detalle = "Consentimiento informado del paciente.";
  if (revocado) detalle = "Revocado por el paciente: no cuenta como firmado.";
  else if (firmado && porRepresentante) {
    detalle = `Firmado por el representante (${c.signerName}${c.signerRelation ? `, ${c.signerRelation}` : ""})${faltaDoctor ? " · falta la firma del doctor" : ""}.`;
  } else if (faltaDoctor) detalle = "Firmado por el paciente · falta la firma del doctor.";
  return {
    name: (c.procedure as string | null) ?? "Consentimiento de ortodoncia",
    signed: firmado,
    date: fecha(c.signedAt),
    risks: detalle,
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
  // Filtra controles pasados (performedAt no null O scheduledAt anterior a
  // ahora). Excluye los futuros para no inflar la métrica con citas que
  // aún no ocurrieron. Toma hasta los últimos 12 por fecha desc.
  const now = Date.now();
  const past = legacy.controls
    .filter(
      (c) =>
        c.performedAt != null ||
        c.scheduledAt.getTime() < now,
    )
    .sort((a, b) => {
      const aT = (a.performedAt ?? a.scheduledAt).getTime();
      const bT = (b.performedAt ?? b.scheduledAt).getTime();
      return bT - aT;
    })
    .slice(0, 12);
  if (past.length === 0) return 100;
  const attended = past.filter((c) => c.attendance === "ATTENDED").length;
  return Math.round((attended / past.length) * 100);
}
