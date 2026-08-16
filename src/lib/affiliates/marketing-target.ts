// A dónde apunta el QR del material de marketing, y cómo se dibuja.
//
// LA REJA DE SEGURIDAD VIVE AQUÍ: el `affiliateId` sale SIEMPRE del contexto
// de sesión y entra en el WHERE de la consulta. Si el afiliado manda el id de
// un link ajeno en la URL, la consulta no lo encuentra y el QR cae a su propio
// link base — nunca al de otro. Las dos rutas del material (imagen y PDF)
// comparten esta función justo para que la reja no pueda quedar puesta en una
// y olvidada en la otra.

import { prisma } from "@/lib/prisma";
import type { AffiliateContext } from "@/lib/affiliate-auth";
import { baseReferralUrl, shortLinkUrl } from "@/lib/affiliates/link-url";

/**
 * URL corta que se codifica en el QR.
 *
 * - Sin `rawLinkId` (o con "base") → el link base del afiliado, /r/<referralCode>.
 * - Con el id de un link SUYO que ya tenga publicCode → /r/<publicCode>, para
 *   que el material impreso sume clics a esa campaña.
 * - Con cualquier otra cosa (id ajeno, id inventado, link sin publicCode
 *   porque el SQL de campañas no se ha corrido) → link base. Un afiliado sin
 *   links de campaña recibe su material igual; esta ruta nunca falla por eso.
 */
export async function resolveAffiliateQrTarget(
  ctx: AffiliateContext,
  rawLinkId: string | null | undefined,
): Promise<string> {
  const base = baseReferralUrl(ctx.affiliate.referralCode);
  const linkId = (rawLinkId ?? "").trim();
  if (!linkId || linkId === "base") return base;

  const link = await prisma.affiliateLink
    .findFirst({
      // affiliateId de la SESIÓN: es lo único que impide generar material con
      // la campaña de otro afiliado cambiando el parámetro de la URL.
      where: { id: linkId, affiliateId: ctx.affiliateId },
      select: { publicCode: true },
    })
    // La columna publicCode puede no existir todavía (sql/afiliados-ventas.sql
    // sin correr): el catch la trata como "sin link corto" → base.
    .catch(() => null);

  return link?.publicCode ? shortLinkUrl(link.publicCode) : base;
}

/**
 * QR en PNG (data URL) listo para `<img>` de satori y para `<Image>` de
 * @react-pdf. `dark` casi negro y `light` blanco puro: alto contraste, sin
 * degradados y sin tintas de proceso — se escanea igual impreso en láser que
 * en una pantalla.
 */
export async function qrDataUrl(
  url: string,
  opts?: { size?: number; dark?: string },
): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(url, {
    width: opts?.size ?? 640,
    margin: 1,
    // "M" (15% de recuperación) es el equilibrio de siempre: sobrevive a una
    // impresión regular sin inflar la cuadrícula como haría "H".
    errorCorrectionLevel: "M",
    color: { dark: opts?.dark ?? "#0f172a", light: "#ffffff" },
  });
}
