import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { discardSaleDraft } from "@/lib/barber/sale-drafts";

export const dynamic = "force-dynamic";

// DELETE /api/barber/sales/drafts/[id] → DESCARTA la nota (cash.manage). No se
// borra la fila: queda DISCARDED con quién y cuándo.
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    await discardSaleDraft(ctx, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
