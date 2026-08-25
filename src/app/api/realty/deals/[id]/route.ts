import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { updateDeal } from "@/app/api/realty/deals/service";
import { realtyApiError } from "@/lib/realty/team";

// PATCH /api/realty/deals/[id] — editar, cerrar o cancelar una operación.
//
// Si cambia el monto de la comisión, las partes por porcentaje se recalculan
// en la misma transacción: dejarlas con el importe viejo es la forma
// silenciosa de que el reparto deje de sumar el 100% y nadie se entere hasta
// el día de pago.

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    const deal = await updateDeal(ctx, params.id, body);
    return NextResponse.json({ deal });
  } catch (err) {
    return realtyApiError(err);
  }
}
