import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduSafeTimeZone, eduTodayISO } from "@/lib/edu/agenda-core";
import { eduCsvFileName } from "@/lib/edu/evaluacion-core";
import {
  EDU_CASOS_EXPORT_MAX_ROWS,
  buildEduCasosCsv,
  parseEduCasosPanelFilters,
} from "@/lib/edu/casos-core";
import { listEduCasosParaExport } from "@/lib/edu/casos";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/casos/export — la pantalla de casos, en CSV.
 *
 * Exportar es LEER: mismo permiso (`casos.view`), mismo alcance
 * (`eduCaseScopeWhere` dentro de listEduCasosParaExport) y LOS MISMOS
 * filtros que la pantalla — la query string es idéntica. Un endpoint de
 * descarga con su propia consulta es la puerta de atrás clásica: se
 * audita la pantalla y se olvida el CSV.
 *
 * 🔴 PERO CON SU PROPIO TECHO, Y ESO NO ES LA MISMA COSA. Hasta el
 * arreglo del volumen, esto reusaba `listEduCasosPanel` — tope 300, el de
 * una PANTALLA — y devolvía 413 en cuanto la lista se cortaba. Resultado
 * medido: un instituto con 400 casos marcaba "incluir cerrados" y se
 * quedaba sin export, justo en el caso para el que existe el botón (una
 * acreditación pide los cerrados). Ahora lee hasta
 * EDU_CASOS_EXPORT_MAX_ROWS en lotes. La regla no cambió: por encima de
 * ESE tope, el 413 sigue — un CSV silenciosamente incompleto es un
 * reporte falso.
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
    const page = await listEduCasosParaExport(g.ctx, parseEduCasosPanelFilters(sp), zona);
    if (page.truncated) {
      // Un CSV silenciosamente incompleto es un reporte falso: se avisa y
      // se pide acotar, en vez de entregar un archivo que parece completo.
      // El número va EN EL MENSAJE: "hay más de los que caben" sin decir
      // cuántos caben no le dice a nadie cuánto tiene que acotar.
      return NextResponse.json(
        {
          error:
            `Un export cabe hasta ${EDU_CASOS_EXPORT_MAX_ROWS.toLocaleString("es-MX")} casos y éste los pasa. ` +
            "Acota por fechas de apertura (o por especialidad) y descárgalo en dos partes: un CSV recortado " +
            "en silencio sería un reporte falso, así que se prefiere no entregarlo.",
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
