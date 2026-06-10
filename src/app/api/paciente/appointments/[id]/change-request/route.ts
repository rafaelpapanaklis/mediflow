// POST /api/paciente/appointments/[id]/change-request   (WS1-T5)
//
// El paciente pide REAGENDAR o CANCELAR su cita desde el portal.
// Body: { type: "RESCHEDULE"|"CANCEL", date?: "YYYY-MM-DD", startTime?: "HH:mm", reason?: string }
//
// Reglas (en este orden):
//   1) Guard getPatientPortalContext(); la cita debe pertenecer a un link
//      (patientId + clinicId) → 404 si no.
//   2) Cita en CHANGEABLE_STATUSES → 422 { error: "not_changeable" }.
//   3) Ventana: canPatientChange(appt.startsAt, clinic.patientChangesMinHours)
//      → 422 { error: "window", minHours }.
//   4) Sin otra solicitud PENDING para esa cita → 409 { error: "pending_exists" }.
//      (Hay UNIQUE parcial en SQL: atrapar también P2002/23505 del create.)
//   5) RESCHEDULE: date + startTime obligatorios (400 si faltan/mal formados);
//      proposedStartsAt = tzLocalToUtc(date, h, m, clinic.timezone); debe ser
//      futuro; duración = endsAt - startsAt de la cita original →
//      proposedEndsAt; isSlotFree({... excludeAppointmentId: cita.id }) → si
//      ocupado 409 { error: "slot_taken" }.
//   6) reason opcional, .trim().slice(0, 500).
//   7) clinic.patientChangesAutoApprove === false → crear AppointmentChangeRequest
//      PENDING (clinicId, appointmentId, patientId, accountId = ctx.account.id,
//      type, reason, proposedStartsAt/EndsAt si aplica) →
//      200 { ok: true, autoApproved: false, status: "PENDING" }.
//   8) === true → prisma.$transaction CORTO (PgBouncer): re-checar conflicto
//      (patrón de src/app/api/public/book/route.ts) + aplicar:
//        RESCHEDULE → update cita { startsAt, endsAt, status: "SCHEDULED", confirmedAt: null }
//        CANCEL     → update cita { status: "CANCELLED", cancelledAt: now,
//                     cancelReason: reason || "Cancelada por el paciente desde el portal" }
//      + crear CR { status: "APPROVED", autoApproved: true, resolvedAt: now }.
//      Fuera de la tx, best-effort try/catch:
//        · si RESCHEDULE: limpiar recordatorios automáticos de la cita para que
//          el sweep re-encole con la nueva hora (leer src/lib/reminders/enqueue.ts
//          para el discriminador exacto del modelo WhatsAppReminder),
//        · notifyPatientChangeResolution(cr.id) de "@/lib/appointment-change/notify".
//      200 { ok: true, autoApproved: true, status: "APPROVED" }.
//
//   NOTA audit: la fila de AppointmentChangeRequest ES el registro de quién pidió
//   (accountId + patientId + timestamps). NO llamar logAudit aquí (no hay User
//   del lado del paciente; AuditLog.userId es de staff).
//   export const dynamic = "force-dynamic". clinicId SIEMPRE de la cita verificada.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  CHANGEABLE_STATUSES,
  canPatientChange,
  isSlotFree,
  clearAutoRemindersForAppointment,
} from "@/lib/appointment-change/slots";
import { notifyPatientChangeResolution } from "@/lib/appointment-change/notify";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";

export const dynamic = "force-dynamic";

interface ChangeRequestBody {
  type?: string;
  date?: string;
  startTime?: string;
  reason?: string;
}

