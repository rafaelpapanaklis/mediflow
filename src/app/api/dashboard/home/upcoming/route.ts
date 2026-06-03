import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { fetchAppointmentsForRange } from "@/lib/agenda/server";

// Estados terminales que NO cuentan como "próxima cita".
const TERMINAL_STATUSES = ["CANCELLED", "COMPLETED", "NO_SHOW", "CHECKED_OUT"];
const HORIZON_DAYS = 14;

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, ["ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

  const now = new Date();
  const to = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

  // fetchAppointmentsForRange ya filtra por clinicId y ordena por startsAt asc.
  const appts = await fetchAppointmentsForRange(now, to, {
    clinicId: session.clinic.id,
    clinicCategory: session.clinic.category,
  });

  const items = appts
    .filter((a) => !TERMINAL_STATUSES.includes(a.status))
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      startsAt: a.startsAt,
      status: a.status,
      patientId: a.patient.id,
      patientName: a.patient.name,
      doctorShortName: a.doctor?.shortName ?? null,
      reason: a.reason ?? null,
      isTeleconsult: a.isTeleconsult ?? false,
    }));

  return NextResponse.json({ items });
}

function parseLimit(v: string | null): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(Math.floor(n), 20);
}
