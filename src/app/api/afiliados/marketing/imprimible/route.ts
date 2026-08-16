import { NextResponse, type NextRequest } from "next/server";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { resolveAffiliateQrTarget, qrDataUrl } from "@/lib/affiliates/marketing-target";
import {
  affiliateShortName,
  displayShortUrl,
  findPrintPiece,
  findSocialStyle,
  findSocialVariant,
  SOCIAL_VARIANTS,
  PRINT_DEFAULT_STYLE,
} from "@/lib/affiliates/marketing-assets";
import {
  AffiliateBusinessCardsDocument,
  AffiliateFlyerDocument,
  AffiliateExpoBrochureDocument,
  type AffiliatePrintProps,
} from "@/lib/pdf/affiliate-marketing-print";

/**
 * GET /api/afiliados/marketing/imprimible?pieza=tarjetas|volante|diptico
 *     [&estilo=claro|oscuro|color][&tema=<id>][&link=<id>]
 *
 * Material listo para imprenta con el nombre y el QR del afiliado. Mismo
 * patrón que /api/afiliados/reportes/estado-cuenta: createElement +
 * renderToBuffer y respuesta application/pdf como adjunto.
 *
 * El afiliado sale de la SESIÓN. De la URL solo viajan la pieza, el estilo, el
 * tema y —opcional— cuál de sus propios links va en el QR
 * (resolveAffiliateQrTarget valida la pertenencia; un id ajeno cae al link
 * base del que pide, no al del dueño).
 *
 * `estilo` y `tema` CAEN A UN VALOR BUENO si faltan o vienen inventados, en
 * vez de devolver 400: son parámetros de presentación, no de identidad, y un
 * enlace guardado de la versión anterior del panel (que no mandaba ninguno de
 * los dos) tiene que seguir bajando su PDF.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const piece = findPrintPiece(params.get("pieza"));
  if (!piece) return NextResponse.json({ error: "Pieza desconocida." }, { status: 400 });

  const style = findSocialStyle(params.get("estilo"))?.id ?? PRINT_DEFAULT_STYLE;
  const variant = findSocialVariant(params.get("tema")) ?? SOCIAL_VARIANTS[0];

  const target = await resolveAffiliateQrTarget(ctx, params.get("link"));
  const props: AffiliatePrintProps = {
    affiliateName: affiliateShortName(ctx.affiliate.name),
    shortUrl: displayShortUrl(target),
    // Negro puro, y SIEMPRE sobre la baldosa blanca que pone QrChip: en el
    // estilo oscuro y en el de color el fondo de la hoja no sirve de blanco.
    qrDataUrl: await qrDataUrl(target, { size: 800, dark: "#000000" }),
    style,
    variant,
  };

  const Doc =
    piece.id === "tarjetas"
      ? AffiliateBusinessCardsDocument
      : piece.id === "volante"
        ? AffiliateFlyerDocument
        : AffiliateExpoBrochureDocument;

  // renderToBuffer espera un ReactElement<DocumentProps>; el wrapper FC no lo
  // infiere. Mismo cast que estado-cuenta y payroll-pdf.
  const element = createElement(Doc, props);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  // El nombre dice qué se descargó: el afiliado que baja el volante en tres
  // estilos no acaba con "dalecontrol-volante (2).pdf" tres veces.
  const name = [piece.file, style, piece.usesVariant ? variant.id : null]
    .filter(Boolean)
    .join("-");

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
