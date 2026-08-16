import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { resolveAffiliateQrTarget, qrDataUrl } from "@/lib/affiliates/marketing-target";
import { AffiliateMarketingArtwork, SOCIAL_PALETTES } from "@/lib/og/affiliate-marketing-artwork";
import {
  findSocialFormat,
  findSocialVariant,
  findSocialStyle,
  affiliateShortName,
  displayShortUrl,
} from "@/lib/affiliates/marketing-assets";

/**
 * GET /api/afiliados/marketing/imagen?formato=post&variante=agenda&estilo=oscuro[&link=<id>]
 *
 * Imagen para redes con la marca DaleControl, el mensaje elegido, el estilo
 * elegido, el nombre del afiliado y su QR. Se genera al vuelo con
 * ImageResponse (satori), el mismo motor que /og/blog. El dibujo vive en
 * src/lib/og/affiliate-marketing-artwork.tsx.
 *
 * RUNTIME NODEJS, no edge: /og/blog corre en el Edge porque su título viaja
 * por query y nunca toca la BD. Aquí hay que leer la sesión del afiliado con
 * Prisma, y Prisma no corre en el Edge. ImageResponse funciona en los dos.
 *
 * El afiliado sale SIEMPRE de la cookie de sesión; de la URL solo viajan el
 * formato, el mensaje y —opcionalmente— cuál de SUS links va en el QR (ver
 * resolveAffiliateQrTarget, que valida la pertenencia contra la sesión).
 */

export const runtime = "nodejs";
// La respuesta depende de la cookie de sesión: cachearla serviría el material
// de un afiliado a otro.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const format = findSocialFormat(params.get("formato"));
  const variant = findSocialVariant(params.get("variante"));
  const style = findSocialStyle(params.get("estilo"));
  if (!format || !variant || !style) {
    return NextResponse.json({ error: "Formato, mensaje o estilo desconocido." }, { status: 400 });
  }

  const target = await resolveAffiliateQrTarget(ctx, params.get("link"));

  const headers: Record<string, string> = {
    // Privada y corta: la pieza es la misma mientras no cambie el link, y la
    // vista previa del panel pide los cuatro formatos de un jalón.
    "Cache-Control": "private, max-age=600",
  };
  if (params.get("descarga") === "1") {
    headers["Content-Disposition"] =
      `attachment; filename="dalecontrol-${variant.id}-${style.id}-${format.id}.png"`;
  }

  return new ImageResponse(
    (
      <AffiliateMarketingArtwork
        format={format}
        variant={variant}
        style={style.id}
        // El QR se tiñe con el estilo: negro puro sobre el claro, casi negro
        // sobre los otros dos (que llevan baldosa blanca detrás). El color
        // sale de la MISMA paleta que dibuja la pieza, para que no puedan
        // quedar desalineados.
        qrDataUrl={await qrDataUrl(target, { size: 620, dark: SOCIAL_PALETTES[style.id].qrDark })}
        urlText={displayShortUrl(target)}
        affiliateName={affiliateShortName(ctx.affiliate.name)}
      />
    ),
    { width: format.width, height: format.height, headers },
  );
}
