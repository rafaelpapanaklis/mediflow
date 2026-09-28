"use server";
// Orthodontics — Control y agenda (ws1-t4, Ola 1, sep-2026).
//
// Datos mínimos para que `BotonHojaControl` (agenda/BotonHojaControl.tsx)
// pueda abrir `DrawerTreatmentCard` desde una cita de control, sin arrastrar
// las ~14 consultas de `loadOrthoRedesignData` (pensado para la ficha
// completa del paciente, no para un botón de la agenda). Cuatro consultas
// en paralelo — bajo el límite de 7 por Promise.all de las reglas de la
// casa.
//
// Tolera P2021/P2022 en `orthoTreatmentCard` (columnas nuevas de
// sql/ortodoncia-nucleo.sql y sql/ortodoncia-control-agenda.sql aún sin
// aplicar en esta base) — mismo patrón que loader.ts / cobranza-db.ts:
// si la tabla/columna no existe todavía, se trata como "sin hojas
// anteriores", no como error.
//
// Arreglo de la revisión cruzada (REPORTE-ws1-t1.md, sección «Revisión
// cruzada»): no comprobaba visibilidad de paciente — cualquier usuario
// autenticado de la clínica con `medicalRecord.view` podía leer el plan,
// wires y foto-sets de un paciente restringido con solo adivinar su
// treatmentPlanId/appointmentId. Ahora reusa `loadPatientForOrtho`
// (`_helpers.ts`), el mismo chequeo que el resto del módulo.
//
// Ronda 6 (ws1-t8, «El día de la ortodoncista», M6/M12): la construcción del
// contexto se separó en `buildTreatmentCardContext` para que
// `getTreatmentCardContextForPatient.ts` (entrada desde la ficha, "Registrar
// control" sin pasar por una cita concreta) devuelva EXACTAMENTE lo mismo —
// "una sola forma de registrar el control" también en el backend, no solo en
// el botón. Dos añadidos sobre la Ola 1:
//   · M12 — `lastElastics`/`lastIndications`: lo que la ÚLTIMA hoja firmada
//     dejó anotado, para precargar la hoja nueva (hallazgo 12: "la hoja
//     empieza en blanco cada vez").
//   · M6/hallazgo 7 — si YA hay una hoja de HOY para este plan (por fecha de
//     calendario en la zona de la clínica, `tarjetaDeControlDeHoy`), se
//     devuelve como `existingCard` aunque no esté ligada a ESTA cita: se
//     CONTINÚA esa hoja en vez de crear una segunda del mismo día.

import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { tarjetaDeControlDeHoy } from "@/lib/orthodontics/redesign/control-del-dia";
import {
  arcoActualDelControl,
  bracketsPendientes,
  notaPrecargada,
  type BracketPendiente,
} from "@/lib/orthodontics/precarga-hoja-control";
import type { OrthoPaymentStatus, OrthoTechnique } from "@prisma/client";
import type {
  OrthoElasticClass,
  OrthoElasticZone,
  OrthoPhaseKey,
  SOAP,
  TreatmentCardDTO,
  WireStepDTO,
} from "@/components/specialties/orthodontics/redesign/types";

function esColumnaOTablaAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

type RawCard = Awaited<ReturnType<typeof fetchCards>>[number];

