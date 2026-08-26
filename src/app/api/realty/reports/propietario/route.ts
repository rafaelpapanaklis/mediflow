// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/propietario?propertyId=…&from=…&to=…
//     ?formato=csv → hoja de cálculo
//     (sin formato) → el DTO en JSON
//
// Es el MISMO `getOwnerActivityReport` que consume la pantalla: la hoja de
// cálculo, el PDF y lo que ve el asesor no pueden discrepar en un número,
// porque el que queda mal es el asesor enfrente de su cliente.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getOwnerActivityReport, ownerReportToCsv } from "@/lib/realty/reports";
import { csvResponse, gateReport, idFromQuery, isDenied, rangeFromQuery, reportError } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await gateReport("activity");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const sp = req.nextUrl.searchParams;
    const propertyId = idFromQuery(sp, "propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Falta el inmueble." }, { status: 400 });
    }
    const range = rangeFromQuery(ctx, sp);

    const report = await getOwnerActivityReport(ctx, {
      propertyId,
      from: range.from,
      to: range.to,
    });
    // 404 y no 403: un inmueble de otra cuenta y uno que no existe tienen
    // que responder EXACTAMENTE lo mismo, o la diferencia se vuelve una
    // forma de averiguar qué inmuebles tiene el de al lado.
    if (!report) {
      return NextResponse.json({ error: "Ese inmueble ya no existe." }, { status: 404 });
    }

    if (sp.get("formato") === "csv") {
      return csvResponse(
        ownerReportToCsv(report),
        `reporte-${report.propertyTitle}-${report.to}`,
      );
    }

    return NextResponse.json({ report });
  } catch (e) {
    return reportError("propietario:GET", e);
  }
}
