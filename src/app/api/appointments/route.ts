import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
  isOverlapError,
} from "@/lib/agenda/api-helpers";
import {
  appointmentToDTO,
  fetchActiveDoctors,
  fetchAppointmentsForDay,
  fetchPendingValidation,
  fetchResources,
  fetchWaitlistCount,
} from "@/lib/agenda/server";
import {
  dayRangeUtc,
  getTzParts,
  isValidDateISO,
  todayInTz,
} from "@/lib/agenda/time-utils";
import { canOverrideOverlap } from "@/lib/agenda/transitions";
import { validateResourceSchedule } from "@/lib/agenda/resource-schedule";
import { loadResourceSchedule } from "@/lib/agenda/resource-schedule.server";
import { logMutation } from "@/lib/audit";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { syncCreateToGoogleCalendar } from "@/lib/agenda/google-sync";
import type {
  AgendaDayResponse,
  AppointmentConflictError,
  AppointmentStatus,
  CreateAppointmentInput,
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
// GET /api/appointments?date=&doctorId=&resourceId=&status=
// Returns AgendaDayResponse (M3 shape — diferente al GET legacy de M2.b).
// ═════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const sp = req.nextUrl.searchParams;
  const dateParam = sp.get("date");
  const dateISO = dateParam && isValidDateISO(dateParam)
    ? dateParam
    : todayInTz(session.clinic.timezone);

  const doctorId = sp.get("doctorId") || undefined;
  const resourceId = sp.get("resourceId") || undefined;
  const statusCsv = sp.get("status");
  const statuses: AppointmentStatus[] | undefined = statusCsv
    ? (statusCsv.split(",").filter(Boolean) as AppointmentStatus[])
    : undefined;

  // scope=clinic: cliente declara que necesita TODAS las citas de la
  // clinica (no solo las del usuario logueado). Usado por el SlotGridPicker
  // del modal Nueva Cita para detectar conflictos de doctor/resource con
  // citas de otros doctores.
  const scope = sp.get("scope");
  if (scope && scope !== "clinic") {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  // SECURITY: scope=clinic permite ver todas las citas (necesario para
  // SlotGridPicker que detecta conflictos cross-doctor). Solo permitido
  // a roles administrativos. DOCTOR sigue scopeado a sus propias citas.
  const canUseClinicScope =
    session.user.role === "ADMIN" ||
    session.user.role === "SUPER_ADMIN" ||
    session.user.role === "RECEPTIONIST";
  const effectiveScope = scope === "clinic" && canUseClinicScope ? "clinic" : null;
  const doctorIdScope =
    effectiveScope === "clinic"
      ? undefined
      : session.user.role === "DOCTOR"
      ? session.user.id
      : undefined;

  const range = dayRangeUtc(dateISO, session.timeConfig);

  const [appointments, doctors, resources, pendingValidation, waitlistCount] =
    await Promise.all([
      fetchAppointmentsForDay(dateISO, session.timeConfig, {
        clinicId: session.clinic.id,
        clinicCategory: session.clinic.category,
        doctorIdScope,
        doctorId,
        resourceId,
        statuses,
      }),
      fetchActiveDoctors(session.clinic.id, session.clinic.category),
      fetchResources(session.clinic.id),
      fetchPendingValidation(
        dateISO,
        session.timeConfig,
        session.clinic.id,
        session.clinic.category,
      ),
      fetchWaitlistCount(session.clinic.id),
    ]);

  const response: AgendaDayResponse = {
    range: {
      from: range.startUtc.toISOString(),
      to: range.endUtc.toISOString(),
    },
    timezone: session.clinic.timezone,
    slotMinutes: session.clinic.defaultSlotMinutes,
    dayStart: session.clinic.agendaDayStart,
    dayEnd: session.clinic.agendaDayEnd,
    appointments,
    doctors,
    resources,
    pendingValidation,
    waitlistCount,
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// ═════════════════════════════════════════════════════════════════
// POST /api/appointments
// ═════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "DOCTOR",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  let body: CreateAppointmentInput;
  try {
    body = (await req.json()) as CreateAppointmentInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validation = validateCreate(body);
  if (validation) {
    return NextResponse.json({ error: validation }, { status: 400 });
  }

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
  }

  if (!body.overrideReason) {
    const hoursCheck = isWithinClinicHours(
      startsAt,
      endsAt,
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

  if (body.overrideReason && !canOverrideOverlap(session.user.role)) {
    return NextResponse.json(
      { error: "override_not_allowed_for_role" },
      { status: 403 },
    );
  }

  const [patient, doctor, resource] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: session.clinic.id },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: {
        id: body.doctorId,
        clinicId: session.clinic.id,
        role: "DOCTOR",
        isActive: true,
      },
      select: { id: true },
    }),
    body.resourceId
      ? prisma.resource.findFirst({
          where: {
            id: body.resourceId,
            clinicId: session.clinic.id,
            isActive: true,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!patient) {
    return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  }
  if (!doctor) {
    return NextResponse.json({ error: "doctor_not_found" }, { status: 404 });
  }
  if (body.resourceId && !resource) {
    return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
  }

  // Resource working-hours validation. A Resource without any schedule rows
  // is treated as "always open" (backward-compat for resources created before
  // this feature). overrideReason bypasses the check (admin escape hatch).
  if (body.resourceId && !body.overrideReason) {
    const schedule = await loadResourceSchedule(body.resourceId);
    const valid = validateResourceSchedule(
      startsAt,
      endsAt,
      schedule,
      session.clinic.timezone,
    );
    if (!valid.ok) {
      return NextResponse.json(
        {
          error: "resource_unavailable",
          reason: valid.reason,
        },
        { status: 422 },
      );
    }
  }

  try {
    const created = await prisma.appointment.create({
      data: {
        clinicId: session.clinic.id,
        patientId: body.patientId,
        doctorId: body.doctorId,
        resourceId: body.resourceId ?? null,
        startsAt,
        endsAt,
        status: "SCHEDULED",
        type: body.reason ?? "Consulta general",
        mode: body.isTeleconsult ? "TELECONSULTATION" : "IN_PERSON",
        source: "STAFF",
        requiresValidation: false,
        overrideReason: body.overrideReason ?? null,
        overriddenBy: body.overrideReason ? session.user.id : null,
        overriddenAt: body.overrideReason ? new Date() : null,
      },
      include: APPT_INCLUDE,
    });

    // TODO(M3.b): notifyPatient via WhatsApp si body.notifyPatient
    //             y session.clinic.waConnected.

    await logMutation({
      req,
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "appointment",
      entityId: created.id,
      action: "create",
      after: { patientId: created.patientId, doctorId: created.doctorId, startsAt: created.startsAt, type: created.type, status: created.status },
    });

    // Google Calendar sync (best-effort, no falla la creacion si Google falla)
    try {
      const fullAppt = await prisma.appointment.findUnique({
        where: { id: created.id },
        select: {
          id: true, type: true, startsAt: true, endsAt: true, notes: true,
          patient: { select: { firstName: true, lastName: true, email: true } },
          doctor:  { select: { firstName: true, lastName: true, email: true } },
        },
      });
      if (fullAppt) {
        await syncCreateToGoogleCalendar(session.clinic.id, {
          id: fullAppt.id, type: fullAppt.type,
          startsAt: fullAppt.startsAt, endsAt: fullAppt.endsAt,
          notes: fullAppt.notes,
          patientName: `${fullAppt.patient.firstName} ${fullAppt.patient.lastName}`,
          doctorName: `${fullAppt.doctor.firstName} ${fullAppt.doctor.lastName}`,
          doctorEmail: fullAppt.doctor.email ?? null,
          patientEmail: fullAppt.patient.email ?? null,
        });
      }
    } catch (err) {
      console.error("GCal sync wrapper error:", err);
    }

    revalidateAfter("appointments");
    revalidatePatientProfile(created.patientId);
    return NextResponse.json(
      { appointment: appointmentToDTO(created, session.clinic.category) },
      { status: 201 },
    );
  } catch (err) {
    if (isOverlapError(err)) {
      const conflict = await findConflictingAppointment(
        session.clinic.id,
        body.doctorId,
        body.resourceId ?? null,
        startsAt,
        endsAt,
      );
      const payload: AppointmentConflictError = {
        error: "appointment_overlap",
        conflictingAppointment: conflict ?? {
          id: "unknown",
          patientName: "—",
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          doctorId: body.doctorId,
          resourceId: body.resourceId ?? null,
          status: "SCHEDULED",
        },
      };
      return NextResponse.json(payload, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }
    console.error("[POST /api/appointments] unexpected error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

function validateCreate(body: Partial<CreateAppointmentInput>): string | null {
  if (!body.patientId || typeof body.patientId !== "string") return "missing_patientId";
  if (!body.doctorId || typeof body.doctorId !== "string") return "missing_doctorId";
  if (!body.startsAt || typeof body.startsAt !== "string") return "missing_startsAt";
  if (!body.endsAt || typeof body.endsAt !== "string") return "missing_endsAt";
  if (Number.isNaN(new Date(body.startsAt).getTime())) return "invalid_startsAt";
  if (Number.isNaN(new Date(body.endsAt).getTime())) return "invalid_endsAt";
  return null;
}

async function findConflictingAppointment(
  clinicId: string,
  doctorId: string,
  resourceId: string | null,
  startsAt: Date,
  endsAt: Date,
) {
  const candidates = await prisma.appointment.findMany({
    where: {
      clinicId,
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
