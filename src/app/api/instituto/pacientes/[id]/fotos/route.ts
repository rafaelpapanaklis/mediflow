import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { listEduPatientPhotos } from "@/lib/edu/fotos";

// 🔴 nodejs y no edge: el listado firma URL con la llave de service role.
export const runtime = "nodejs";
// La respuesta lleva URL FIRMADAS que caducan: cachearla serviría enlaces
// muertos.
export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/pacientes/[id]/fotos — las FOTOS CLÍNICAS del
 * paciente, cada una con su URL firmada y la de su miniatura, recién
 * generadas.
 *
 * Filtros opcionales por query: `etapa` (PRE|DURANTE|POST|CONTROL) y
 * `vista` (la vista de la foto). Un valor que no está en el enum se
 * IGNORA en vez de devolver cero filas: una píldora rota en la pantalla no
 * puede hacerle creer a nadie que el paciente no tiene fotos.
 *
 * 🔴 CAJA NO VE FOTOS. Igual que el odontograma y los estudios: la tabla
 * cuelga del paciente, la lectura va con el alcance del recurso "cases".
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.view");
  if ("response" in g) return g.response;

  try {
    const paciente = await getEduClinicalPatient(g.ctx, params.id);
    if (!paciente) {
      return NextResponse.json(
        { error: "Ese paciente no existe o su expediente no te toca." },
        { status: 404 },
      );
    }
    const url = new URL(request.url);
    const page = await listEduPatientPhotos(
      g.ctx,
      paciente.id,
      g.ctx.institution.timezone,
      { stage: url.searchParams.get("etapa"), photoType: url.searchParams.get("vista") },
    );
    // 🔴 `truncated` viaja en la respuesta y no solo en la pantalla: quien
    // consuma este endpoint sin pasar por el panel tiene que poder saber
    // que la galería salió cortada.
    return NextResponse.json({ rows: page.rows, truncated: page.truncated });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/pacientes/[id]/fotos");
  }
}

/**
 * 🔴 N-2 · AQUÍ YA NO HAY POST, Y ESO ES EL ARREGLO.
 *
 * La foto se subía por este handler con `request.formData()`. El
 * `bodySizeLimit: "30mb"` de `next.config.mjs` **solo vale para server
 * actions**: el cuerpo de un route handler lo corta la plataforma muy por
 * debajo (~4.5 MB), así que la pantalla prometía 25 MB por una tubería que
 * en producción no los aguanta — 413, cuerpo no-JSON y un «No se pudo
 * subir la foto (HTTP 413)» que se repetía igual en cada reintento.
 *
 * Ahora la subida son los MISMOS TRES PASOS que los estudios de 2 GB:
 *   POST ./fotos/sign     → valida, comprueba la cuota y firma
 *   PUT  <signedUrl>      → el binario va del navegador AL BUCKET
 *   POST ./fotos/confirm  → mide, comprueba el número mágico y registra
 *   POST ./fotos/abort    → limpia lo que se subió y no se confirmó
 *
 * No se deja aquí una segunda puerta «por compatibilidad»: una tubería que
 * se cae por encima de 4.5 MB no es un plan B, es el fallo original
 * esperando a que alguien la vuelva a llamar.
 */
