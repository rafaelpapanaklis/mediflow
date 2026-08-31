import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduCampus, listEduCampuses } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/sedes — las sedes del instituto, con sus números.
 *
 * ⚠️ NO se recorta por el acceso de quien pregunta, y es deliberado: quien
 * tiene `sedes.view` está administrando la geografía de la escuela y
 * necesita ver el mapa completo — incluidas las sedes a las que él mismo no
 * entra. Lo que el acceso recorta son los DATOS de cada sede (su agenda, su
 * caja), no su existencia.
 */
export async function GET() {
  const g = await eduApiGuard("sedes.view");
  if ("response" in g) return g.response;

  try {
    return NextResponse.json({ rows: await listEduCampuses(g.ctx) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/sedes");
  }
}

/**
 * POST /api/instituto/sedes — da de alta una sede.
 *
 * 🔴 La zona horaria es DE LA SEDE. Por defecto se copia la del instituto
 * (el caso normal), pero una universidad con campus en Tijuana y en Mérida
 * la cambia aquí: la agenda de cada sede se pinta y se guarda con la suya.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("sedes.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduCampus(g.ctx, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/sedes");
  }
}
