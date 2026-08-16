import { NextResponse, type NextRequest } from "next/server";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { resolveAffiliateQrTarget, qrDataUrl } from "@/lib/affiliates/marketing-target";
import { affiliateShortName, displayShortUrl, findPrintPiece } from "@/lib/affiliates/marketing-assets";
import {
  AffiliateBusinessCardsDocument,
  AffiliateFlyerDocument,
  AffiliateExpoBrochureDocument,
  type AffiliatePrintProps,
} from "@/lib/pdf/affiliate-marketing-print";

/**
 * GET /api/afiliados/marketing/imprimible?pieza=tarjetas|volante|diptico[&link=<id>]
 *
 * Material listo para imprenta con el nombre y el QR del afiliado. Mismo
 * patrón que /api/afiliados/reportes/estado-cuenta: createElement +
 * renderToBuffer y respuesta application/pdf como adjunto.
 *
 * El afiliado sale de la SESIÓN. De la URL solo viajan la pieza y, opcional,
 * cuál de sus propios links va en el QR (resolveAffiliateQrTarget valida la
 * pertenencia; un id ajeno cae al link base del que pide, no al del dueño).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const piece = findPrintPiece(params.get("pieza"));
  if (!piece) return NextResponse.json({ error: "Pieza desconocida." }, { status: 400 });

  const target = await resolveAffiliateQrTarget(ctx, params.get("link"));
  const props: AffiliatePrintProps = {
    affiliateName: affiliateShortName(ctx.affiliate.name),
    shortUrl: displayShortUrl(target),
    // Negro puro sobre blanco: es lo que mejor aguanta una impresión láser y
    // una separación a CMYK.
    qrDataUrl: await qrDataUrl(target, { size: 800, dark: "#000000" }),
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

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${piece.file}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
