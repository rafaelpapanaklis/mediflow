import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduCleanId, parseEduCaseStatus } from "@/lib/edu/agenda-core";
import { createEduCase, listEduCases } from "@/lib/edu/casos";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/casos — los casos que le tocan a quien pregunta.
 *
 * 🔴 CAJA NO VE CASOS aunque alguien le encienda "casos.view" por error: el
 * helper de visibilidad le devuelve alcance "none" para este recurso, así
 * que la respuesta sale vacía. Es la línea del contrato ("caja: sin
 * expediente clínico"), cerrada en dos sitios en vez de uno.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("casos.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const page = await listEduCases(g.ctx, {
      status: parseEduCaseStatus(url.searchParams.get("estado")),
      programId: eduCleanId(url.searchParams.get("programa")),
      studentId: eduCleanId(url.searchParams.get("alumno")),
      patientId: eduCleanId(url.searchParams.get("paciente")),
      onlyOpen: url.searchParams.get("abiertos") === "1",
    });
    return NextResponse.json({ rows: page.rows, truncated: page.truncated });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/casos");
  }
}

/**
 * POST /api/instituto/casos — abre un caso.
 *
 * Exige "casos.assign": repartir pacientes entre alumnos es la decisión
 * académica de la ola. El supervisor se rellena solo con el titular
 * VIGENTE del alumno si no viene en el body.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("casos.assign");
  if ("response" in g) return g.response;

  try {
    const created = await createEduCase(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/casos");
  }
}
