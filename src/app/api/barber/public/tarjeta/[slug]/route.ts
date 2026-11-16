import { after, NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { checkBarberCaptcha } from "@/lib/barber/captcha";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";
import { resolvePortalShop } from "@/lib/barber/client-portal";
import { panelPhone } from "@/lib/barber/telefono-panel";
import { depsDeTarjeta, pedirTarjeta } from "@/lib/barber/tarjeta-web";
import { TARJETA_IP_LIMIT } from "@/lib/barber/tarjeta-web-core";

/**
 * POST /api/barber/public/tarjeta/[slug] — «Mi tarjeta» (ws6-t2).
 *
 * El cliente escribió su teléfono en /b/<slug>/mi-tarjeta. Aquí NUNCA se
 * devuelve la tarjeta ni su enlace: con WhatsApp listo se manda el enlace a
 * ESE número, y la respuesta es idéntica exista o no el cliente. Este
 * endpoint no tiene forma de contestar «ese número no está registrado».
 *
 * Anti-abuso: freno por IP, captcha (Cloudflare Turnstile, acción propia),
 * freno por número dentro de pedirTarjeta y campo trampa `website`.
 *
 *   body { iso?, phone, captchaToken?, website? }
 *   200  { ok: true, canal: "whatsapp" | "barberia" }
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  try {
    const limited = await persistentRateLimit(req, { ...TARJETA_IP_LIMIT, scope: "barber-public-tarjeta" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });

    // Campo trampa: la misma respuesta de siempre, para que el bot no aprenda.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return NextResponse.json({ ok: true, canal: "whatsapp" });
    }

    const shop = await resolvePortalShop(params.slug);
    if (!shop) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });

    // Un teléfono mal escrito SÍ se puede decir: no revela si alguien es cliente.
    const tel = panelPhone(body.iso, body.phone);
    if (!tel.ok) return NextResponse.json({ error: tel.error, code: "badPhone" }, { status: 400 });

    const captcha = await checkBarberCaptcha(req, body.captchaToken, BARBER_CAPTCHA_ACTIONS.starsCard);
    if (captcha.response) return captcha.response;

    const pedido = await pedirTarjeta(await depsDeTarjeta(), {
      shop: { id: shop.id, slug: shop.slug },
      phone: tel.stored,
    });
    // El WhatsApp sale DESPUÉS de responder: el tiempo de respuesta no delata
    // si el número es de un cliente.
    if (pedido.enviar) after(pedido.enviar);

    return NextResponse.json({ ok: true, canal: pedido.canal });
  } catch (err) {
    console.error("[barber/public/tarjeta] error:", err);
    // Ni el 500 puede depender de si el cliente existe.
    return NextResponse.json({ error: "No pudimos atender tu solicitud. Intenta de nuevo." }, { status: 500 });
  }
}
