import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { bajaEduPatient, previsualizarEduArco, reactivarEduPatient } from "@/lib/edu/arco";

export const dynamic = "force-dynamic";

/**
 * ARCO (LFPDPPP) sobre la ficha de un paciente: la BAJA lógica y su vuelta.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DOS LLAVES, Y LA SEGUNDA LA COMPRUEBA LA CAPA DE DATOS.
 *
 * El `eduApiGuard` abre con `pacientes.view` —lo mínimo para tocar una
 * ficha— y `eduArcoAsegurarPermiso` (dentro de src/lib/edu/arco.ts) exige
 * ADEMÁS `pacientes.manage` **y** `direccion.panel`. Está ahí y no aquí a
 * propósito: son tres rutas ARCO y la comprobación que vive en una sola
 * de ellas es la que falta en la cuarta.
 *
 * `pacientes.manage` lo lleva CAJA por defecto, y dar de baja el
 * expediente de una persona no es una decisión de mostrador; con las dos
 * keys, solo DIRECCION lo tiene. Ninguna key nueva: una key nueva NO le
 * llega a nadie con `permissionsOverride` guardado (el override REEMPLAZA
 * al default) y habría exigido backfill en SQL contra cada escuela.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 institutionId de getEduContext(), JAMÁS del cuerpo ni del query.
 */

/** GET — qué pasaría si se anonimiza: qué se sustituye y qué se conserva. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json(await previsualizarEduArco(g.ctx, params.id));
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/pacientes/${params.id}/arco`);
  }
}

/** POST — DA DE BAJA la ficha, con motivo obligatorio. Baja lógica. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await bajaEduPatient(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/pacientes/${params.id}/arco`);
  }
}

/**
 * PATCH — DESHACE la baja.
 *
 * No hay DELETE en esta ruta, y no es un olvido: aquí no se borra nada
 * nunca. Deshacer una baja es un PATCH porque es exactamente eso —
 * cambiarle una columna a una fila que sigue viva.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;
  try {
    const r = await reactivarEduPatient(g.ctx, params.id, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `PATCH /api/instituto/pacientes/${params.id}/arco`);
  }
}
