import { NextResponse } from "next/server";
import { setRealtyPropertyPublished } from "@/lib/realty/properties";
import { gateRealty, notFound, readJson, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH — encender o apagar la publicación en la web.
 *
 * `isPublished` es INDEPENDIENTE del estatus comercial: un inmueble
 * DISPONIBLE que el dueño no quiere anunciado se despublica con esto, sin
 * mentir sobre su estatus. Al encenderlo por primera vez, la capa de datos
 * le asigna slug público si no tenía.
 *
 * Requiere `properties.edit` y no `web.edit`: lo que se decide aquí es si
 * ESTE inmueble sale, no cómo se ve la página — eso es de la ola de mi-web.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    if (!("isPublished" in body)) {
      return NextResponse.json({ error: "Falta el dato." }, { status: 400 });
    }
    const ok = await setRealtyPropertyPublished(gate.ctx, params.id, body.isPublished === true);
    if (!ok) return notFound();
    return NextResponse.json({ ok: true, isPublished: body.isPublished === true });
  } catch (e) {
    return realtyApiError("properties/[id]/publish:PATCH", e);
  }
}
