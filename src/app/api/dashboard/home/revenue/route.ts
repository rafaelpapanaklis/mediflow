import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { getTzParts } from "@/lib/agenda/time-utils";
import { movimientosDelPeriodo } from "@/lib/dinero/ingresos.server";
import { netoDelPeriodo } from "@/lib/dinero/ingresos";
import {
  buildRevenueWindow,
  bucketKeyFor,
  parseRevenueRange,
} from "@/lib/home/revenue-buckets";

interface SeriesPoint {
  label: string;
  value: number;
  /** El tramo todavía no ocurre: la UI corta ahí la línea. */
  future: boolean;
}

/**
 * Serie de ingresos del home admin.
 *
 * INVARIANTE: el `where` y la ventana son EXACTAMENTE los del KPI
 * "Ingresos del …" (`aggregateAdminPeriodKpis` → `periodRangeUtc`), y los
 * buckets teselan la ventana completa. Por lo tanto `total` (y la suma de la
 * serie) es el mismo número que pinta la tarjeta. Cuando la ventana de la
 * gráfica terminaba en "ahora + 1h" los pagos con `paidAt` a futuro —los que
 * escribe el seed de demo, `fin de la cita + 1..2 h`— contaban para la tarjeta
 * y desaparecían de la gráfica.
 */
export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, ["ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

  const range = parseRevenueRange(req.nextUrl.searchParams.get("range"));
  const tz = session.clinic.timezone;
  const now = new Date();

  const { buckets, from, to } = buildRevenueWindow(range, tz, now);

  // Traemos los movimientos de la ventana UNA sola vez y agrupamos en JS:
  // evita las 24/31 queries que haría un loop por bucket. Ingresos con la
  // definición ÚNICA (ws1-t2, lib/dinero): cobros menos reembolsos, sin
  // canceladas ni historia migrada — el número de Finanzas y de la tarjeta.
  let degraded = false;
  const movimientos = await movimientosDelPeriodo(session.clinic.id, { gte: from, lt: to })
    .catch((err) => {
      // Se degrada en vez de tumbar el home, pero lo DECLARA: sin esta bandera
      // un fallo de la query se veía igual que "no hubo ingresos".
      console.error("[home revenue] payments query failed:", err);
      degraded = true;
      return { cobros: [], reembolsos: [] };
    });

  const neto = netoDelPeriodo(
    movimientos.cobros,
    movimientos.reembolsos,
    (d) => bucketKeyFor(range, getTzParts(d, tz)),
  );
  const sums = neto.porClave;
  const total = neto.neto;

  const nowMs = now.getTime();
  const series: SeriesPoint[] = buckets.map((b) => ({
    label: b.label,
    value: sums[b.key] ?? 0,
    future: b.start.getTime() > nowMs,
  }));

  return NextResponse.json({
    range,
    series,
    total,
    count: movimientos.cobros.length,
    degraded,
  });
}
