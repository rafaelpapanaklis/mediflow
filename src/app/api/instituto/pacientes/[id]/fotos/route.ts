import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { listEduPatientPhotos, uploadEduPatientPhoto } from "@/lib/edu/fotos";
import { EDU_MAX_PHOTO_BYTES, EDU_MAX_PHOTO_LABEL } from "@/lib/edu/fotos-core";
import { EduPadronError } from "@/lib/edu/padron";

// 🔴 nodejs y no edge: la subida lee el binario y lo comprime con sharp,
// que es un módulo nativo. En el runtime edge ni siquiera carga.
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
 * POST /api/instituto/pacientes/[id]/fotos — SUBE una foto clínica.
 *
 * multipart/form-data:
 *   file        (obligatorio) · el binario
 *   etapa       PRE | DURANTE | POST | CONTROL     (default PRE)
 *   vista       la vista de la foto                (default OTRA)
 *   capturedAt  ISO, la fecha de TOMA              (default: ahora)
 *   caseId      opcional, dentro del alcance
 *   notas       opcional
 *
 * 🔴 EL BINARIO SÍ PASA POR AQUÍ, al revés que los estudios, y ésa es toda
 * la diferencia: 25 MB de tope, MIME comprobado por NÚMERO MÁGICO (no por
 * lo que declare el navegador), compresión a 2 400 px JPEG q85 y miniatura
 * de 300 px WebP q80. Un estudio no puede hacer nada de eso porque sube
 * directo al bucket para admitir tomografías de 2 GB.
 *
 * El orden de las comprobaciones vive en src/lib/edu/fotos.ts, no aquí:
 * este handler solo lee el multipart y traduce errores a respuestas.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.upload");
  if ("response" in g) return g.response;

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      // Un cuerpo que no es multipart, o que se cortó a la mitad. 400 con
      // palabras y no un 500: quien sube tiene al paciente en el sillón.
      throw new EduPadronError(
        `No se pudo leer el archivo. Vuelve a elegirlo; el máximo por foto es ${EDU_MAX_PHOTO_LABEL}.`,
        400,
      );
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new EduPadronError("Falta la foto.", 400);
    }
    // El tope se comprueba ANTES de leer el arrayBuffer: cargar 500 MB en
    // memoria para después decir que no caben es la forma más cara de
    // rechazar algo.
    if (file.size > EDU_MAX_PHOTO_BYTES) {
      throw new EduPadronError(
        `Esa foto pesa más de lo permitido. El máximo por foto es ${EDU_MAX_PHOTO_LABEL}.`,
        413,
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const creada = await uploadEduPatientPhoto(g.ctx, params.id, {
      bytes,
      mime: file.type,
      fileName: (file as File).name,
      stage: form.get("etapa"),
      photoType: form.get("vista"),
      capturedAt: form.get("capturedAt"),
      caseId: form.get("caseId"),
      notes: form.get("notas"),
    });
    return NextResponse.json(creada, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/pacientes/[id]/fotos");
  }
}
