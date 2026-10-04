// «Avisar al paciente» al MOVER una cita (ws1-t1, auditoría BEVADENT, F14).
//
// El servidor ya sabía callarse: `PATCH /api/appointments/[id]` manda el WhatsApp de «cita reprogramada» solo
// si la cita cambió de HORA, solo si la clínica encendió «Al reprogramar» (Dashboard → WhatsApp y
// recordatorios) y nunca si llega `notifyPatient: false`. Lo que faltaba era la casilla: al editar una cita o
// al soltarla arrastrada, recepción no podía decir «a este no le avises» (el paciente ya lo sabe porque lo
// pidió por teléfono, o es un ajuste interno de la agenda).
//
// Las reglas viven aquí, sin React, para que las mismas cuatro pantallas (Editar cita, «Mover cita» de la
// agenda nueva, «¿Reagendar?» de la agenda de siempre y la edición de /dashboard/appointments) decidan igual:
//   · la casilla sale solo si la hora cambia (si no, el servidor no avisa de nada y la casilla mentiría);
//   · sale MARCADA cuando la clínica tiene el aviso encendido y WhatsApp conectado — lo de siempre —;
//   · desmarcada viaja `notifyPatient: false`; marcada o sin saber el ajuste no viaja nada y el servidor
//     hace lo de siempre (cuerpo del PATCH idéntico al de antes de esta casilla).

/**
 * Qué se sabe del aviso de la clínica. `null` = todavía no (o no se pudo preguntar): no se pinta nada y el
 * servidor decide como siempre.
 */
export type EstadoAvisoReprogramar = "encendido" | "apagado" | "sinWhatsApp" | null;

/** Lee la respuesta de `GET /api/clinic/me`. */
export function estadoDelAvisoReprogramar(cuerpo: unknown): EstadoAvisoReprogramar {
  const clinic = (cuerpo as { clinic?: Record<string, unknown> } | null)?.clinic;
  if (!clinic || typeof clinic !== "object") return null;
  if (typeof clinic.waNotifyOnReschedule !== "boolean") return null;
  if (!clinic.waConnected) return "sinWhatsApp";
  return clinic.waNotifyOnReschedule ? "encendido" : "apagado";
}

/** ¿Cambia la hora de inicio? Es lo único que el servidor considera noticia para el paciente. */
export function cambiaLaHoraDeLaCita(antesIso: string | null | undefined, despuesIso: string | null | undefined): boolean {
  if (!antesIso || !despuesIso) return false;
  const a = new Date(antesIso).getTime();
  const d = new Date(despuesIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(d)) return false;
  return a !== d;
}

/** La casilla se enseña (marcable) solo si la hora cambia y el aviso de verdad saldría. */
export function seOfreceLaCasilla(estado: EstadoAvisoReprogramar, cambiaHora: boolean): boolean {
  return cambiaHora && estado === "encendido";
}

/**
 * Lo que la casilla añade al cuerpo del PATCH. Solo `{ notifyPatient: false }` cuando se ofreció y la
 * desmarcaron; en cualquier otro caso nada.
 */
export function campoDelAviso(
  estado: EstadoAvisoReprogramar,
  cambiaHora: boolean,
  marcada: boolean,
): { notifyPatient?: false } {
  return seOfreceLaCasilla(estado, cambiaHora) && !marcada ? { notifyPatient: false } : {};
}

export interface TextosAvisoReprogramar {
  casilla: string;
  rotulo: string;
  apagado: string;
  /** ws1-t1 (C-101): sin WhatsApp conectado también se dice, en vez de no pintar nada. */
  sinWhatsApp: string;
}

const ES: TextosAvisoReprogramar = {
  rotulo: "Aviso al paciente",
  casilla: "Avisar al paciente por WhatsApp del cambio",
  apagado:
    "El aviso de «cita reprogramada» está apagado en WhatsApp y recordatorios: al paciente no le llega nada.",
  sinWhatsApp: "La clínica no tiene WhatsApp conectado: al paciente no le llega nada. Avísale por otro medio.",
};

const EN: TextosAvisoReprogramar = {
  rotulo: "Patient notice",
  casilla: "Notify the patient about the change on WhatsApp",
  apagado:
    "The «rescheduled appointment» notice is off in WhatsApp & reminders: the patient won't get a message.",
  sinWhatsApp: "The clinic has no WhatsApp connected: the patient won't get a message. Let them know another way.",
};

export function textosAvisoReprogramar(locale: string | null | undefined): TextosAvisoReprogramar {
  return (locale ?? "es").toLowerCase().startsWith("en") ? EN : ES;
}
