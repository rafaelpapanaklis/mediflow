// Encolador de recordatorios automáticos de citas.
//
// Llamado por /api/cron/appointment-reminders cada 15 min. Barre las citas
// próximas de cada clínica y encola filas en WhatsAppReminder (canal whatsapp
// y/o email; el queue-worker las envía). Idempotente: nunca encola dos veces
// la misma cita+momento+canal (dedup contra filas APPT_AUTO existentes).
//
// Reglas:
// - Sin transacciones largas (PgBouncer): queries cortas + createMany en chunks.
// - Tolerante a fallos por clínica: try/catch por clínica, una clínica rota no
//   frena a las demás.
// - No usa el bot IA: cero tokens, cero tope diario del bot.

import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  APPT_AUTO_TYPE,
  dedupeKey,
  formatApptDateParts,
  getConfirmUrl,
  getEffectiveReminderSettings,
  renderReminderTemplate,
} from "@/lib/reminders/config";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import { loadNotifPrefsByAccount } from "@/lib/patient-notifications/prefs";
import type { NotifPrefs } from "@/lib/patient-notifications/types";

export interface SweepSummary {
  clinics: number;
  queuedWhatsapp: number;
  queuedEmail: number;
  /** Notificaciones in-app del portal creadas (centro de notificaciones). */
  inAppNotifications: number;
  skipped: number;
  errors: Array<{ clinicId: string; reason: string }>;
}

/**
 * Barre citas próximas y encola recordatorios pendientes.
 *
 * Ventana por momento (offset en minutos): una cita califica para el momento N
 * si `startsAt - N` cae en [now - graceMin, now + lookaheadMin]. graceMin da
 * tolerancia si un cron se saltó; lookaheadMin cubre el intervalo del cron.
 */
