import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { crearLinkDePedido, type ErrorLinkPedido } from "@/lib/barber/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/public/orders/[id]/mercadopago — ws6-t5 (contrato con la
 * tienda, ws6-t1). Responde `{ initPoint }`: la URL de Mercado Pago a la que
 * la tienda manda al cliente para pagar SU pedido.
 *
 * Sin sesión (es la página pública del folio). El id del pedido es la única
 * llave: la barbería, los renglones y el total salen del PEDIDO en la base,
 * nunca del cuerpo. Cuerpo opcional `{ returnPath }`: la página a la que
 * vuelve el cliente, aceptada solo si es de `/b/<slug de esa barbería>/…`
 * (si no, la del folio: /b/<slug>/tienda/pedido/<id>).
 *
 * Respuestas:
 *   200 { initPoint }
 *   404 { code: "notFound" }      pedido inexistente (o la tienda sin SQL)
 *   404 { code: "mpUnavailable" } la barbería no tiene Mercado Pago conectado
 *       (o DaleControl no lo tiene configurado): la tienda NO muestra el botón
 *   409 { code: "notPending" | "expired" | "badOrder" | "belowMinimum" }
 *   429 demasiados intentos · 502 { code: "mpError" } Mercado Pago no contestó
 */
const RL = { limit: 20, windowSec: 600 };

const RESPUESTA: Record<ErrorLinkPedido, { status: number; code: string; error: string }> = {
  no_encontrado: { status: 404, code: "notFound", error: "No encontramos este pedido." },
  sin_mp: { status: 404, code: "mpUnavailable", error: "Esta barbería no recibe pagos en línea." },
  no_pendiente: { status: 409, code: "notPending", error: "Este pedido ya no está esperando pago." },
  vencido: { status: 409, code: "expired", error: "Este pedido ya venció." },
  renglones: { status: 409, code: "badOrder", error: "No podemos cobrar este pedido en línea. Págalo en la barbería." },
  bajo_minimo: { status: 409, code: "belowMinimum", error: "Este pedido se paga en la barbería." },
  mp_fallo: { status: 502, code: "mpError", error: "Mercado Pago no respondió. Intenta de nuevo en unos minutos." },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = typeof id === "string" ? id.trim() : "";
  if (!orderId || orderId.length > 64) {
    return NextResponse.json({ code: "notFound", error: RESPUESTA.no_encontrado.error }, { status: 404 });
  }

  const limited = await persistentRateLimit(req, { ...RL, scope: "barber-mp-order" });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { returnPath?: unknown } | null;
  const r = await crearLinkDePedido({ orderId, returnPath: body?.returnPath });
  if (!("error" in r)) return NextResponse.json({ initPoint: r.initPoint });
  const e = RESPUESTA[r.error];
  return NextResponse.json({ code: e.code, error: e.error }, { status: e.status });
}
