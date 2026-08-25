import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addRealtyStorageBytes, removeRealtyFiles } from "@/lib/realty/media";
import { gateRealty, notFound, readJson, realtyApiError } from "../../../_helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH — marcar esta foto como portada.
 *
 * 🔴 UNA portada por inmueble, y la BASE NO LO IMPONE: Prisma no expresa
 * índices únicos parciales. Con dos portadas, la tarjeta del listado cambia
 * de foto entre renders y nadie entiende por qué. Por eso quitar la
 * anterior y poner la nueva van en la MISMA transacción.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; photoId: string } },
) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const body = await readJson(req);
    if (body.isCover !== true) {
      return NextResponse.json({ error: "Nada que cambiar." }, { status: 400 });
    }

    // El accountId Y el propertyId van en el where: una foto de otra cuenta
    // (o de otro inmueble de la misma) no se puede promover desde aquí.
    const photo = await prisma.realtyPropertyPhoto.findFirst({
      where: { id: params.photoId, accountId: ctx.accountId, propertyId: params.id },
      select: { id: true },
    });
    if (!photo) return notFound();

    await prisma.$transaction([
      prisma.realtyPropertyPhoto.updateMany({
        where: { accountId: ctx.accountId, propertyId: params.id, isCover: true },
        data: { isCover: false },
      }),
      prisma.realtyPropertyPhoto.updateMany({
        where: { id: photo.id, accountId: ctx.accountId },
        data: { isCover: true },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]/photos/[photoId]:PATCH", e);
  }
}

/**
 * DELETE — quitar la foto: fila, objeto del bucket y bytes del contador.
 *
 * Si la borrada era la PORTADA, se asciende la siguiente. Dejar el inmueble
 * sin portada lo deja sin imagen en el listado, que es donde se decide si
 * alguien lo abre.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; photoId: string } },
) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const photo = await prisma.realtyPropertyPhoto.findFirst({
      where: { id: params.photoId, accountId: ctx.accountId, propertyId: params.id },
      select: { id: true, url: true, bytes: true, isCover: true },
    });
    if (!photo) return notFound();

    await prisma.realtyPropertyPhoto.deleteMany({
      where: { id: photo.id, accountId: ctx.accountId },
    });

    if (photo.isCover) {
      const next = await prisma.realtyPropertyPhoto.findFirst({
        where: { accountId: ctx.accountId, propertyId: params.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (next) {
        await prisma.realtyPropertyPhoto.updateMany({
          where: { id: next.id, accountId: ctx.accountId },
          data: { isCover: true },
        });
      }
    }

    // Best-effort a propósito: si el objeto ya no está, la fila SÍ se tiene
    // que ir igual. Una fila que apunta a un archivo inexistente es peor
    // que un huérfano en el bucket.
    await removeRealtyFiles([photo.url]);
    if (photo.bytes > 0) await addRealtyStorageBytes(ctx.accountId, -photo.bytes);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]/photos/[photoId]:DELETE", e);
  }
}
