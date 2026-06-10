// POST /api/appointment-change-requests/[id]/resolve   (WS1-T5, lado clínica)
// Body: { action: "APPROVE"|"REJECT", note?: string }
// Resuelve una solicitud de cambio (RESCHEDULE/CANCEL) hecha por el paciente
// desde el portal. Multi-tenant estricto: clinicId SIEMPRE de la sesión.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import {
  loadClinicSession,
  requireRole,
  isOverlapError,
} from "@/lib/agenda/api-helpers";
import {
  syncUpdateToGoogleCalendar,
  syncDeleteFromGoogleCalendar,
} from "@/lib/agenda/google-sync";
import {
  isSlotFree,
  clearAutoRemindersForAppointment,
} from "@/lib/appointment-change/slots";
import { notifyPatientChangeResolution } from "@/lib/appointment-change/notify";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const SLOT_TAKEN_NOTE = "El horario propuesto ya no está disponible";
// Sentinel para abortar el $transaction cuando el re-check detecta overlap.
const SLOT_TAKEN_IN_TX = "appointment_change_slot_taken_in_tx";

async function notifyBestEffort(changeRequestId: string) {
  try {
    await notifyPatientChangeResolution(changeRequestId);
  } catch (err) {
    console.error("[resolve CR] notify error (ignorado):", err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "SUPER_ADMIN",
    "ADMIN",
    "RECEPTIONIST",
    "DOCTOR",
  ]);
  if (forbidden) return forbidden;

  let body: { action?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = body?.action;
  if (action !== "APPROVE" && action !== "REJECT") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const note =
    typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";

  const cr = await prisma.appointmentChangeRequest.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    include: {
      appointment: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!cr) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // DOCTOR solo puede resolver solicitudes de SUS citas.
  if (
    session.user.role === "DOCTOR" &&
    cr.appointment.doctorId !== session.user.id
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (cr.status !== "PENDING") {
    return NextResponse.json({ error: "not_pending" }, { status: 409 });
  }

  const now = new Date();
  const appointment = cr.appointment;

  // ── REJECT ──────────────────────────────────────────────────────
  if (action === "REJECT") {
    try {
      await prisma.appointmentChangeRequest.update({
        where: { id: cr.id },
        data: {
          status: "REJECTED",
          resolvedById: session.user.id,
          resolvedAt: now,
          resolutionNote: note || null,
        },
      });
    } catch (err) {
      console.error("[resolve CR] REJECT error", err);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    await notifyBestEffort(cr.id);
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  // ── APPROVE + CANCEL ────────────────────────────────────────────
  if (cr.type === "CANCEL") {
    try {
      await prisma.$transaction([
        prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelReason: cr.reason || "Cancelada a petición del paciente",
          },
        }),
        prisma.appointmentChangeRequest.update({
          where: { id: cr.id },
          data: {
            status: "APPROVED",
            resolvedById: session.user.id,
            resolvedAt: now,
          },
        }),
      ]);
    } catch (err) {
      console.error("[resolve CR] APPROVE CANCEL error", err);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }

    // Google Calendar sync (best-effort) — espejo del DELETE /api/appointments/[id]
    try {
      if (appointment.googleCalendarEventId) {
        await syncDeleteFromGoogleCalendar(
          session.clinic.id,
          appointment.googleCalendarEventId,
        );
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { googleCalendarEventId: null },
        });
      }
    } catch (err) {
      console.error("GCal delete wrapper error:", err);
    }

    await logMutation({
      req,
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "appointment",
      entityId: appointment.id,
      action: "update",
      before: {
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
      },
      after: {
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: "CANCELLED",
      },
    });

    revalidateAfter("appointments");
    await notifyBestEffort(cr.id);
    return NextResponse.json({ ok: true, status: "APPROVED" });
  }

  // ── APPROVE + RESCHEDULE ────────────────────────────────────────
  const proposedStartsAt = cr.proposedStartsAt;
  const proposedEndsAt = cr.proposedEndsAt;
  if (!proposedStartsAt || !proposedEndsAt) {
    return NextResponse.json({ error: "bad_request" }, { status: 422 });
  }

  const autoRejectSlotTaken = async () => {
    try {
      await prisma.appointmentChangeRequest.update({
        where: { id: cr.id },
        data: {
          status: "REJECTED",
          resolvedById: session.user.id,
          resolvedAt: new Date(),
          resolutionNote: SLOT_TAKEN_NOTE,
        },
      });
    } catch (err) {
      console.error("[resolve CR] auto-reject error", err);
    }
    await notifyBestEffort(cr.id);
    return NextResponse.json(
      { error: "slot_taken", autoRejected: true },
      { status: 409 },
    );
  };

  let free = false;
  try {
    free = await isSlotFree({
      clinicId: session.clinic.id,
      doctorId: appointment.doctorId,
      startsAt: proposedStartsAt,
      endsAt: proposedEndsAt,
      excludeAppointmentId: appointment.id,
    });
  } catch (err) {
    console.error("[resolve CR] isSlotFree error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!free) {
    return autoRejectSlotTaken();
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Re-check de overlap DENTRO de la transacción (mismo where que el
      // PATCH /api/appointments/[id]) para cerrar la ventana de carrera.
      const conflict = await tx.appointment.findFirst({
        where: {
          clinicId: session.clinic.id,
          id: { not: appointment.id },
          OR: [
            { doctorId: appointment.doctorId },
            ...(appointment.resourceId
              ? [{ resourceId: appointment.resourceId }]
              : []),
          ],
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          overrideReason: null,
          startsAt: { lt: proposedEndsAt },
          endsAt: { gt: proposedStartsAt },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new Error(SLOT_TAKEN_IN_TX);
      }

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          startsAt: proposedStartsAt,
          endsAt: proposedEndsAt,
          status: "SCHEDULED",
          confirmedAt: null,
        },
      });

      await tx.appointmentChangeRequest.update({
        where: { id: cr.id },
        data: {
          status: "APPROVED",
          resolvedById: session.user.id,
          resolvedAt: now,
        },
      });
    });
  } catch (err) {
    // Chocó dentro de la tx (re-check o constraint EXCLUDE) → auto-rechazo.
    if (
      (err instanceof Error && err.message === SLOT_TAKEN_IN_TX) ||
      isOverlapError(err)
    ) {
      return autoRejectSlotTaken();
    }
    console.error("[resolve CR] APPROVE RESCHEDULE error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Post-aprobación (fuera de tx, best-effort cada uno):

  // 1) Limpiar recordatorios automáticos para que el sweep re-encole con la
  //    nueva hora (solo RESCHEDULE).
  try {
    await clearAutoRemindersForAppointment(appointment.id);
  } catch (err) {
    console.error("[resolve CR] clearAutoReminders error (ignorado):", err);
  }

  // 2) Google Calendar sync (best-effort) — mismo helper que el PATCH
  //    /api/appointments/[id].
  try {
    const updatedFull = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: {
        id: true,
        type: true,
        startsAt: true,
        endsAt: true,
        notes: true,
        googleCalendarEventId: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    });
    if (updatedFull?.googleCalendarEventId) {
      await syncUpdateToGoogleCalendar(
        session.clinic.id,
        updatedFull.googleCalendarEventId,
        {
          id: updatedFull.id,
          type: updatedFull.type,
          startsAt: updatedFull.startsAt,
          endsAt: updatedFull.endsAt,
          notes: updatedFull.notes,
          patientName: `${updatedFull.patient.firstName} ${updatedFull.patient.lastName}`,
          doctorName: `${updatedFull.doctor.firstName} ${updatedFull.doctor.lastName}`,
          doctorEmail: null,
        },
      );
    }
  } catch (err) {
    console.error("GCal update wrapper error:", err);
  }

  // 3) Audit log.
  await logMutation({
    req,
    clinicId: session.clinic.id,
    userId: session.user.id,
    entityType: "appointment",
    entityId: appointment.id,
    action: "update",
    before: {
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
    },
    after: {
      startsAt: proposedStartsAt,
      endsAt: proposedEndsAt,
      status: "SCHEDULED",
    },
  });

  revalidateAfter("appointments");
  await notifyBestEffort(cr.id);
  return NextResponse.json({ ok: true, status: "APPROVED" });
}
