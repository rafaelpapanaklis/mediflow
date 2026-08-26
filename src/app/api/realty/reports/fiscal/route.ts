// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/fiscal?year=&ownerId=
//     &formato=csv → hoja de cálculo · sin formato → el DTO en JSON
//
// El archivo que el arrendador le manda a su contador. Desde julio de 2026
// el SAT ya mira los montos de las rentas, así que este archivo dejó de ser
// un adorno: es lo que le permite a un rentista contestar sin adivinar.
//
// 🔴 SIN UNA SOLA MENCIÓN DE CFDI NI DE TIMBRADO, en el JSON, en el CSV y
// en el PDF. Este producto emite RECIBOS, no facturas: sugerir lo contrario
// —aunque sea con una columna llamada "folio fiscal"— haría que alguien
// creyera que ya cumplió y no lo hizo. La pantalla lo dice con todas sus
// letras: "llévale esto a tu contador".
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getTaxSummary, taxSummaryToCsv } from "@/lib/realty/reports";
import {
  csvResponse,
  gateReport,
  idFromQuery,
  isDenied,
  reportError,
  yearFromQuery,
} from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // `tax` pide dinero (payments.manage u expenses.manage) Y el plan con
  // rentas. Un asesor con properties.view NO llega aquí ni escribiendo la
  // URL: esta hoja lleva el ingreso completo de la cartera del dueño.
  const gate = await gateReport("tax");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const sp = req.nextUrl.searchParams;
    const year = yearFromQuery(ctx, sp);
    const ownerId = idFromQuery(sp, "ownerId");

    const report = await getTaxSummary(ctx, { year, ownerId });

    if (sp.get("formato") === "csv") {
      const quien = report.ownerName ? `-${report.ownerName}` : "";
      return csvResponse(taxSummaryToCsv(report), `resumen-anual${quien}-${report.year}`);
    }

    return NextResponse.json({ report });
  } catch (e) {
    return reportError("fiscal:GET", e);
  }
}
