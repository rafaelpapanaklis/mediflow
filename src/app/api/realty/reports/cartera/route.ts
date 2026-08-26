// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/reports/cartera
//     ?from=&to=&ownerId=&variant=cartera|rentabilidad
//     &formato=csv → hoja de cálculo · sin formato → el DTO en JSON
//
// UNA sola consulta detrás de DOS pestañas. La cartera del propietario y la
// rentabilidad por inmueble son la MISMA cuenta presentada distinto, así
// que comparten `getPropertyEconomics` y no pueden discrepar en un número.
// Lo único que cambia es qué columnas se escriben y —esto sí importa— con
// qué permiso se entra.
//
// 🔴 EL PERMISO SE COMPRUEBA POR LA VARIANTE QUE SE PIDIÓ, no por la otra.
// `portfolio` y `profitability` hoy salen de las mismas tres llaves, pero
// son dos entradas distintas de ReportAccess a propósito: el día que
// alguien le abra la rentabilidad a un asesor sin abrirle la cartera del
// dueño, esta ruta ya está del lado correcto y no hay que acordarse de
// venir a arreglarla.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getPropertyEconomics, portfolioToCsv } from "@/lib/realty/reports";
import {
  csvResponse,
  gateReport,
  idFromQuery,
  isDenied,
  rangeFromQuery,
  reportError,
  variantFromQuery,
} from "../_guard";

// 🔴 Un `route.ts` SOLO puede exportar los verbos y la config de Next. Una
// función auxiliar exportada de aquí truena el build con "is not a valid
// Route export field". Por eso `variantFromQuery` vive en _guard.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    if (sp.get("formato") === "csv") {
      // El nombre lleva el propietario cuando se filtró por uno: el contador
      // que recibe tres archivos necesita distinguirlos sin abrirlos.
      const quien = report.ownerName ? `-${report.ownerName}` : "";
      return csvResponse(
        portfolioToCsv(report, variant),
        `${variant}${quien}-${report.from}-a-${report.to}`,
      );
    }

    return NextResponse.json({ report, variant });
  } catch (e) {
    return reportError("cartera:GET", e);
  }
}
