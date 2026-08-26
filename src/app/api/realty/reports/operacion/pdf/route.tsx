// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/operacion/pdf?from=&to=
//
// El paquete que el dueño de la inmobiliaria se lleva a la junta del lunes.
// Apaisado porque la tabla de morosidad tiene cinco tramos de antigüedad y
// en carta vertical el tramo de "más de 90 días" —el único que de verdad
// duele— se sale de la página.
//
// Los bloques que el usuario no puede ver llegan en `null` desde
// getOperationsReport y el PDF sencillamente no los dibuja: no hay un
// segundo criterio de visibilidad viviendo dentro del componente.
// ═══════════════════════════════════════════════════════════════════════
import type { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { OperationsPdf } from "@/components/realty/reports/report-pdf";
import { getOperationsReport } from "@/lib/realty/reports";
import {
  brandFor,
  gateReport,
  isDenied,
  pdfResponse,
  rangeFromQuery,
  reportError,
} from "../../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const gate = await gateReport("funnel", "commissions", "collections");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const range = rangeFromQuery(ctx, req.nextUrl.searchParams);
    const report = await getOperationsReport(ctx, { from: range.from, to: range.to });

    const buffer = await renderToBuffer(
      <OperationsPdf report={report} brand={await brandFor(ctx)} />,
    );
    return pdfResponse(buffer, `operacion-${report.from}-a-${report.to}`);
  } catch (e) {
    return reportError("operacion/pdf:GET", e);
  }
}
