import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import {
  fetchActiveDoctors,
  fetchAppointmentsForRange,
  fetchResources,
  fetchWaitlistCount,
} from "@/lib/agenda/server";
import { isValidDateISO } from "@/lib/agenda/time-utils";
import { listarBloqueos } from "@/lib/agenda-bloqueos/consulta.server";
import { ctxDeSesion } from "@/lib/agenda-bloqueos/core-ctx";
import { hasPermission } from "@/lib/auth/permissions";
import { calendarRangeUtc } from "@/lib/agenda/date-ranges";
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

  // Tope de span: la UI del calendario nunca pide más de ~42 días (vista mes =
  // grilla 6x7; lista = hoy+30). Un rango enorme (años) escanearía toda la
  // agenda de la clínica sin límite. Cap defensivo a 92 días — preserva
  // intactas las vistas mes/semana/día/lista; el clinicId sigue siendo el de
  // la sesión.
  const MAX_RANGE_DAYS = 92;
  const spanDays = Math.round(
    (Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000,
  );
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: "range_too_large", maxDays: MAX_RANGE_DAYS },
      { status: 400 },
    );
  }

  const tz = session.clinic.timezone;
  // Usamos el helper centralizado de día calendario en tz: el rango es
  // `[fromISO 00:00 tz, toISO+1 00:00 tz)`. Esto garantiza que una cita
  // a las 23:59 hora local pertenezca al día calendario local
  // correspondiente, no al día UTC. Idéntica semántica a la SSR de
  // /dashboard/agenda y al provider del cliente — sin esto los
  // contadores y el render se desincronizan.
  const { fromUtc, toUtc } = calendarRangeUtc(fromISO, toISO, tz);

  const doctorIdScope =
    session.user.role === "DOCTOR" ? session.user.id : undefined;

  // Filtros opcionales (query params comma-separated).
  const doctorIds = parseList(url.searchParams.get("doctorIds"));
  const resourceIds = parseList(url.searchParams.get("resourceIds"));
  const statusesRaw = parseList(url.searchParams.get("statuses"));
  const statuses = statusesRaw.filter((s): s is AppointmentStatus =>
    (VALID_STATUSES as string[]).includes(s),
  );

  const puedeVerBloqueos = hasPermission(
    {
      role: session.user.role,
      permissionsOverride: session.user.permissionsOverride ?? [],
    },
    "agenda.view",
  );

  const [appointments, doctors, resources, waitlistCount, bloqueos] = await Promise.all([
    fetchAppointmentsForRange(fromUtc, toUtc, {
      clinicId: session.clinic.id,
      clinicCategory: session.clinic.category,
      doctorIdScope,
      doctorIds: doctorIds.length > 0 ? doctorIds : undefined,
      resourceIds: resourceIds.length > 0 ? resourceIds : undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      // Enmascara pacientes restringidos que este usuario no puede ver.
      viewer: { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id },
    }),
    fetchActiveDoctors(session.clinic.id, session.clinic.category),
    fetchResources(session.clinic.id),
    fetchWaitlistCount(session.clinic.id),
    // WS1-T3 — los bloqueos del MISMO rango que las citas, en el MISMO viaje.
    //
    // El GET de /api/appointments ya los mandaba (WS1-T2), pero la agenda solo
    // pasa por ahí en la SSR del primer día: a partir del segundo día, y en
    // Semana y Mes, todo lo recarga este endpoint. Sin esto, cambiar de día
    // borraba la franja de la pantalla y el bloqueo dejaba de verse.
    //
    // 🔴 SOLO PARA QUIEN PUEDE VER LA AGENDA. El `reason` de un bloqueo es
    // texto libre y puede ser privado («operación de rodilla»); por eso
    // `/api/settings/bloqueos` exige `agenda.view`. Este endpoint no lo
    // exigía y NO se le añade un gate nuevo —eso le quitaría a alguien algo
    // que hoy puede hacer—: lo que se hace es no ADJUNTAR los bloqueos si no
    // tiene el permiso. Quien hoy lee este endpoint lo sigue leyendo igual;
    // simplemente no recibe un dato que hasta ahora no recibía.
    //
    // `listarBloqueos` aplica además el alcance por rol: un DOCTOR recibe los
    // suyos y los de toda la clínica, nunca el motivo del bloqueo de otra.
    // Y degrada a [] si la tabla todavía no existe, igual que allí.
    puedeVerBloqueos
      ? listarBloqueos(ctxDeSesion(session), {
          desde: fromUtc.toISOString(),
          hasta: toUtc.toISOString(),
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    range: { from: fromUtc.toISOString(), to: toUtc.toISOString() },
    timezone: session.clinic.timezone,
    slotMinutes: session.clinic.defaultSlotMinutes,
    // Ventana EFECTIVA (∪ ClinicSchedule) — P1-13, misma que el SSR y el GET.
    dayStart: session.timeConfig.dayStart,
    dayEnd: session.timeConfig.dayEnd,
    appointments,
    doctors,
    resources,
    pendingValidation: [],
    waitlistCount,
    bloqueos,
  });
}
