import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addRealtyStorageBytes, removeRealtyFiles } from "@/lib/realty/media";
import { gateRealty, notFound, realtyApiError } from "../../../_helpers";

export const dynamic = "force-dynamic";

/** DELETE — quitar el documento: fila, objeto del bucket y bytes del cupo. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; docId: string } },
) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const doc = await prisma.realtyPropertyDocument.findFirst({
      where: { id: params.docId, accountId: ctx.accountId, propertyId: params.id },
      select: { id: true, url: true, bytes: true },
    });
    if (!doc) return notFound();

    await prisma.realtyPropertyDocument.deleteMany({
      where: { id: doc.id, accountId: ctx.accountId },
    });

    await removeRealtyFiles([doc.url]);
    if (doc.bytes > 0) await addRealtyStorageBytes(ctx.accountId, -doc.bytes);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]/documents/[docId]:DELETE", e);
  }
}
