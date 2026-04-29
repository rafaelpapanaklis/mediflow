import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import {
  fetchActiveDoctors,
  fetchAppointmentsForRange,
  fetchResources,
  fetchWaitlistCount,
} from "@/lib/agenda/server";
import { isValidDateISO, tzLocalToUtc } from "@/lib/agenda/time-utils";
import type { AppointmentStatus } from "@/lib/agenda/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_CHAIR",
  "IN_PROGRESS",
  "COMPLETED",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
];

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: Request) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const fromISO = url.searchParams.get("from");
  const toISO = url.searchParams.get("to");

  if (!fromISO || !toISO || !isValidDateISO(fromISO) || !isValidDateISO(toISO)) {
    return NextResponse.json(
      { error: "invalid_range", expected: "from and to as YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (fromISO > toISO) {
    return NextResponse.json({ error: "invalid_range_order" }, { status: 400 });
  }

  const tz = session.clinic.timezone;
  const fromUtc = tzLocalToUtc(fromISO, session.clinic.agendaDayStart, 0, tz);
  // toISO es exclusivo: avanzamos un día y usamos dayStart=0
  const [ty, tm, td] = toISO.split("-").map((n) => parseInt(n, 10));
  const nextISO = new Date(Date.UTC(ty, tm - 1, td + 1));
  const nextISOStr = `${nextISO.getUTCFullYear()}-${String(nextISO.getUTCMonth() + 1).padStart(2, "0")}-${String(nextISO.getUTCDate()).padStart(2, "0")}`;
  const toUtc = tzLocalToUtc(nextISOStr, session.clinic.agendaDayStart, 0, tz);

  const doctorIdScope =
    session.user.role === "DOCTOR" ? session.user.id : undefined;

  // Filtros opcionales (query params comma-separated).
  const doctorIds = parseList(url.searchParams.get("doctorIds"));
  const resourceIds = parseList(url.searchParams.get("resourceIds"));
  const statusesRaw = parseList(url.searchParams.get("statuses"));
  const statuses = statusesRaw.filter((s): s is AppointmentStatus =>
    (VALID_STATUSES as string[]).includes(s),
  );

  const [appointments, doctors, resources, waitlistCount] = await Promise.all([
    fetchAppointmentsForRange(fromUtc, toUtc, {
      clinicId: session.clinic.id,
      clinicCategory: session.clinic.category,
      doctorIdScope,
      doctorIds: doctorIds.length > 0 ? doctorIds : undefined,
      resourceIds: resourceIds.length > 0 ? resourceIds : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
    }),
    fetchActiveDoctors(session.clinic.id, session.clinic.category),
    fetchResources(session.clinic.id),
    fetchWaitlistCount(session.clinic.id),
  ]);

  return NextResponse.json({
    range: { from: fromUtc.toISOString(), to: toUtc.toISOString() },
    timezone: session.clinic.timezone,
    slotMinutes: session.clinic.defaultSlotMinutes,
    dayStart: session.clinic.agendaDayStart,
    dayEnd: session.clinic.agendaDayEnd,
    appointments,
    doctors,
    resources,
    pendingValidation: [],
    waitlistCount,
  });
}
