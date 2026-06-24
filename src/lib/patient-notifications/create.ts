// Crea UNA notificación in-app para el centro de notificaciones del portal.
// Best-effort: NUNCA lanza (si la tabla aún no existe por SQL pendiente, o el
// dedupeKey choca, se loguea y se ignora). Lo usan los productores de eventos:
// resolución de cambios de cita (src/lib/appointment-change/notify.ts) y, a
// futuro, mensajes nuevos. El cron de recordatorios inserta en lote aparte
// (createMany skipDuplicates) por volumen.
import { prisma } from "@/lib/prisma";

export type PatientNotificationType =
  | "APPOINTMENT_REMINDER"
  | "APPOINTMENT_CHANGE"
  | "MESSAGE";

export interface CreatePatientNotificationInput {
  clinicId: string;
  patientId: string;
  accountId?: string | null;
  type: PatientNotificationType;
  title: string;
  body: string;
  /** Idempotencia opcional. Eventos únicos: omitir (queda null). */
  dedupeKey?: string | null;
}

export async function createPatientNotification(
  input: CreatePatientNotificationInput,
): Promise<void> {
  try {
    await prisma.patientNotification.create({
      data: {
        clinicId: input.clinicId,
        patientId: input.patientId,
        accountId: input.accountId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch (err) {
    console.error("[patient-notifications/create] (best-effort):", err);
  }
}
