// GET → { kind: "affiliate" | "seller" | "none", status?, parentApproved?, home }.
// Lo usa el login para enrutar tras un signInWithPassword exitoso: un afiliado
// cae a /afiliados/inicio y un vendedor (equipo) a /afiliados/vendedor/inicio.
// La identidad SIEMPRE sale de la sesión Supabase (getAffiliateContext /
// getAffiliateSellerContext), NUNCA del request. Prioriza afiliado: si la misma
// cuenta fuese ambas, el panel de afiliado manda.
import { NextResponse } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";

export async function GET() {
  const aff = await getAffiliateContext();
  if (aff) {
    return NextResponse.json({
      kind: "affiliate",
      status: aff.status,
      home: "/afiliados/inicio",
    });
  }

  const sel = await getAffiliateSellerContext();
  if (sel) {
    return NextResponse.json({
      kind: "seller",
      parentApproved: sel.parentStatus === "APPROVED",
      home: "/afiliados/vendedor/inicio",
    });
  }

  return NextResponse.json({ kind: "none" });
}
