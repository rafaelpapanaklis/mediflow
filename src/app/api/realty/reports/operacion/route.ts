// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/operacion?from=&to=
//     &formato=csv → hoja de cálculo · sin formato → el DTO en JSON
//
// Embudo, portal que CIERRA, tiempo de primera respuesta, morosidad con
// antigüedad y comisiones. Cinco bloques con TRES permisos distintos, y por
// eso la puerta es un OR: se entra con cualquiera de los tres y luego
// `getOperationsReport` arma solo lo que ese usuario puede ver — los
// bloques que no le tocan salen en `null` y ni siquiera se consultan.
//
// Un asesor con `leads.view` baja su embudo y su tiempo de respuesta; NO
// baja la morosidad de la cartera ni el reparto de comisiones. Eso no lo
// decide esta ruta: lo decide el MISMO getReportAccess que decide qué se
// pinta en pantalla, que es justo el punto de tenerlo en un solo lugar.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getOperationsReport, operationsToCsv } from "@/lib/realty/reports";
import {
  csvResponse,
  gateReport,
  isDenied,
  rangeFromQuery,
  reportError,
} from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await gateReport("funnel", "commissions", "collections");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const sp = req.nextUrl.searchParams;
    const range = rangeFromQuery(ctx, sp);

    const report = await getOperationsReport(ctx, { from: range.from, to: range.to });

    if (sp.get("formato") === "csv") {
      return csvResponse(operationsToCsv(report), `operacion-${report.from}-a-${report.to}`);
    }

    return NextResponse.json({ report });
  } catch (e) {
    return reportError("operacion:GET", e);
  }
}
