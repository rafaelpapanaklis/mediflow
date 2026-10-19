/**
 * «Pagar mi plan» y «Subir de plan y pagar» tras un cobro de tarjeta rechazado — núcleo PURO.
 *
 * Sin prisma, sin cliente de Stripe (solo tipos mínimos de lo que se lee): lo importan el servicio
 * (`pago-pendiente.server.ts`), la ruta `/api/billing/pago-pendiente` y sus pruebas.
 *
 * REGLAS DE NEGOCIO (Rafael):
 *   · Subir de plan es en la MISMA suscripción (nunca otra: cero doble cobro). Se anula la factura
 *     abierta del plan viejo y la suscripción pasa al plan nuevo cobrándolo COMPLETO en ese momento:
 *     ciclo nuevo desde hoy (`billing_cycle_anchor: "now"`), sin prorrateo.
 *   · NUNCA con la promo del primer mes ($19/$29/$39): precio de lista del plan nuevo. Si la
 *     suscripción aún arrastra el descuento de esa promo, se le quita al subir.
 *   · IVA: la regla de siempre para un cambio de plan (`ivaParaPagoDeClinica`, Ajuste 1c).
 *   · Solo planes MÁS GRANDES que el actual.
 */

import { z } from "zod";
import { PLAN_IDS, type PlanId } from "./plans";
import {
  desgloseConIva,
  ivaAplica,
  type ExencionIva,
  type IvaParaCobro,
} from "./iva-cobro";
import {
  isPlanTierUpgrade,
  planAmountCents,
  subscriptionItemInterval,
  type BillingInterval,
  type PlanPricing,
} from "./proration";

/** Moneda del contrato: todos los planes se cobran en pesos. */
export const MONEDA_PAGO = "MXN" as const;

/**
 * Prefijo del cupón de la promo del primer mes (ver `ensureFirstMonthCoupon` en first-month-promo.ts:
 * `dc-first-month-<plan>-<centavos>` y `dc-first-month-iva-<plan>-<centavos>`). Es la única forma de
 * reconocerlo en Stripe; si ese id cambia, la prueba «la promo se quita al subir» lo avisa.
 */
export const PREFIJO_CUPON_PROMO = "dc-first-month-";

// ── Respuesta HTTP ──────────────────────────────────────────────────────────

export interface RespuestaPago {
  status: number;
  body: Record<string, unknown>;
}

export const respuesta = (status: number, body: Record<string, unknown>): RespuestaPago => ({ status, body });

// ── Cuerpo del POST ─────────────────────────────────────────────────────────

const CuerpoSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("pagar") }),
  z.object({ accion: z.literal("subir"), plan: z.enum(PLAN_IDS) }),
]);

export type CuerpoPago = z.infer<typeof CuerpoSchema>;

/** 400 si el cuerpo no es `{accion:"pagar"}` ni `{accion:"subir", plan}` con un plan que existe. */
export function parsearCuerpo(body: unknown): { ok: true; cuerpo: CuerpoPago } | { ok: false; respuesta: RespuestaPago } {
  const r = CuerpoSchema.safeParse(body);
  if (r.success) return { ok: true, cuerpo: r.data };
  return {
    ok: false,
    respuesta: respuesta(400, {
      code: "CUERPO_INVALIDO",
      error: 'Envía { "accion": "pagar" } o { "accion": "subir", "plan": "<plan>" } con un plan válido.',
    }),
  };
}

// ── Tipos mínimos de lo que se lee de Stripe ────────────────────────────────

interface DescuentoStripe {
  id: string;
  coupon?: { id?: string | null } | null;
}

export interface SuscripcionPago {
  id: string;
  status: string;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  items: { data: Array<{ id: string; price?: { unit_amount?: number | null; recurring?: { interval?: string | null } | null } | null }> };
  /** API 2024-06-20: el descuento principal viene con su cupón. */
  discount?: DescuentoStripe | null;
  /** Ids (o descuentos expandidos) de todos los descuentos de la suscripción. */
  discounts?: Array<string | DescuentoStripe> | null;
}

