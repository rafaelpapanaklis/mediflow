// Últimos recordatorios de WhatsApp de una clínica — estado REAL de la cola.
//
// Hasta ahora ninguna pantalla leía `WhatsAppReminder.status`: un envío que
// Meta rechazaba quedaba FAILED en la base y la clínica seguía creyendo que sus
// recordatorios salían. Este loader alimenta el panel "Últimos recordatorios"
// de /dashboard/whatsapp.
//
// SERVER ONLY. El clinicId lo pasa el caller desde la sesión, nunca del cliente.

import { prisma } from "@/lib/prisma";
import { describeReminderError, type ReminderErrorKey } from "./reminder-error";
import {
  WA_REMINDER_STATUS,
  WA_REMINDER_CONFIRMABLE_TYPES,
} from "./reminder-status";

/** Estado normalizado para la UI (el legacy 'ACTIVE' entra como pendiente). */
export type RecentReminderStatus = "SENT" | "FAILED" | "PENDING" | "CANCELLED";

/** Familia del recordatorio — se traduce con `inbox.whatsapp.recentKind<Kind>`. */
export type RecentReminderKind =
  | "Appointment"
  | "Recall"
  | "Birthday"
  | "Followup"
  | "TreatmentFollowup"
  | "Clinical"
  | "Other";

export interface RecentReminderDTO {
  id: string;
  kind: RecentReminderKind;
  status: RecentReminderStatus;
  channel: "whatsapp" | "email";
  /** Paciente de la cita; si el recordatorio no cuelga de una cita, el teléfono. */
  who: string | null;
  /** Ya formateada en la zona horaria de la clínica (evita desajuste de hidratación). */
  whenLabel: string;
  /** Clave del motivo del fallo, si se reconoció (ver reminder-error.ts). */
  reasonKey: ReminderErrorKey | null;
  /** Error crudo — se muestra cuando no hay traducción, para no inventar. */
  rawError: string | null;
}

export interface RecentRemindersResult {
  rows: RecentReminderDTO[];
  /** true = la consulta falló. La UI lo dice en vez de fingir "no hay nada". */
  failed: boolean;
}

const CLINICAL_TYPES = ["ENDO", "PERIO", "ORTHO", "IMPLANT"];

function kindOf(type: string): RecentReminderKind {
  if (WA_REMINDER_CONFIRMABLE_TYPES.includes(type)) return "Appointment";
  if (type === "RECALL") return "Recall";
  if (type === "BIRTHDAY") return "Birthday";
  if (type === "FOLLOWUP") return "Followup";
  if (type === "TREATMENT_FOLLOWUP") return "TreatmentFollowup";
  if (CLINICAL_TYPES.includes(type)) return "Clinical";
  return "Other";
}

function statusOf(raw: string): RecentReminderStatus {
  if (raw === WA_REMINDER_STATUS.SENT) return "SENT";
  if (raw === WA_REMINDER_STATUS.FAILED) return "FAILED";
  if (raw === WA_REMINDER_STATUS.CANCELLED) return "CANCELLED";
  // PENDING y el legacy 'ACTIVE' (y cualquier valor viejo desconocido) son
  // "todavía no se envió": es lo que el worker asume al barrer la cola.
  return "PENDING";
}

/**
 * Últimos recordatorios de la clínica (por defecto 20), del más nuevo al más
 * viejo. Nunca lanza: ante un fallo de lectura devuelve `failed: true` para que
 * la pantalla pueda decirlo en vez de mostrar una lista vacía engañosa.
 */
export async function getRecentReminders(
  clinicId: string,
  timezone: string,
  take = 20,
): Promise<RecentRemindersResult> {
  try {
    const rows = await prisma.whatsAppReminder.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take,
      // `select` explícito a propósito: la tabla se creó por SQL manual y una
      // columna del schema que aún no exista en prod tumbaría la pantalla entera.
      select: {
        id: true,
        type: true,
        status: true,
        sentAt: true,
        scheduledFor: true,
        createdAt: true,
        errorMsg: true,
        payload: true,
        patientPhone: true,
        appointment: {
          select: { patient: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    const fmt = buildFormatter(timezone);

    return {
      failed: false,
      rows: rows.map((r) => {
        const status = statusOf(r.status);
        const patient = r.appointment?.patient;
        const who = patient
          ? `${patient.firstName} ${patient.lastName}`.trim()
          : r.patientPhone ?? null;
        // Enviados/fallidos se fechan por sentAt (sello del claim); los que
        // siguen en cola, por cuándo les toca salir.
        const when =
          status === "SENT" || status === "FAILED"
            ? r.sentAt ?? r.scheduledFor ?? r.createdAt
            : r.scheduledFor ?? r.createdAt;

        return {
          id: r.id,
          kind: kindOf(r.type),
          status,
          // Mismo acceso débil que el worker: el payload es Json libre.
          channel: (r.payload as any)?.channel === "email" ? "email" : "whatsapp",
          who: who || null,
          whenLabel: fmt(when),
          reasonKey: status === "FAILED" || status === "CANCELLED" ? describeReminderError(r.errorMsg) : null,
          rawError: status === "FAILED" || status === "CANCELLED" ? r.errorMsg : null,
        } as RecentReminderDTO;
      }),
    };
  } catch (err) {
    console.error("[whatsapp/recent-reminders] no se pudo leer la cola:", err);
    return { rows: [], failed: true };
  }
}

/** Formateador en la zona de la clínica; si la zona es inválida, cae a la del server. */
function buildFormatter(timezone: string): (d: Date | null) => string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  let df: Intl.DateTimeFormat;
  try {
    df = new Intl.DateTimeFormat("es-MX", { ...opts, timeZone: timezone });
  } catch {
    df = new Intl.DateTimeFormat("es-MX", opts);
  }
  return (d) => (d ? df.format(d) : "—");
}
