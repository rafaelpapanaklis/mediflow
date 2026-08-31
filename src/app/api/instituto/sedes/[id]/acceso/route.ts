import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { listEduCampusPeople, setEduCampusAccess } from "@/lib/edu/campus";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/sedes/[id]/acceso — quién entra a esta sede.
 *
 * Devuelve TODAS las personas del instituto, no solo las que ya tienen
 * fila: la pregunta que trae a alguien aquí es "¿quién entra al campus
 * norte?" y la respuesta útil incluye a los que todavía no.
 *
 * 🔴 SIN FILAS = ENTRA A TODAS LAS SEDES. Por eso cada persona viaja con
 * `campusCount`: es lo único que permite decir la verdad incómoda —quien
 * tiene cero sedes marcadas no está fuera de ninguna, está en todas—, y la
 * pantalla la dice con esas palabras.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("sedes.manage");
  if ("response" in g) return g.response;

  try {
    return NextResponse.json({ rows: await listEduCampusPeople(g.ctx, params.id) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/sedes/[id]/acceso");
  }
}

/**
 * POST /api/instituto/sedes/[id]/acceso — da o quita el acceso de UNA
 * persona a ESTA sede. Body: { userId, allowed }.
 *
 * 🔴 QUITAR LA ÚLTIMA SEDE DE ALGUIEN LE ABRE TODAS. Es la lectura al revés
 * de "sin filas = todas", y sorprende: la respuesta trae `abrioTodas` para
 * que la pantalla lo diga en el momento, en vez de dejar a la dirección
 * creyendo que acaba de cerrarle una puerta cuando se las abrió todas.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("sedes.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await setEduCampusAccess(g.ctx, params.id, body.userId, body.allowed);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/sedes/[id]/acceso");
  }
}
