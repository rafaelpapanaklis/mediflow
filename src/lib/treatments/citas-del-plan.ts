// Citas del plan de tratamiento (ws1-t1 · fase 2 · P8) — las REGLAS, puras (sin base ni sesión).
//
// «Agendar lo pendiente» crea una cita NORMAL (POST /api/appointments, con las reglas de siempre:
// horario, comida, sobreagendar, doctor) y liga a ella las filas del plan que se eligieron
// (`treatment_plan_items."citaAgendadaId"`, sql/plan-tratamiento-citas.sql). Aquí vive:
//  · cuándo una cita «ocupa» a la fila (agendada) y cuándo la deja libre otra vez;
//  · cuántos minutos se proponen para la cita (duración del tarifario × cantidad);
//  · la lectura de `planItemIds` que llega en el cuerpo;
//  · a quién le toca el WhatsApp de seguimiento (pendientes SIN cita, no por intervalo).
// La capa de base es `citas-del-plan-db.ts` (solo servidor).
//
// La cita cancelada LIBERA la fila sin escribir nada: la liga se queda y se lee con el estado de
// la cita. Así da igual por qué puerta se canceló (panel, portal, bot, Google): no hay que
// acordarse de soltar la fila en cada una.

import type { EstadoDeFila } from "./items";

/** Una cita en estos estados ya no cuenta: la fila vuelve a estar por agendar. */
export const CITA_LIBERA: readonly string[] = ["CANCELLED", "NO_SHOW"];
/** La cita ya se atendió: si la fila sigue pendiente (no se marcó hecha), está por agendar otra vez. */
export const CITA_CERRADA: readonly string[] = ["COMPLETED", "CHECKED_OUT"];
/** El paciente está en la clínica ahora mismo: la cita ocupa la fila aunque ya pasó su hora de fin… */
export const CITA_EN_CURSO: readonly string[] = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"];
/** …pero no para siempre: una cita que nadie cerró deja de apartar la fila a las 12 h de su fin. */
export const HORAS_EN_CURSO_MAX = 12;

/** Minutos de una fila cuyo procedimiento no trae duración en el tarifario (o no viene del tarifario). */
export const MINUTOS_POR_DEFECTO = 30;
/** El mismo tope que acepta la ventana de Nueva cita (5–480 min). */
export const MAX_MINUTOS_CITA = 480;
/** Tope de filas en una sola cita: un plan real agenda 1–6 por visita. */
export const MAX_FILAS_POR_CITA = 30;

/**
 * Seguimiento por WhatsApp: se avisa cuando el plan tiene pendientes SIN cita y pasaron estos días
 * desde lo último que pasó en el plan (alta, última cita ligada, último procedimiento hecho).
 * Decisión para Rafael (REPORTE-ws1-t1): 14 es el valor conservador.
 */
export const DIAS_SIN_CITA_PARA_AVISAR = 14;
/** Entre dos avisos del mismo plan (el dedupe de siempre: `lastFollowUpSent`). */
export const DIAS_ENTRE_AVISOS = 7;
/**
 * Tope de avisos por plan: después del tercero ya no se insiste (decisión para Rafael). Cuentan los
 * encolados con `payload.planId` (los de antes de este cambio no lo llevan).
 */
export const MAX_AVISOS_POR_PLAN = 3;
/**
 * Plan de siempre (sin filas): solo se avisa si su sesión se venció en los últimos 30 días. Con el
 * filtro roto de antes (42883) el cron no avisaba a nadie; sin este tope, el primer día saldría un
 * WhatsApp a cada plan vencido desde hace meses (también los importados).
 */
