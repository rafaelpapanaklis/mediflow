// GET → { kind: "affiliate" | "none", status?, home? }.
//
// Lo usa el login del portal para enrutar tras un signInWithPassword exitoso.
// Desde que el segundo nivel del programa son AFILIADOS INVITADOS y no
// "vendedores", todos los que entran por aquí son afiliados normales: hay un
// solo panel (/afiliados/inicio) y, por tanto, una sola rama.
//
// La identidad SIEMPRE sale de la sesión de Supabase (getAffiliateContext),
// NUNCA del request.
import { NextResponse } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";

export async function GET() {
  const aff = await getAffiliateContext();
  if (aff) {
    return NextResponse.json({
      kind: "affiliate",
      status: aff.status,
      home: "/afiliados/inicio",
    });
  }

  return NextResponse.json({ kind: "none" });
}
