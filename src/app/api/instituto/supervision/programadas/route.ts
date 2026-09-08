import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import {
  listEduRotacionesProgramadas,
  programarEduRotacion,
} from "@/lib/edu/docente";

export const dynamic = "force-dynamic";

/**
 * LA ROTACIÓN DOCENTE PROGRAMADA (Ola C·2).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ AÑADE SOBRE /api/instituto/supervision
 *
 * Aquélla asigna un docente AHORA y cierra al titular en el mismo acto.
 * Ésta programa el relevo para una fecha FUTURA, que es como se decide en
 * una escuela: en junta, para que arranque el lunes. Hacerlo el lunes a
 * mano es como se llega a un alumno sin docente durante tres días.
 *
 * 🔴 CERO SQL: la columna `startsAt` existe desde la Ola 1A y el predicado
 * de vigencia (`eduCurrentAssignmentWhere`) ya filtra `startsAt <= now` en
 * las tres lecturas del vertical. Lo que faltaba era poder escribir una
 * fecha futura y poder VER lo programado antes de que llegue.
 *
 * 🔴 PERMISOS, y son dos distintos a propósito:
 *   · GET  → `docentes.view`. Es la misma pantalla que ya enseña quién
 *     lleva a quién, y lo programado es parte de esa respuesta: un docente
 *     tiene derecho a saber que el lunes le entra un alumno. El ALCANCE lo
 *     recorta igual que el padrón (un docente ve lo de SUS alumnos).
 *   · POST → `supervision.assign`. Repartir alumnos es administrar la
 *     escuela, y programarlo no lo es menos.
 * Ninguna key nueva.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET — lo programado y todavía no arrancado, lo más cercano primero. */
export async function GET() {
  const g = await eduApiGuard("docentes.view");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json({ rows: await listEduRotacionesProgramadas(g.ctx) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/supervision/programadas");
  }
}

/**
 * POST — programa una rotación.
 *
 * ⚠️ NO cierra al titular de hoy, y eso está escrito con su porqué en
 * `programarEduRotacion` (src/lib/edu/docente.ts): cerrarlo ahora dejaría
 * al alumno sin docente hasta que el relevo entre.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("supervision.assign");
  if ("response" in g) return g.response;
  try {
    const r = await programarEduRotacion(
      g.ctx,
      await eduReadJson(request),
      eduAuditRequestMeta(request),
    );
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/supervision/programadas");
  }
}
