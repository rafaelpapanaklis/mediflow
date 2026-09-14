/**
 * Lo común de las acciones de agenda de Sabina (WS1-T2): la forma de una
 * PROPUESTA, la forma de una PREGUNTA, la rendija de lectura y la configuración
 * de la clínica.
 *
 * 🔴 LAS DOS REGLAS QUE ESTE ARCHIVO EXISTE PARA SOSTENER
 *
 * 1. Estas herramientas PROPONEN y no escriben. Devuelven la petición EXACTA que
 *    haría la pantalla (`peticion`: método, ruta y cuerpo del endpoint real) y la
 *    confirmación en dos fases (ws1-t1) es la única que la ejecuta. Aquí no hay
 *    Prisma que escriba: `AgendaDb` es de solo lectura por tipos, igual que
 *    `SabinaDb`.
 *
 * 2. Las reglas NO se copian. Lo que decide si una cita cabe sale de las mismas
 *    funciones con las que decide el servidor: `scheduleViolation`,
 *    `validateResourceSchedule`, `newAppointmentRuleViolation`,
 *    `rescheduleRuleViolation` y `canTransition`. El 409 del POST sigue siendo la
 *    última palabra (carrera): por eso existe `revalidarPropuestaAgenda`.
 */

import { z } from "zod";
import type { PermissionKey } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import type { ScheduleDay } from "@/lib/agenda/clinic-hours";
import { normalizePatientText } from "@/lib/patients/patient-search-core";
import type { SabinaCtx } from "../tipos";

/* ═══════════════════════════════════════════════════════════════════════
   LA RENDIJA DE LECTURA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Lo que leen las acciones de agenda. SOLO LECTURA, igual que `SabinaDb`: aquí
 * no existe `create`, `update`, `delete`, `upsert`, `$transaction` ni
 * `$executeRaw`. Lleva además tres modelos que las herramientas de consulta no
 * necesitaban: `user` (los doctores), `resourceSchedule` (el horario de cada
 * sillón) y `whatsAppReminder` (si ya salió el recordatorio).
 */
export interface AgendaDb {
  appointment: { findMany(args: any): Promise<any[]> };
  patient: { findMany(args: any): Promise<any[]> };
  user: { findMany(args: any): Promise<any[]> };
  resource: { findMany(args: any): Promise<any[]> };
  resourceSchedule: { findMany(args: any): Promise<any[]> };
  clinic: { findFirst(args: any): Promise<any> };
  clinicSchedule: { findMany(args: any): Promise<any[]> };
  whatsAppReminder: { count(args: any): Promise<number> };
  $queryRaw(query: any): Promise<any[]>;
}

/** El cliente de lectura: `ctx.db` en pruebas, el `prisma` del repo en producción. */
export function dbAgendaDe(ctx: SabinaCtx): AgendaDb {
  return (ctx.db ?? prisma) as unknown as AgendaDb;
}

/* ═══════════════════════════════════════════════════════════════════════
   ROLES — los mismos `requireRole` de las rutas
   ═══════════════════════════════════════════════════════════════════════ */

/** `POST /api/appointments` y `PATCH /api/appointments/:id`. */
export const ROLES_AGENDAR = ["RECEPTIONIST", "DOCTOR", "ADMIN", "SUPER_ADMIN"] as const;

/** `DELETE /api/appointments/:id`. Un DOCTOR no está: decisión de Rafael, se queda así (N4). */
export const ROLES_CANCELAR = ["RECEPTIONIST", "ADMIN", "SUPER_ADMIN"] as const;