export const DIAS_VENTANA_PLAN_VIEJO = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface CitaLigada {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

/** ¿Esta cita tiene «apartada» a la fila? Viva y por venir (o con el paciente en la clínica). */
export function citaOcupaLaFila(cita: CitaLigada | null | undefined, ahora: Date): boolean {
  if (!cita) return false;
  if (CITA_LIBERA.indexOf(cita.status) !== -1 || CITA_CERRADA.indexOf(cita.status) !== -1) return false;
  if (CITA_EN_CURSO.indexOf(cita.status) !== -1) return cita.endsAt.getTime() + HORAS_EN_CURSO_MAX * 60 * 60 * 1000 > ahora.getTime();
  return cita.endsAt.getTime() > ahora.getTime();
}

export type EstadoDeAgenda =
  /** Pendiente o en curso, con una cita viva por delante. */
  | "agendada"
  /** Pendiente o en curso, sin cita viva: se puede agendar. */
  | "por_agendar"
  /** Hecha o cancelada: no se agenda. */
  | "no_aplica";

export function estadoDeAgenda(fila: { estado: EstadoDeFila }, cita: CitaLigada | null | undefined, ahora: Date): EstadoDeAgenda {
  if (fila.estado !== "pendiente" && fila.estado !== "en_curso") return "no_aplica";
  return citaOcupaLaFila(cita, ahora) ? "agendada" : "por_agendar";
}

/**
 * Minutos que se proponen para la cita: la duración del tarifario de cada fila por su cantidad
 * (dos resinas = dos veces), redondeado HACIA ARRIBA al tamaño del hueco de la clínica y dentro de
 * lo que acepta la ventana de Nueva cita. Es una propuesta: en la ventana se cambia.
 */
export function minutosDeLaCita(filas: Array<{ cantidad: number; minutos: number | null }>, minutosDelHueco: number): number {
  const hueco = Number.isFinite(minutosDelHueco) && minutosDelHueco >= 5 ? Math.round(minutosDelHueco) : 15;
  const suma = filas.reduce((s, f) => {
    const m = typeof f.minutos === "number" && Number.isFinite(f.minutos) && f.minutos > 0 ? f.minutos : MINUTOS_POR_DEFECTO;
    const n = Number.isInteger(f.cantidad) && f.cantidad > 0 ? f.cantidad : 1;
    return s + m * n;
  }, 0);
  const redondeado = Math.max(hueco, Math.ceil(suma / hueco) * hueco);
  return Math.min(MAX_MINUTOS_CITA, redondeado);
}

export type CodigoDeCitaDelPlan =
  /** Falta el SQL (sql/plan-tratamiento-citas.sql) o la tabla de filas: nada se guarda. */
  | "plan_citas_no_disponible"
  /** `planItemIds` no es una lista de ids, o trae demasiados. */
  | "plan_filas_invalidas"
  /** Alguna fila no existe, es de otra clínica o de otro paciente (no se dice cuál). */
  | "plan_fila_ajena"
  /** El plan es de otro doctor (el doctor solo toca sus planes). */
  | "plan_de_otro_doctor"
  /** El plan está pausado, terminado o abandonado: no se agenda de él. */
  | "plan_no_activo"
  /** Alguna fila ya está hecha o cancelada. */
  | "plan_fila_no_pendiente"
  /** Alguna fila ya tiene una cita viva por delante. */
  | "plan_fila_ya_agendada";

export const ESTADO_HTTP_DE_CODIGO: Record<CodigoDeCitaDelPlan, number> = {
  plan_citas_no_disponible: 409,
  plan_filas_invalidas: 400,
  plan_fila_ajena: 404,
  plan_de_otro_doctor: 403,
  plan_no_activo: 409,
  plan_fila_no_pendiente: 409,
  plan_fila_ya_agendada: 409,
};

/** Interfaz plana a propósito (tsconfig sin `strict`: `if (!r.ok)` no estrecha una unión). */
export interface LecturaDeIds {
  ok: boolean;
  ids?: string[];
  codigo?: CodigoDeCitaDelPlan;
}

/**
 * `planItemIds` del cuerpo. Ausente, null o [] = cita normal sin plan (ids vacío). Ids repetidos se
 * juntan. Cualquier otra cosa es un 400: no se crea una cita «a medias» sin las filas que se pidieron.
 */
export function leerPlanItemIds(raw: unknown): LecturaDeIds {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, codigo: "plan_filas_invalidas" };
  const ids: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") return { ok: false, codigo: "plan_filas_invalidas" };
    const id = x.trim();
    if (!id || id.length > 100) return { ok: false, codigo: "plan_filas_invalidas" };
    if (ids.indexOf(id) === -1) ids.push(id);
  }
  if (ids.length > MAX_FILAS_POR_CITA) return { ok: false, codigo: "plan_filas_invalidas" };
  return { ok: true, ids };
}

/** Lo que el repositorio encontró de cada fila pedida, para decidir si se puede ligar. */
export interface FilaParaLigar {
  id: string;
  planId: string;
  estado: EstadoDeFila;
  planDoctorId: string;
  planPatientId: string;
  /** `treatment_plans.status` leído como texto (en la base real es TEXT). */
  planStatus: string;
  cita: CitaLigada | null;
}

/**
 * ¿Se pueden ligar estas filas a una cita NUEVA del paciente? `encontradas` son las que la base
 * devolvió con el filtro de la clínica (las de otra clínica no llegan). Devuelve el código del
 * primer problema o null.
 */
export function problemaAlLigar(
  pedidas: string[],
  encontradas: FilaParaLigar[],
  quien: { patientId: string; userId: string; esDoctor: boolean },
  ahora: Date,
): CodigoDeCitaDelPlan | null {
  const porId = new Map(encontradas.map((f) => [f.id, f]));
  for (const id of pedidas) {
    const f = porId.get(id);
    // Otra clínica u otro paciente: la misma respuesta, para no revelar que la fila existe.
    if (!f || f.planPatientId !== quien.patientId) return "plan_fila_ajena";
  }
  for (const id of pedidas) {
    const f = porId.get(id)!;
    if (quien.esDoctor && f.planDoctorId !== quien.userId) return "plan_de_otro_doctor";
  }
  for (const id of pedidas) {
    if (porId.get(id)!.planStatus !== "ACTIVE") return "plan_no_activo";
  }
  for (const id of pedidas) {
    const f = porId.get(id)!;
    const e = estadoDeAgenda(f, f.cita, ahora);
    if (e === "no_aplica") return "plan_fila_no_pendiente";
    if (e === "agendada") return "plan_fila_ya_agendada";
  }
  return null;
}

