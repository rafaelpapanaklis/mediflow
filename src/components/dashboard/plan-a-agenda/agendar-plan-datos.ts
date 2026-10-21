/**
 * «Agendar lo pendiente» (ws1-t1 · plan fase 2 · P8) — lo PURO de la pantalla: qué devuelve
 * `GET /api/appointments/plan-pendiente`, cómo se arma la Nueva cita con las filas elegidas y cómo
 * viajan en la URL de la agenda. Sin React ni red, para probarlo con `tsx --test`.
 */

import { MAX_FILAS_POR_CITA, minutosDeLaCita, type EstadoDeAgenda } from "@/lib/treatments/citas-del-plan";
import type { OpenNewAppointmentParams } from "@/lib/new-appointment/types";

export interface FilaDeAgenda {
  id: string;
  nombre: string;
  dientes: number[];
  caras: string[];
  estado: string;
  cantidad: number;
  minutos: number | null;
  agenda: EstadoDeAgenda;
  cita: { id: string; startsAt: string; status: string } | null;
}

export interface DatosDePlanPendiente {
  disponible: boolean;
  puedeAgendar?: boolean;
  minutosDelHueco?: number;
  minutosSugeridos?: number;
  plan?: {
    id: string;
    nombre: string;
    status: string;
    doctorId: string;
    paciente: { id: string; nombre: string };
  };
  filas?: FilaDeAgenda[];
}

/** Parámetros de la URL de la agenda: `?agendarPlan=<planId>&filas=<id>,<id>`. */
export const PARAM_PLAN = "agendarPlan";
export const PARAM_FILAS = "filas";

export function urlDeAgendaDelPlan(planId: string, filaIds: string[]): string {
  const q = new URLSearchParams();
  q.set(PARAM_PLAN, planId);
  q.set(PARAM_FILAS, filaIds.join(","));
  return `/dashboard/agenda?${q.toString()}`;
}

/** Lee la URL de la agenda; null si no viene del plan. Ids repetidos o vacíos se quitan. */
export function leerUrlDeAgendaDelPlan(params: { get(k: string): string | null }): { planId: string; filaIds: string[] } | null {
  const planId = params.get(PARAM_PLAN)?.trim() ?? "";
  if (!planId) return null;
  const filaIds = Array.from(new Set((params.get(PARAM_FILAS) ?? "").split(",").map((x) => x.trim()).filter(Boolean))).slice(0, MAX_FILAS_POR_CITA);
  return { planId, filaIds };
}

/** Las que se pueden agendar hoy (pendientes o en curso, sin cita viva). */
export function porAgendar(datos: DatosDePlanPendiente | null): FilaDeAgenda[] {
  return (datos?.filas ?? []).filter((f) => f.agenda === "por_agendar");
}

/** «Resina 2 caras 16» · «Limpieza»: el nombre con sus dientes, como se lee en la agenda. */
export function etiquetaDeFila(f: Pick<FilaDeAgenda, "nombre" | "dientes">): string {
  return f.dientes.length > 0 ? `${f.nombre} ${f.dientes.join(", ")}` : f.nombre;
}

/** Tope del motivo de la cita: lo que se lee en la tarjeta de la agenda. */
export const MAX_MOTIVO = 160;

export function resumenDeFilas(filas: Array<Pick<FilaDeAgenda, "nombre" | "dientes">>): string {
  const texto = filas.map(etiquetaDeFila).join(" · ");
  return texto.length > MAX_MOTIVO ? `${texto.slice(0, MAX_MOTIVO - 1).trimEnd()}…` : texto;
}

/**
 * La Nueva cita con lo elegido: paciente y doctor del plan, motivo = los procedimientos, duración del
 * tarifario, y las filas que el POST liga a la cita. Solo entran las que siguen por agendar: si
 * alguna ya tuvo cita mientras tanto, se queda fuera (y si no queda ninguna, null).
 *
 * `prefijoMotivo` («Plan: ») va delante del motivo A PROPÓSITO: «Cobrar hoy» abierto desde una cita
 * propone como concepto el procedimiento del tarifario cuyo nombre ES el motivo, con su precio
 * (`conceptoDeLaCita`). Sin el prefijo, «Limpieza» o «Resina 2 caras 16» saldrían con precio y se
 * podrían cobrar aparte de la nota del plan: un cobro doble. Con él, sale sin importe.
 */
export function paramsDeNuevaCita(
  datos: DatosDePlanPendiente | null,
  filaIds: string[],
  prefijoMotivo = "",
): OpenNewAppointmentParams | null {
  if (!datos?.disponible || !datos.plan) return null;
  const libres = porAgendar(datos);
  const elegidas = filaIds.length > 0 ? libres.filter((f) => filaIds.indexOf(f.id) !== -1) : [];
  if (elegidas.length === 0) return null;
  const resumen = resumenDeFilas(elegidas);
  return {
    initialPatient: { id: datos.plan.paciente.id, name: datos.plan.paciente.nombre },
    initialDoctorId: datos.plan.doctorId,
    initialReason: `${prefijoMotivo}${resumen}`,
    initialDurationMin: minutosDeLaCita(elegidas, datos.minutosDelHueco ?? 30),
    delPlan: { planId: datos.plan.id, filaIds: elegidas.map((f) => f.id), resumen },
  };
}

/** Lo que contesta `GET /api/appointments/plan-pendiente?appointmentId=` (Reagendar). */
export interface DatosDeReagendar {
  disponible: boolean;
  puedeAgendar?: boolean;
  minutosSugeridos?: number;
  planId?: string | null;
  filas?: Array<{ id: string; nombre: string; dientes: number[] }>;
}

/**
 * «Reagendar» una cita cancelada o no asistida del plan: la cita nueva se vuelve a llevar sus filas
 * pendientes (y su duración). null = reagendar como siempre: sin SQL, sin permiso de tocar el plan
 * (el POST lo pediría y la cita no se guardaría) o sin filas.
 */
export function paramsDeReagendar(datos: DatosDeReagendar | null): Pick<OpenNewAppointmentParams, "delPlan" | "initialDurationMin"> | null {
  if (!datos?.disponible || !datos.puedeAgendar || !datos.planId || !datos.filas?.length) return null;
  return {
    delPlan: { planId: datos.planId, filaIds: datos.filas.map((f) => f.id), resumen: resumenDeFilas(datos.filas) },
    ...(datos.minutosSugeridos ? { initialDurationMin: datos.minutosSugeridos } : {}),
  };
}

/** Suma lo elegido para el pie de la hoja: cuántos y cuántos minutos. */
export function totalElegido(datos: DatosDePlanPendiente | null, filaIds: string[]): { n: number; minutos: number } {
  const elegidas = porAgendar(datos).filter((f) => filaIds.indexOf(f.id) !== -1);
  return { n: elegidas.length, minutos: elegidas.length ? minutosDeLaCita(elegidas, datos?.minutosDelHueco ?? 30) : 0 };
}

/** Códigos del POST que son de las filas del plan (la ventana los dice con su frase). */
export function esErrorDelPlan(codigo: unknown): codigo is string {
  return typeof codigo === "string" && codigo.startsWith("plan_");
}
