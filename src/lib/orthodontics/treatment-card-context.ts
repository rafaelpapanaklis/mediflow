// Orthodontics — contexto de la hoja de control (núcleo compartido).
//
// Vivía exportado desde `src/app/actions/orthodontics/getTreatmentCardContextForAppointment.ts`,
// un archivo "use server": toda función exportada de un archivo así es una
// SERVER ACTION que el navegador puede invocar con los argumentos que quiera.
// `buildTreatmentCardContext` no comprueba sesión ni clínica (recibe el plan YA
// cargado y confía en él), así que expuesta como acción leía hojas de control,
// arcos y juegos de fotos de CUALQUIER caso con solo su id (auditoría 30-sep,
// inventario de M6). Aquí, fuera de "use server", solo la llaman las dos
// acciones que antes validan sesión, permiso clínico, clínica y visibilidad.

import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { loadOrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { duracionSugeridaProximoControl } from "@/lib/orthodontics/duracion-proximo-control";
import { mesDeTratamiento } from "@/lib/orthodontics/mes-de-tratamiento";
import { cargarProgresoDeControles } from "@/lib/orthodontics/controles-hechos-db";
import { inicioDelCaso, numeroDeEsteControl } from "@/lib/orthodontics/controles-hechos";
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
  /**
   * ws1-t10: los controles que prevé el plan del caso («Control X de N»); null si el plan no lo dice. Es lo que la
   * hoja ya abierta (existingCard) necesita para decir su «de N».
   */
  controlesPrevistos: number | null;
  /** ws1-t10: la técnica del caso, para filtrar las plantillas de nota de la hoja. */
  technique: OrthoTechnique | null;
  defaultsForNew: {
    cardNumber: number;
    /**
     * ws1-t10: el número de ESTE control con la misma cuenta que la ficha («El siguiente es el control 2 de 18»):
     * las visitas del caso, no las hojas. null si el plan no dice cuántos controles prevé.
     */
    controlNumero: number | null;
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
    /** Duración sugerida de «Próximo control»: la de «Control de ortodoncia»
     * en Configuración → tipos de cita (antes, 30 min fijos). */
    proximoControlMin: number | null;
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
    /** Para leer la duración sugerida de «Próximo control» de Configuración. */
    clinicId?: string;
    installedAt: Date | null;
    startDate: Date | null;
    createdAt?: Date | null;
    /** Fila 12: para la nota precargada. Opcionales: sin ellos la nota sale más genérica. */
    technique?: OrthoTechnique | null;
    patient?: { firstName: string; lastName: string } | null;
    paymentPlan?: { status: OrthoPaymentStatus } | null;
  },
  appt: { id: string; startsAt: Date; endsAt: Date; status?: string } | null,
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
  // «Hoy» es el día de ESTA cita, no el del reloj: visto en vivo, abrir la
  // cita de mañana enseñaba la hoja firmada de hoy en vez de una nueva.
  const deHoy = linkedToAppt ? null : tarjetaDeControlDeHoy(cards, clinicTimezone, appt?.startsAt ?? new Date());
  const raw = linkedToAppt ?? deHoy;
  const existingCard = raw ? adaptCard(raw, wireById) : null;

  const maxCardNumber = cards.reduce((m, c) => Math.max(m, c.cardNumber), 0);
  const lastSignedCard = [...cards].reverse().find((c) => c.status === "SIGNED") ?? null;

  // ws1-t10: la fase del caso es la que está en curso (la misma que dice la cabecera de la ficha); solo sin fases en
  // curso se cae a la de la última hoja firmada. Antes mandaba la de la última hoja, y al avanzar de fase la hoja
  // nueva seguía diciendo la anterior.
  const phase: OrthoPhaseKey =
    phaseInProgress?.phaseKey ?? lastSignedCard?.phaseKey ?? "ALIGNMENT";
  const visitDate = appt ? appt.startsAt.toISOString() : new Date().toISOString();
  // ws1-t10: meses reales desde la colocación al día de la visita (antes, meses de calendario contra «hoy»).
  const monthAt = mesDeTratamiento(plan.installedAt ?? plan.startDate, new Date(visitDate));
  // Fila 12: el arco actual es el que puso el último control o, si ese
  // control no cambió de arco, el mismo con el que llegó (antes, sin cambio
  // de arco en el último control, la hoja nueva decía «—»).
  const arcoActualId = arcoActualDelControl(lastSignedCard);
  const wireFrom = arcoActualId ? (wireById.get(arcoActualId) ?? null) : null;
  const durationMin = appt
    ? Math.max(15, Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60000))
    : 30;

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
    techniqueName: plan.clinicId && plan.id ? await cargarNombreDeTecnica(plan.clinicId, plan.id) : null,
    phaseKey: phase,
    paymentStatus: plan.paymentPlan?.status ?? null,
    bracketsPendientesFdi: lastPendingBrackets.map((b) => b.toothFdi),
  });

  // ws1-t10: «Control X de N» con la cuenta de la ficha (visitas del caso). Sin previstos en el plan no hay «de N».
  const progreso = plan.clinicId
    ? (
        await cargarProgresoDeControles(plan.clinicId, clinicTimezone, [
          { planId: plan.id, patientId: plan.patientId, inicio: inicioDelCaso({ installedAt: plan.installedAt, startDate: plan.startDate, createdAt: plan.createdAt ?? null }) },
        ])
      ).get(plan.id) ?? null
    : null;
  const controlNumero = progreso
    ? numeroDeEsteControl({
        hechos: progreso.hechos,
        yaCuenta: existingCard !== null || (appt?.status !== undefined && ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"].includes(appt.status)),
      })
    : null;

  const ajustes = plan.clinicId ? await loadOrthoClinicSettings(plan.clinicId).catch(() => null) : null;
  const proximoControlMin = duracionSugeridaProximoControl(ajustes?.appointmentTypes);

  return {
    treatmentPlanId: plan.id,
    patientId: plan.patientId,
    appointmentId: appt?.id ?? null,
    existingCard,
    availableWires: wireDTOs,
    controlesPrevistos: progreso?.previstos ?? null,
    technique: plan.technique ?? null,
    defaultsForNew: {
      cardNumber: maxCardNumber + 1,
      controlNumero,
      phase,
      monthAt,
      wireFrom,
      visitDate,
      durationMin,
      lastElastics,
      lastIndications: lastSignedCard?.indications ?? null,
      lastPendingBrackets,
      soapPrefill,
      proximoControlMin,
    },
    availablePhotoSets: photoSets.map((s) => ({
      id: s.id,
      label: `${photoSetLabel(s.setType)} · ${s.capturedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`,
    })),
  };
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
