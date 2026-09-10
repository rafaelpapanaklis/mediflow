import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduAudit, eduAuditRequestMeta } from "@/lib/edu/auditoria";
import {
  eduInvoicesCsv,
  eduInvoicesCsvNombre,
  parseEduInvoiceFilters,
} from "@/lib/edu/facturacion-core";
import { listEduInvoices } from "@/lib/edu/facturacion";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * GET /api/instituto/facturacion/csv — 🔴 H-78 (la otra mitad).
 *
 * «Facturación no tiene filtro por fecha ni exportación, y se corta en
 * 200. Cerrar el mes y conciliar con el corte de caja es imposible desde
 * el panel.» El filtro por fecha lo cerró la C·1; esto es la exportación.
 *
 * 🔴 SALE LO QUE SE ESTÁ VIENDO. Los filtros se leen con la MISMA función
 * que la lista (`parseEduInvoiceFilters`) y se consulta con la MISMA
 * función (`listEduInvoices`), así que el CSV y la pantalla no pueden
 * discrepar. Eso incluye el tope de 200: lo que la pantalla dice que se
 * quedó fuera, también se queda fuera aquí — y por eso el filtro de
 * fechas es lo que hace útil a los dos.
 *
 * 🔴 SE REGISTRA COMO **EXPORT** en la bitácora (NOM-024): un archivo con
 * nombres de pacientes, RFC e importes es un dato que SALE de la escuela,
 * y esa es exactamente la pregunta que una auditoría viene a hacer.
 *
 * Permiso: `facturacion.view` — el mismo que ver la lista. Exportar lo que
 * ya tienes delante no es un privilegio distinto de mirarlo.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("facturacion.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const filtros = parseEduInvoiceFilters(params);
    const page = await listEduInvoices(g.ctx, filtros, {
      timeZone: g.ctx.institution.timezone,
    });

    await eduAudit(g.ctx, {
      action: "export",
      entity: "invoice",
      after: {
        formato: "csv",
        filas: page.rows.length,
        truncado: page.truncated,
        desde: filtros.desde,
        hasta: filtros.hasta,
        estado: filtros.status,
      },
      ...eduAuditRequestMeta(request),
    });

    return new NextResponse(eduInvoicesCsv(page.rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // `attachment` y no `inline`: esto se abre en una hoja de cálculo,
        // no en una pestaña.
        "Content-Disposition": `attachment; filename="${eduInvoicesCsvNombre(filtros)}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/facturacion/csv");
  }
}
