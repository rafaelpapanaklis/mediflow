import { NextResponse } from "next/server";
import { parseCardToken } from "@/lib/barber/stars-core";
import { datosDeInstalacion } from "@/lib/barber/tarjeta-instalar";
import { manifestDeTarjeta } from "@/lib/barber/tarjeta-instalar-core";

/**
 * GET /b/[slug]/tarjeta/[token]/manifest.webmanifest — el manifest de UNA
 * tarjeta de estrellas (ws6-t2, punto 5): nombre «Estrellas · <barbería>»,
 * ícono de la barbería, `start_url` = el enlace personal y pantalla completa.
 *
 * 🔒 Solo devuelve datos públicos de la barbería más el MISMO token con el
 * que se pidió (ya viene en la URL): no consulta al cliente ni dice si el
 * enlace sigue vigente. Un token con forma rara → 404. Sin caché compartida
 * y fuera de buscadores: la URL lleva la llave de la tarjeta.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ slug: string; token: string }> }) {
  const params = await props.params;
  const token = decodeURIComponent(params.token ?? "");
  if (!parseCardToken(token)) return new NextResponse(null, { status: 404 });

  const shop = await datosDeInstalacion(params.slug);
  if (!shop) return new NextResponse(null, { status: 404 });

  const manifest = manifestDeTarjeta({
    shopName: shop.name,
    slug: shop.slug,
    token,
    template: shop.template,
    acento: shop.acento,
    locale: shop.locale,
  });

  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
