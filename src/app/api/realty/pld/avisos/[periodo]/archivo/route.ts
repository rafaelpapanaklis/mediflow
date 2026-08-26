// GET /api/realty/pld/avisos/[periodo]/archivo — baja la hoja de
// concentrado del periodo.
//
// 🔴 DESCARGAR NO ES PRESENTAR. Esta ruta NO cambia el estado del periodo.
// El archivo lo sube el cliente en el portal del SAT y luego marca el
// periodo a mano. Si bajar el archivo marcara el aviso, el tablero diría
// "presentado" de operaciones que siguen sin reportarse — que es exactamente
// el error que este módulo existe para evitar.
//
// Sí deja renglón en la bitácora: quién bajó los datos de qué periodo.
import { NextResponse } from "next/server";
import { generarArchivoAviso } from "@/lib/realty/pld/archivo";
import { periodoValido } from "@/lib/realty/pld/avisos";
import { registrarAcceso } from "@/lib/realty/pld/bitacora";
import { cargarOperaciones } from "@/lib/realty/pld/operaciones";
import { getPldParams } from "@/lib/realty/pld/parametros";
import { errorPld, gatePld, malaPeticion } from "../../../_guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { periodo: string } }) {
  // Basta pld.view: bajar el concentrado es una lectura. Marcarlo como
  // presentado —eso sí— pide pld.manage.
  const gate = await gatePld("pld.view");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const periodMonth = periodoValido(params.periodo);
    if (!periodMonth) return malaPeticion("Ese periodo no se entiende. Va como AAAA-MM.");

    const resueltos = await getPldParams();
    if (!resueltos.ok) {
      return NextResponse.json(
        {
          error:
            "No podemos armar el archivo: faltan los umbrales antilavado en el panel de DaleControl " +
            "(Inmobiliarias → Parámetros). Sin ellos no se sabe qué operaciones entran en el aviso.",
          code: "PARAM_MISSING",
          faltantes: resueltos.faltantes,
        },
        { status: 409 },
      );
    }

    const { operaciones } = await cargarOperaciones(ctx, resueltos.params, { periodMonth });
    const archivo = await generarArchivoAviso(ctx, periodMonth, operaciones, resueltos.params);

    await registrarAcceso(ctx, { action: "DESCARGAR_AVISO", subject: periodMonth }, req);

    return new NextResponse(archivo.contenido, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${archivo.nombre}"`,
        // Son datos personales de terceros: ni el navegador ni un proxy
        // deben quedarse con una copia.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    return errorPld("avisos/archivo", e);
  }
}
