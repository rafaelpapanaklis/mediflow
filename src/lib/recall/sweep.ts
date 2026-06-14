// Recall genérico — barrido de reactivación (WS1-T8).
//
// Encuentra pacientes "por reactivar" (≥1 cita COMPLETED, última visita hace
// ≥ intervalo, SIN cita futura) y los nudgea por el canal configurado:
//   - WhatsApp: encola un WhatsAppReminder type RECALL (la cola existente lo
//     envía; resuelve al paciente por patientPhone).
//   - Email: se manda inline con sendEmail (la cola sólo sabe emailar
//     recordatorios de cita, que leen el email desde la cita) + se registra una
//     fila RECALL status SENT para dedupe/auditoría.
//
// Dedupe: no re-encolar si el paciente ya recibió un RECALL en los últimos
// RECALL_DEDUPE_DAYS días (por teléfono o por payload.patientId). Tope de
// seguridad RECALL_MAX_PER_CLINIC por corrida. Multi-tenant: clinicId en cada
// query. Reglas del repo: target < ES2015 → sin for...of sobre Set/Map (uso
// objetos planos + bucles por índice).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  getRecallSettings,
  renderRecallMessage,
  RECALL_DEDUPE_DAYS,
  RECALL_MAX_PER_CLINIC,
} from "@/lib/reminders/config";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecallClinicResult {
  clinicId: string;
  due: number;
  queuedWhatsapp: number;
  sentEmail: number;
  failedEmail: number;
  skipped: number;
}

export interface RecallSweepSummary {
  clinics: number;
  due: number;
  queuedWhatsapp: number;
  sentEmail: number;
  failedEmail: number;
  skipped: number;
  perClinic: RecallClinicResult[];
}

interface DuePatient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  last_completed: Date;
}

