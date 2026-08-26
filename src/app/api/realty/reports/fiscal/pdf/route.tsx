// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/fiscal/pdf?year=&ownerId=
//
// El resumen anual, impreso. Es el que el arrendador entrega en papel o
// reenvía por correo a su contador, así que lleva el membrete de la
// inmobiliaria y la leyenda de que NO es una declaración ni un comprobante
// fiscal — el PDF tiene que poder explicarse solo cuando ya nadie recuerde
// de qué pantalla salió.
//
// La hoja de cálculo va por la ruta hermana (?formato=csv). El contador
// casi siempre prefiere esa; el PDF es para el dueño.
// ═══════════════════════════════════════════════════════════════════════
import type { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { TaxPdf } from "@/components/realty/reports/report-pdf";
import { getTaxSummary } from "@/lib/realty/reports";
import {
  brandFor,
  gateReport,
  idFromQuery,
  isDenied,
  pdfResponse,
  reportError,
  yearFromQuery,
} from "../../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const gate = await gateReport("tax");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const sp = req.nextUrl.searchParams;
    const year = yearFromQuery(ctx, sp);
    const ownerId = idFromQuery(sp, "ownerId");

    const report = await getTaxSummary(ctx, { year, ownerId });
    const buffer = await renderToBuffer(<TaxPdf report={report} brand={await brandFor(ctx)} />);

    const quien = report.ownerName ? `-${report.ownerName}` : "";
    return pdfResponse(buffer, `resumen-anual${quien}-${report.year}`);
  } catch (e) {
    return reportError("fiscal/pdf:GET", e);
  }
}
