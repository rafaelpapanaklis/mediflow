/**
 * Afiliados — guardia de conteo de clics (cableado a Prisma).
 *
 * UN SOLO lugar decide si una visita SUMA. Las tres superficies que cuentan
 * (`/r/<code>`, `/socio/<slug>` y `POST /api/afiliados/track`) lo consultan
 * antes de tocar cualquier contador, así que el criterio no se puede desfasar
 * entre ellas.
 *
 * EL CRITERIO vive en click-guard-core.ts (puro y probado). Aquí solo se le
 * enchufa la consulta real a `affiliate_clicks` y se guarda la fila.
 */

import { prisma } from "@/lib/prisma";
import {
  decideClickCount,
  type ClickGuardInput,
  type RecentClickLookup,
} from "./click-guard-core";

// Re-exports para no romper a quien ya importaba desde aquí.
export {
  CLICK_DEDUPE_MS,
  CLICK_IP_FALLBACK_MS,
  isBotUserAgent,
  type ClickGuardInput,
} from "./click-guard-core";

/**
 * Consulta de clic previo. Devuelve `null` si la consulta NO se pudo hacer
 * (BD caída, o `vid` todavía sin aplicar en la BD): el core distingue ese caso
 * de "no encontré nada" y degrada en vez de contar a ciegas.
 */
const prismaLookup: RecentClickLookup = async (query) => {
  try {
    const previous = await prisma.affiliateClick.findFirst({
      // Usa el índice existente [ref, createdAt]; el resto filtra encima (la
      // ventana más larga es de 30 min, así que son poquísimas filas).
      where: {
        ref: query.ref,
        createdAt: { gte: query.since },
        ...(query.vid ? { vid: query.vid } : {}),
        ...(query.ipHash ? { ipHash: query.ipHash } : {}),
        // `undefined` no filtra; `null` SÍ (busca filas con userAgent nulo).
        ...(query.userAgent !== undefined ? { userAgent: query.userAgent } : {}),
      },
      select: { id: true },
    });
    return previous !== null;
  } catch {
    return null;
  }
};

/**
 * ¿Esta visita suma un clic?
 *
 * `false` significa "no incrementes el contador y no insertes la fila" — nada
 * más. La redirección, la cookie y el render de la página siguen su curso.
 */
export async function shouldCountAffiliateClick(input: ClickGuardInput): Promise<boolean> {
  return decideClickCount(input, prismaLookup);
}

/** Fila de clic. `vid` es el dc_vid EFECTIVO (el que trae o el recién sembrado). */
export interface AffiliateClickRecord {
  affiliateId: string;
  ref: string;
  campaign: string | null;
  landingPage: string | null;
  ipHash: string | null;
  userAgent: string | null;
  vid: string | null;
}

/**
 * Guarda la fila del clic. Nunca lanza.
 *
 * El `vid` que se guarda es el EFECTIVO, no el que trajo la petición: en la
 * primera visita se acaba de sembrar la cookie, y si la fila no lo llevara, la
 * recarga siguiente no encontraría con qué deduplicar y contaría de nuevo.
 *
 * Si `sql/affiliate-click-vid.sql` todavía no se corrió, la columna no existe
 * y el insert truena: se reintenta SIN `vid` antes que perder el clic. La
 * cuenta degrada al respaldo corto por IP (el comportamiento de antes), no a
 * cero clics.
 */
export async function createAffiliateClick(data: AffiliateClickRecord): Promise<void> {
  try {
    await prisma.affiliateClick.create({ data });
    return;
  } catch {
    // Silencio: sin clic registrado, pero con redirección y cookie intactas.
  }

  if (!data.vid) return; // el fallo no fue por la columna nueva
  try {
    const { vid, ...withoutVid } = data;
    await prisma.affiliateClick.create({ data: withoutVid });
  } catch {
    /* noop */
  }
}
