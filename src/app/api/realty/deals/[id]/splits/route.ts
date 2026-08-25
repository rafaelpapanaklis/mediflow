import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { setDealSplits } from "@/app/api/realty/deals/service";
import { realtyApiError } from "@/lib/realty/team";

// PUT /api/realty/deals/[id]/splits — body { splits: [...] }
//
// Reemplaza el reparto COMPLETO. Se manda entero, nunca por partes: un
// reparto a medias no cierra y no se puede validar.
//
// El servidor vuelve a correr computeSplits (el MISMO motor puro que usó la
// pantalla mientras se escribía), así que un reparto que no suma el 100% de
// la comisión se rechaza con 400 aunque alguien llame a la API a mano.

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const deal = await setDealSplits(ctx, params.id, body.splits);
    return NextResponse.json({ deal });
  } catch (err) {
    return realtyApiError(err);
  }
}