/** UNIQUE parcial en SQL (un solo PENDING por appointmentId): P2002 o 23505. */
function isUniquePendingViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  if (!e) return false;
  if (e.code === "P2002") return true;
  if (e.meta && e.meta.code === "23505") return true;
  return typeof e.message === "string" && e.message.includes("23505");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  let body: ChangeRequestBody;
  try {
    body = (await req.json()) as ChangeRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = body.type === "RESCHEDULE" || body.type === "CANCEL" ? body.type : null;
  if (!type) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      doctorId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      clinic: {
        select: {
          timezone: true,
          patientChangesMinHours: true,
          patientChangesAutoApprove: true,
          schedules: {
            select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
          },
        },
      },
    },
  });

  // 1) Multi-tenant: la cita debe pertenecer a un link (patientId + clinicId)
  //    de la cuenta de la sesión → 404 si no (sin revelar existencia).
  const owned =
    appt !== null &&
    ctx.links.some((l) => l.patientId === appt.patientId && l.clinicId === appt.clinicId);
  if (!appt || !owned) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 2) Estado cambiable.
  if (!CHANGEABLE_STATUSES.includes(appt.status)) {
    return NextResponse.json({ error: "not_changeable" }, { status: 422 });
  }

  // 3) Ventana mínima.
  const minHours = appt.clinic.patientChangesMinHours ?? 24;
  if (!canPatientChange(appt.startsAt, minHours)) {
    return NextResponse.json({ error: "window", minHours }, { status: 422 });
  }

  // 4) Sin otra solicitud PENDING (el UNIQUE parcial cubre la carrera abajo).
  const pending = await prisma.appointmentChangeRequest.findFirst({
    where: { appointmentId: appt.id, status: "PENDING" },
    select: { id: true },
  });
  if (pending) {
    return NextResponse.json({ error: "pending_exists" }, { status: 409 });
  }

  // 5) RESCHEDULE: validar horario propuesto.
  const durationMs = appt.endsAt.getTime() - appt.startsAt.getTime();
  let proposedStartsAt: Date | null = null;
  let proposedEndsAt: Date | null = null;

  if (type === "RESCHEDULE") {
    const dateStr = typeof body.date === "string" ? body.date : "";
    const startTime = typeof body.startTime === "string" ? body.startTime : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(startTime)) {
      return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    }
    const [slotH, slotM] = startTime.split(":").map(Number);
    if (slotH > 23 || slotM > 59) {
      return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    }

    proposedStartsAt = tzLocalToUtc(dateStr, slotH, slotM, appt.clinic.timezone);
    if (proposedStartsAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    }
    proposedEndsAt = new Date(proposedStartsAt.getTime() + durationMs);

    // Dentro del horario de la clínica (mismo criterio que el booking público
    // y que el endpoint de slots): día habilitado + cabe antes del cierre.
    const [y, m, d] = dateStr.split("-").map(Number);
    const jsDayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const scheduleDay = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
    const daySchedule = appt.clinic.schedules.find((s) => s.dayOfWeek === scheduleDay);
    if (!daySchedule || !daySchedule.enabled) {
      return NextResponse.json({ error: "outside_schedule" }, { status: 400 });
    }
    const [openH, openM] = daySchedule.openTime.split(":").map(Number);
    const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
    const slotMins = slotH * 60 + slotM;
    const durationMin = Math.max(1, Math.round(durationMs / 60_000));
    if (slotMins < openH * 60 + openM || slotMins + durationMin > closeH * 60 + closeM) {
      return NextResponse.json({ error: "outside_schedule" }, { status: 400 });
    }

    const free = await isSlotFree({
      clinicId: appt.clinicId,
      doctorId: appt.doctorId,
      startsAt: proposedStartsAt,
      endsAt: proposedEndsAt,
      excludeAppointmentId: appt.id,
    });
    if (!free) {
      return NextResponse.json({ error: "slot_taken" }, { status: 409 });
    }
  }

  // 6) reason opcional.
  const reasonTrimmed = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const reason = reasonTrimmed.length > 0 ? reasonTrimmed : null;

  // 7) Sin auto-aprobación: crear solicitud PENDING que resuelve la clínica.
  if (appt.clinic.patientChangesAutoApprove !== true) {
    try {
      await prisma.appointmentChangeRequest.create({
        data: {
          clinicId: appt.clinicId, // SIEMPRE de la cita verificada, jamás del body
          appointmentId: appt.id,
          patientId: appt.patientId,
          accountId: ctx.account.id,
          type,
          status: "PENDING",
          reason,
          proposedStartsAt,
          proposedEndsAt,
        },
      });
    } catch (err) {
      if (isUniquePendingViolation(err)) {
        return NextResponse.json({ error: "pending_exists" }, { status: 409 });
      }
      console.error("[paciente/change-request] create error:", err);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, autoApproved: false, status: "PENDING" });
  }

  // 8) Auto-aprobación: aplicar el cambio en una transacción CORTA (PgBouncer):
  //    re-checar conflicto + update de la cita + crear CR APPROVED.
  const now = new Date();
  let crId: string;
  try {
    const cr = await prisma.$transaction(async (tx) => {
      if (type === "RESCHEDULE") {
        // Re-check anti double-booking (patrón de /api/public/book).
        const conflict = await tx.appointment.findFirst({
          where: {
            clinicId: appt.clinicId,
            doctorId: appt.doctorId,
            id: { not: appt.id },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
            startsAt: { lt: proposedEndsAt! },
            endsAt: { gt: proposedStartsAt! },
          },
          select: { id: true },
        });
        if (conflict) throw new Error("SLOT_TAKEN");

        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            startsAt: proposedStartsAt!,
            endsAt: proposedEndsAt!,
            status: "SCHEDULED",
            confirmedAt: null,
          },
        });
      } else {
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelReason: reason || "Cancelada por el paciente desde el portal",
          },
        });
      }

      return tx.appointmentChangeRequest.create({
        data: {
          clinicId: appt.clinicId,
          appointmentId: appt.id,
          patientId: appt.patientId,
          accountId: ctx.account.id,
          type,
          status: "APPROVED",
          autoApproved: true,
          resolvedAt: now,
          reason,
          proposedStartsAt,
          proposedEndsAt,
        },
        select: { id: true },
      });
    });
    crId = cr.id;
  } catch (err) {
    if (err instanceof Error && err.message === "SLOT_TAKEN") {
      return NextResponse.json({ error: "slot_taken" }, { status: 409 });
    }
    if (isUniquePendingViolation(err)) {
      return NextResponse.json({ error: "pending_exists" }, { status: 409 });
    }
    console.error("[paciente/change-request] auto-approve error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Best-effort FUERA de la tx: nunca rompen la respuesta.
  if (type === "RESCHEDULE") {
    // Borra recordatorios automáticos (hora vieja) → el sweep re-encola.
    await clearAutoRemindersForAppointment(appt.id); // nunca lanza
  }
  try {
    await notifyPatientChangeResolution(crId);
  } catch (err) {
    console.error("[paciente/change-request] notify error:", err);
  }

  return NextResponse.json({ ok: true, autoApproved: true, status: "APPROVED" });
}
