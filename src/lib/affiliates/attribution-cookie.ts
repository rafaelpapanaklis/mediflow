// Cookie de atribución de afiliado (dc_aff) — PRIMER TOQUE, 90 días.
//
// POR QUÉ EXISTE: hasta ahora la atribución dependía de que ?ref= sobreviviera
// en la URL hasta el registro. Si el visitante entraba por el link del afiliado,
// se iba y volvía tres días después escribiendo dalecontrol.com a mano, el
// afiliado NO cobraba pese a haber hecho el trabajo. Esta cookie cierra ese
// hueco.
//
// ⚠️ SIEMPRE SERVER-SIDE (Set-Cookie desde un route handler), JAMÁS
// document.cookie: Safari (ITP) borra a los 7 días las cookies escritas por
// JavaScript, así que en iPhone los 90 días serían 7.
//
// REGLA DE PRIMER TOQUE: si la cookie ya existe y sigue vigente NO se
// sobrescribe ni se renueva — ni por otro afiliado, ni por otra campaña. El
// primero se queda la atribución sus 90 días; al expirar deja de atribuir a
// nadie (no hay renovación por visitas posteriores).

import type { NextResponse } from "next/server";

export const AFFILIATE_COOKIE = "dc_aff";

/** 90 días duros. Ni se renuevan ni se extienden en visitas posteriores. */
export const AFFILIATE_COOKIE_DAYS = 90;
export const AFFILIATE_COOKIE_MAX_AGE = AFFILIATE_COOKIE_DAYS * 24 * 60 * 60;
const MAX_AGE_MS = AFFILIATE_COOKIE_MAX_AGE * 1000;

/**
 * Valor de la cookie ya parseado y VIGENTE (el parser descarta las expiradas).
 * `ref` es el referralCode del afiliado; `campaign` la campaña del link que
 * trajo al visitante (null si entró por el link base).
 */
export interface AffiliateAttribution {
  ref: string;
  campaign: string | null;
  /** Epoch ms del PRIMER toque. No se actualiza nunca. */
  firstTouchAt: number;
}

// Formato plano "v1.<ref>.<campaign>.<epochMs>" en vez de JSON/base64: ni el
// referralCode ([A-Z0-9]) ni la campaña ([a-z0-9-]) contienen puntos, así que
// el split es inequívoco y la cookie queda legible al depurar en producción.
const COOKIE_VERSION = "v1";
const REF_RE = /^[A-Za-z0-9]{4,24}$/;
const CAMPAIGN_RE = /^[a-z0-9-]{1,40}$/;

/** Serializa para Set-Cookie. Devuelve null si el valor no es válido. */
export function packAttribution(value: AffiliateAttribution): string | null {
  const ref = (value.ref ?? "").trim();
  if (!REF_RE.test(ref)) return null;
  const campaign = value.campaign && CAMPAIGN_RE.test(value.campaign) ? value.campaign : "";
  const ts = Number.isFinite(value.firstTouchAt) ? Math.floor(value.firstTouchAt) : 0;
  if (ts <= 0) return null;
  return `${COOKIE_VERSION}.${ref}.${campaign}.${ts}`;
}

/**
 * Parsea el valor crudo de la cookie. Devuelve null si está corrupta, es de
 * otra versión o YA EXPIRÓ.
 *
 * La expiración se revalida aquí aunque maxAge ya la borre en el navegador:
 * una cookie de 91 días que sobreviva (reloj del cliente, proxy que la
 * reinyecte) NO debe atribuir a nadie.
 */
export function parseAttribution(raw: string | null | undefined): AffiliateAttribution | null {
  try {
    const value = (raw ?? "").trim();
    if (!value) return null;

    const parts = value.split(".");
    if (parts.length !== 4) return null;
    const [version, ref, campaign, rawTs] = parts;
    if (version !== COOKIE_VERSION) return null;
    if (!REF_RE.test(ref)) return null;
    if (campaign !== "" && !CAMPAIGN_RE.test(campaign)) return null;

    const firstTouchAt = Number.parseInt(rawTs, 10);
    if (!Number.isFinite(firstTouchAt) || firstTouchAt <= 0) return null;

    // Vencida → como si no existiera. Con margen para relojes adelantados:
    // una fecha en el futuro es basura, no una cookie eterna.
    const age = Date.now() - firstTouchAt;
    if (age > MAX_AGE_MS || age < -MAX_AGE_MS) return null;

    return { ref, campaign: campaign === "" ? null : campaign, firstTouchAt };
  } catch {
    // Una cookie corrupta jamás puede romper un alta ni una redirección.
    return null;
  }
}

/**
 * Escribe la cookie en la respuesta. Solo se llama cuando NO había una
 * vigente (primer toque). Pick<> para aceptar tanto NextResponse.json como
 * NextResponse.redirect, igual que src/lib/auth/two-factor-cookie.ts.
 */
export function setAttributionCookie(
  res: Pick<NextResponse, "cookies">,
  value: AffiliateAttribution,
): boolean {
  const packed = packAttribution(value);
  if (!packed) return false;
  res.cookies.set({
    name: AFFILIATE_COOKIE,
    value: packed,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AFFILIATE_COOKIE_MAX_AGE,
  });
  return true;
}
