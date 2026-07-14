import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import {
  loadClinicSession,
  requireRole,
  isOverlapError,
} from "@/lib/agenda/api-helpers";
import { appointmentToDTO } from "@/lib/agenda/server";
import { canOverrideOverlap } from "@/lib/agenda/transitions";
import { isOutsideClinicSchedule } from "@/lib/agenda/clinic-schedule";
import { validateResourceSchedule } from "@/lib/agenda/resource-schedule";
import { loadResourceSchedule } from "@/lib/agenda/resource-schedule.server";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { getTzParts } from "@/lib/agenda/time-utils";
import {
  syncUpdateToGoogleCalendar,
  syncDeleteFromGoogleCalendar,
} from "@/lib/agenda/google-sync";
import type {
  AppointmentConflictError,
  AppointmentStatus,
  UpdateAppointmentInput,
} from "@/lib/agenda/types";

const APPT_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  doctor:  { select: { id: true, firstName: true, lastName: true } },
} as const;

function isWithinClinicHours(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  dayStart: number,
  dayEnd: number,
): { ok: true } | { ok: false; reason: "before_open" | "after_close" } {
  const s = getTzParts(startsAt, timezone);
  const e = getTzParts(endsAt, timezone);
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;
  if (startMin < dayStart * 60) return { ok: false, reason: "before_open" };
  if (endMin > dayEnd * 60) return { ok: false, reason: "after_close" };
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════
// PATCH /api/appointments/:id
// ═════════════════════════════════════════════════════════════════

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "DOCTOR",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: UpdateAppointmentInput;
  try {
    body = (await req.json()) as UpdateAppointmentInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.overrideReason && !canOverrideOverlap(session.user.role)) {
    return NextResponse.json(
      { error: "override_not_allowed_for_role" },
      { status: 403 },
    );
  }

  const data: Prisma.AppointmentUpdateInput = {};

  if (body.doctorId) {
    const d = await prisma.user.findFirst({
      where: {
        id: body.doctorId,
        clinicId: session.clinic.id,
        role: "DOCTOR",
        isActive: true,
      },
      select: { id: true },
    });
    if (!d) return NextResponse.json({ error: "doctor_not_found" }, { status: 404 });
    data.doctor = { connect: { id: body.doctorId } };
  }

  if (body.resourceId !== undefined) {
    if (body.resourceId === null) {
      data.resource = { disconnect: true };
    } else {
      const res = await prisma.resource.findFirst({
        where: {
          id: body.resourceId,
          clinicId: session.clinic.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!res) return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
      data.resource = { connect: { id: body.resourceId } };
    }
  }

  let newStarts = existing.startsAt;
  let newEnds = existing.endsAt;
  if (body.startsAt) {
    newStarts = new Date(body.startsAt);
    if (Number.isNaN(newStarts.getTime())) {
      return NextResponse.json({ error: "invalid_startsAt" }, { status: 400 });
    }
    data.startsAt = newStarts;
  }
  if (body.endsAt) {
    newEnds = new Date(body.endsAt);
    if (Number.isNaN(newEnds.getTime())) {
      return NextResponse.json({ error: "invalid_endsAt" }, { status: 400 });
    }
    data.endsAt = newEnds;
  }
  if (newEnds <= newStarts) {
    return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
  }

  if (!body.overrideReason) {
    const hoursCheck = isWithinClinicHours(
      newStarts,
      newEnds,
      session.clinic.timezone,
      session.clinic.agendaDayStart,
      session.clinic.agendaDayEnd,
    );
    if (hoursCheck.ok === false) {
      return NextResponse.json(
        {
          error: "outside_clinic_hours",
          reason: hoursCheck.reason,
          clinicDayStart: session.clinic.agendaDayStart,
          clinicDayEnd: session.clinic.agendaDayEnd,
        },
        { status: 422 },
      );
    }
  }

  // Resource working-hours validation. Applies if the appointment ends up with
  // a resourceId (either explicitly set in this PATCH or inherited from the
  // existing record). overrideReason — current or already set on existing —
  // bypasses the check.
  const effectiveResourceId =
    body.resourceId === undefined ? existing.resourceId : body.resourceId;
  const effectiveOverride =
    body.overrideReason !== undefined ? body.overrideReason : existing.overrideReason;
  if (effectiveResourceId && !effectiveOverride) {
    const schedule = await loadResourceSchedule(effectiveResourceId);
    const valid = validateResourceSchedule(
      newStarts,
      newEnds,
      schedule,
      session.clinic.timezone,
    );
    if (!valid.ok) {
      return NextResponse.json(
        { error: "resource_unavailable", reason: valid.reason },
        { status: 422 },
      );
    }
  }

  // Aviso "fuera del horario de atención" (ClinicSchedule): solo cuando el
  // PATCH mueve la cita (trae startsAt/endsAt) — ediciones de motivo/estado
  // de citas viejas fuera de horario no deben disparar el 409. NO bloquea:
  // el staff confirma reenviando outsideScheduleOk: true; overrideReason
  // (escape hatch existente) también lo omite para no cambiar su flujo.
  if ((body.startsAt || body.endsAt) && !body.outsideScheduleOk && !body.overrideReason) {
    const schedules = await prisma.clinicSchedule.findMany({
      where: { clinicId: session.clinic.id },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
    });
    const outside = isOutsideClinicSchedule(
      schedules,
      newStarts,
      newEnds,
      session.clinic.timezone,
    );
    if (outside) {
      return NextResponse.json(
        { error: "OUTSIDE_SCHEDULE", reason: outside.reason, message: outside.message },
        { status: 409 },
      );
    }
  }

  if (body.reason !== undefined) {
    data.type = body.reason ?? "Consulta general";
  }

  if (body.overrideReason !== undefined) {
    data.overrideReason = body.overrideReason;
    if (body.overrideReason) {
      data.overriddenByUser = { connect: { id: session.user.id } };
      data.overriddenAt = new Date();
    } else {
      data.overriddenByUser = { disconnect: true };
      data.overriddenAt = null;
    }
  }

  try {
    const updated = await prisma.appointment.update({
      where: { id: params.id },
      data,
      include: APPT_INCLUDE,
    });

    // TODO(M3.b): if body.notifyPatient → trigger WA notification (waConnected).

    await logMutation({
      req,
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "appointment",
      entityId: params.id,
      action: "update",
      before: { startsAt: existing.startsAt, endsAt: existing.endsAt, doctorId: existing.doctorId, resourceId: existing.resourceId, type: existing.type, status: existing.status },
      after: { startsAt: updated.startsAt, endsAt: updated.endsAt, doctorId: updated.doctorId, resourceId: updated.resourceId, type: updated.type, status: updated.status },
    });

    // Google Calendar sync (best-effort)
    try {
      const updatedFull = await prisma.appointment.findUnique({
        where: { id: params.id },
        select: {
          id: true, type: true, startsAt: true, endsAt: true, notes: true,
          googleCalendarEventId: true,
          patient: { select: { firstName: true, lastName: true } },
          doctor:  { select: { firstName: true, lastName: true } },
        },
      });
      if (updatedFull?.googleCalendarEventId) {
        await syncUpdateToGoogleCalendar(session.clinic.id, updatedFull.googleCalendarEventId, {
          id: updatedFull.id, type: updatedFull.type,
          startsAt: updatedFull.startsAt, endsAt: updatedFull.endsAt,
          notes: updatedFull.notes,
          patientName: `${updatedFull.patient.firstName} ${updatedFull.patient.lastName}`,
          doctorName: `${updatedFull.doctor.firstName} ${updatedFull.doctor.lastName}`,
          doctorEmail: null,
        });
      }
    } catch (err) {
      console.error("GCal update wrapper error:", err);
    }

    revalidateAfter("appointments");
    revalidatePatientProfile(updated.patientId);
    return NextResponse.json(
      { appointment: appointmentToDTO(updated, session.clinic.category) },
    );
  } catch (err) {
    if (isOverlapError(err)) {
      const conflict = await findConflictingAppointment(
        session.clinic.id,
        params.id,
        body.doctorId ?? existing.doctorId,
        body.resourceId === undefined
          ? existing.resourceId
          : body.resourceId,
        newStarts,
        newEnds,
      );
      const payload: AppointmentConflictError = {
        error: "appointment_overlap",
        conflictingAppointment: conflict ?? {
          id: "unknown",
          patientName: "—",
          startsAt: newStarts.toISOString(),
          endsAt: newEnds.toISOString(),
          doctorId: body.doctorId ?? existing.doctorId,
          resourceId: body.resourceId === undefined
            ? existing.resourceId
            : body.resourceId,
          status: "SCHEDULED",
        },
      };
      return NextResponse.json(payload, { status: 409 });
    }
    console.error("[PATCH /api/appointments/:id] unexpected error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// ═════════════════════════════════════════════════════════════════
// DELETE /api/appointments/:id  → soft cancel
// ═════════════════════════════════════════════════════════════════

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, status: true, patientId: true, doctorId: true, startsAt: true, googleCalendarEventId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.status === "CANCELLED") {
    return NextResponse.json({ ok: true });
  }

  await prisma.appointment.update({
    where: { id: params.id },
    data: { status: "CANCELLED" },
  });

  await logMutation({
    req,
    clinicId: session.clinic.id,
    userId: session.user.id,
    entityType: "appointment",
    entityId: params.id,
    action: "delete",
    before: { status: existing.status, patientId: existing.patientId, doctorId: existing.doctorId, startsAt: existing.startsAt },
  });

  // Google Calendar sync — borrar el evento del calendario si existia
  try {
    if (existing.googleCalendarEventId) {
      await syncDeleteFromGoogleCalendar(session.clinic.id, existing.googleCalendarEventId);
      // Limpiar el id para no reintentar si vuelven a llamar DELETE
      await prisma.appointment.update({
        where: { id: params.id },
        data: { googleCalendarEventId: null },
      });
    }
  } catch (err) {
    console.error("GCal delete wrapper error:", err);
  }

  revalidateAfter("appointments");
  revalidatePatientProfile(existing.patientId);
  return NextResponse.json({ ok: true });
}

async function findConflictingAppointment(
  clinicId: string,
  excludeId: string,
  doctorId: string,
  resourceId: string | null,
  startsAt: Date,
  endsAt: Date,
) {
  const candidates = await prisma.appointment.findMany({
    where: {
      clinicId,
      id: { not: excludeId },
      OR: [{ doctorId }, ...(resourceId ? [{ resourceId }] : [])],
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      overrideReason: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    include: { patient: { select: { firstName: true, lastName: true } } },
    take: 1,
  });

  if (candidates.length === 0) return null;
  const a = candidates[0];
  const name = [a.patient.firstName, a.patient.lastName].filter(Boolean).join(" ").trim();
  return {
    id: a.id,
    patientName: name || "—",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    doctorId: a.doctorId,
    resourceId: a.resourceId,
    status: a.status as AppointmentStatus,
  };
}
