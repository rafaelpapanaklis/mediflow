// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/cartera/pdf?from=&to=&ownerId=&variant=…
//
// El PDF que el rentista de diez casas le enseña a su esposa y el que el
// asesor le imprime al dueño. Mismo `getPropertyEconomics` que la pantalla:
// si un día el PDF dijera otro rendimiento que la tabla, el que pierde la
// cuenta es el asesor.
//
// Va apaisado (landscape) y no vertical: son nueve columnas de dinero y en
// carta vertical la última se corta justo en el rendimiento, que es el
// número por el que se abre este archivo.
// ═══════════════════════════════════════════════════════════════════════
import type { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PortfolioPdf } from "@/components/realty/reports/report-pdf";
import { getPropertyEconomics } from "@/lib/realty/reports";
import {
  brandFor,
  gateReport,
  idFromQuery,
  isDenied,
  pdfResponse,
  rangeFromQuery,
  reportError,
  variantFromQuery,
} from "../../_guard";

// @react-pdf/renderer NO corre en edge: necesita Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const variant = variantFromQuery(sp);

  const gate = await gateReport(variant === "cartera" ? "portfolio" : "profitability");
  if (isDenied(gate)) return gate.response;
  const { ctx } = gate;

  try {
    const range = rangeFromQuery(ctx, sp);
    const ownerId = idFromQuery(sp, "ownerId");

    const report = await getPropertyEconomics(ctx, {
      from: range.from,
      to: range.to,
      ownerId,
    });

    // Una cartera vacía SÍ genera PDF (con su renglón de "no hay nada en
    // este periodo"): un 404 aquí parecería que el sistema se rompió, y lo
    // que pasa es que el periodo elegido no tiene movimientos.
    const buffer = await renderToBuffer(
      <PortfolioPdf report={report} brand={await brandFor(ctx)} variant={variant} />,
    );
    const quien = report.ownerName ? `-${report.ownerName}` : "";
    return pdfResponse(buffer, `${variant}${quien}-${report.from}-a-${report.to}`);
  } catch (e) {
    return reportError("cartera/pdf:GET", e);
  }
}
