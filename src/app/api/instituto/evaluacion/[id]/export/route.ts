import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduTodayISO, eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { eduCsvFileName } from "@/lib/edu/evaluacion-core";
import { buildEduBitacoraCsv, getEduBitacora } from "@/lib/edu/evaluacion";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/evaluacion/[id]/export — LA BITÁCORA EN CSV.
 *
 * Es lo que la dirección enseña en una acreditación: casos, calificaciones,
 * horas, requisitos y traspasos de un alumno, en un archivo que se abre en
 * una hoja de cálculo y se suma.
 *
 * 🔴 CSV y no PDF a propósito. Lo que se hace con esto es pegarlo en Excel
 * y sacar totales; un PDF bonito obliga a volver a teclearlo, y volver a
 * teclear un expediente académico es cómo aparecen las diferencias que
 * después nadie sabe explicar.
 *
 * 🔴 MISMO ALCANCE QUE LA PANTALLA. Un endpoint de exportación es
 * exactamente el sitio donde se olvida el recorte —"total, es solo un
 * archivo"— y por eso no lee la bitácora por su cuenta: llama a
 * `getEduBitacora`, que busca al alumno DENTRO del alcance. Un alumno solo
 * se exporta a sí mismo; caja no exporta nada.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("evaluacion.view");
  if ("response" in g) return g.response;

  try {
    const zona = eduSafeTimeZone(g.ctx.institution.timezone);
    const page = await getEduBitacora(g.ctx, params.id, zona);
    if (!page) {
      return NextResponse.json({ error: "Ese alumno no es de este instituto." }, { status: 404 });
    }

    const csv = buildEduBitacoraCsv(page);
    const nombre = eduCsvFileName(
      `${page.matricula}-${page.studentName}`,
      eduTodayISO(zona),
    );

    return new Response(csv, {
      status: 200,
      headers: {
        // charset=utf-8 ADEMÁS del BOM que lleva el archivo: uno es para
        // el navegador y el otro para Excel, que ignora la cabecera.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        // Una bitácora académica no se cachea: lo que se enseña en una
        // acreditación tiene que ser lo que hay hoy.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/evaluacion/[id]/export");
  }
}
