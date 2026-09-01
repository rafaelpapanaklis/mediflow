// ¿Qué va a pasar DE VERDAD con los recordatorios de ESTE paciente?
//
// La ficha prometía a todo el mundo, en la tarjeta "Reglas automáticas", un
// "recordatorio por WhatsApp 24 h antes de su próxima cita (si la clínica tiene
// WhatsApp activado)". El paréntesis miraba la CONEXIÓN de WhatsApp, no el
// interruptor de los recordatorios: en una clínica con los recordatorios
// APAGADOS el aviso seguía prometiendo un mensaje que no sale nunca. Y la hora
// estaba escrita a mano: el momento es configurable (48 h / 24 h / 4 h / 2 h /
// 1 h, hasta cuatro a la vez) y "24 h" mentía en cuanto alguien lo cambiaba.
//
// Este módulo replica —PURO, sin BD, sin i18n— las MISMAS condiciones que
// decide el cron en src/lib/reminders/enqueue.ts, y en el mismo orden:
//
//   1. settings.enabled && settings.offsets.length > 0
//      (settings = getEffectiveReminderSettings(clinic), que es también la
//      que lee el cron; ahí vive la trampa de que waReminderActive en NULL
//      significa ENCENDIDO — `waReminderActive ?? true`).
//   2. Canal de la clínica: whatsapp exige clinic.waConnected; email no exige
//      nada. Si no queda ninguno, el cron hace `continue` y no sale nada.
//   3. Override del paciente (PatientAccount.notifPrefs): puede dejar UN solo
//      momento y recortar el canal, pero NUNCA dejarlo sin ninguno.
//   4. El dato de contacto: sin teléfono no se encola WhatsApp y sin correo no
//      se encola email (el cron los cuenta como `skipped`).
//
// Si esas reglas cambian en enqueue.ts, cambian aquí. Es la única razón por la
// que esto vive aparte de la tarjeta que lo pinta.

import type { ReminderSettings } from "./config";
import type { NotifPrefs } from "@/lib/patient-notifications/types";

/** Canal por el que un recordatorio sale de verdad (la config admite "both"). */
export type ReminderOutcomeChannel = "whatsapp" | "email";

/**
 * Por qué sale (o no) el recordatorio. Cada valor corresponde a UN corte
 * concreto del cron, para que el texto de la ficha pueda decir cuál falló:
 *   ok        — sí sale.
 *   disabled  — apagados en Ajustes › Recordatorios (o sin ningún momento).
 *   noChannel — encendidos, pero ningún canal puede salir (WhatsApp sin
 *               conectar y sin canal de correo).
 *   noContact — el canal existe, pero el paciente no tiene ese dato.
 */
export type ReminderOutcomeReason = "ok" | "disabled" | "noChannel" | "noContact";

export interface ReminderOutcome {
  willSend: boolean;
  reason: ReminderOutcomeReason;
  /** Canales que de verdad saldrían para ESTE paciente. */
  channels: ReminderOutcomeChannel[];
  /**
   * Canales que la clínica (ya con el override del paciente) quiere usar, ANTES
   * de mirar si hay teléfono o correo. Sirve para decir QUÉ dato falta cuando
   * el motivo es "noContact".
   */
  wanted: ReminderOutcomeChannel[];
  /** Momentos reales, en minutos antes de la cita, en orden descendente. */
  offsets: number[];
}

export interface ReminderOutcomeInput {
  /** Config EFECTIVA de la clínica — getEffectiveReminderSettings(clinic). */
  settings: ReminderSettings;
  /** Clinic.waConnected: sin conexión de Meta el canal WhatsApp no existe. */
  waConnected: boolean;
  patientHasPhone: boolean;
  patientHasEmail: boolean;
  /** Override del portal del paciente, si guardó uno válido. */
  patientPrefs?: NotifPrefs | null;
}

export function resolveReminderOutcome(input: ReminderOutcomeInput): ReminderOutcome {
  const { settings, waConnected, patientHasPhone, patientHasEmail } = input;
  const prefs = input.patientPrefs ?? null;

  // 1 · El interruptor. `settings` ya trae resuelto el legacy (incluido el
  //     waReminderActive NULL = ENCENDIDO), así que aquí solo se lee.
  if (!settings.enabled || settings.offsets.length === 0) {
    return { willSend: false, reason: "disabled", channels: [], wanted: [], offsets: [] };
  }

  // 2 · Canal de la clínica.
  let wantsWhatsapp =
    (settings.channel === "whatsapp" || settings.channel === "both") && waConnected;
  let wantsEmail = settings.channel === "email" || settings.channel === "both";
  let offsets = settings.offsets;

  if (!wantsWhatsapp && !wantsEmail) {
    return { willSend: false, reason: "noChannel", channels: [], wanted: [], offsets };
  }

  // 3 · Override del paciente. El momento solo se recorta si la clínica ofrece
  //     ese momento (si no, el paciente sigue recibiendo todos); el canal solo
  //     se recorta si queda al menos uno vivo — el mismo `if (wa || em)` del
  //     cron, que es lo que impide dejar al paciente sin ningún canal.
  if (prefs) {
    if (offsets.includes(prefs.leadMinutes)) offsets = [prefs.leadMinutes];
    const wa = wantsWhatsapp && (prefs.channel === "whatsapp" || prefs.channel === "both");
    const em = wantsEmail && (prefs.channel === "email" || prefs.channel === "both");
    if (wa || em) {
      wantsWhatsapp = wa;
      wantsEmail = em;
    }
  }

  const wanted: ReminderOutcomeChannel[] = [];
  if (wantsWhatsapp) wanted.push("whatsapp");
  if (wantsEmail) wanted.push("email");

  // 4 · El dato de contacto del paciente.
  const channels: ReminderOutcomeChannel[] = [];
  if (wantsWhatsapp && patientHasPhone) channels.push("whatsapp");
  if (wantsEmail && patientHasEmail) channels.push("email");

  if (channels.length === 0) {
    return { willSend: false, reason: "noContact", channels: [], wanted, offsets };
  }
  return { willSend: true, reason: "ok", channels, wanted, offsets };
}

/**
 * Un momento en horas ENTERAS, o null si no lo es. Los cinco momentos que la UI
 * deja elegir (ALLOWED_REMINDER_OFFSETS) son todos múltiplos de 60, igual que
 * los dos del camino legacy; el null es la salida defensiva para que un valor
 * raro guardado a mano se pinte en minutos en vez de "0.5 h".
 */
export function reminderOffsetHours(minutes: number): number | null {
  return minutes > 0 && minutes % 60 === 0 ? minutes / 60 : null;
}
