// Qué recordatorios cancelar y cuáles recrear al mover una cita (M-22).
//
// EL PROBLEMA: el mensaje del recordatorio se rendea al ENCOLAR, con la fecha y
// la hora congeladas dentro del texto. Si la cita se mueve y su recordatorio
// sigue en cola, al paciente le llega la hora VIEJA. Y como el dedup del
// encolador va por cita+momento+canal, mientras esa fila exista bloquea además
// el recordatorio correcto: no es que llegue tarde, es que no llega nunca.
//
// PURO a propósito: aquí vive toda la decisión y se prueba entera sin BD
// (npm run test:reminders-reschedule). El helper que escribe está en
// reschedule.server.ts.

import { WA_REMINDER_PENDING_STATUSES } from "@/lib/whatsapp/reminder-status";
import type { ReminderChannel } from "@/lib/reminders/config";

export type ReminderOutChannel = "whatsapp" | "email";

export interface ExistingApptReminder {
  id: string;
  /** Columna TEXT: PENDING | SENT | FAILED | CANCELLED, y el legacy ACTIVE. */
  status: string;
}

/** Override del paciente (portal). null = usar la config de la clínica. */
export interface PatientReminderPref {
  leadMinutes: number;
  channel: string;
}

export interface ReminderReschedulePlan {
  /** Aún no salieron: se cancelan porque llevan la hora vieja dentro del texto. */
  cancelIds: string[];
  /** Ya enviados (o ya cerrados): NO se tocan, son historial. */
  keepIds: string[];
  /** Lo que hay que encolar para la hora nueva. */
  create: Array<{ offsetMin: number; channel: ReminderOutChannel; scheduledFor: Date }>;
}

/**
 * ¿Este recordatorio sigue sin enviarse?
 *
 * TRAMPA DEL SCHEMA: `status` es TEXT y hay filas legacy de mayo con 'ACTIVE'
 * que también significan pendiente (está documentado en schema.prisma y el
 * worker las barre). Filtrar solo por 'PENDING' dejaría vivas justo las más
 * viejas y el bug seguiría ahí para ellas.
 *
 * Se normaliza a mayúsculas por si alguna fila trae otra caja: en el peor caso
 * cancelamos una fila que el worker ya consideraba muerta (inofensivo), nunca
 * al revés.
 */
export function isPendingReminderStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return WA_REMINDER_PENDING_STATUSES.includes(s);
}

export interface PlanReminderRescheduleInput {
  /** Recordatorios APPT_AUTO que hoy tiene la cita. */
  existing: ExistingApptReminder[];
  /** Hora NUEVA de la cita. */
  newStartsAt: Date;
  now: Date;
  /** Config efectiva de la clínica (getEffectiveReminderSettings). */
  settings: { enabled: boolean; offsets: number[]; channel: ReminderChannel };
  /** Override del paciente, si tiene cuenta del portal y lo guardó. */
  pref?: PatientReminderPref | null;
  /** Sin teléfono no hay WhatsApp; sin correo no hay email. */
  hasPhone: boolean;
  hasEmail: boolean;
}

/**
 * Decide el plan completo. No escribe nada.
 *
 * Reglas de recreación (las MISMAS que aplica el barrido de
 * lib/reminders/enqueue.ts, para que reagendar no dé un resultado distinto al
 * de encolar desde cero):
 *   · la config de la clínica manda los momentos y el canal;
 *   · si el paciente eligió una anticipación que la clínica ofrece, recibe SOLO
 *     esa; si eligió una que la clínica no ofrece, no se filtra nada;
 *   · el canal del paciente se cruza con el de la clínica, pero si ese cruce lo
 *     dejaría sin ningún canal se ignora (nadie se queda sin aviso);
 *   · un momento que YA pasó no se recrea.
 */
export function planReminderReschedule(
  input: PlanReminderRescheduleInput,
): ReminderReschedulePlan {
  const cancelIds: string[] = [];
  const keepIds: string[] = [];
  for (const r of input.existing) {
    if (isPendingReminderStatus(r.status)) cancelIds.push(r.id);
    else keepIds.push(r.id);
  }

  const create: ReminderReschedulePlan["create"] = [];
  if (!input.settings.enabled || input.settings.offsets.length === 0) {
    return { cancelIds, keepIds, create };
  }

  // Canales de la clínica ∩ canales del paciente (con la salvaguarda de arriba).
  const clinicChannels: ReminderOutChannel[] = [];
  if (input.settings.channel === "whatsapp" || input.settings.channel === "both") {
    clinicChannels.push("whatsapp");
  }
  if (input.settings.channel === "email" || input.settings.channel === "both") {
    clinicChannels.push("email");
  }

  let channels = clinicChannels;
  if (input.pref) {
    const p = input.pref.channel;
    const crossed = clinicChannels.filter(
      (c) => p === "both" || p === c,
    );
    if (crossed.length > 0) channels = crossed;
  }

  // Anticipación: solo se estrecha si la clínica de verdad ofrece la que el
  // paciente pidió.
  let offsets = input.settings.offsets;
  if (input.pref && offsets.includes(input.pref.leadMinutes)) {
    offsets = [input.pref.leadMinutes];
  }

  const seen = new Set<string>();
  for (const offset of offsets) {
    const moment = new Date(input.newStartsAt.getTime() - offset * 60_000);
    // Momento pasado: no se recrea. Encolarlo con scheduledFor = ahora mandaría
    // "te recordamos tu cita de mañana" dos horas antes de la cita, que es peor
    // que no mandar nada. El barrido tampoco lo encolaría.
    if (moment.getTime() <= input.now.getTime()) continue;

    for (const channel of channels) {
      if (channel === "whatsapp" && !input.hasPhone) continue;
      if (channel === "email" && !input.hasEmail) continue;
      // Una config con offsets repetidos no puede generar dos avisos iguales.
      const key = `${offset}|${channel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      create.push({ offsetMin: offset, channel, scheduledFor: moment });
    }
  }

  return { cancelIds, keepIds, create };
}
