import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { addEduPayment } from "@/lib/edu/caja";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/caja/cobros/[id]/pagos — registra un pago o una
 * devolución.
 *
 * 🔴 Una DEVOLUCIÓN (`isRefund: true`) exige el permiso `caja.refund`
 * ADEMÁS de `caja.charge`, y se comprueba en los dos lados: aquí, para
 * poder contestar 403 con un mensaje entendible, y otra vez dentro de
 * `addEduPayment`, para que ninguna ruta futura pueda saltárselo llamando
 * directo a la capa de datos.
 *
 * 🔴 El turno que se estampa es el del PAGO, no el del cobro: un cobro de
 * ayer que se liquida hoy entra en el corte de HOY, porque el dinero está
 * en la caja de hoy.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const canRefund = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "caja.refund",
    );
    if (body.isRefund && !canRefund) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene el permiso caja.refund." },
        { status: 403 },
      );
    }
    const res = await addEduPayment(g.ctx, params.id, body, { canRefund });
    return NextResponse.json({ ok: true, ...res }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/cobros/[id]/pagos");
  }
}