// ── Seguimiento por WhatsApp ────────────────────────────────────────────────

export interface PlanParaSeguimiento {
  /** Filas vivas (no canceladas) del plan, con su cita agendada si la tienen. */
  filas: Array<{ estado: EstadoDeFila; cantidad?: number; hechoEn?: Date | null; invoiceId?: string | null; cita: CitaLigada | null }>;
  /** El paciente tiene CUALQUIER cita viva por delante en esta clínica (ligada al plan o no). */
  citaPorDelante: boolean;
  /** Alta del plan. */
  creadoEn: Date;
  lastFollowUpSent: Date | null;
  /** Avisos de seguimiento que ya se encolaron para este plan. */
  avisosPrevios?: number;
}

export interface DecisionDeSeguimiento {
  avisar: boolean;
  /** Pendientes (o en curso) sin cita viva. */
  pendientesSinCita: number;
  hechas: number;
  /** Vivas = no canceladas. */
  vivas: number;
  motivo: "sin_pendientes" | "sin_aceptar" | "con_cita" | "reciente" | "avisado_hace_poco" | "tope" | "avisar";
}

/**
 * ¿Le toca el WhatsApp de seguimiento a este plan? Solo si tiene procedimientos pendientes SIN cita,
 * el tratamiento ya empezó o se aceptó (alguna fila hecha o en la nota de cobro: a un plan solo
 * presentado no se le escribe «continúa tu tratamiento»), el paciente no tiene NINGUNA cita viva por
 * delante (si ya viene, no se le insiste), pasaron `DIAS_SIN_CITA_PARA_AVISAR` desde lo último que
 * pasó en el plan, no se avisó en los últimos `DIAS_ENTRE_AVISOS` y no llegó al tope de avisos.
 */
export function decidirSeguimiento(
  p: PlanParaSeguimiento,
  ahora: Date,
  dias: { sinCita?: number; entreAvisos?: number } = {},
): DecisionDeSeguimiento {
  const sinCitaDias = dias.sinCita ?? DIAS_SIN_CITA_PARA_AVISAR;
  const entreAvisos = dias.entreAvisos ?? DIAS_ENTRE_AVISOS;
  let pendientesSinCita = 0;
  let hechas = 0;
  let vivas = 0;
  let aceptado = false;
  let ultima = p.creadoEn.getTime();
  for (const f of p.filas) {
    if (f.estado === "cancelado") continue;
    vivas++;
    if (f.invoiceId) aceptado = true;
    if (f.estado === "hecho") {
      hechas++;
      if (f.hechoEn) ultima = Math.max(ultima, f.hechoEn.getTime());
      continue;
    }
    // Una cita ligada que ya pasó (atendida o no) también cuenta como «lo último que pasó».
    if (f.cita && CITA_LIBERA.indexOf(f.cita.status) === -1) ultima = Math.max(ultima, Math.min(f.cita.endsAt.getTime(), ahora.getTime()));
    if (!citaOcupaLaFila(f.cita, ahora)) pendientesSinCita++;
  }
  const base = { pendientesSinCita, hechas, vivas };
  if (pendientesSinCita === 0) return { ...base, avisar: false, motivo: "sin_pendientes" };
  if (!aceptado && hechas === 0) return { ...base, avisar: false, motivo: "sin_aceptar" };
  if ((p.avisosPrevios ?? 0) >= MAX_AVISOS_POR_PLAN) return { ...base, avisar: false, motivo: "tope" };
  if (p.citaPorDelante) return { ...base, avisar: false, motivo: "con_cita" };
  if (ahora.getTime() - ultima < sinCitaDias * DIA_MS) return { ...base, avisar: false, motivo: "reciente" };
  if (p.lastFollowUpSent && ahora.getTime() - p.lastFollowUpSent.getTime() < entreAvisos * DIA_MS) {
    return { ...base, avisar: false, motivo: "avisado_hace_poco" };
  }
  return { ...base, avisar: true, motivo: "avisar" };
}

/** Días desde lo último que pasó en el plan (para el tono del mensaje). */
export function diasSinActividad(p: Pick<PlanParaSeguimiento, "filas" | "creadoEn">, ahora: Date): number {
  let ultima = p.creadoEn.getTime();
  for (const f of p.filas) {
    if (f.estado === "cancelado") continue;
    if (f.estado === "hecho" && f.hechoEn) ultima = Math.max(ultima, f.hechoEn.getTime());
    else if (f.cita && CITA_LIBERA.indexOf(f.cita.status) === -1) ultima = Math.max(ultima, Math.min(f.cita.endsAt.getTime(), ahora.getTime()));
  }
  return Math.max(0, Math.floor((ahora.getTime() - ultima) / DIA_MS));
}
