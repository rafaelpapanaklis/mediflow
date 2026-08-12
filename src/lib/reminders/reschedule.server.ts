import "server-only";

// Aplicación del plan de reagendado de recordatorios (M-22).
//
// Se llama DENTRO de la misma transacción que mueve la cita: si el update de la
// cita falla a medias, no puede quedar una cita movida con recordatorios viejos
// (ni al revés). Por eso recibe el `tx` en vez de usar el cliente global.
//
// La decisión de QUÉ cancelar y QUÉ recrear vive en reschedule.ts, que es puro y
// está testeado sin BD. Aquí solo se lee el contexto y se escribe.

import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  APPT_AUTO_TYPE,
  formatApptDateParts,
  getConfirmUrl,
  getEffectiveReminderSettings,
  renderReminderTemplate,
} from "@/lib/reminders/config";
import {
  WA_REMINDER_STATUS,
  WA_REMINDER_PENDING_STATUSES,
} from "@/lib/whatsapp/reminder-status";
import { parseNotifPrefs } from "@/lib/patient-notifications/types";
import {
  isPendingReminderStatus,
  planReminderReschedule,
} from "@/lib/reminders/reschedule";

/** Cliente de Prisma dentro de una transacción (o el global, si no hay). */
type Tx = Prisma.TransactionClient;

export interface ReminderRescheduleResult {
  cancelled: number;
  created: number;
}

const EMPTY: ReminderRescheduleResult = { cancelled: 0, created: 0 };

/**
 * Cancela los recordatorios pendientes de la cita y encola los que
 * correspondan a la hora NUEVA.
 *
 * Los SENT no se tocan: son historial y, además, son las filas contra las que
 * el webhook empareja un "CONFIRMAR"/"CANCELAR" del paciente. Borrarlas —que es
 * lo que se hacía— dejaba sin efecto la respuesta a un recordatorio ya recibido.
 *
 * Multi-tenant: TODAS las lecturas y escrituras van acotadas por clinicId.
 */
