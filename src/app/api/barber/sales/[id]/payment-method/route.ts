import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, changeSalePaymentMethod, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// POST /api/barber/sales/[id]/payment-method { paymentMethod } → corrige el
// método de un ticket ya cobrado (Efectivo / Tarjeta / SPEI) mientras su
// turno siga abierto, con bitácora. Después del corte solo se cancela.
// cash.manage.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sale = await changeSalePaymentMethod(ctx, params.id, { paymentMethod: body.paymentMethod });
    return NextResponse.json(sale);
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
