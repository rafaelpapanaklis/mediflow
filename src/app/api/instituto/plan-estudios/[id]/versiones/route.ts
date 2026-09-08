import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import {
  createEduRequisitoVersion,
  listEduRequisitoVersiones,
} from "@/lib/edu/requisitos-version";

export const dynamic = "force-dynamic";

/**
 * LAS VERSIONES DE UN REQUISITO DEL PLAN DE ESTUDIOS (H-89).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CIERRA: «subir el mínimo de 8 a 12 en marzo y TODA la escuela
 * —incluida la que se gradúa en junio— pasa de "Cumplido 8 de 8" a "Te
 * faltan 4 de 12", sin explicación y sin fecha».
 *
 * 🔴 LA FILA VIVA DEL REQUISITO NO SE TOCA: sigue siendo LA VIGENTE y
 * todo el código de evaluación la lee igual. Esto añade el LIBRO de
 * versiones; medir a cada alumno contra la de SU generación es la Ola C·2
 * (`eduRequisitoEfectivo`, en requisitos-version-core.ts).
 *
 * 🔴 PERMISO: `requisitos.manage`, la misma que ya administra el plan de
 * estudios. Ninguna key nueva.
 *
 * ⚠️ La ruta cuelga de `/api/instituto/plan-estudios/[id]/versiones` y no
 * de `/api/instituto/requisitos/[id]/...` a propósito: los requisitos son
 * de otra casilla de esta ola y esto no toca ni uno de sus archivos. El
 * `[id]` de aquí ES el del requisito.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET — las versiones, más recientes primero, y cuál rige hoy. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("requisitos.manage");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json(await listEduRequisitoVersiones(g.ctx, params.id));
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/plan-estudios/${params.id}/versiones`);
  }
}

/**
 * POST — CONGELA una versión.
 *
 * La respuesta trae `duele: true` cuando el cambio le quita avance a todo
 * el mundo de golpe (el mínimo SUBE, o se pasa a "solo completados"). NO
 * bloquea —subir el mínimo es una decisión legítima de la escuela— pero la
 * pantalla lo puede poner delante antes de guardar, que es lo que H-89
 * echaba en falta.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("requisitos.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await createEduRequisitoVersion(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/plan-estudios/${params.id}/versiones`);
  }
}