async function fetchCards(treatmentPlanId: string) {
  return prisma.orthoTreatmentCard.findMany({
    where: { treatmentPlanId, deletedAt: null },
    orderBy: { cardNumber: "asc" },
    include: {
      elastics: true,
      iprPoints: true,
      brokenBrackets: true,
      signedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

export interface TreatmentCardAgendaContext {
  treatmentPlanId: string;
  patientId: string;
  /**
   * La cita de la que se abrió este contexto — `null` si `getTreatmentCard-
   * ContextForPatient` no encontró ninguna cita de control de HOY (M6: la
   * ficha igual deja registrar un control sin cita, pero ya no puede
   * FINGIR que está ligado a una).
   */
  appointmentId: string | null;
  /** Ya hay una hoja ligada a ESTA cita, o una hoja de HOY del mismo caso
   * (se reabre/continúa, no se crea otra — hallazgo 7). */
  existingCard: TreatmentCardDTO | null;
  availableWires: WireStepDTO[];
  defaultsForNew: {
    cardNumber: number;
    phase: OrthoPhaseKey;
    monthAt: number;
    wireFrom: WireStepDTO | null;
    visitDate: string;
    durationMin: number;
    /** M12: elásticos vigentes según la última hoja FIRMADA. */
    lastElastics: Array<{ elasticClass: OrthoElasticClass; config: string; zone: OrthoElasticZone }>;
    /** M12: indicaciones de la última hoja FIRMADA (referencia — el doctor
     * las edita o las deja tal cual, no se re-envían solas). */
    lastIndications: string | null;
    /** Fila 12: brackets que la última hoja FIRMADA dejó sin recementar. */
    lastPendingBrackets: BracketPendiente[];
    /** Fila 12: nota S/O/A/P con la que arranca la hoja (soap-prefill). */
    soapPrefill: SOAP;
  };
  /** C4: foto-sets del caso para ligar el de esta visita. */
  availablePhotoSets: Array<{ id: string; label: string }>;
}

/**
 * Núcleo compartido: dado el plan YA cargado y una cita (o `null` si no hay
 * ninguna concreta), arma el contexto completo. `getTreatmentCardContext-
 * ForAppointment` y `getTreatmentCardContextForPatient` son wrappers finos
 * sobre esto — la única diferencia entre Agenda y ficha es CÓMO se resuelve
 * `appt`.
 */
export async function buildTreatmentCardContext(
  plan: {
    id: string;
    patientId: string;
    installedAt: Date | null;
    startDate: Date | null;
    /** Fila 12: para la nota precargada. Opcionales: sin ellos la nota sale más genérica. */
    technique?: OrthoTechnique | null;
    patient?: { firstName: string; lastName: string } | null;
    paymentPlan?: { status: OrthoPaymentStatus } | null;
  },
  appt: { id: string; startsAt: Date; endsAt: Date } | null,
  clinicTimezone: string,
): Promise<TreatmentCardAgendaContext> {
  const [wireSteps, cards, phaseInProgress, photoSets] = await Promise.all([
    prisma.orthoWireStep.findMany({
      where: { treatmentPlanId: plan.id },
      orderBy: { orderIndex: "asc" },
    }),
    fetchCards(plan.id).catch((e) => {
      if (esColumnaOTablaAusente(e)) return [] as RawCard[];
      throw e;
    }),
    prisma.orthodonticPhase.findFirst({
      where: { treatmentPlanId: plan.id, status: "IN_PROGRESS" },
      select: { phaseKey: true },
    }),
    prisma.orthoPhotoSet.findMany({
      where: { treatmentPlanId: plan.id },
      orderBy: { capturedAt: "desc" },
      take: 20,
      select: { id: true, setType: true, capturedAt: true },
    }),
  ]);

  const wireDTOs = wireSteps.map(adaptWire);
  const wireById = new Map(wireDTOs.map((w) => [w.id, w]));

  // ¿Esta cita ya tiene una hoja ligada? Columna `appointmentId` puede no
  // existir aún — si `cards` vino vacío por P2021/P2022, esto simplemente
  // no encuentra nada (no crashea).
  const linkedToAppt = appt ? cards.find((c) => c.appointmentId === appt.id) ?? null : null;
  // Hallazgo 7: si no hay una ligada a ESTA cita, ¿hay una de HOY de este
  // mismo caso (por otra cita, o sin cita)? Se continúa esa en vez de crear
  // una segunda del mismo día.
  const deHoy = linkedToAppt ? null : tarjetaDeControlDeHoy(cards, clinicTimezone);
  const raw = linkedToAppt ?? deHoy;
  const existingCard = raw ? adaptCard(raw, wireById) : null;

  const maxCardNumber = cards.reduce((m, c) => Math.max(m, c.cardNumber), 0);
  const lastSignedCard = [...cards].reverse().find((c) => c.status === "SIGNED") ?? null;

  const phase: OrthoPhaseKey =
    lastSignedCard?.phaseKey ?? phaseInProgress?.phaseKey ?? "ALIGNMENT";
  const monthAt = monthsSince(plan.installedAt ?? plan.startDate);
  // Fila 12: el arco actual es el que puso el último control o, si ese
  // control no cambió de arco, el mismo con el que llegó (antes, sin cambio
  // de arco en el último control, la hoja nueva decía «—»).
  const arcoActualId = arcoActualDelControl(lastSignedCard);
  const wireFrom = arcoActualId ? (wireById.get(arcoActualId) ?? null) : null;
  const durationMin = appt
    ? Math.max(15, Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60000))
    : 30;
  const visitDate = appt ? appt.startsAt.toISOString() : new Date().toISOString();

  const lastElastics = (lastSignedCard?.elastics ?? []).map((e) => ({
    elasticClass: e.elasticClass as OrthoElasticClass,
    config: e.config,
    zone: e.zone as OrthoElasticZone,
  }));
  const lastPendingBrackets = bracketsPendientes(lastSignedCard?.brokenBrackets ?? []);
  const soapPrefill = notaPrecargada({
    patientName: plan.patient ? `${plan.patient.firstName} ${plan.patient.lastName}` : "",
    monthAt,
    technique: plan.technique ?? null,
    phaseKey: phase,
    paymentStatus: plan.paymentPlan?.status ?? null,
    bracketsPendientesFdi: lastPendingBrackets.map((b) => b.toothFdi),
  });

  return {
    treatmentPlanId: plan.id,
    patientId: plan.patientId,
    appointmentId: appt?.id ?? null,
    existingCard,
    availableWires: wireDTOs,
    defaultsForNew: {
      cardNumber: maxCardNumber + 1,
      phase,
      monthAt,
      wireFrom,
      visitDate,
      durationMin,
      lastElastics,
      lastIndications: lastSignedCard?.indications ?? null,
      lastPendingBrackets,
      soapPrefill,
    },
    availablePhotoSets: photoSets.map((s) => ({
      id: s.id,
      label: `${photoSetLabel(s.setType)} · ${s.capturedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`,
    })),
  };
}

export async function getTreatmentCardContextForAppointment(
  appointmentId: string,
  treatmentPlanId: string,
): Promise<ActionResult<TreatmentCardAgendaContext>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      installedAt: true,
      startDate: true,
      // Fila 12: datos de la nota precargada.
      technique: true,
      patient: { select: { firstName: true, lastName: true } },
      paymentPlan: { select: { status: true } },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  // Visibilidad por paciente (arreglo de la revisión cruzada, REPORTE-ws1-t1.md):
  // sin este chequeo, un doctor sin acceso a un paciente restringido
  // (excluido de `visibleUserIds`) podía igual leer su plan, sus wires y
  // sus foto-sets con solo conocer el treatmentPlanId/appointmentId.
  const patient = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(patient)) return patient;

  // Tenant + integridad: la cita tiene que ser de este mismo paciente/clínica.
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId, patientId: plan.patientId },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (!appt) return fail("Cita no encontrada para este paciente");

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const context = await buildTreatmentCardContext(plan, appt, clinic?.timezone ?? "America/Mexico_City");
  return ok(context);
}

