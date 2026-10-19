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
import { PLAN_IDS, isPlanId, type PlanId } from "./plans";
import { isPlanTierUpgrade, subscriptionItemInterval, type BillingInterval } from "./proration";

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
  coupon?: { id?: string | null; percent_off?: number | null; amount_off?: number | null } | null;
  /** Epoch en segundos en que deja de aplicar (cupones «repeating»); null = sin fin. */
  end?: number | null;
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
  metadata?: Record<string, string> | null;
}

const idDe = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v?.id ?? null;

// ── Factura pendiente ───────────────────────────────────────────────────────

/** Estados de una factura que `invoices.pay` cobra: abierta, o incobrable (Stripe la deja así al acabar los reintentos). */
const ESTADOS_PAGABLES = ["open", "uncollectible"];

/**
 * La factura PAGABLE del plan: la más reciente con saldo. Una `open` siempre gana a una `uncollectible`
 * (que es la que Stripe marca al agotar los reintentos y que `invoices.pay` también acepta: sin esto la
 * clínica quedaba sin ningún botón para pagar). Ignora las que no son de este cliente de Stripe (defensa
 * en profundidad: la lista ya se pide por la suscripción de la clínica de la sesión) y las de saldo 0.
 */
export function facturaAbiertaMasReciente(
  facturas: FacturaPago[] | null | undefined,
  customerId: string | null | undefined,
): FacturaPago | null {
  const candidatas = (facturas ?? []).filter((f) => {
    if (!ESTADOS_PAGABLES.includes(f.status ?? "") || !(f.amount_due > 0)) return false;
    const cliente = idDe(f.customer);
    return !customerId || !cliente || cliente === customerId;
  });
  if (candidatas.length === 0) return null;
  const rango = (f: FacturaPago) => (f.status === "open" ? 1 : 0);
  return candidatas.reduce((a, b) => (rango(b) !== rango(a) ? (rango(b) > rango(a) ? b : a) : (b.created ?? 0) > (a.created ?? 0) ? b : a));
}

/** ¿La factura trae el descuento de la promo del primer mes? (informativo: no se altera su monto). */
export function facturaTienePromo(f: Pick<FacturaPago, "discount">): boolean {
  return !!f.discount?.coupon?.id?.startsWith(PREFIJO_CUPON_PROMO);
}

// ── Marca de «subir» en la factura anulada (para terminar un cambio a medias) ──

/**
 * «Subir» anula la factura vieja y DESPUÉS cambia la suscripción. Si el cambio falla de red, la clínica
 * quedaría sin factura abierta. Por eso, ANTES de anular, la factura se marca (metadata de Stripe) con lo
 * que hace falta para que un reintento termine el cambio sin cobrar dos veces:
 *   · plan destino y plan de origen (el de la suscripción al marcar),
 *   · la hora de la marca (epoch en segundos),
 *   · la clave de idempotencia del cambio.
 */
export const MARCA = {
  plan: "pago_pendiente_subir",
  desde: "pago_pendiente_subir_desde",
  ts: "pago_pendiente_subir_ts",
  clave: "pago_pendiente_subir_clave",
} as const;

/** Cuánto tiempo, desde la marca, un reintento puede terminar el cambio. */
export const VENTANA_RECUPERACION_MS = 24 * 60 * 60 * 1000;

/** La hora de la marca, en segundos (también entra en la clave de idempotencia de marcar). */
export const segundosDe = (d: Date): number => Math.floor(d.getTime() / 1000);

export function armarMarca(args: { destino: PlanId; desde: string | null | undefined; clave: string; ahora?: Date }): Record<string, string> {
  return {
    [MARCA.plan]: args.destino,
    [MARCA.desde]: args.desde ?? "",
    [MARCA.ts]: String(segundosDe(args.ahora ?? new Date())),
    [MARCA.clave]: args.clave,
  };
}

export interface AnuladaRecuperable {
  factura: FacturaPago;
  /** Plan al que se iba a subir cuando se anuló. */
  planMarcado: PlanId;
}

/**
 * La factura anulada por este mismo flujo cuyo cambio quedó a medias, o null. Para que cuente:
 *   1. está anulada (`void`), es de este cliente de Stripe y lleva la marca de arriba;
 *   2. la marca tiene menos de 24 h;
 *   3. la suscripción TODAVÍA no se movió: el plan de su metadata es el de origen de la marca y es el que
 *      la clínica tiene. Si el update llegó a Stripe (aunque la respuesta se perdiera) la metadata ya trae
 *      el plan nuevo y esto da null: no se vuelve a cobrar.
 */
