import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import {
  EDU_PATIENT_CSV_HEADERS,
  eduCsvCell,
  eduPatientsCsv,
  eduPatientsCsvFileName,
  parseEduPatientFilters,
} from "@/lib/edu/pacientes-core";
import { EDU_PATIENT_CSV_MAX_ROWS, listEduPatientsForCsv } from "@/lib/edu/pacientes";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * GET /api/instituto/pacientes/exportar — la lista filtrada, en CSV.
 *
 * 🔴 EXISTE PARA LAS LISTAS GRANDES. Con hasta 1 000 filas la pantalla
 * arma el archivo en el navegador con las que ya tiene cargadas —cero
 * viajes, descarga instantánea— y esta ruta ni se toca. Por encima de eso,
 * o cuando la lista está paginada y faltan filas por bajar, el archivo
 * tiene que salir del servidor: pedirle al navegador que recorra 40
 * páginas de 50 para exportar es cómo se cuelga una pestaña.
 *
 * 🔴 EL MISMO `where` QUE LA LISTA. Mismo alcance, mismos filtros, mismo
 * buscador: `listEduPatientsForCsv` los arma con `patientsWhere`, la misma
 * función. Un CSV que enseñara una fila que la lista esconde sería una
 * fuga de tenant con formato de hoja de cálculo.
 *
 * 🔴 ES UN ENLACE, NO UN `fetch`. La pantalla apunta un `<a>` aquí y el
 * navegador descarga con sus propias cookies. Un `fetch` habría exigido
 * meter el archivo entero en memoria del navegador para volver a
 * escupirlo como Blob, y con 5 000 filas eso se nota.
 *
 * ⚠️ Techo de 5 000 filas. Cuando muerde, el archivo sale igual y lo DICE
 * en la cabecera `X-Edu-Truncado` y en una última fila del propio CSV: un
 * archivo incompleto que parece completo es peor que no tenerlo, porque
 * alguien cuenta pacientes con él.
 *
 * ⚠️ NO lleva antecedentes, hábitos, embarazo ni NOM-004, y no es un
 * olvido: un CSV se manda por correo y se queda abierto en un escritorio.
 * Lo que sale es el padrón administrativo —lo que hace falta para llamar,
 * cobrar y contar—, no la historia clínica.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const now = new Date();
    const { rows, truncated } = await listEduPatientsForCsv(
      g.ctx,
      parseEduPatientFilters(params),
      now,
    );

    let csv = eduPatientsCsv(rows);
    if (truncated) {
      // La advertencia va DENTRO del archivo además de en la cabecera:
      // quien lo abre en Excel no ve cabeceras HTTP. Y va con TODAS las
      // columnas rellenas de vacío, no como una celda suelta: una fila de
      // una columna en una hoja de 26 sale descuadrada y se lee como un
      // archivo roto en vez de como un aviso.
      const aviso = [
        `Se exportaron las primeras ${EDU_PATIENT_CSV_MAX_ROWS} filas. Afina los filtros para llevarte el resto.`,
        ...Array<string>(EDU_PATIENT_CSV_HEADERS.length - 1).fill(""),
      ];
      csv += `${aviso.map(eduCsvCell).join(",")}\r\n`;
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${eduPatientsCsvFileName(now)}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "X-Edu-Truncado": truncated ? "1" : "0",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/exportar");
  }
}
