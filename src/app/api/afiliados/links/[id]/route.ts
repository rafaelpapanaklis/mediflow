// Renombrar / eliminar un link del afiliado logueado. Ownership SIEMPRE por
// affiliateId de la sesión (updateMany/deleteMany con where compuesto, nunca
// por id solo). campaign es INMUTABLE (estabilidad de URL y QR impresos).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 40) {
    return NextResponse.json(
      { error: "El nombre debe tener entre 2 y 40 caracteres." },
      { status: 400 }
    );
  }

  try {
    const { count } = await prisma.affiliateLink.updateMany({
      where: { id: params.id, affiliateId: ctx.affiliateId },
      data: { name },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Link no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { count } = await prisma.affiliateLink.deleteMany({
      where: { id: params.id, affiliateId: ctx.affiliateId },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Link no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