export async function applyReminderReschedule(
  tx: Tx,
  args: {
    appointmentId: string;
    clinicId: string;
    newStartsAt: Date;
    now?: Date;
    /** Motivo que queda en la fila cancelada (lo muestra el panel). */
    reason?: string;
  },
): Promise<ReminderRescheduleResult> {
  const now = args.now ?? new Date();

  const appt = await tx.appointment.findFirst({
    where: { id: args.appointmentId, clinicId: args.clinicId },
    select: {
      id: true,
      confirmToken: true,
      patientId: true,
      patient: { select: { firstName: true, phone: true, email: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
  });
  if (!appt) return EMPTY;

  const clinic = await tx.clinic.findUnique({
    where: { id: args.clinicId },
    select: {
      name: true,
      timezone: true,
      reminderSettings: true,
      waReminderActive: true,
      waReminder24h: true,
      waReminder1h: true,
      waReminderMsg: true,
    },
  });
  if (!clinic) return EMPTY;

  const existing = await tx.whatsAppReminder.findMany({
    where: {
      appointmentId: args.appointmentId,
      clinicId: args.clinicId,
      type: APPT_AUTO_TYPE,
    },
    select: { id: true, status: true },
  });

  // Override del paciente (si tiene cuenta del portal). Best-effort: si la
  // columna aún no existe o la cuenta no está, se usa la config de la clínica.
  let pref = null;
  try {
    const link = await tx.patientAccountLink.findFirst({
      where: { patientId: appt.patientId, clinicId: args.clinicId },
      select: { account: { select: { notifPrefs: true } } },
    });
    pref = parseNotifPrefs(link?.account?.notifPrefs);
  } catch {
    pref = null;
  }

  const settings = getEffectiveReminderSettings(clinic);
  const plan = planReminderReschedule({
    existing,
    newStartsAt: args.newStartsAt,
    now,
    settings,
    pref,
    hasPhone: Boolean(appt.patient.phone),
    hasEmail: Boolean(appt.patient.email),
  });

  if (plan.cancelIds.length > 0) {
    await tx.whatsAppReminder.updateMany({
      // El guard por status NO es redundante con el plan: el worker hace
      // claim-then-send (marca SENT ANTES de enviar), así que puede reclamar una
      // de estas filas entre el findMany de arriba y este update. Sin el guard
      // la marcaríamos "cancelada" cuando el mensaje YA salió, y el panel
      // mentiría en el sentido contrario al que arregla esto.
      where: {
        id: { in: plan.cancelIds },
        clinicId: args.clinicId,
        status: { in: WA_REMINDER_PENDING_STATUSES },
      },
      data: {
        status: WA_REMINDER_STATUS.CANCELLED,
        errorMsg: args.reason ?? "Cancelado: la cita se reagendó y este aviso llevaba la hora anterior",
      },
    });
  }

  if (plan.create.length === 0) {
    return { cancelled: plan.cancelIds.length, created: 0 };
  }

  // El link de confirmación necesita confirmToken. Se genera aquí si la cita no
  // lo tenía; el guard `confirmToken: null` evita pisar el de otra corrida —
  // pisarlo mataría el link de un mensaje YA enviado.
  let token = appt.confirmToken;
  if (!token) {
    const fresh = randomBytes(24).toString("base64url");
    const wrote = await tx.appointment.updateMany({
      where: { id: appt.id, confirmToken: null },
      data: { confirmToken: fresh },
    });
    if (wrote.count === 1) {
      token = fresh;
    } else {
      const current = await tx.appointment.findUnique({
        where: { id: appt.id },
        select: { confirmToken: true },
      });
      token = current?.confirmToken ?? fresh;
    }
  }

  // El cuerpo se rendea con la fecha y la hora NUEVAS: ese es el punto de todo
  // esto. El mensaje viaja congelado en la fila, así que rendearlo aquí es lo
  // que hace que el paciente reciba la hora correcta.
  const { fecha, hora } = formatApptDateParts(args.newStartsAt, clinic.timezone);
  const doctorName = `Dr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}`.trim();
  const confirmUrl = getConfirmUrl(token);
  const message = renderReminderTemplate(settings.template, {
    paciente: appt.patient.firstName,
    clinica: clinic.name,
    fecha,
    hora,
    doctor: doctorName,
    link: confirmUrl,
  });

  await tx.whatsAppReminder.createMany({
    data: plan.create.map((row) => ({
      clinicId: args.clinicId,
      appointmentId: appt.id,
      type: APPT_AUTO_TYPE,
      message,
      status: WA_REMINDER_STATUS.PENDING,
      scheduledFor: row.scheduledFor,
      // MISMA forma de payload que el encolador: es la llave del dedup
      // (cita+momento+canal) y el routing por canal del worker.
      payload: {
        kind: "APPT_AUTO",
        offsetMin: row.offsetMin,
        channel: row.channel,
        confirmUrl,
        ...(row.channel === "email"
          ? { subject: `Recordatorio de cita — ${clinic.name}` }
          : {}),
      },
    })),
  });

  return { cancelled: plan.cancelIds.length, created: plan.create.length };
}

/**
 * Cancela los recordatorios automáticos PENDIENTES de una cita que se cierra
 * (cancelada, no-show, rechazada). Los enviados se conservan como historial.
 *
 * El worker ya hacía un re-check al enviar y no manda un aviso de una cita
 * cancelada, pero la fila se quedaba en "En cola" hasta que le tocaba turno: el
 * panel enseñaba un recordatorio pendiente de una cita que ya no existe.
 *
 * Incluye el legacy 'ACTIVE' vía `isPendingReminderStatus` (schema TEXT).
 */
export async function cancelPendingRemindersForAppointment(
  tx: Tx,
  args: { appointmentId: string; clinicId: string; reason?: string },
): Promise<number> {
  const existing = await tx.whatsAppReminder.findMany({
    where: {
      appointmentId: args.appointmentId,
      clinicId: args.clinicId,
      type: APPT_AUTO_TYPE,
    },
    select: { id: true, status: true },
  });
  // Mismo criterio de "pendiente" que el reagendado, del mismo sitio testeado:
  // incluye el legacy 'ACTIVE'.
  const cancelIds = existing
    .filter((r) => isPendingReminderStatus(r.status))
    .map((r) => r.id);
  if (cancelIds.length === 0) return 0;

  const res = await tx.whatsAppReminder.updateMany({
    // Mismo guard que en el reagendado: el claim-then-send del worker puede
    // haber reclamado la fila entre la lectura y esta escritura.
    where: {
      id: { in: cancelIds },
      clinicId: args.clinicId,
      status: { in: WA_REMINDER_PENDING_STATUSES },
    },
    data: {
      status: WA_REMINDER_STATUS.CANCELLED,
      errorMsg: args.reason ?? "Cancelado: la cita se canceló",
    },
  });
  return res.count;
}
