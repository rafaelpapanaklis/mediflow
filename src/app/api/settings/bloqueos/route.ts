import { NextResponse, type NextRequest } from "next/server";
import {
  contextoDeBloqueos,
  cuerpoJson,
  extractAuditMeta,
  respuestaDeError,
} from "@/lib/agenda-bloqueos/ruta.server";
import { crearBloqueo, listarBloqueos } from "@/lib/agenda-bloqueos/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/bloqueos?desde=&hasta=  → la lista del rango.
 *
 * `desde` y `hasta` son INSTANTES ISO y el filtro es por SOLAPE: un puente que
 * arranca antes del `desde` y termina dentro tiene que salir. El DOCTOR recibe
 * solo los suyos y los de toda la clínica (ver `listarBloqueos`).
 *
 * Lo abre cualquiera con `agenda.view`: quien ve la rejilla tiene que poder
 * leer POR QUÉ un hueco está cerrado.
 */
export async function GET(req: NextRequest) {
  const r = await contextoDeBloqueos({ soloLectura: true });
  if (r instanceof NextResponse) return r;

  const sp = req.nextUrl.searchParams;
  try {
    const bloqueos = await listarBloqueos(r.ctx, {
      desde: sp.get("desde"),
      hasta: sp.get("hasta"),
    });
    return NextResponse.json(
      { bloqueos, timezone: r.ctx.timezone },
      { headers: { "Cache-Control": "no-store, must-revalidate" } },
    );
  } catch (err) {
    return respuestaDeError(err);
  }
}

/**
 * POST /api/settings/bloqueos → crea uno.
 *
 * 🔴 409 CON LA LISTA, no un texto suelto. Si dentro del rango hay citas
 * vivas, el bloqueo NO se crea y el cuerpo trae `{ error:
 * "CITAS_EN_EL_RANGO", citas: [...], total }` para que la pantalla pueda
 * pintarlas una a una y ofrecer moverlas. Un mensaje de texto obligaría a
 * recepción a buscarlas a mano en la agenda.
 */
export async function POST(req: NextRequest) {
  const r = await contextoDeBloqueos();
  if (r instanceof NextResponse) return r;

  const body = await cuerpoJson(req);
  try {
    const res = await crearBloqueo(r.ctx, body, extractAuditMeta(req));
    if (!res.ok && res.choque) return NextResponse.json(res.choque, { status: 409 });
    return NextResponse.json({ bloqueo: res.bloqueo }, { status: 201 });
  } catch (err) {
    return respuestaDeError(err);
  }
}
