import { NextResponse, type NextRequest } from "next/server";
import { acquireLock, persistentRateLimit, releaseLock } from "@/lib/failban";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduFormatBytes } from "@/lib/edu/estudios-core";
import {
  buildEduStudyLite,
  eduLiteYaGenerado,
  getEduStudyForViewer,
} from "@/lib/edu/estudios";
import {
  CBCT_LITE_HI_SUFFIX,
  CBCT_LITE_SUFFIX,
} from "@/components/patient-3d/cbct-lite-shared";
import { MAX_CBCT_LITE_BYTES } from "@/lib/uploads/patient-study-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Descomprimir + decodificar + reducir un CBCT grande tarda; damos margen.
export const maxDuration = 300;

/**
 * POST /api/instituto/estudios/[id]/lite — el CBCT REDUCIDO del estudio.
 *
 * Un CBCT pesa 300-600 MB y eso no cabe en la RAM de un teléfono. El
 * SERVIDOR lo descomprime, lo decodifica y lo reduce UNA vez, y guarda el
 * binario hermano `<path>.lite2.bin` (~10-25 MB) al lado del original en el
 * bucket del vertical. La primera apertura en móvil lo genera; las
 * siguientes lo reusan.
 *
 * Es la GEMELA de /api/patients/[id]/dicom-set/[fileId]/lite del dental, y
 * existe porque aquella resuelve contra `PatientFile` con la sesión del
 * dental: con un id del instituto contesta 404. La MATEMÁTICA no se copia —
 * `buildCbctLite` (src/lib/cbct-lite.ts) se importa tal cual.
 *
 * 🔴 TENANT. El estudio se busca con `getEduStudyForViewer`, que resuelve
 * con el institutionId de la SESIÓN y pasa el paciente por el alcance
 * clínico (src/lib/edu/visibility.ts). Un estudio de otra escuela —o de un
 * paciente que a este rol no le toca— es un 404, igual que uno inventado.
 *
 * ⚠️ Esta ruta necesita memoria de sobra en producción. El dental la tiene
 * declarada en vercel.json; la del instituto hay que añadirla ahí igual
 * (queda anotado en ORQUESTA.md — vercel.json no es un archivo del
 * vertical y el guardia no deja tocarlo).
 */

// Los tres frenos de abajo son de COSTE, no de seguridad: el aislamiento
// por instituto ya lo da el findFirst con el institutionId de la sesión.
// Solo cuentan GENERACIONES (van después del hit de caché), para que abrir
// estudios ya preparados nunca choque con ellos.
const LITE_RATE_LIMIT = { limit: 10, windowSec: 3600 };
// Un pelo por encima de maxDuration: si la función muere sin soltar el
// candado, expira solo y el estudio se puede reintentar.
const LITE_LOCK_TTL_SEC = 330;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.view");
  if ("response" in g) return g.response;

  try {
    const estudio = await getEduStudyForViewer(g.ctx, params.id);
    if (!estudio) {
      return NextResponse.json({ error: "Ese estudio no existe o no te toca." }, { status: 404 });
    }

    // Solo sets CBCT (.zip). Un DICOM suelto o una malla no tienen versión
    // reducida que generar.
    if (!/\.zip$/i.test(estudio.storagePath)) {
      return NextResponse.json(
        { error: "El archivo no es un set CBCT (.zip)" },
        { status: 400 },
      );
    }

    // Techo de tamaño: generar el reducido descomprime el .zip ENTERO en
    // memoria. Sin este freno, un CBCT gigante mata la función por OOM y el
    // visor se queda con un error mudo. `detail` es justo lo que el visor
    // pinta en pantalla en vez de su texto por defecto.
    if (estudio.sizeBytes > MAX_CBCT_LITE_BYTES) {
      return NextResponse.json(
        {
          error: "Estudio demasiado grande para la vista móvil",
          detail: `Esta tomografía pesa ${eduFormatBytes(estudio.sizeBytes)} y la versión para móvil solo se puede preparar hasta ${eduFormatBytes(MAX_CBCT_LITE_BYTES)}. Ábrela desde una computadora o descárgala para verla en tu visor DICOM.`,
          tooLarge: true,
        },
        { status: 413 },
      );
    }

    // ?res=hi → variante de alta resolución (384²). Por defecto, 256².
    const hi = req.nextUrl.searchParams.get("res") === "hi";
    const litePath = `${estudio.storagePath}${hi ? CBCT_LITE_HI_SUFFIX : CBCT_LITE_SUFFIX}`;

    // 1) ¿Ya está hecho? Se devuelve firmado sin volver a pagarlo.
    const yaHecho = await eduLiteYaGenerado(litePath);
    if (yaHecho) return NextResponse.json({ liteUrl: yaHecho, cached: true });

    // 2) A partir de aquí SÍ se paga la generación. Freno por INSTITUTO (no
    //    por IP: la escuela entera sale por la misma). `scope` fijo porque
    //    el pathname lleva el id del estudio — sin él el límite sería "10
    //    por estudio", que no frena nada.
    const rl = await persistentRateLimit(req, {
      id: `edu-cbct:${g.ctx.institutionId}`,
      scope: "edu-cbct-lite",
      ...LITE_RATE_LIMIT,
    });
    if (rl) {
      // El 429 genérico no trae `detail`, y `detail` es lo ÚNICO que el
      // visor sabe mostrar: sin él cae en su texto por defecto y le dice a
      // la persona que el estudio "es muy grande para el teléfono", que es
      // falso y encima la manda a buscar una computadora que no necesita.
      const retry = rl.headers.get("Retry-After");
      const mins = Math.max(1, Math.ceil(Number(retry || LITE_RATE_LIMIT.windowSec) / 60));
      return NextResponse.json(
        {
          error: "Demasiadas preparaciones seguidas",
          detail: `El instituto ya preparó ${LITE_RATE_LIMIT.limit} tomografías para móvil en la última hora. Vuelve a intentarlo en unos ${mins} min, o ábrela desde una computadora mientras tanto.`,
          rateLimited: true,
        },
        { status: 429, headers: retry ? { "Retry-After": retry } : undefined },
      );
    }

    // 3) Candado por estudio: dos teléfonos a la vez sobre el mismo
    //    `litePath` generaban el MISMO binario dos veces. El segundo se va
    //    con 409 y reintenta.
    const lockKey = `edu-cbct-lite:${litePath}`;
    if (!(await acquireLock(lockKey, LITE_LOCK_TTL_SEC))) {
      return NextResponse.json(
        {
          error: "Preparación en curso",
          detail: "Esta tomografía ya se está preparando para móvil. Vuelve a intentarlo en un momento.",
          generating: true,
        },
        { status: 409, headers: { "Retry-After": "30" } },
      );
    }

    try {
      const out = await buildEduStudyLite(estudio, litePath, hi ? 384 : 256);
      return NextResponse.json(out);
    } catch (e) {
      // `buildCbctLite` lanza con el motivo real ("El .zip no contiene
      // cortes DICOM legibles"). Ese motivo vale más que un 500 mudo: es lo
      // que el visor enseña, y le dice a la persona qué subió mal.
      const detail = (e as Error)?.message ?? String(e);
      console.error("[instituto/estudios/lite] no se pudo generar:", detail);
      return NextResponse.json(
        { error: "No se pudo preparar la versión ligera del estudio", detail },
        { status: 500 },
      );
    } finally {
      // Soltar SIEMPRE: si no, el estudio queda bloqueado hasta que expire
      // el TTL aunque la generación fallara.
      await releaseLock(lockKey);
    }
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/estudios/[id]/lite");
  }
}
