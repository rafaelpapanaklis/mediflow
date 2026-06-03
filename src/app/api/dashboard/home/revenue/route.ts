import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";

type RevenueRange = "hoy" | "semana" | "mes" | "anio";

interface SeriesPoint {
  label: string;
  value: number;
}

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, ["ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

  const range = parseRange(req.nextUrl.searchParams.get("range"));
  const tz = session.clinic.timezone;
  const now = new Date();

  // Buckets ordenados + el inicio de la ventana que cubre el bucket más viejo.
  const { buckets, from } = buildBuckets(range, tz, now);
  const to = new Date(now.getTime() + 3_600_000); // 1h de colchón para el bucket actual

  // Traemos TODOS los pagos del rango UNA sola vez (mismo `where` que el
  // buildRevenueSeries del home admin) y los agrupamos por bucket en JS.
  // Evita las 24 queries que haría un loop por bucket.
  const payments = await prisma.payment
    .findMany({
      where: {
        invoice: { clinicId: session.clinic.id, status: { notIn: ["CANCELLED"] } },
        paidAt: { gte: from, lt: to },
        method: { not: "refund" },
      },
      select: { amount: true, paidAt: true },
    })
    .catch((err) => {
      console.error("[home revenue] payments query failed:", err);
      return [];
    });

  const sums: Record<string, number> = {};
  for (const p of payments) {
    if (!p.paidAt) continue;
    const key = bucketKey(range, getTzParts(p.paidAt, tz));
    sums[key] = (sums[key] ?? 0) + Number(p.amount ?? 0);
  }

  const series: SeriesPoint[] = buckets.map((b) => ({
    label: b.label,
    value: sums[b.key] ?? 0,
  }));

  return NextResponse.json({ series });
}

function parseRange(v: string | null): RevenueRange {
  return v === "hoy" || v === "semana" || v === "anio" || v === "mes" ? v : "mes";
}

interface Bucket {
  key: string;
  label: string;
}

/**
 * Lista ordenada de buckets para el rango + la fecha de inicio (`from`) que
 * cubre el bucket más antiguo. Las claves se derivan SIEMPRE de la zona de la
 * clínica vía getTzParts, así que el agrupamiento es a prueba de husos/DST:
 * cada pago cae en su bucket por su fecha LOCAL, no por UTC.
 */
function buildBuckets(
  range: RevenueRange,
  tz: string,
  now: Date,
): { buckets: Bucket[]; from: Date } {
  const np = getTzParts(now, tz);

  if (range === "hoy") {
    // 24 buckets por hora, terminando en la hora local actual.
    // getTzParts puede devolver hour===24 en medianoche local (bug de V8 con
    // hour12:false); lo normalizamos a 0 igual que formatSlotTime (time-utils)
    // y formatTimeInTz (date-ranges). Sin esto el bucket de medianoche queda
    // etiquetado "24:00" y los pagos de 00:xx se pierden por clave desalineada.
    const curHour = normHour(np.hour);
    const curHourUtc = tzLocalToUtc(isoDate(np.year, np.month, np.day), curHour, 0, tz);
    const buckets: Bucket[] = [];
    for (let i = 23; i >= 0; i--) {
      const inst = new Date(curHourUtc.getTime() - i * 3_600_000);
      const p = getTzParts(inst, tz);
      const h = normHour(p.hour);
      buckets.push({
        key: hourKey(p.year, p.month, p.day, h),
        label: `${pad(h)}:00`,
      });
    }
    return { buckets, from: new Date(curHourUtc.getTime() - 23 * 3_600_000) };
  }

  if (range === "semana") {
    // 7 buckets por día (hoy y los 6 días previos), etiqueta de día de semana.
    const buckets: Bucket[] = [];
    let from = now;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.UTC(np.year, np.month - 1, np.day - i, 12));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      buckets.push({ key: dayKey(y, m, day), label: weekdayLabel(d) });
      if (i === 6) from = tzLocalToUtc(isoDate(y, m, day), 0, 0, tz);
    }
    return { buckets, from };
  }

  if (range === "anio") {
    // 12 buckets por mes, terminando en el mes local actual.
    const buckets: Bucket[] = [];
    let from = now;
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(np.year, np.month - 1 - i, 1, 12));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      buckets.push({ key: monthKey(y, m), label: monthLabel(d) });
      if (i === 11) from = tzLocalToUtc(isoDate(y, m, 1), 0, 0, tz);
    }
    return { buckets, from };
  }

  // "mes": un bucket por día del mes actual, del día 1 al día de hoy.
  const buckets: Bucket[] = [];
  for (let day = 1; day <= np.day; day++) {
    buckets.push({ key: dayKey(np.year, np.month, day), label: String(day) });
  }
  return { buckets, from: tzLocalToUtc(isoDate(np.year, np.month, 1), 0, 0, tz) };
}

function bucketKey(
  range: RevenueRange,
  p: { year: number; month: number; day: number; hour: number },
): string {
  if (range === "hoy") return hourKey(p.year, p.month, p.day, normHour(p.hour));
  if (range === "anio") return monthKey(p.year, p.month);
  return dayKey(p.year, p.month, p.day); // semana + mes
}

// Algunos V8 devuelven hour===24 para la medianoche local con hour12:false.
function normHour(h: number): number {
  return h === 24 ? 0 : h;
}

function hourKey(y: number, m: number, d: number, h: number): string {
  return `${y}-${pad(m)}-${pad(d)}-${pad(h)}`;
}
function dayKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function monthKey(y: number, m: number): string {
  return `${y}-${pad(m)}`;
}
function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function weekdayLabel(d: Date): string {
  const s = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" })
    .format(d)
    .replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function monthLabel(d: Date): string {
  const s = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" })
    .format(d)
    .replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
