import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { assertEduPermission } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";
import { eduImportCamposDe, eduImportSimular } from "@/lib/edu/importar";
import {
  eduImportEsEntidad,
  eduImportResumen,
  type EduImportEntidad,
} from "@/lib/edu/importar-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/padron/importar — SIMULA una importación de padrón.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTE ENDPOINT NO ESCRIBE NADA. Lee el archivo, propone qué columna es
 * qué, y contesta renglón por renglón qué se crearía y qué chocaría. Crear
 * es el OTRO endpoint (`importar/confirmar`), y esa separación no es
 * ceremonia: aquí cada renglón bueno se convierte en una cuenta de acceso
 * con su contraseña, y las cuentas de este producto NO se borran. Un
 * archivo con una columna de más crearía doscientas cuentas mal y no
 * habría vuelta atrás.
 *
 * Recibe `multipart/form-data` —no JSON— porque lleva el archivo:
 *   · `file`       (.xlsx o .csv, máx. 5 MB, máx. 1 000 renglones)
 *   · `entidad`    "alumnos" | "docentes"
 *   · `mapeo`      JSON opcional: encabezado → campo, cuando quien importa
 *                  corrige a mano lo que se detectó solo.
 *   · `semestre`   opcional, para los alumnos cuyo renglón no lo traiga.
 *
 * 🔴 DOS PERMISOS, Y HACEN FALTA LOS DOS. `equipo.manage` porque esto crea
 * CUENTAS de acceso, y `padron.manage` —solo para alumnos— porque además
 * los INSCRIBE en una generación. Son las dos llaves que abriría quien
 * hiciera el trabajo a mano, una por una, y esta pantalla no puede ser un
 * atajo para saltarse ninguna. No se inventó una key nueva de importación:
 * una key nueva NO le llega a nadie que ya tenga `permissionsOverride`
 * guardado —el override REEMPLAZA al default— así que habría exigido
 * backfill en SQL contra la base de cada escuela para servir de algo.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new EduPadronError("No llegó el archivo. Vuelve a subirlo.");
    }

    const entidadCruda = form.get("entidad");
    if (!eduImportEsEntidad(entidadCruda)) {
      throw new EduPadronError("Di qué estás importando: estudiantes o docentes.");
    }
    const entidad: EduImportEntidad = entidadCruda;

    // Inscribir en una generación es padrón, no equipo. Se exige AQUÍ y no
    // solo al confirmar: enseñarle la simulación de un padrón a quien no
    // puede tocarlo ya sería enseñarle nombres y correos que no le tocan.
    if (entidad === "alumnos") assertEduPermission(g.ctx, "padron.manage");

    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new EduPadronError("Elige un archivo .xlsx o .csv.");
    }

    let mapeo: unknown = null;
    const mapeoCrudo = form.get("mapeo");
    if (typeof mapeoCrudo === "string" && mapeoCrudo.trim()) {
      try {
        mapeo = JSON.parse(mapeoCrudo);
      } catch {
        // Un mapeo ilegible NO tumba la subida: se cae a la autodetección,
        // que es lo que hay que enseñar de todos modos en el primer paso.
        mapeo = null;
      }
    }

    const semestreCrudo = form.get("semestre");
    const semestrePorDefecto =
      typeof semestreCrudo === "string" && semestreCrudo.trim()
        ? Number(semestreCrudo.trim())
        : undefined;

    const simulacion = await eduImportSimular(g.ctx, {
      entidad,
      file: file as File,
      mapeo,
      semestrePorDefecto:
        Number.isFinite(semestrePorDefecto) ? (semestrePorDefecto as number) : undefined,
    });

    return NextResponse.json({
      ...simulacion,
      campos: eduImportCamposDe(entidad),
      resumen: eduImportResumen(simulacion.filas),
    });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/padron/importar");
  }
}