export interface FacturaPago {
  id: string;
  status?: string | null;
  amount_due: number;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  customer?: string | { id: string } | null;
  created?: number | null;
  attempt_count?: number | null;
  discount?: DescuentoStripe | null;
}

const idDe = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v?.id ?? null;

// ── Factura abierta ─────────────────────────────────────────────────────────

/**
 * La factura ABIERTA del plan: la más reciente con saldo. Ignora las que no son de este cliente de
 * Stripe (defensa en profundidad: la lista ya se pide por la suscripción de la clínica de la sesión) y
 * las de saldo 0 (nada que cobrar).
 */
export function facturaAbiertaMasReciente(
  facturas: FacturaPago[] | null | undefined,
  customerId: string | null | undefined,
): FacturaPago | null {
  const candidatas = (facturas ?? []).filter((f) => {
    if (f.status !== "open" || !(f.amount_due > 0)) return false;
    const cliente = idDe(f.customer);
    return !customerId || !cliente || cliente === customerId;
  });
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => ((b.created ?? 0) > (a.created ?? 0) ? b : a));
}

/** ¿La factura trae el descuento de la promo del primer mes? (informativo: no se altera su monto). */
export function facturaTienePromo(f: Pick<FacturaPago, "discount">): boolean {
  return !!f.discount?.coupon?.id?.startsWith(PREFIJO_CUPON_PROMO);
}

// ── Opciones de subida (GET) ────────────────────────────────────────────────

/** Los planes más grandes que el actual, en el orden canónico (BASIC → PRO → CLINIC). */
export function planesMasGrandes(planActual: string | null | undefined): PlanId[] {
  return PLAN_IDS.filter((p) => isPlanTierUpgrade(planActual, p));
}

/** ¿Este plan es más grande que el actual? */
export function esPlanMasGrande(planActual: string | null | undefined, plan: string): boolean {
  return (PLAN_IDS as readonly string[]).includes(plan) && isPlanTierUpgrade(planActual, plan);
}

export interface OpcionSubir {
  plan: PlanId;
  nombre: string;
  /** Pesos, exactos: lo que se cobra HOY por el plan nuevo completo (con IVA si `ivaIncluido`). */
  monto: number;
  ivaIncluido: boolean;
}

/**
 * Lo que costaría el plan nuevo hoy: precio de lista del plan en el intervalo de la suscripción
 * (nunca la promo del primer mes ni los precios conservados de la clínica) más el IVA que corresponde.
 */
export function opcionDeSubida(args: {
  plan: PlanPricing & { id: PlanId };
  interval: BillingInterval;
  exencion: ExencionIva | null | undefined;
}): OpcionSubir {
  const subtotalCents = planAmountCents(args.plan, args.interval);
  const conIva = ivaAplica({ metodo: "card", plan: args.plan.id, exencion: args.exencion });
  const totalCents = conIva ? desgloseConIva(subtotalCents).totalCents : subtotalCents;
  return { plan: args.plan.id, nombre: args.plan.name, monto: totalCents / 100, ivaIncluido: conIva };
}

// ── Parámetros de Stripe de «subir» ─────────────────────────────────────────

/**
 * Los descuentos que quedan al subir de plan. `undefined` = no tocar los descuentos de la suscripción
 * (no traía la promo). Si traía la promo del primer mes se quita SOLO esa: un descuento que el admin le
 * puso a mano (otro cupón) se conserva. `""` = ya no queda ninguno (así lo pide Stripe para vaciarlos).
 */
export function descuentosParaSubir(sub: Pick<SuscripcionPago, "discount" | "discounts">): "" | Array<{ discount: string }> | undefined {
  const todos = new Map<string, boolean>(); // id → ¿es la promo?
  const anota = (d: DescuentoStripe) => {
    const esPromo = !!d.coupon?.id?.startsWith(PREFIJO_CUPON_PROMO);
    todos.set(d.id, (todos.get(d.id) ?? false) || esPromo);
  };
  if (sub.discount?.id) anota(sub.discount);
  for (const d of sub.discounts ?? []) {
    if (typeof d === "string") {
      if (!todos.has(d)) todos.set(d, false);
    } else if (d?.id) {
      anota(d);
    }
  }
  const hayPromo = [...todos.values()].some(Boolean);
  if (!hayPromo) return undefined;
  const quedan = [...todos.entries()].filter(([, promo]) => !promo).map(([id]) => ({ discount: id }));
  return quedan.length > 0 ? quedan : "";
}