interface SweepClinic {
  id: string;
  name: string;
  reminderSettings: unknown;
  waConnected?: boolean | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

/** Email simple de recall (la cola no sabe emailar recalls sin cita). */
function buildRecallEmail(clinicName: string, message: string): { subject: string; html: string; text: string } {
  const subject = `Te esperamos en ${clinicName} 🦷`;
  const body = escapeHtml(message).replace(/\n/g, "<br/>");
  const html =
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:520px;margin:0 auto;padding:20px">` +
    `${body}</div>`;
  return { subject, html, text: message };
}

/** Procesa el recall de UNA clínica. Devuelve el conteo de la corrida. */
export async function sweepClinic(
  clinic: SweepClinic,
  opts?: { now?: Date; cap?: number },
): Promise<RecallClinicResult> {
  const now = opts?.now ?? new Date();
  const cap = opts?.cap ?? RECALL_MAX_PER_CLINIC;
  const res: RecallClinicResult = {
    clinicId: clinic.id,
    due: 0,
    queuedWhatsapp: 0,
    sentEmail: 0,
    failedEmail: 0,
    skipped: 0,
  };

  const settings = getRecallSettings(clinic);
  if (!settings.enabled) return res;

  const cutoff = new Date(now.getTime() - settings.intervalDays * DAY_MS);
  const dedupeCutoff = new Date(now.getTime() - RECALL_DEDUPE_DAYS * DAY_MS);

  // Pacientes por reactivar. Mismo patrón de agregación que churn-risk:
  // la última visita y "tiene cita futura" se calculan EN LA BASE.
  const dueRows = await prisma.$queryRaw<DuePatient[]>`
    WITH appt AS (
      SELECT "patientId",
        MAX("startsAt") FILTER (WHERE "status" IN ('COMPLETED','CHECKED_OUT')) AS last_completed,
        bool_or("startsAt" >= ${now} AND "status" NOT IN ('CANCELLED','NO_SHOW')) AS has_upcoming
      FROM "appointments"
      WHERE "clinicId" = ${clinic.id}
      GROUP BY "patientId"
    )
    SELECT p."id", p."firstName", p."lastName", p."phone", p."email", a.last_completed
    FROM "patients" p
    JOIN appt a ON a."patientId" = p."id"
    WHERE p."clinicId" = ${clinic.id}
      AND p."deletedAt" IS NULL
      AND p."status" = 'ACTIVE'
      AND a.last_completed IS NOT NULL
      AND COALESCE(a.has_upcoming, false) = false
      AND a.last_completed < ${cutoff}
    ORDER BY a.last_completed ASC
    LIMIT ${cap}
  `;
  res.due = dueRows.length;
  if (dueRows.length === 0) return res;

  // Dedupe: RECALL recientes de la clínica → sets por teléfono y por patientId.
  const recent = await prisma.whatsAppReminder.findMany({
    where: { clinicId: clinic.id, type: "RECALL", createdAt: { gte: dedupeCutoff } },
    select: { patientPhone: true, payload: true },
  });
  const recalledPhones: Record<string, true> = {};
  const recalledIds: Record<string, true> = {};
  recent.forEach((r) => {
    if (r.patientPhone) recalledPhones[r.patientPhone] = true;
    const pid = (r.payload as Record<string, unknown> | null)?.patientId;
    if (typeof pid === "string") recalledIds[pid] = true;
  });

  const wantWA = settings.channel === "whatsapp" || settings.channel === "both";
  const wantEmail = settings.channel === "email" || settings.channel === "both";

  const rowsToCreate: Array<Record<string, unknown>> = [];

  for (let i = 0; i < dueRows.length; i++) {
    const p = dueRows[i];
    if (recalledIds[p.id] || (p.phone && recalledPhones[p.phone])) {
      res.skipped++;
      continue;
    }
    const fullName = `${p.firstName} ${p.lastName}`.trim();
    const message = renderRecallMessage(settings.message, {
      nombre: p.firstName || fullName || "paciente",
      clinica: clinic.name,
    });
    let acted = false;

    // WhatsApp → encolar (la cola lo envía). Requiere teléfono.
    if (wantWA && p.phone) {
      rowsToCreate.push({
        clinicId: clinic.id,
        appointmentId: null,
        patientPhone: p.phone,
        message,
        type: "RECALL",
        status: "PENDING",
        scheduledFor: now,
        payload: { kind: "recall", channel: "whatsapp", patientId: p.id },
      });
      res.queuedWhatsapp++;
      acted = true;
    }

    // Email → inline con sendEmail (degrada a stub si no hay RESEND_API_KEY).
    if (wantEmail && p.email) {
      const mail = buildRecallEmail(clinic.name, message);
      try {
        const { delivered } = await sendEmail({
          to: p.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        if (delivered) {
          res.sentEmail++;
          acted = true;
          rowsToCreate.push({
            clinicId: clinic.id,
            appointmentId: null,
            patientPhone: p.phone ?? null,
            message,
            type: "RECALL",
            status: "SENT",
            sentAt: now,
            scheduledFor: now,
            payload: { kind: "recall", channel: "email", patientId: p.id },
          });
        } else {
          res.failedEmail++;
        }
      } catch {
        res.failedEmail++;
      }
    }

    if (!acted) res.skipped++;
    // Marca local: no duplicar dentro de la MISMA corrida.
    recalledIds[p.id] = true;
    if (p.phone) recalledPhones[p.phone] = true;
  }

  // Encola WA + registra filas email en chunks (sin transacción → PgBouncer ok).
  const CHUNK = 500;
  for (let i = 0; i < rowsToCreate.length; i += CHUNK) {
    await prisma.whatsAppReminder.createMany({ data: rowsToCreate.slice(i, i + CHUNK) as any });
  }

  return res;
}

/**
 * Barre TODAS las clínicas con recall activo. Sólo carga clínicas con
 * reminderSettings (subset) y filtra en JS por recall.enabled — robusto ante
 * la semántica de filtros JSON-path de Prisma.
 */
export async function sweepAllRecalls(opts?: { now?: Date }): Promise<RecallSweepSummary> {
  const summary: RecallSweepSummary = {
    clinics: 0,
    due: 0,
    queuedWhatsapp: 0,
    sentEmail: 0,
    failedEmail: 0,
    skipped: 0,
    perClinic: [],
  };

  const candidates = await prisma.clinic.findMany({
    where: { reminderSettings: { not: Prisma.DbNull } },
    select: { id: true, name: true, reminderSettings: true, waConnected: true },
  });
  const clinics = candidates.filter((c) => getRecallSettings(c).enabled);
  summary.clinics = clinics.length;

  for (let i = 0; i < clinics.length; i++) {
    try {
      const r = await sweepClinic(clinics[i], { now: opts?.now });
      summary.perClinic.push(r);
      summary.due += r.due;
      summary.queuedWhatsapp += r.queuedWhatsapp;
      summary.sentEmail += r.sentEmail;
      summary.failedEmail += r.failedEmail;
      summary.skipped += r.skipped;
    } catch (e) {
      console.error("[recall-sweep] clínica falló", clinics[i].id, e);
    }
  }
  return summary;
}