function monthsSince(from: Date | null): number {
  if (!from) return 0;
  const now = new Date();
  const months =
    (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  return Math.max(0, months);
}

function photoSetLabel(setType: string): string {
  const labels: Record<string, string> = {
    T0: "Inicial",
    T1: "3 meses",
    T2: "6 meses",
    CONTROL: "Control",
  };
  return labels[setType] ?? setType;
}

function adaptWire(w: {
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
}): WireStepDTO {
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

function adaptCard(c: RawCard, wireById: Map<string, WireStepDTO>): TreatmentCardDTO {
  return {
    id: c.id,
    cardNumber: c.cardNumber,
    visitDate: c.visitDate.toISOString(),
    durationMin: c.durationMin,
    phaseKey: c.phaseKey,
    monthAt: parseFloat(c.monthAt.toString()),
    wireFrom: c.wireFromId ? (wireById.get(c.wireFromId) ?? null) : null,
    wireTo: c.wireToId ? (wireById.get(c.wireToId) ?? null) : null,
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
    activationsNote: c.activationsNote ?? null,
    indications: c.indications ?? null,
    elastics: c.elastics.map((e) => ({
      id: e.id,
      elasticClass: e.elasticClass as TreatmentCardDTO["elastics"][number]["elasticClass"],
      config: e.config,
      zone: e.zone as TreatmentCardDTO["elastics"][number]["zone"],
    })),
    iprPoints: c.iprPoints.map((p) => ({
      id: p.id,
      toothA: p.toothA,
      toothB: p.toothB,
      amountMm: parseFloat(p.amountMm.toString()),
      done: p.done,
    })),
    brokenBrackets: c.brokenBrackets.map((b) => ({
      id: b.id,
      toothFdi: b.toothFdi,
      brokenDate: b.brokenDate.toISOString(),
      reBondedDate: b.reBondedDate ? b.reBondedDate.toISOString() : null,
      notes: b.notes,
    })),
  };
}