export interface ParamsSubir {
  items: Array<{ id: string; price: string; tax_rates?: string[] }>;
  proration_behavior: "none";
  billing_cycle_anchor: "now";
  metadata: Record<string, string>;
  expand: string[];
  automatic_tax?: { enabled: true };
  discounts?: "" | Array<{ discount: string }>;
}

/**
 * Arma el `subscriptions.update` de «subir». INVARIANTES (los fija la prueba):
 *   · `billing_cycle_anchor: "now"` + `proration_behavior: "none"`: ciclo nuevo desde hoy, plan nuevo
 *     COMPLETO, sin prorrateo ni crédito del viejo.
 *   · SIN `payment_behavior: "error_if_incomplete"`: la factura vieja ya está anulada; si la tarjeta
 *     vuelve a fallar la actualización debe quedar hecha y la factura nueva abierta (para pagarla por
 *     la URL), no revertida dejando a la clínica sin ninguna factura que pagar.
 *   · el plan va en la metadata de la suscripción (convención de change-plan: el webhook la usa).
 */
export function armarUpdateSubir(args: {
  sub: SuscripcionPago;
  itemId: string;
  priceId: string;
  plan: PlanId;
  clinicId: string;
  iva: Extract<IvaParaCobro, { ok: true }>;
}): ParamsSubir {
  const descuentos = descuentosParaSubir(args.sub);
  return {
    items: [{ id: args.itemId, price: args.priceId, ...(args.iva.linea.tax_rates ? { tax_rates: args.iva.linea.tax_rates } : {}) }],
    proration_behavior: "none",
    billing_cycle_anchor: "now",
    metadata: { ...(args.sub.metadata ?? {}), clinicId: args.clinicId, plan: args.plan, kind: "platform-subscription" },
    expand: ["latest_invoice"],
    ...(args.iva.modo === "automatico" ? { automatic_tax: { enabled: true as const } } : {}),
    ...(descuentos !== undefined ? { discounts: descuentos } : {}),
  };
}

export { subscriptionItemInterval };

// ── Idempotencia ────────────────────────────────────────────────────────────

/**
 * Claves de idempotencia de Stripe: clínica + factura + acción (+ lo que distingue un intento nuevo).
 *
 *   · pagar: lleva `attempt_count` de la factura. Dos POST seguidos comparten clave (y Stripe cobra una
 *     sola vez); en cuanto un intento falla la factura suma un intento y la clave cambia, así que la
 *     persona que corrige su tarjeta y reintenta NO recibe el rechazo cacheado de 24 h.
 *   · subir: lleva el plan destino. Reintentar el mismo cambio devuelve la misma actualización.
 */
export const claves = {
  pagar: (clinicId: string, facturaId: string, intentos: number | null | undefined) =>
    `pago-pendiente:pagar:${clinicId}:${facturaId}:${intentos ?? 0}`,
  anular: (clinicId: string, facturaId: string) => `pago-pendiente:anular:${clinicId}:${facturaId}`,
  subir: (clinicId: string, facturaId: string, plan: string) => `pago-pendiente:subir:${clinicId}:${facturaId}:${plan}`,
  precio: (clinicId: string, plan: string, interval: BillingInterval, cents: number) =>
    `pago-pendiente:precio:${clinicId}:${plan}:${interval}:${cents}`,
};

// ── Mensajes (español neutro, con tú) ───────────────────────────────────────

export const MENSAJES = {
  sinPendiente: "No tienes ningún pago pendiente.",
  sinPermiso: "Solo el dueño o un administrador de la clínica puede pagar o cambiar el plan.",
  planNoMasGrande: "Solo puedes subir a un plan más grande que el que tienes.",
  stripeNoContesto: "Stripe no respondió. Intenta de nuevo en unos minutos.",
  noHayUrl: "Stripe no devolvió el enlace para pagar. Intenta de nuevo o abre el portal de facturación.",
} as const;
