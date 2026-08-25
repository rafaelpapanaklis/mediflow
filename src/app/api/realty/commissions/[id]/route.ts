import { NextRequest, NextResponse } from "next/server";
import { getRealtyContext } from "@/lib/realty-auth";
import { setSplitPaid } from "@/app/api/realty/deals/service";
import { realtyApiError } from "@/lib/realty/team";

// PATCH /api/realty/commissions/[id] — body { paid: boolean }
// Marca (o desmarca) pagada UNA parte del reparto. Desmarcarla es la vía
// legítima para corregir un reparto que ya se había cobrado, y queda a la
// vista de todos en la pantalla.
//
// No se puede pagar la parte de una operación que todavía no cierra: eso
// sería adelantar dinero de algo que se puede caer.

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getRealtyContext();
    if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deal = await setSplitPaid(ctx, params.id, body.paid === true);
    return NextResponse.json({ deal });
  } catch (err) {
    return realtyApiError(err);
  }
}
