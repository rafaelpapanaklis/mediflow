// Qué plantilla (tipo de envío) y qué datos lleva cada aviso de cita —
// ws1-t4 (auditoría BEVADENT, F4/M7).
//
// La cancelación tiene ahora su propia plantilla (`appointment_cancelled`,
// dc_cancelacion_cita). Antes salía con el tipo `appointment_change` («tu cita
// cambió al…») y, para no mentir, SIN datos: fuera de la ventana de 24 h se
// bloqueaba siempre y el paciente no se enteraba de que su cita ya no existía.
//
// PURO: sin Prisma ni red. Lo usan avisos-cita.ts (el equipo agenda, mueve o
// cancela) y appointment-change/notify.ts (la clínica resuelve una solicitud del
// portal). El ORDEN de cada array es contrato con su entrada del catálogo.

import type { WhatsAppSendKind } from "./system-message";

export type EventoAvisoCita = "agendada" | "reprogramada" | "cancelada";

export interface DatosAvisoCita {
  paciente: string;
  clinica: string;
  fecha: string;
  hora: string;
  doctor: string;
}

/** Tipo de envío (y por tanto de plantilla) de cada evento. */
export function kindDeAvisoCita(evento: EventoAvisoCita): WhatsAppSendKind {
  if (evento === "agendada") return "booking";
  if (evento === "cancelada") return "appointment_cancelled";
  return "appointment_change";
}

/**
 * Datos de la plantilla del evento, EN EL ORDEN de su entrada del catálogo:
 * agendada/reprogramada {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora,
 * {{5}} doctor; cancelada {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora
 * (las de la cita cancelada, que conserva su startsAt).
 */
export function paramsDeAvisoCita(evento: EventoAvisoCita, v: DatosAvisoCita): string[] {
  if (evento === "cancelada") return [v.paciente, v.clinica, v.fecha, v.hora];
  return [v.paciente, v.clinica, v.fecha, v.hora, v.doctor];
}

/**
 * La resolución de una solicitud de cambio del portal:
 *   · reagendado aprobado → `appointment_change` con la fecha NUEVA;
 *   · cancelación aprobada → `appointment_cancelled` con la fecha original;
 *   · rechazo (la cita sigue en pie) → `appointment_change` SIN datos: ninguna
 *     plantilla del catálogo dice «no pudimos cambiarla», así que fuera de la
 *     ventana de 24 h se bloquea con su motivo en vez de mandar un texto que miente.
 */
export function envioDeResolucion(
  cr: { status: string; type: string },
  v: DatosAvisoCita,
): { kind: WhatsAppSendKind; templateParams: string[] | null } {
  if (cr.status === "APPROVED" && cr.type === "RESCHEDULE") {
    return { kind: "appointment_change", templateParams: paramsDeAvisoCita("reprogramada", v) };
  }
  if (cr.status === "APPROVED" && cr.type === "CANCEL") {
    return { kind: "appointment_cancelled", templateParams: paramsDeAvisoCita("cancelada", v) };
  }
  return { kind: "appointment_change", templateParams: null };
}
