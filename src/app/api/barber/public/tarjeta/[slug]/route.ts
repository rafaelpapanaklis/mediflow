import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import { checkBarberCaptcha } from "@/lib/barber/captcha";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";
import { resolvePortalShop } from "@/lib/barber/client-portal";
import { panelPhone } from "@/lib/barber/telefono-panel";
import { buscarTarjeta, depsDeTarjeta } from "@/lib/barber/tarjeta-web";
import { TARJETA_IP_LIMIT } from "@/lib/barber/tarjeta-web-core";

/**
 * POST /api/barber/public/tarjeta/[slug] — «Mi tarjeta» (ws6-t2).
 *
 * El cliente escribió su teléfono en /b/<slug>/mi-tarjeta. Si es cliente de
 * ESA barbería se devuelve su tarjeta de estrellas (la misma vista que la
 * tarjeta por enlace: nombre de pila, estrellas, bonos e historial de
 * estrellas) y su enlace personal. Nada más: ni teléfono, ni citas, ni pagos.
 * No se manda ningún WhatsApp.
 *
 * Anti-abuso: freno por IP, captcha (Cloudflare Turnstile, acción propia),
 * freno por número (dentro de buscarTarjeta) y campo trampa `website`.
 * Las respuestas no se cachean ni salen con Referer.
 *
 *   body { iso?, phone, captchaToken?, website? }
 *   200  { ok: true, found: true, view, link } | { ok: true, found: false }
 *   429  { error, code: "tooMany" }
 */

export const dynamic = "force-dynamic";

const CABECERAS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CABECERAS });

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  try {
    const limited = await persistentRateLimit(req, { ...TARJETA_IP_LIMIT, scope: "barber-public-tarjeta" });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "Solicitud inválida" }, 400);

    // Campo trampa: «no encontrado», para que el bot no aprenda nada.
    if (typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true, found: false });

    const shop = await resolvePortalShop(params.slug);
    if (!shop) return json({ error: "Barbería no encontrada" }, 404);

    const tel = panelPhone(body.iso, body.phone);
    if (!tel.ok) return json({ error: tel.error, code: "badPhone" }, 400);

    const captcha = await checkBarberCaptcha(req, body.captchaToken, BARBER_CAPTCHA_ACTIONS.starsCard);
    if (captcha.response) return captcha.response;

    const r = await buscarTarjeta(await depsDeTarjeta(), { shop: { id: shop.id, slug: shop.slug }, phone: tel.stored });

    if (r.estado === "frenado") {
      return json({ error: "Demasiados intentos con ese número. Espera un rato y vuelve a intentar.", code: "tooMany" }, 429);
    }
    if (r.estado !== "encontrada") return json({ ok: true, found: false });
    return json({ ok: true, found: true, view: r.view, link: r.ruta });
  } catch (err) {
    console.error("[barber/public/tarjeta] error:", err);
    return json({ error: "No pudimos atender tu solicitud. Intenta de nuevo." }, 500);
  }
}
