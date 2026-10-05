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
import { desgloseConIva } from "@/lib/billing/iva-cobro";

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

// ── Encargo 7 (Rafael, 5-oct-2026): el enlace arranca en ANUAL y deja pasar a MENSUAL ──────────
// Ninguno de los dos lleva la promo. Los precios vienen de plan_configs (priceMxn y
// priceMxnAnnual, MXN antes de IVA); aquí solo se hacen las cuentas, en centavos.

export type PeriodoDelEnlace = "annual" | "monthly";
/** Periodo con el que arranca el enlace. */
export const PERIODO_INICIAL_DEL_ENLACE: PeriodoDelEnlace = "annual";

export interface CuentasDelEnlace {
  billing: PeriodoDelEnlace;
  /** Lo que se cobra por periodo, antes de IVA (el unit_amount del checkout). */
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
  /** Solo anual: el precio anual entre 12 (antes de IVA) y con IVA. */
  equivaleMesCents: number | null;
  equivaleMesConIvaCents: number | null;
  /** Solo anual: 12 meses al precio de lista, lo que se ahorra y su porcentaje. */
  doceMesesCents: number | null;
  ahorroCents: number | null;
  pctAhorro: number | null;
}

export function cuentasDelEnlace(
  plan: { priceMxn: number; priceMxnAnnual: number },
  billing: PeriodoDelEnlace,
): CuentasDelEnlace {
  const anual = billing === "annual";
  const d = desgloseConIva(Math.round((anual ? plan.priceMxnAnnual : plan.priceMxn) * 100));
  if (!anual) {
    return { billing, ...d, equivaleMesCents: null, equivaleMesConIvaCents: null, doceMesesCents: null, ahorroCents: null, pctAhorro: null };
  }
  const doceMesesCents = Math.round(plan.priceMxn * 100) * 12;
  const ahorroCents = Math.max(0, doceMesesCents - d.subtotalCents);
  return {
    billing,
    ...d,
    equivaleMesCents: Math.round(d.subtotalCents / 12),
    equivaleMesConIvaCents: Math.round(d.totalCents / 12),
    doceMesesCents,
    ahorroCents,
    pctAhorro: doceMesesCents > 0 ? Math.round((ahorroCents / doceMesesCents) * 100) : 0,
  };
}

/** «$13,472.24»: pesos con centavos, separador de miles de es-MX. */
export function pesos(centavos: number): string {
  return "$" + (centavos / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Las líneas que enseñan el registro y la pantalla de pago (mismo texto en las dos). */
export function lineasDelEnlace(c: CuentasDelEnlace, plan: { priceMxn: number }): { titulo: string; detalle: string[] } {
  if (c.billing === "annual") {
    return {
      titulo: `Pago anual: ${pesos(c.subtotalCents)} + IVA ${pesos(c.ivaCents)} = ${pesos(c.totalCents)} al año`,
      detalle: [
        `Equivale a ${pesos(c.equivaleMesCents!)} al mes + IVA (${pesos(c.equivaleMesConIvaCents!)} con IVA)`,
        `Ahorras ${pesos(c.ahorroCents!)} (${c.pctAhorro}%) contra 12 meses de ${pesos(Math.round(plan.priceMxn * 100))} (${pesos(c.doceMesesCents!)})`,
      ],
    };
  }
  return {
    titulo: `Pago mensual: ${pesos(c.subtotalCents)} + IVA ${pesos(c.ivaCents)} = ${pesos(c.totalCents)} al mes`,
    detalle: ["Precio de lista, sin promoción · cancela cuando quieras"],
  };
}
