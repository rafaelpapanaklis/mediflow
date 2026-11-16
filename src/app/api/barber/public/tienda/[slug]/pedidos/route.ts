import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { checkBarberCaptcha } from "@/lib/barber/captcha";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";
import { cleanBarberClientName } from "@/lib/barber/booking-core";
import { normalizeBarberPhone } from "@/lib/barber/booking";
import { getPortalSession } from "@/lib/barber/client-portal";
import { createTiendaOrder, isTiendaGateOk, resolveTienda, tiendaErrorBody } from "@/lib/barber/tienda";
import { normalizeOrderLines, rutaTienda } from "@/lib/barber/tienda-core";
import { onTiendaOrderCreated } from "@/lib/barber/tienda-pedido-nuevo";

/**
 * POST /api/barber/public/tienda/[slug]/pedidos — APARTAR productos (ws6-t1).
 *
 * Sin sesión. La barbería sale del SLUG; los productos tienen que ser de una
 * sede de esa cadena, mostrarse, poder apartarse y alcanzar (lo decide
 * createTiendaOrder dentro de una transacción con candado por producto).
 * Nunca acepta precios ni un barbershopId del navegador.
 *
 * Anti-abuso, el mismo juego que la reserva:
 *   · captcha Cloudflare Turnstile (acción propia `barber-shop-order`);
 *     sin sus variables sigue funcionando y queda en el log;
 *   · freno por IP y barbería solo para ráfagas;
 *   · tope de pedidos vivos por teléfono (TIENDA_MAX_OPEN_PER_PHONE);
 *   · nombre solo con letras y WhatsApp de México real;
 *   · campo trampa `website`.
 *
 * Si el cliente entró a «mi cuenta» de ESA sede, el pedido queda ligado a su
 * ficha (client_id). Si no, sin ficha: en Caja se elige al cliente si hace falta.
 *
 *   body { lines: [{productId, qty}], name, phone, payOnline?, captchaToken?, website? }
 *   200  { ok, id, folio, total, branch, expiresAt, folioUrl }
 */

export const dynamic = "force-dynamic";

const RL = { limit: 20, windowSec: 600 };

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  try {
    const limited = await persistentRateLimit(req, { ...RL, scope: `barber-public-tienda:${String(params.slug ?? "").toLowerCase()}` });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });

    // Campo trampa: éxito falso para que el bot no aprenda.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return NextResponse.json({ ok: true, id: "------", folio: "-----" });
    }

    const captcha = await checkBarberCaptcha(req, body.captchaToken, BARBER_CAPTCHA_ACTIONS.shopOrder);
    if (captcha.response) return captcha.response;

    const gate = await resolveTienda(params.slug);
    if (!isTiendaGateOk(gate)) return NextResponse.json({ error: "Esta tienda no está disponible.", code: "shopNotFound" }, { status: 404 });

    const name = cleanBarberClientName(body.name);
    if (!name) return NextResponse.json({ error: "Escribe tu nombre solo con letras.", code: "badName" }, { status: 400 });
    const phone = normalizeBarberPhone(body.phone);
    if (!phone) return NextResponse.json({ error: "Escribe un WhatsApp de México a 10 dígitos.", code: "badPhone" }, { status: 400 });
    const lines = normalizeOrderLines(body.lines);

    // «mi cuenta»: la cookie del portal vale solo para la sede que la emitió.
    let portalClient: { barbershopId: string; clientId: string } | null = null;
    for (const b of gate.branches) {
      const s = await getPortalSession(b.id);
      if (s) {
        portalClient = { barbershopId: b.id, clientId: s.clientId };
        break;
      }
    }

    const order = await createTiendaOrder({ gate, lines, name, phone, portalClient, payOnline: body.payOnline === true });

    // PUNTO ÚNICO de «entró un pedido nuevo» (16-nov): aquí se enganchará el
    // correo al dueño cuando Rafael lo decida. HOY NO MANDA NADA y nunca
    // lanza: el pedido ya está guardado. Ver tienda-pedido-nuevo.ts.
    await onTiendaOrderCreated({
      orderId: order.id,
      folio: order.folio,
      barbershopId: order.branch.id,
      shopSlug: gate.shop.slug,
      shopName: order.branch.name,
      branchName: order.branch.branchName,
      clientName: name,
      clientPhone: phone,
      items: order.items,
      total: order.total,
      payOnline: body.payOnline === true,
      expiresAt: order.expiresAt,
    });

    return NextResponse.json({
      ok: true,
      id: order.id,
      folio: order.folio,
      total: order.total,
      branch: { name: order.branch.name, branchName: order.branch.branchName, address: order.branch.address, city: order.branch.city },
      expiresAt: order.expiresAt,
      folioUrl: `${rutaTienda(gate.shop.slug)}/pedido/${encodeURIComponent(order.id)}`,
    });
  } catch (err) {
    const t = tiendaErrorBody(err);
    if (t) return NextResponse.json(t.body, { status: t.status });
    console.error("[barber/public/tienda] error:", err);
    return NextResponse.json({ error: "No pudimos apartar tu pedido. Intenta de nuevo." }, { status: 500 });
  }
}
