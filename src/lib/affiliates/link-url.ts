// URL pública de los links de afiliado — fuente ÚNICA.
//
// Antes esta plantilla estaba escrita a mano en tres sitios (dos routes de API
// del panel y la page SSR de /afiliados/herramientas), así que
// un link recién creado y uno ya existente podían mostrarse con formatos
// distintos en la misma pantalla.
//
// Forma actual: /r/<publicCode> — código opaco de 8 caracteres. La histórica
// /socio/<slug>?c=<campaign> sigue viva y se usa como fallback para los links
// creados antes de la migración (publicCode null): nada de lo ya compartido en
// WhatsApp o impreso en un QR deja de funcionar.

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/seo";

/** Base sin barra final. */
export function siteBase(): string {
  return SITE_URL.replace(/\/$/, "");
}

/** URL corta de un link con publicCode: https://.../r/<code> */
export function shortLinkUrl(publicCode: string): string {
  return `${siteBase()}/r/${publicCode}`;
}

/** URL histórica de campaña: https://.../socio/<slug>?c=<campaign> */
export function legacyCampaignUrl(slug: string, campaign: string): string {
  return `${siteBase()}/socio/${slug}?c=${campaign}`;
}

/**
 * URL a mostrar/copiar de un link. Corta si el link ya tiene publicCode;
 * si no, la histórica (links creados antes de la migración).
 */
export function affiliateLinkUrl(link: {
  publicCode?: string | null;
  campaign: string;
}, slug: string): string {
  return link.publicCode ? shortLinkUrl(link.publicCode) : legacyCampaignUrl(slug, link.campaign);
}

/**
 * URL del link BASE del afiliado (sin campaña): /r/<referralCode>.
 * /r resuelve también los referralCode, así que el afiliado tiene una sola
 * forma de URL que compartir para todo.
 */
export function baseReferralUrl(referralCode: string): string {
  return `${siteBase()}/r/${referralCode}`;
}

// Alfabeto plano [a-z0-9]: el código va en la URL y debe sobrevivir a que
// alguien lo dicte o lo escriba en minúsculas. /r lo resuelve normalizado.
const PUBLIC_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const PUBLIC_CODE_LENGTH = 8;

/**
 * Código opaco aleatorio. randomBytes (no Math.random): un código adivinable
 * dejaría que cualquiera manipulara las campañas de otro afiliado.
 * Rechazo por módulo para no sesgar el alfabeto de 36 sobre 256.
 */
export function randomPublicCode(len: number = PUBLIC_CODE_LENGTH): string {
  const n = PUBLIC_CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // 252 → descarta 252..255
  let out = "";
  while (out.length < len) {
    const bytes = randomBytes(len * 2);
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      const b = bytes[i];
      if (b < limit) out += PUBLIC_CODE_ALPHABET[b % n];
    }
  }
  return out;
}

/**
 * Genera un publicCode único global (la columna es @unique). Reintenta hasta
 * 10 veces; si todas colisionaran —imposible en la práctica: 36^8 ≈ 2.8
 * billones— cae a un código más largo, que sigue siendo válido para /r.
 *
 * Devuelve null si la columna aún no existe en la BD (SQL sin correr): el
 * link se crea igual y se muestra con su URL histórica.
 */
export async function generateLinkPublicCode(): Promise<string | null> {
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = randomPublicCode();
      const existing = await prisma.affiliateLink.findUnique({
        where: { publicCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    return randomPublicCode(PUBLIC_CODE_LENGTH + 4);
  } catch {
    return null;
  }
}
