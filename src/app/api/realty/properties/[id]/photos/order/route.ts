import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gateRealty, notFound, readJson, realtyApiError } from "../../../_helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH — nuevo orden de la galería.
 *
 * Recibe los ids YA ordenados y reescribe `sortOrder` en una transacción:
 * a medias, la galería quedaría con dos fotos en la misma posición y el
 * orden dependería de cómo desempate Postgres, que no es estable.
 *
 * 🔴 Los ids se recortan contra los que REALMENTE son de este inmueble y de
 * esta cuenta. Un id colado en el arreglo no puede tocar la foto de otro
 * inquilino: sale de la lista y ya.
 *
 * Nota de ruta: este segmento es estático, así que Next lo resuelve ANTES
 * que [photoId] — "order" nunca se toma por el id de una foto.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 200)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No llegó ningún orden." }, { status: 400 });
    }

    const own = await prisma.realtyPropertyPhoto.findMany({
      where: { accountId: ctx.accountId, propertyId: params.id, id: { in: ids } },
      select: { id: true },
    });
    if (own.length === 0) return notFound();

    const allowed = new Set(own.map((p) => p.id));
    const ordered = ids.filter((id) => allowed.has(id));

    await prisma.$transaction(
      ordered.map((id, index) =>
        prisma.realtyPropertyPhoto.updateMany({
          where: { id, accountId: ctx.accountId, propertyId: params.id },
          data: { sortOrder: index },
        }),
      ),
    );

    return NextResponse.json({ ok: true, count: ordered.length });
  } catch (e) {
    return realtyApiError("properties/[id]/photos/order:PATCH", e);
  }
}
