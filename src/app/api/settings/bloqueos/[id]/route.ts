import { NextResponse, type NextRequest } from "next/server";
import {
  contextoDeBloqueos,
  cuerpoJson,
  extractAuditMeta,
  respuestaDeError,
} from "@/lib/agenda-bloqueos/ruta.server";
import { editarBloqueo, retirarBloqueo } from "@/lib/agenda-bloqueos/service";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/settings/bloqueos/[id] → edita el motivo, el tipo y/o el rango.
 *
 * 🔴 REVALIDA EL 409. Estirar un bloqueo del 24 al 26 tiene que chocar con la
 * limpieza del 25 igual que si se creara de cero; si no, el candado de la
 * creación tendría la puerta de atrás abierta.
 *
 * El ALCANCE (`doctorId`) no se edita: para cambiarlo se retira y se pone uno
 * nuevo, que vuelve a pasar por el choque. Ver `editarBloqueo`.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await contextoDeBloqueos();
  if (r instanceof NextResponse) return r;

  const body = await cuerpoJson(req);
  try {
    const res = await editarBloqueo(r.ctx, params.id, body, extractAuditMeta(req));
    if (!res.ok && res.choque) return NextResponse.json(res.choque, { status: 409 });
    return NextResponse.json({ bloqueo: res.bloqueo });
  } catch (err) {
    return respuestaDeError(err);
  }
}

/**
 * DELETE /api/settings/bloqueos/[id] → lo retira (baja LÓGICA).
 *
 * La fila se queda con su `deletedAt`: un bloqueo que existió explica por qué
 * esa tarde no hubo nadie en la clínica. Un DOCTOR retira los suyos; los de
 * toda la clínica, solo la administración.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await contextoDeBloqueos();
  if (r instanceof NextResponse) return r;

  try {
    const res = await retirarBloqueo(r.ctx, params.id, extractAuditMeta(req));
    return NextResponse.json({ ok: true, id: res.id });
  } catch (err) {
    return respuestaDeError(err);
  }
}
