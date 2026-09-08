import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { addEduPayment } from "@/lib/edu/caja";
import { eduPagosPideDevolucion } from "@/lib/edu/dinero-core";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduCampusForCharge, eduWithCampus } from "@/lib/edu/campus-core";

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
 * en la caja de hoy. Y desde la C·fin también en el corte de AQUÍ: el
 * efectivo de un cobro de Norte pagado en el mostrador de Sur entra en el
 * cajón de Sur, que es donde está el billete.
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
    // La devolución puede venir en las TRES formas del cuerpo: en la raíz
    // (el pago único de siempre), dentro de `payment` o dentro de
    // `payments`. Se pregunta con el MISMO helper que usa la capa de datos
    // —escribirlo a mano aquí es donde estaba el bug del `??`, que no cae
    // al lado derecho cuando el izquierdo es `false`—. `addEduPayment` lo
    // vuelve a comprobar (ninguna ruta futura puede saltárselo); esto solo
    // contesta con un mensaje que se entiende.
    if (eduPagosPideDevolucion(body) && !canRefund) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene el permiso caja.refund." },
        { status: 403 },
      );
    }
    // 🔴 H-63 · EL ALCANCE POR SEDE al leer el cobro, y 🔴 EL MOSTRADOR
    // en el que entra el dinero para sellar el turno. Las dos salen del
    // selector de la barra superior (`getEduCampusScope`), nunca del body.
    //
    // Con la vista consolidada puesta, `eduCampusForCharge` no puede decir
    // dónde estás y aquí NO se rebota: se manda `null` y el pago cae en el
    // turno de la sede del cobro, que es exactamente lo que se hacía
    // antes. Cobrar exige elegir sede porque emite un documento; abonar a
    // uno que ya existe, no.
    const sede = await getEduCampusScope(g.ctx);
    const donde = eduCampusForCharge(sede);
    const res = await addEduPayment(eduWithCampus(g.ctx, sede), params.id, body, {
      canRefund,
      campusId: donde.ok ? donde.campusId : null,
    });
    // 🔴 H-06 · `duplicado` = este POST traía una clave de idempotencia ya
    // usada y NO se registró un segundo abono: se devuelve el estado del
    // cobro tal como quedó. 200 y no 201, porque no se creó nada. Mismo
    // contrato que el POST de cobros desde P2-10.
    return NextResponse.json({ ok: true, ...res }, { status: res.duplicado ? 200 : 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/cobros/[id]/pagos");
  }
}
