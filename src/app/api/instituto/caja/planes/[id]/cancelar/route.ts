import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { cancelEduPaymentPlan } from "@/lib/edu/pagos";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/caja/planes/[id]/cancelar — cancela un plan ACTIVO,
 * con motivo.
 *
 * 🔴 Exige `caja.refund`, el permiso de deshacer dinero: cancelar un
 * calendario de cobro comprometido es el mismo nivel de confianza que
 * devolver dinero. Lo ya pagado SE QUEDA (son pagos reales, están en su
 * corte); el saldo del cobro vuelve a cobrarse normal.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.refund");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await cancelEduPaymentPlan(g.ctx, params.id, body);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/planes/[id]/cancelar");
  }
}
