import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import {
  buildEduDireccionCsv,
  eduDirCsvFileName,
  eduDirFiltrosDeQuery,
} from "@/lib/edu/direccion-core";
import {
  eduDirContextFrom,
  getEduDireccionAhora,
  getEduDireccionPanel,
} from "@/lib/edu/direccion";
import { getEduCampusScope } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/direccion/export — EL TABLERO EN CSV.
 *
 * 🔴 EN UNA ACREDITACIÓN ESTO SE PIDE EN PAPEL, y el papel se resuelve por
 * DOS caminos distintos a propósito:
 *   · esta exportación, para lo que hay que SUMAR (se pega en una hoja de
 *     cálculo y se cuadra);
 *   · el `@media print` de la propia pantalla, para lo que hay que
 *     ENSEÑAR (el tablero tal como se ve, con sus colores y su rejilla).
 * Un PDF generado aparte sería una TERCERA versión del mismo tablero, que
 * es como se acaba con tres cifras distintas del mismo mes.
 *
 * 🔴 SALE DE LAS MISMAS FUNCIONES QUE LA PANTALLA. No hay una consulta
 * "para exportar": se llama a `getEduDireccionPanel` y a
 * `getEduDireccionAhora` con los mismos filtros. Si el archivo se armara
 * por su cuenta, el día que una cuenta cambiara habría que acordarse de
 * cambiarla dos veces.
 *
 * 🔴 MISMO PERMISO Y MISMO ALCANCE. Exportar es leer: un endpoint de
 * descarga sin guard es la puerta de atrás del tablero.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("direccion.panel");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const filtros = eduDirFiltrosDeQuery(url.searchParams);
    // 🔴 Ola 11 · LA SEDE, y el CSV la ESCRIBE en su cabecera. Un archivo
    // que se lleva a una acreditacion con el nombre del instituto y las
    // cifras de un solo campus es el dato falso mas caro de todos.
    const ctx = eduDirContextFrom(g.ctx, await getEduCampusScope(g.ctx));

    // En SECUENCIA y no en paralelo: son dos bloques de seis consultas
    // cada uno y encadenarlos dejaría doce simultáneas contra el mismo
    // pool. Una exportación puede tardar medio segundo más.
    const ahora = await getEduDireccionAhora(ctx, filtros);
    const panel = await getEduDireccionPanel(ctx, filtros);

    const csv = buildEduDireccionCsv(panel, ahora);
    const nombre = eduDirCsvFileName(panel.ventana.desdeISO, panel.ventana.hastaISO);

    return new Response(csv, {
      status: 200,
      headers: {
        // charset=utf-8 ADEMÁS del BOM que lleva el archivo: uno es para el
        // navegador y el otro para Excel, que ignora la cabecera.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        // Un tablero de dirección no se cachea: lo que se lleva a una
        // acreditación tiene que ser lo que hay hoy.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/direccion/export");
  }
}
