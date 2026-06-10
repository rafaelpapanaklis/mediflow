import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { SELLER_PAYOUT_METHODS } from "@/lib/affiliates/team";

// PATCH /api/afiliados/vendedor/me  body: { payoutMethod?, payoutDetails? }
// El vendedor edita SUS datos de pago. sellerId SIEMPRE sale de la sesión
// (getAffiliateSellerContext), NUNCA del body — un vendedor no puede tocar a
// otro. Espejo de /api/afiliados/me SIN las preferencias de notificación.
export async function PATCH(req: Request) {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Mismo gate que links/coupon: el equipo solo opera bajo un afiliado aprobado.
  if (ctx.parentStatus !== "APPROVED") {
    return NextResponse.json({ error: "Tu afiliado aún no está aprobado." }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const methodRaw = typeof body?.payoutMethod === "string" ? body.payoutMethod.trim().toUpperCase() : "";
  const payoutMethod = methodRaw === "" ? null : SELLER_PAYOUT_METHODS.has(methodRaw) ? methodRaw : null;
  const detailsRaw = typeof body?.payoutDetails === "string" ? body.payoutDetails.trim().slice(0, 300) : "";
  const payoutDetails = detailsRaw === "" ? null : detailsRaw;

  const updated = await prisma.affiliateSeller.update({
    where: { id: ctx.sellerId },
    data: { payoutMethod, payoutDetails },
    select: { payoutMethod: true, payoutDetails: true },
  });

  return NextResponse.json(updated);
}
