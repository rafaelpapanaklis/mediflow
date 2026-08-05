/**
 * Afiliados — guardia de conteo de clics.
 *
 * UN SOLO lugar decide si una visita SUMA. Las tres superficies que cuentan
 * (`/r/<code>`, `/socio/<slug>` y `POST /api/afiliados/track`) lo consultan
 * antes de tocar cualquier contador, así que el criterio no se puede desfasar
 * entre ellas.
 *
 * Filtra dos cosas:
 *  1. BOTS. Los generadores de vista previa (WhatsApp, Facebook, Telegram,
 *     Slack…) golpean cada URL que se comparte y los crawlers la revisitan solos.
 *     No ejecutan JS, así que no aparecen en GA4 pero SÍ sumaban en el servidor.
 *  2. RECARGAS. Un mismo visitante refrescando la página no puede valer tres
 *     clics.
 *
 * Regla de oro: esto NUNCA bloquea ni rompe nada. El bot recibe su redirección
 * y su cookie de atribución igual que siempre (si /r le fallara, WhatsApp
 * dejaría de generar la vista previa del enlace y el afiliado perdería el
 * empujón visual del link); simplemente no se le cuenta. Y si la consulta de
 * dedupe truena, se cuenta y se sigue: mejor un falso positivo que perder un
 * clic real.
 */

import { prisma } from "@/lib/prisma";
// Detector ÚNICO del repo, compartido con la analítica general. Aquí NO se
// escribe lógica de user-agent: si falta un bot, se amplía en ese archivo.
import { parseUserAgent } from "@/lib/analytics/ua";

/** Ventana de dedupe: mismo ipHash + mismo ref dentro de 30 min = 1 solo clic. */
export const CLICK_DEDUPE_MS = 30 * 60_000;

/** ¿Es un bot? Delega en `parseUserAgent` (src/lib/analytics/ua.ts). */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  return parseUserAgent(ua).device === "bot";
}

export interface ClickGuardInput {
  /** User-agent crudo de la petición (`user-agent`). */
  userAgent: string | null | undefined;
  /** referralCode/slug con el que se registraría el clic. */
  ref: string | null | undefined;
  /** sha256 truncado de la IP (`hashIp`). null cuando no hay IP disponible. */
  ipHash: string | null | undefined;
  /** Inyectable para pruebas; por defecto, ahora. */
  now?: Date;
}

/**
 * ¿Esta visita suma un clic?
 *
 * `false` significa "no incrementes el contador y no insertes la fila" — nada
 * más. La redirección, la cookie y el render de la página siguen su curso.
 */
export async function shouldCountAffiliateClick(input: ClickGuardInput): Promise<boolean> {
  if (isBotUserAgent(input.userAgent)) return false;

  const ref = (input.ref ?? "").trim();
  const ipHash = (input.ipHash ?? "").trim();
  // Sin huella no hay forma de deduplicar (IP ausente detrás de cierto proxy,
  // o la tabla vieja): se cuenta. Perder un clic real es peor que repetirlo.
  if (!ref || !ipHash) return true;

  const now = input.now ?? new Date();
  try {
    const previous = await prisma.affiliateClick.findFirst({
      // Usa el índice existente [ref, createdAt]; el ipHash filtra encima.
      where: { ref, ipHash, createdAt: { gte: new Date(now.getTime() - CLICK_DEDUPE_MS) } },
      select: { id: true },
    });
    return previous === null;
  } catch {
    // BD caída, tabla ausente… se cuenta y se sigue. JAMÁS romper la visita.
    return true;
  }
}
