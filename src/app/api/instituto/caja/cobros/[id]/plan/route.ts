import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { createEduPaymentPlan } from "@/lib/edu/pagos";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/caja/cobros/[id]/plan — difiere el saldo de un cobro
 * en mensualidades (pagar a meses).
 *
 * Mismo permiso que cobrar (`caja.charge`): armar el calendario de un
 * cobro ES una forma de cobrarlo. No hay una key nueva a propósito — una
 * "planes.create" solo daría un segundo interruptor que apagar mal.
 *
 * 🔴 El servidor CREA las mensualidades solo: la pantalla manda cuántos
 * meses (y opcionalmente el día de corte y un enganche); los montos y las
 * fechas los pone pagos-core. Si el saldo no divide exacto, la diferencia
 * entera va en la PRIMERA mensualidad.
 *
 * 🔴 La zona horaria del "hoy" (y por tanto del día de corte por defecto)
 * es la del INSTITUTO, de la sesión — nunca del body.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await createEduPaymentPlan(g.ctx, params.id, body, {
      timeZone: g.ctx.institution.timezone,
    });
    return NextResponse.json({ ok: true, ...res }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/cobros/[id]/plan");
  }
}