export function anuladaRecuperable(args: {
  facturas: FacturaPago[] | null | undefined;
  customerId: string | null | undefined;
  planSuscripcion: string | null | undefined;
  planClinica: string | null | undefined;
  ahora?: Date;
}): AnuladaRecuperable | null {
  const ahoraS = Math.floor((args.ahora ?? new Date()).getTime() / 1000);
  const candidatas: Array<AnuladaRecuperable & { ts: number }> = [];
  for (const f of args.facturas ?? []) {
    if (f.status !== "void") continue;
    const cliente = idDe(f.customer);
    if (args.customerId && cliente && cliente !== args.customerId) continue;
    const m = f.metadata ?? {};
    const planMarcado = m[MARCA.plan];
    const ts = Number(m[MARCA.ts]);
    if (!isPlanId(planMarcado) || !Number.isFinite(ts)) continue;
    if (ahoraS - ts > VENTANA_RECUPERACION_MS / 1000 || ts > ahoraS + 300) continue;
    const desde = m[MARCA.desde] ?? "";
    if (!desde || desde !== args.planClinica) continue;
    if (args.planSuscripcion && args.planSuscripcion !== desde) continue; // la suscripción ya se movió
    candidatas.push({ factura: f, planMarcado, ts });
  }
  if (candidatas.length === 0) return null;
  const mejor = candidatas.reduce((a, b) => (b.ts > a.ts ? b : a));
  return { factura: mejor.factura, planMarcado: mejor.planMarcado };
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

// ── Parámetros de Stripe de «subir» ─────────────────────────────────────────

interface DescuentoListado {
  id: string;
  esPromo: boolean;
  /** Solo si se conoce el cupón (suscripción pedida con `expand: ["discounts"]`). */
  percentOff: number | null;
  amountOffCents: number | null;
  end: number | null;
}

/** Todos los descuentos de la suscripción, sin repetir (el principal y los de `discounts`). */
function listarDescuentos(sub: Pick<SuscripcionPago, "discount" | "discounts">): DescuentoListado[] {
  const todos = new Map<string, DescuentoListado>();
  const anota = (d: DescuentoStripe) => {
    const previo = todos.get(d.id);
    const esPromo = !!d.coupon?.id?.startsWith(PREFIJO_CUPON_PROMO);
    todos.set(d.id, {
      id: d.id,
      esPromo: (previo?.esPromo ?? false) || esPromo,
      percentOff: d.coupon?.percent_off ?? previo?.percentOff ?? null,
      amountOffCents: d.coupon?.amount_off ?? previo?.amountOffCents ?? null,
      end: d.end ?? previo?.end ?? null,
    });
  };
  if (sub.discount?.id) anota(sub.discount);
  for (const d of sub.discounts ?? []) {
    if (typeof d === "string") {
      if (!todos.has(d)) todos.set(d, { id: d, esPromo: false, percentOff: null, amountOffCents: null, end: null });
    } else if (d?.id) {
      anota(d);
    }
  }
  return [...todos.values()];
}

/**
 * Los descuentos que quedan al subir de plan. `undefined` = no tocar los descuentos de la suscripción
 * (no traía la promo). Si traía la promo del primer mes se quita SOLO esa: un descuento que el admin le
 * puso a mano (otro cupón) se conserva. `""` = ya no queda ninguno (así lo pide Stripe para vaciarlos).
 *
 * ⚠️ Decisión pendiente de Rafael (revisión t4 #10): si al subir se quitan TODOS los cupones o se conservan.
 * Hoy se conservan; `descuentosConservados` + `aplicarDescuentos` hacen que el monto que se muestra
 * descuente lo mismo que Stripe va a descontar.
 */
export function descuentosParaSubir(sub: Pick<SuscripcionPago, "discount" | "discounts">): "" | Array<{ discount: string }> | undefined {
  const todos = listarDescuentos(sub);
  if (!todos.some((d) => d.esPromo)) return undefined;
  const quedan = todos.filter((d) => !d.esPromo).map((d) => ({ discount: d.id }));
  return quedan.length > 0 ? quedan : "";
}

/** Los descuentos que SIGUEN aplicando en la factura nueva de «subir» (todos menos la promo; sin los ya vencidos). */
export function descuentosConservados(sub: Pick<SuscripcionPago, "discount" | "discounts">, ahora: Date = new Date()): DescuentoListado[] {
  const todos = listarDescuentos(sub);
  // Sin promo, `descuentosParaSubir` no toca nada: se conserva TODO lo que traiga la suscripción.
  const ahoraS = Math.floor(ahora.getTime() / 1000);
  return todos.filter((d) => !d.esPromo && (d.end === null || d.end > ahoraS));
}

/**
 * Subtotal (centavos, antes de IVA) tras los descuentos conservados, en el orden en que Stripe los aplica a
 * un mismo cobro: porcentaje sobre el importe y monto fijo restado, nunca por debajo de 0. Un descuento cuyo
 * cupón no se conoce no se puede valorar: se ignora (el llamador lo sabe con `descuentoSinValorar`).
 */
export function aplicarDescuentos(subtotalCents: number, descuentos: DescuentoListado[]): number {
  let t = Math.round(subtotalCents);
  for (const d of descuentos) {
    if (d.percentOff) t = Math.round(t * (1 - d.percentOff / 100));
    if (d.amountOffCents) t = Math.max(0, t - d.amountOffCents);
  }
  return t;
}

/** ¿Hay un descuento conservado que no se pudo valorar (no vino su cupón)? */
export function descuentoSinValorar(descuentos: DescuentoListado[]): boolean {
  return descuentos.some((d) => d.percentOff === null && d.amountOffCents === null);
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
  // La hora (`ts`) va en la clave porque es un PARÁMETRO de la llamada: la misma clave con otros parámetros
  // la rechaza Stripe (idempotency_error) durante 24 h.
  marcar: (clinicId: string, facturaId: string, plan: string, ts: number) => `pago-pendiente:marcar:${clinicId}:${facturaId}:${plan}:${ts}`,
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
  stripeNoContesto: "No pudimos completar la operación con el proveedor de pagos. Intenta de nuevo en unos minutos.",
  facturaNoSePuedePagar: "Esta factura ya no se puede pagar. Recarga la página para ver tu estado actual.",
  noHayUrl: "Stripe no devolvió el enlace para pagar. Intenta de nuevo o abre el portal de facturación.",
} as const;
