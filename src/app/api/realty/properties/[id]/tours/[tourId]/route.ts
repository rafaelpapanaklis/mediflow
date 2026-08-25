import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addRealtyStorageBytes, removeRealtyFiles } from "@/lib/realty/media";
import { gateRealty, notFound, realtyApiError } from "../../../_helpers";

export const dynamic = "force-dynamic";

/**
 * DELETE — quitar un recorrido.
 *
 * Si era una panorámica propia, además hay que borrar el archivo del bucket
 * y devolver los bytes al cupo. Si era una liga externa, `fileUrl` es null
 * y `bytes` es 0: no hay nada que devolver y removeRealtyFiles no hace nada.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; tourId: string } },
) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const tour = await prisma.realtyPropertyTour.findFirst({
      where: { id: params.tourId, accountId: ctx.accountId, propertyId: params.id },
      select: { id: true, fileUrl: true, bytes: true },
    });
    if (!tour) return notFound();

    await prisma.realtyPropertyTour.deleteMany({
      where: { id: tour.id, accountId: ctx.accountId },
    });

    if (tour.fileUrl) await removeRealtyFiles([tour.fileUrl]);
    if (tour.bytes > 0) await addRealtyStorageBytes(ctx.accountId, -tour.bytes);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]/tours/[tourId]:DELETE", e);
  }
}
