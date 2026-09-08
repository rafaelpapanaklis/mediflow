import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { assertEduPermission } from "@/lib/edu/permissions";
import { EduPadronError } from "@/lib/edu/padron";
import { eduParseCampusIds } from "@/lib/edu/campus";
import { eduImportCrear } from "@/lib/edu/importar";
import { eduImportEsEntidad, type EduImportEntidad } from "@/lib/edu/importar-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/padron/importar/confirmar — CREA un trozo de la
 * importación.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ VA POR JSON Y NO CON EL ARCHIVO OTRA VEZ. La pantalla ya
 * subió el archivo en el paso de simular y tiene los renglones leídos: 
 * volver a mandarlo por cada trozo sería subir cinco megas veinte veces, y
 * peor, sería volver a interpretarlo — y si el mapeo se resolviera distinto
 * la segunda vez, lo que se crea no sería lo que se enseñó.
 *
 * 🔴 Y AUN ASÍ EL SERVIDOR NO SE FÍA. `eduImportCrear` vuelve a validar
 * cada renglón y vuelve a preguntarle a la base qué correos y qué
 * matrículas están tomados AHORA: entre la simulación y este clic caben
 * otra pestaña y otra persona de dirección llevándose esa matrícula.
 *
 * 🔴 POR TROZOS de 25. Cada renglón es una llamada a Supabase Auth de unos
 * cientos de milisegundos; doscientos en una sola petición se comerían el
 * tiempo máximo de la función a mitad de la generación, dejando media
 * creada y ninguna contraseña en pantalla.
 *
 * Cuerpo:
 *   · `entidad`     "alumnos" | "docentes"
 *   · `filas`       hasta 25 renglones ya leídos
 *   · `programId`, `cohortId`   (obligatorios para alumnos)
 *   · `campusIds`   H-112 · las sedes; `[]` o ausente = TODAS
 *   · `semestre`    el semestre por defecto que se eligió en la pantalla
 *   · `archivo`     el nombre del archivo, solo para la bitácora
 *
 * 🔴 LOS DOS PERMISOS, otra vez. Un endpoint no se protege porque el
 * anterior lo hiciera.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);

    if (!eduImportEsEntidad(body.entidad)) {
      throw new EduPadronError("Di qué estás importando: estudiantes o docentes.");
    }
    const entidad: EduImportEntidad = body.entidad;
    if (entidad === "alumnos") assertEduPermission(g.ctx, "padron.manage");

    // Las sedes, validadas UNA vez contra este instituto. Vacío = todas.
    const campusIds = await eduParseCampusIds(g.ctx, body.campusIds);

    const semestre =
      body.semestre === undefined || body.semestre === null || body.semestre === ""
        ? undefined
        : Number(body.semestre);

    const resultados = await eduImportCrear(g.ctx, {
      entidad,
      filas: body.filas,
      institutionName: g.ctx.institution.name,
      programId: body.programId,
      cohortId: body.cohortId,
      campusIds,
      semestrePorDefecto: Number.isFinite(semestre) ? (semestre as number) : undefined,
      archivo: typeof body.archivo === "string" ? body.archivo : "",
    });

    const creadas = resultados.filter((r) => r.ok).length;
    // 200 y no 201 aunque haya creaciones: en una importación lo normal es
    // que unas pasen y otras no, y un 201 diría que se creó "el recurso",
    // que aquí no es uno.
    return NextResponse.json({ resultados, creadas, total: resultados.length });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/padron/importar/confirmar");
  }
}
