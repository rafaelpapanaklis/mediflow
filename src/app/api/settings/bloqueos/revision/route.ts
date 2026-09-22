import { NextResponse, type NextRequest } from "next/server";
import {
  contextoDeBloqueos,
  cuerpoJson,
  respuestaDeError,
} from "@/lib/agenda-bloqueos/ruta.server";
import { revisarChoque } from "@/lib/agenda-bloqueos/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/settings/bloqueos/revision → EL MISMO CHEQUEO, SIN CREAR NADA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE UNA RUTA SOLO PARA MIRAR
 *
 * Sin ella, el aviso de «aquí hay 3 citas que mover» sale al pulsar Guardar:
 * después de elegir las fechas, escribir el motivo y decidirse. Con ella sale
 * MIENTRAS se eligen las fechas, que es cuando todavía se puede cambiar de
 * idea sin haber hecho nada. Es el mismo cuerpo que el POST y la misma
 * respuesta; lo único que cambia es que aquí no se escribe.
 *
 * Toma `agenda.bloqueos` como el POST a propósito: la lista lleva nombres de
 * pacientes y de doctores, así que no la puede pedir quien no podría crear el
 * bloqueo de todos modos.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(req: NextRequest) {
  const r = await contextoDeBloqueos();
  if (r instanceof NextResponse) return r;

  const body = await cuerpoJson(req);
  try {
    const choque = await revisarChoque(r.ctx, body);
    // `hayChoque: false` y no un 204: la pantalla necesita una respuesta que
    // pueda pintar como «adelante», y un cuerpo vacío se confunde con un
    // fallo de red.
    if (!choque) return NextResponse.json({ hayChoque: false, citas: [], total: 0 });
    return NextResponse.json({ hayChoque: true, ...choque });
  } catch (err) {
    return respuestaDeError(err);
  }
}