export function rolPermitido(ctx: SabinaCtx, roles: readonly string[]): boolean {
  return roles.includes(ctx.role);
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE DEVUELVEN LAS ACCIONES
   ═══════════════════════════════════════════════════════════════════════ */

export type AccionAgenda = "agendar_cita" | "reagendar_cita" | "cancelar_cita";

/**
 * Lo que Sabina HARÍA. No escribe nada: la fase 2 (la confirmación de ws1-t1)
 * es quien lo ejecuta, y solo después de que el usuario toque «Confirmar».
 */
export interface PropuestaAgenda {
  accion: AccionAgenda;
  /** La key que exige el endpoint. La fase 2 la vuelve a comprobar. */
  permiso: PermissionKey;
  /**
   * La llamada EXACTA al endpoint real, con el cuerpo que manda la pantalla. La
   * fase 2 la ejecuta tal cual contra el route handler; no se arma otra.
   */
  peticion: {
    metodo: "POST" | "PATCH" | "DELETE";
    ruta: string;
    cuerpo: Record<string, unknown> | null;
  };
  /** Título corto de la tarjeta: «Agendar cita». */
  titulo: string;
  /** La frase entera, legible de un vistazo: «Agendar a Ana … el jueves 18 … a las 10:00 con …». */
  frase: string;
  /** Los datos resueltos, uno por línea. */
  detalle: Array<{ campo: string; valor: string }>;
  /** Solo reagendar: cómo está y cómo quedaría. */
  antes: MomentoCita | null;
  despues: MomentoCita | null;
  /** Lo que la tarjeta tiene que decir ANTES de confirmar (qué le llega al paciente, qué no). */
  avisos: string[];
  /** Si se puede deshacer y cómo. Si no, la tarjeta lo dice antes. */
  deshacer: { reversible: boolean; como: string };
  /**
   * Cómo volver a comprobarla al confirmar: la misma herramienta con los ids ya
   * resueltos. Ver `revalidarPropuestaAgenda`.
   */
  revalidar: { herramienta: AccionAgenda; parametros: Record<string, unknown> };
  /**
   * Cómo estaba la cita al proponer (reagendar y cancelar). Si al confirmar ya
   * no está así, alguien la tocó entretanto y la propuesta caducó.
   */
  esperado: { startsAt: string; endsAt: string; doctorId: string; status: string } | null;
}

export interface MomentoCita {
  fecha: string;
  hora: string;
  /** «jueves 18 de septiembre, 10:00–10:30». */
  texto: string;
  doctor: string;
}

export type FaltaAgenda = "paciente" | "doctor" | "motivo" | "sillon" | "cita";

export interface OpcionAgenda {
  /** El id que el modelo tiene que mandar de vuelta (`pacienteId`, `doctorId`, …). */
  id: string;
  etiqueta: string;
  detalle: string | null;
}

export interface PreguntaAgenda {
  falta: FaltaAgenda;
  /** La pregunta, lista para decirla. */
  texto: string;
  /** Vacío cuando es un dato libre (el motivo). */
  opciones: OpcionAgenda[];
}

export type CausaNoDisponible =
  | "ocupado"
  | "fuera_de_horario"
  | "dia_cerrado"
  | "pasado"
  | "sillon_no_disponible"
  | "sin_sillon_libre";

/**
 * El resultado de una acción. `ok: true` en el runner siempre: estas cinco
 * formas son RESPUESTAS que Sabina tiene que dar, no fallos de la consulta.
 * La falta de KEY sí sale como `sin_permiso` del runner, antes de llegar aquí.
 */
export type DatosAccionAgenda =
  | { estado: "propuesta"; propuesta: PropuestaAgenda }
  /** Falta un dato o hay varios candidatos: Sabina PREGUNTA, no elige. */
  | { estado: "pregunta"; preguntas: PreguntaAgenda[] }
  /** Esa hora no se puede; van las más cercanas que sí (del mismo día). */
  | { estado: "no_disponible"; causa: CausaNoDisponible; frase: string; fecha: string; alternativas: string[] }
  /** El rol (o el estado de la cita para ese rol) no lo permite, aunque tenga la key. */
  | { estado: "sin_permiso"; permiso: PermissionKey; causa: "rol" | "estado"; frase: string }
  | { estado: "no_se_puede"; causa: string; frase: string };

/** La línea para el modelo, con la instrucción que no se puede saltar. */
export function resumirAccion(d: DatosAccionAgenda): string {
  switch (d.estado) {
    case "propuesta":
      return (
        `PROPUESTA, NO HECHA: ${d.propuesta.frase} Nada se ha guardado todavía: dile al usuario ` +
        `qué harías y que lo confirme en la tarjeta. NO digas que ya quedó.` +
        (d.propuesta.avisos.length ? ` Dile también: ${d.propuesta.avisos.join(" ")}` : "")
      );
    case "pregunta":
      return (
        `FALTA INFORMACIÓN: ${d.preguntas.map((p) => p.texto).join(" ")} ` +
        `Pregúntaselo al usuario tal cual. NO elijas tú entre las opciones.`
      );
    case "no_disponible":
      return (
        `${d.frase}` +
        (d.alternativas.length ? ` Horas libres ese día: ${d.alternativas.join(", ")}. Ofrécelas.` : "")
      );
    case "sin_permiso":
      return `SIN PERMISO: ${d.frase} Dilo con estas palabras; no lo intentes de otra forma.`;
    case "no_se_puede":
      return `NO SE PUEDE: ${d.frase}`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   LA CLÍNICA
   ═══════════════════════════════════════════════════════════════════════ */

export interface ConfigClinica {
  /** La tz de la FILA de la clínica: la misma que usa la ruta al validar. */
  timezone: string;
  agendaDayStart: number;
  agendaDayEnd: number;
  defaultSlotMinutes: number;
  googleCalendarEnabled: boolean;
  schedules: ScheduleDay[];
}

/**
 * La configuración con la que decide `loadClinicSession`: zona, ventana, hueco
 * y horario de Ajustes. Nunca se leen los tokens de Google, solo si está activo.
 */
export async function cargarClinica(ctx: SabinaCtx, db: AgendaDb): Promise<ConfigClinica> {
  const [clinica, horario] = await Promise.all([
    db.clinic.findFirst({
      where: { id: ctx.clinicId },
      select: {
        timezone: true,
        agendaDayStart: true,
        agendaDayEnd: true,
        defaultSlotMinutes: true,
        googleCalendarEnabled: true,
      },
    }),
    db.clinicSchedule.findMany({
      where: { clinicId: ctx.clinicId },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      orderBy: { dayOfWeek: "asc" },
    }),
  ]);
  if (!clinica) throw new Error("clinica_no_encontrada");
  return {
    timezone: clinica.timezone || ctx.timezone,
    agendaDayStart: typeof clinica.agendaDayStart === "number" ? clinica.agendaDayStart : 8,
    agendaDayEnd: typeof clinica.agendaDayEnd === "number" ? clinica.agendaDayEnd : 20,
    defaultSlotMinutes: typeof clinica.defaultSlotMinutes === "number" && clinica.defaultSlotMinutes > 0 ? clinica.defaultSlotMinutes : 30,
    googleCalendarEnabled: clinica.googleCalendarEnabled === true,
    schedules: (horario ?? []) as ScheduleDay[],
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   FORMATO
   ═══════════════════════════════════════════════════════════════════════ */

/** Hora de pared de la clínica. Sin segundos ni zona: el código la convierte, no el modelo. */
export const esquemaHora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "la hora va en formato HH:MM, de 00:00 a 23:59");

/** «jueves 18 de septiembre», en la zona de la clínica. */
export function fechaLarga(instante: Date, timezone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  })
    .format(instante)
    .replace(",", "");
}

export function nombreDe(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
}

/** «…2222»: lo justo para distinguir a dos homónimos sin sacar el teléfono entero. */
export function telefonoParcial(phone: string | null | undefined): string | null {
  const digitos = String(phone ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? `tel. …${digitos.slice(-4)}` : null;
}

/** Sin acentos, minúsculas, espacios colapsados. El criterio del buscador del panel. */
export function normal(texto: unknown): string {
  return normalizePatientText(texto).replace(/\s+/g, " ").trim();
}

/** `HH:MM` → minutos del día. */
export function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutos del día → `HH:MM`. */
export function hhmm(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}
