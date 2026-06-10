// Eliminar un link del VENDEDOR logueado. Ownership SIEMPRE por sellerId de la
// sesión (deleteMany con where compuesto { id, sellerId }, nunca por id solo):
// un vendedor no puede borrar links del padre ni de otro vendedor.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { count } = await prisma.affiliateLink.deleteMany({
      where: { id: params.id, sellerId: ctx.sellerId },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Link no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "tools_not_ready" }, { status: 503 });
  }
}
