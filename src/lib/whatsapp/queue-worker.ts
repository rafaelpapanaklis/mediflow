// WhatsApp queue worker — A2 cross-módulos.
//
// Procesa WhatsAppReminder con status=PENDING y scheduledFor <= now.
// Detecta el prefijo del campo `message` (ENDO_/PERIO_/ORTHO_/IMPLANT_)
// y rutea al diccionario de plantillas correspondiente. Sustituye los
// argumentos dinámicos desde `payload` (Json) + contexto del paciente
// resuelto por `clinicId + patientPhone` o `appointmentId`.
//
// Backwards-compatible: mensajes legacy sin prefijo (recall manual,
// /api/whatsapp/send) se envían tal cual el campo `message`.

import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { ENDO_WHATSAPP_TEMPLATES } from "@/lib/endodontics/whatsapp-templates";
// ORTHO_WHATSAPP_TEMPLATES — demolido en Fase 1 del rewrite v2. El case
// ORTHO_ devuelve null hasta que Fase 4 v2 lo recablee con templates nuevos.
import { PERIO_WHATSAPP_TEMPLATES } from "@/lib/periodontics/whatsapp-templates";
import { IMPLANT_WHATSAPP_TEMPLATES } from "@/lib/implantology/whatsapp-templates";

interface ProcessSummary {
  picked: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
}

const PREFIXES = ["ENDO_", "PERIO_", "ORTHO_", "IMPLANT_"] as const;
type Prefix = (typeof PREFIXES)[number];

interface PatientCtx {
  firstName: string;
  lastName: string;
  phone: string;
}
interface ClinicCtx {
  name: string;
  timezone: string;
  waPhoneNumberId: string;
  waAccessToken: string;
}

/**
 * Procesa la cola de WhatsAppReminder. Llamado desde el cron handler.
 * Limita el batch para no exceder el rate limit de WhatsApp Cloud API.
 */
