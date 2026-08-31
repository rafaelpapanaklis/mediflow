import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { payEduInstallment } from "@/lib/edu/pagos";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/caja/mensualidades/[id]/pagar — cobra UNA
 * mensualidad. Mismo permiso que cualquier cobro: `caja.charge`.
 *
 * 🔴 El body trae el MÉTODO y la referencia, nunca el monto: se cobra
 * EXACTAMENTE el monto congelado de la mensualidad. Se registra como un
 * EduPayment normal (entra al turno abierto y a su corte) y, si era la
 * última, la misma transacción deja el plan LIQUIDADO.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await payEduInstallment(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, ...res }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/mensualidades/[id]/pagar");
  }
}
