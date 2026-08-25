import { NextResponse } from "next/server";
import { setRealtyPropertyStatus } from "@/lib/realty/properties";
import { enumParam, gateRealty, notFound, readJson, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

const STATUSES = ["DISPONIBLE", "APARTADO", "VENDIDO", "RENTADO"] as const;

/**
 * PATCH — cambiar el estatus comercial desde el listado, sin abrir la ficha.
 *
 * Es la acción rápida más usada: el asesor cuelga el teléfono y marca
 * "Apartado". Va en su propia ruta y no dentro del PATCH por secciones
 * porque el listado no debe tener que saber a qué sección pertenece el
 * campo.
 *
 * OJO: estatus ≠ publicación. Marcar VENDIDO no despublica el inmueble (eso
 * es el interruptor de la web) y despublicar no lo vuelve vendido.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const status = enumParam(body.status, STATUSES);
    if (!status) {
      return NextResponse.json({ error: "Ese estado no existe." }, { status: 400 });
    }
    const ok = await setRealtyPropertyStatus(gate.ctx, params.id, status);
    if (!ok) return notFound();
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return realtyApiError("properties/[id]/status:PATCH", e);
  }
}