export async function processWhatsAppQueue(opts?: {
  batchSize?: number;
}): Promise<ProcessSummary> {
  const summary: ProcessSummary = {
    picked: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  const limit = opts?.batchSize ?? 50;

  const due = await prisma.whatsAppReminder.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    include: {
      clinic: {
        select: {
          id: true,
          name: true,
          timezone: true,
          waConnected: true,
          waPhoneNumberId: true,
          waAccessToken: true,
        },
      },
      appointment: {
        select: {
          id: true,
          startsAt: true,
          patient: {
            select: { firstName: true, lastName: true, phone: true },
          },
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  summary.picked = due.length;

  for (const r of due) {
    try {
      // Pre-checks: clínica con WhatsApp conectado.
      if (
        !r.clinic.waConnected ||
        !r.clinic.waPhoneNumberId ||
        !r.clinic.waAccessToken
      ) {
        await markFailed(r.id, "WhatsApp no conectado en la clínica");
        summary.skipped++;
        continue;
      }
      const clinicCtx: ClinicCtx = {
        name: r.clinic.name,
        timezone: r.clinic.timezone,
        waPhoneNumberId: r.clinic.waPhoneNumberId,
        waAccessToken: r.clinic.waAccessToken,
      };

      // Resuelve teléfono + nombre del paciente. Prioridad:
      //   1. appointmentId (recordatorios de citas)
      //   2. patientPhone directo (recall, encolados con teléfono explícito)
      let patientCtx: PatientCtx | null = null;
      if (r.appointment?.patient?.phone) {
        patientCtx = {
          firstName: r.appointment.patient.firstName,
          lastName: r.appointment.patient.lastName,
          phone: r.appointment.patient.phone,
        };
      } else if (r.patientPhone) {
        const found = await prisma.patient.findFirst({
          where: { clinicId: r.clinicId, phone: r.patientPhone, deletedAt: null },
          select: { firstName: true, lastName: true, phone: true },
        });
        if (found?.phone) {
          patientCtx = {
            firstName: found.firstName,
            lastName: found.lastName,
            phone: found.phone,
          };
        } else {
          patientCtx = {
            firstName: "",
            lastName: "",
            phone: r.patientPhone,
          };
        }
      }
      if (!patientCtx) {
        await markFailed(r.id, "Sin teléfono ni paciente resoluble");
        summary.skipped++;
        continue;
      }

      const body = renderMessage({
        rawMessage: r.message ?? "",
        payload: (r.payload ?? null) as Record<string, unknown> | null,
        patient: patientCtx,
        clinic: clinicCtx,
        appointmentStartsAt: r.appointment?.startsAt ?? null,
        doctorName: r.appointment?.doctor
          ? `${r.appointment.doctor.firstName} ${r.appointment.doctor.lastName}`.trim()
          : null,
      });

      if (!body) {
        await markFailed(r.id, "No se pudo construir el cuerpo del mensaje");
        summary.skipped++;
        continue;
      }

      await sendWhatsAppMessage(
        clinicCtx.waPhoneNumberId,
        clinicCtx.waAccessToken,
        patientCtx.phone,
        body,
      );
      await prisma.whatsAppReminder.update({
        where: { id: r.id },
        data: { status: "SENT", sentAt: new Date(), errorMsg: null },
      });
      summary.sent++;
      // Pausa breve para respetar rate limits.
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (e) {
      const reason = e instanceof Error ? e.message : "error desconocido";
      summary.errors.push({ id: r.id, reason });
      await markFailed(r.id, reason);
      summary.failed++;
    }
  }

  return summary;
}

async function markFailed(id: string, reason: string): Promise<void> {
  try {
    await prisma.whatsAppReminder.update({
      where: { id },
      data: { status: "FAILED", errorMsg: reason },
    });
  } catch {
    /* swallow — el registro queda PENDING para retry manual */
  }
}

interface RenderInput {
  rawMessage: string;
  payload: Record<string, unknown> | null;
  patient: PatientCtx;
  clinic: ClinicCtx;
  appointmentStartsAt: Date | null;
  doctorName: string | null;
}

/**
 * Convierte un campo `message` (puede ser texto literal o "ENDO_<KEY>",
 * "ORTHO_<KEY>", etc.) en el cuerpo final que va a WhatsApp Cloud API.
 *
 * Sustituye los placeholders globales `{clinicName}`, `{clinicPhone}`,
 * `{doctorName}` después del renderizado para que cualquier plantilla
 * pueda usarlos sin recibirlos por argumento.
 */
export function renderMessage(input: RenderInput): string | null {
  const { rawMessage } = input;
  if (!rawMessage) return null;

  const prefix = detectPrefix(rawMessage);
  let body: string | null = null;

  if (!prefix) {
    // Legacy: el mensaje ya viene rendereado (recall manual, /whatsapp/send).
    body = rawMessage;
  } else {
    const key = rawMessage.slice(prefix.length);
    body = renderTemplate(prefix, key, input);
  }
  if (!body) return null;

  // Sustituye placeholders globales tras el render. Usar replaceAll para
  // que se sustituyan todas las apariciones (algunas plantillas firman
  // dos veces).
  return body
    .replaceAll("{clinicName}", input.clinic.name)
    .replaceAll(
      "{doctorName}",
      input.doctorName ? `Dr/a. ${input.doctorName}` : "tu doctor/a",
    )
    .replaceAll("{clinicPhone}", "")
    .replaceAll("{methods}", "transferencia, efectivo o tarjeta")
    .replaceAll("{availableSlots}", "(horarios sujetos a disponibilidad)")
    .replaceAll("{nextAppointmentDate}", "(próxima cita por confirmar)")
    .replaceAll("{nextDate}", "(próxima cita por confirmar)")
    .replaceAll("{pocketImprovement}", "")
    .trim();
}

function detectPrefix(message: string): Prefix | null {
  for (const p of PREFIXES) {
    if (message.startsWith(p)) return p;
  }
  return null;
}

function renderTemplate(
  prefix: Prefix,
  key: string,
  input: RenderInput,
): string | null {
  const { patient, payload, appointmentStartsAt, clinic } = input;
  const firstName = patient.firstName || "Hola";
  const hora = appointmentStartsAt
    ? new Intl.DateTimeFormat("es-MX", {
        timeZone: clinic.timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(appointmentStartsAt)
    : "(hora por confirmar)";
  const fecha = appointmentStartsAt
    ? new Intl.DateTimeFormat("es-MX", {
        timeZone: clinic.timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(appointmentStartsAt)
    : "(fecha por confirmar)";

  // Helpers para sacar args del payload con typing débil pero defensivo.
  const num = (k: string, fallback: number): number => {
    const v = payload?.[k];
    return typeof v === "number" ? v : fallback;
  };
  const str = (k: string, fallback: string): string => {
    const v = payload?.[k];
    return typeof v === "string" ? v : fallback;
  };

  try {
    switch (prefix) {
      case "ENDO_": {
        const toothFdi = num("toothFdi", 0) || undefined;
        switch (key) {
          case "PRE_TC_REMINDER":
            return ENDO_WHATSAPP_TEMPLATES.PRE_TC_REMINDER(
              firstName,
              fecha + " " + hora,
              input.doctorName ?? undefined,
            );
          case "POST_TC_IMMEDIATE":
            return ENDO_WHATSAPP_TEMPLATES.POST_TC_IMMEDIATE(firstName, toothFdi);
          case "RESTORATION_7D":
            return ENDO_WHATSAPP_TEMPLATES.RESTORATION_7D(firstName, toothFdi);
          case "RESTORATION_21D":
            return ENDO_WHATSAPP_TEMPLATES.RESTORATION_21D(firstName, toothFdi);
          case "FOLLOWUP_6M":
            return ENDO_WHATSAPP_TEMPLATES.FOLLOWUP_6M(firstName, toothFdi);
          case "FOLLOWUP_12M":
            return ENDO_WHATSAPP_TEMPLATES.FOLLOWUP_12M(firstName, toothFdi);
          case "FOLLOWUP_24M":
            return ENDO_WHATSAPP_TEMPLATES.FOLLOWUP_24M(firstName, toothFdi);
        }
        return null;
      }

      case "ORTHO_":
        // Templates demolidos en Fase 1 v2 rewrite. Re-cableado en Fase 4 v2.
        return null;

      case "PERIO_": {
        switch (key) {
          case "PRE_MAINTENANCE":
            return PERIO_WHATSAPP_TEMPLATES.PRE_MAINTENANCE(
              num("months", 6),
              firstName,
            );
          case "POST_SRP_DAY_0":
            return PERIO_WHATSAPP_TEMPLATES.POST_SRP_DAY_0(firstName);
          case "POST_SRP_DAY_3":
            return PERIO_WHATSAPP_TEMPLATES.POST_SRP_DAY_3(firstName);
          case "POST_SURGERY_DAY_0":
            return PERIO_WHATSAPP_TEMPLATES.POST_SURGERY_DAY_0(firstName);
          case "POST_SURGERY_DAY_1":
            return PERIO_WHATSAPP_TEMPLATES.POST_SURGERY_DAY_1(firstName);
          case "POST_SURGERY_DAY_7":
            return PERIO_WHATSAPP_TEMPLATES.POST_SURGERY_DAY_7(firstName, hora);
          case "HYGIENE_INSTRUCTIONS": {
            const items = Array.isArray(payload?.items)
              ? (payload!.items as unknown[]).filter(
                  (i): i is string => typeof i === "string",
                )
              : [];
            return PERIO_WHATSAPP_TEMPLATES.HYGIENE_INSTRUCTIONS(firstName, items);
          }
          case "REEVAL_RESULT":
            return PERIO_WHATSAPP_TEMPLATES.REEVAL_RESULT(
              firstName,
              num("bopBefore", 0),
              num("bopAfter", 0),
            );
        }
        return null;
      }

      case "IMPLANT_": {
        switch (key) {
          case "POST_PLACEMENT_DAY_0":
            return IMPLANT_WHATSAPP_TEMPLATES.POST_PLACEMENT_DAY_0(firstName);
          case "POST_PLACEMENT_DAY_7":
            return IMPLANT_WHATSAPP_TEMPLATES.POST_PLACEMENT_DAY_7(firstName, hora);
          case "OSSEOINTEGRATION_CHECK_3M":
            return IMPLANT_WHATSAPP_TEMPLATES.OSSEOINTEGRATION_CHECK_3M(firstName);
          case "PROSTHETIC_LOADING_REMINDER":
            return IMPLANT_WHATSAPP_TEMPLATES.PROSTHETIC_LOADING_REMINDER(firstName);
          case "PERI_IMPLANT_MAINTENANCE":
            return IMPLANT_WHATSAPP_TEMPLATES.PERI_IMPLANT_MAINTENANCE(
              firstName,
              num("months", 6),
            );
        }
        return null;
      }
    }
  } catch (e) {
    console.error("[whatsapp-worker] template render failed", { prefix, key, e });
    return null;
  }

  return null;
}
