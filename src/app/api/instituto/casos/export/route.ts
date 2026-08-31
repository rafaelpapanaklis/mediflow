import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduSafeTimeZone, eduTodayISO } from "@/lib/edu/agenda-core";
import { eduCsvFileName } from "@/lib/edu/evaluacion-core";
import { buildEduCasosCsv, parseEduCasosPanelFilters } from "@/lib/edu/casos-core";
import { listEduCasosPanel } from "@/lib/edu/casos";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/casos/export — la pantalla de casos, en CSV.
 *
 * Exportar es LEER: mismo permiso (`casos.view`), mismo alcance
 * (`eduCaseScopeWhere` dentro de listEduCasosPanel) y LOS MISMOS filtros
 * que la pantalla — la query string es idéntica. Un endpoint de descarga
 * con su propia consulta es la puerta de atrás clásica: se audita la
 * pantalla y se olvida el CSV.
 *
 * CAJA no llega ni con el interruptor encendido: su alcance de "cases" es
 * "none" y la lista sale vacía — pero el guard la para antes (no trae
 * `casos.view` por default).
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("casos.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const sp: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      sp[key] = value;
    });

    const zona = eduSafeTimeZone(g.ctx.institution.timezone);
    const page = await listEduCasosPanel(g.ctx, parseEduCasosPanelFilters(sp), zona);
    if (page.truncated) {
      // Un CSV silenciosamente incompleto es un reporte falso: se avisa y
      // se pide acotar, en vez de entregar 300 filas como si fueran todas.
      return NextResponse.json(
        {
          error:
            "Hay más casos de los que caben en un export. Acota con los filtros (especialidad, fechas o estado) y vuelve a exportar.",
        },
        { status: 413 },
      );
    }

    const csv = buildEduCasosCsv(page.rows);
    const nombre = eduCsvFileName("casos", eduTodayISO(zona));

    return new Response(csv, {
      status: 200,
      headers: {
        // El charset va ADEMÁS del BOM: Excel lee el BOM, todo lo demás
        // lee el header.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/casos/export");
  }
}
