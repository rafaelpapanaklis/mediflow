// ═══════════════════════════════════════════════════════════════════════════
// ENLACES DE CONTRATACIÓN SIN LA PROMO DEL PRIMER MES (pedido de Rafael,
// 5-oct-2026). Puro, client-safe.
//
// dalecontrol.com/contratar/basico · /profesional · /clinica abren el registro
// de ESE plan, mensual, y quien entra por ahí paga desde el primer mes el
// precio de lista + IVA: sin el cupón de $19/$29/$39. Solo QUITA la promo;
// nunca baja un precio. Quien llega por /signup sigue igual.
//
// Cómo viaja la marca (nada en la URL):
//   1. La página /contratar/<plan> deja la cookie `dc_contratar=<PLAN>` (sobrevive
//      al ir y volver de Google en el alta con OAuth) y el formulario manda
//      `sinPromo: true`.
//   2. El alta (register / register-oauth) la guarda del lado del servidor en la
//      bitácora de la clínica (lib/billing/sin-promo.server.ts) y borra la cookie.
//   3. La pantalla de pago y el checkout la leen de ahí: otra sesión u otro día
//      da igual.
// La cookie no va firmada a propósito: lo único que puede hacer es QUITAR un
// descuento, así que falsificarla solo sube lo que paga quien la falsifica.
// ═══════════════════════════════════════════════════════════════════════════
import { isPlanId, type PlanId } from "@/lib/billing/plans";

/** El último tramo de la ruta → el plan. Los nombres son los de la portada. */
export const PLAN_POR_RUTA: Readonly<Record<string, PlanId>> = {
  basico: "BASIC",
  profesional: "PRO",
  pro: "PRO",
  clinica: "CLINIC",
};

/** La ruta pública de cada plan (la que se comparte). */
export const RUTA_DE_PLAN: Readonly<Record<PlanId, string>> = {
  BASIC: "/contratar/basico",
  PRO: "/contratar/profesional",
  CLINIC: "/contratar/clinica",
};

export function planDeRuta(tramo: unknown): PlanId | null {
  const k = String(tramo ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return Object.prototype.hasOwnProperty.call(PLAN_POR_RUTA, k) ? PLAN_POR_RUTA[k] : null;
}

/** /contratar es del sitio: el comodín src/app/[slug] nunca llega a él y ninguna clínica lo toma de slug. */
export function esSlugReservadoDeContratar(slug: string): boolean {
  return slug === "contratar";
}

export const COOKIE_CONTRATAR = "dc_contratar";
/** 7 días: lo mismo que dura la elección del alta (eleccion-alta.ts). */
export const COOKIE_CONTRATAR_MAX_AGE = 7 * 24 * 60 * 60;

/** El plan que dejó la cookie, o null si no hay (o no es un plan). */
export function planDeCookieContratar(valor: string | null | undefined): PlanId | null {
  const v = String(valor ?? "").trim().toUpperCase();
  return isPlanId(v) ? v : null;
}

/**
 * ¿El alta viene de un enlace de contratación, y de qué plan? Manda la cookie que dejó la
 * página (sobrevive a Google); sin cookie, el `sinPromo` del formulario del enlace con su plan.
 * null = un alta normal, con todo como siempre.
 */
export function planDelEnlaceDeAlta(
  cuerpo: { sinPromo?: unknown; plan?: unknown } | null | undefined,
  cookie: string | null | undefined,
): PlanId | null {
  const deCookie = planDeCookieContratar(cookie);
  if (deCookie) return deCookie;
  return cuerpo?.sinPromo === true && isPlanId(cuerpo.plan) ? cuerpo.plan : null;
}

/**
 * La promo del primer mes: SOLO tarjeta + mensual + primera contratación, y
 * nunca para una clínica que llegó por un enlace de contratación.
 */
export function aplicaPromoPrimerMes(a: {
  method: string;
  billing: string;
  firstContract: boolean;
  sinPromo: boolean;
}): boolean {
  return a.method === "card" && a.billing === "monthly" && a.firstContract && !a.sinPromo;
}