export async function sweepAppointmentReminders(opts?: {
  now?: Date;
  lookaheadMin?: number;
  graceMin?: number;
}): Promise<SweepSummary> {
  const now = opts?.now ?? new Date();
  const lookaheadMin = opts?.lookaheadMin ?? 17;
  const graceMin = opts?.graceMin ?? 30;

  const summary: SweepSummary = {
    clinics: 0,
    queuedWhatsapp: 0,
    queuedEmail: 0,
    inAppNotifications: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Todas las clínicas (sin where): la config efectiva se resuelve en JS
  //    con getEffectiveReminderSettings; la tabla es chica.
  const clinics = await prisma.clinic.findMany({
    select: {
      id: true,
      name: true,
      timezone: true,
      waConnected: true,
      waReminderActive: true,
      waReminder24h: true,
      waReminder1h: true,
      waReminderMsg: true,
      reminderSettings: true,
    },
  });

  // 2. Loop secuencial por clínica: una clínica rota no frena a las demás.
  for (const clinic of clinics) {
    try {
      const settings = getEffectiveReminderSettings(clinic);
      if (!settings.enabled || settings.offsets.length === 0) continue;

      const wantsWhatsapp =
        (settings.channel === "whatsapp" || settings.channel === "both") &&
        clinic.waConnected;
      const wantsEmail = settings.channel === "email" || settings.channel === "both";
      if (!wantsWhatsapp && !wantsEmail) continue;

      // 2c. Citas candidatas por momento: una cita califica para el offset N
      //     si startsAt cae en [now + (N - graceMin), now + (N + lookaheadMin)].
      const candidatesByOffset: Array<{
        offset: number;
        appointments: Array<{
          id: string;
          patientId: string;
          startsAt: Date;
          confirmToken: string | null;
          patient: {
            firstName: string;
            lastName: string;
            phone: string | null;
            email: string | null;
          };
          doctor: { firstName: string; lastName: string };
        }>;
      }> = [];
      for (const offset of settings.offsets) {
        const appointments = await prisma.appointment.findMany({
          where: {
            clinicId: clinic.id,
            startsAt: {
              gte: new Date(now.getTime() + (offset - graceMin) * 60000),
              lte: new Date(now.getTime() + (offset + lookaheadMin) * 60000),
            },
            status: { in: ["PENDING", "SCHEDULED", "CONFIRMED"] },
          },
          select: {
            id: true,
            patientId: true,
            startsAt: true,
            confirmToken: true,
            patient: {
              select: { firstName: true, lastName: true, phone: true, email: true },
            },
            doctor: { select: { firstName: true, lastName: true } },
          },
        });
        candidatesByOffset.push({ offset, appointments });
      }

      const candidateIds = Array.from(
        new Set(candidatesByOffset.flatMap((c) => c.appointments.map((a) => a.id))),
      );
      if (candidateIds.length === 0) {
        summary.clinics++;
        continue;
      }
      const candidatePatientIds = Array.from(
        new Set(candidatesByOffset.flatMap((c) => c.appointments.map((a) => a.patientId))),
      );

      // 2d. Dedup en UNA query por clínica: filas APPT_AUTO ya encoladas para
      //     estas citas → Set de llaves cita+momento+canal. Jamás dos
      //     recordatorios para la misma llave, ni entre corridas ni dentro
      //     de la misma corrida (las llaves nuevas se agregan al Set abajo).
      const existing = await prisma.whatsAppReminder.findMany({
        where: {
          clinicId: clinic.id,
          appointmentId: { in: candidateIds },
          type: APPT_AUTO_TYPE,
        },
        select: { appointmentId: true, payload: true },
      });
      const seen = new Set<string>();
      for (const row of existing) {
        if (!row.appointmentId) continue;
        const p = row.payload as any;
        seen.add(dedupeKey(row.appointmentId, p?.offsetMin, p?.channel));
      }

      // Cuentas del portal vinculadas a estos pacientes (para el centro de
      // notificaciones in-app) y sus preferencias de recordatorio. Best-effort:
      // un fallo aquí NO frena el envío de recordatorios (usa config de clínica).
      const accountByPatient = new Map<string, string>();
      let prefsByAccount = new Map<string, NotifPrefs>();
      try {
        const links = await prisma.patientAccountLink.findMany({
          where: { patientId: { in: candidatePatientIds }, clinicId: clinic.id },
          select: { patientId: true, accountId: true },
        });
        for (const l of links) {
          if (!accountByPatient.has(l.patientId)) {
            accountByPatient.set(l.patientId, l.accountId);
          }
        }
        prefsByAccount = await loadNotifPrefsByAccount(links.map((l) => l.accountId));
      } catch (err) {
        console.error("[reminders/enqueue] links/prefs (best-effort):", err);
      }

      // confirmToken generados en esta corrida (reusados entre offsets/canales).
      const tokenCache = new Map<string, string>();

      const rows: Prisma.WhatsAppReminderCreateManyInput[] = [];
      const notifRows: Prisma.PatientNotificationCreateManyInput[] = [];
      let clinicWhatsapp = 0;
      let clinicEmail = 0;

      for (const { offset, appointments } of candidatesByOffset) {
        for (const appt of appointments) {
          const accountId = accountByPatient.get(appt.patientId);
          const pref = accountId ? prefsByAccount.get(accountId) : undefined;

          // Preferencias del paciente (solo si guardó un override válido).
          // Garantía: NUNCA dejan al paciente sin ningún canal (si el filtro
          // vaciaría ambos, se ignora y se usa la config de la clínica).
          let pWantsWhatsapp = wantsWhatsapp;
          let pWantsEmail = wantsEmail;
          if (pref) {
            // Anticipación: si la clínica ofrece ese momento, el paciente solo
            // recibe ESE offset; si no lo ofrece, no se filtra (sigue recibiendo).
            if (settings.offsets.includes(pref.leadMinutes) && offset !== pref.leadMinutes) {
              continue;
            }
            const wa = wantsWhatsapp && (pref.channel === "whatsapp" || pref.channel === "both");
            const em = wantsEmail && (pref.channel === "email" || pref.channel === "both");
            if (wa || em) {
              pWantsWhatsapp = wa;
              pWantsEmail = em;
            }
          }

          const waKey = dedupeKey(appt.id, offset, "whatsapp");
          const emailKey = dedupeKey(appt.id, offset, "email");
          const queueWhatsapp = pWantsWhatsapp && !seen.has(waKey);
          const queueEmail = pWantsEmail && !seen.has(emailKey);

          // Fecha/hora local (puro, barato): cuerpo de la notificación in-app
          // y del mensaje WA/email (más abajo).
          const { fecha, hora } = formatApptDateParts(appt.startsAt, clinic.timezone);
          const doctorName = `Dr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}`.trim();

          // Centro de notificaciones in-app del portal: una por cita+momento,
          // solo si el paciente tiene cuenta. Idempotente por (patientId,
          // dedupeKey) vía createMany skipDuplicates — independiente de WA/email.
          if (accountId) {
            notifRows.push({
              clinicId: clinic.id,
              patientId: appt.patientId,
              accountId,
              type: "APPOINTMENT_REMINDER",
              title: "Recordatorio de tu cita",
              body: `Tu cita en ${clinic.name} es el ${fecha} a las ${hora}. Te atiende ${doctorName}.`,
              dedupeKey: `${appt.id}:${offset}`,
            });
          }

          if (!queueWhatsapp && !queueEmail) continue;

          // 2e. Asegura confirmToken: si la cita no tiene, genera uno y
          //     persiste de inmediato (update corto, sin transacción).
          //     Guard confirmToken=null: si otra corrida concurrente ya generó
          //     uno, NO se pisa (pisarlo mataría el link del mensaje ya enviado).
          let token = tokenCache.get(appt.id) ?? appt.confirmToken;
          if (!token) {
            const fresh = randomBytes(24).toString("base64url");
            const wrote = await prisma.appointment.updateMany({
              where: { id: appt.id, confirmToken: null },
              data: { confirmToken: fresh },
            });
            if (wrote.count === 1) {
              token = fresh;
            } else {
              const current = await prisma.appointment.findUnique({
                where: { id: appt.id },
                select: { confirmToken: true },
              });
              token = current?.confirmToken ?? fresh;
            }
          }
          tokenCache.set(appt.id, token);

          const confirmUrl = getConfirmUrl(token);
          const message = renderReminderTemplate(settings.template, {
            paciente: appt.patient.firstName,
            clinica: clinic.name,
            fecha,
            hora,
            doctor: doctorName,
            link: confirmUrl,
          });

          // Nunca en el pasado: si la grace window ya pasó el momento ideal,
          // el worker lo manda en el siguiente tick.
          const scheduledFor = new Date(
            Math.max(appt.startsAt.getTime() - offset * 60000, now.getTime()),
          );

          if (queueWhatsapp) {
            if (appt.patient.phone) {
              rows.push({
                clinicId: clinic.id,
                appointmentId: appt.id,
                type: APPT_AUTO_TYPE,
                message,
                status: WA_REMINDER_STATUS.PENDING,
                scheduledFor,
                payload: {
                  kind: "APPT_AUTO",
                  offsetMin: offset,
                  channel: "whatsapp",
                  confirmUrl,
                },
              });
              seen.add(waKey);
              clinicWhatsapp++;
            } else {
              summary.skipped++;
            }
          }

          if (queueEmail) {
            if (appt.patient.email) {
              rows.push({
                clinicId: clinic.id,
                appointmentId: appt.id,
                type: APPT_AUTO_TYPE,
                message,
                status: WA_REMINDER_STATUS.PENDING,
                scheduledFor,
                payload: {
                  kind: "APPT_AUTO",
                  offsetMin: offset,
                  channel: "email",
                  confirmUrl,
                  subject: `Recordatorio de cita — ${clinic.name}`,
                },
              });
              seen.add(emailKey);
              clinicEmail++;
            } else {
              summary.skipped++;
            }
          }
        }
      }

      // 2f. Encola en chunks de 500 (sin $transaction — PgBouncer).
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma.whatsAppReminder.createMany({ data: rows.slice(i, i + CHUNK) });
      }

      // 2g. Notificaciones in-app (centro de notificaciones del portal).
      // Best-effort + skipDuplicates: idempotente y JAMÁS frena los
      // recordatorios (si la tabla aún no existe por SQL pendiente, se ignora).
      if (notifRows.length > 0) {
        try {
          for (let i = 0; i < notifRows.length; i += CHUNK) {
            const res = await prisma.patientNotification.createMany({
              data: notifRows.slice(i, i + CHUNK),
              skipDuplicates: true,
            });
            summary.inAppNotifications += res.count;
          }
        } catch (err) {
          console.error(
            "[reminders/enqueue] patientNotification.createMany (best-effort):",
            err,
          );
        }
      }

      summary.queuedWhatsapp += clinicWhatsapp;
      summary.queuedEmail += clinicEmail;
      summary.clinics++;
    } catch (e) {
      summary.errors.push({
        clinicId: clinic.id,
        reason: e instanceof Error ? e.message : "error desconocido",
      });
      continue;
    }
  }

  return summary;
}
