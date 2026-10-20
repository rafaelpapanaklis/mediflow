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
import { MENSAJES_CHECKOUT } from "./mensajes-pago";
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
  customer?: string | { id: string; discount?: { id: string; coupon?: { id?: string | null } | null; promotion_code?: string | { id: string } | null; start?: number | null; end?: number | null } | null } | null;
  metadata?: Record<string, string> | null;
  /** Cobro en pausa (prepago de varios meses, o ciclo re-alineado tras una suspensión). */
  pause_collection?: { behavior?: string | null; resumes_at?: number | null } | null;
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
  /** Total de la factura (después de descuentos, antes de saldo a favor). */
  total?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  customer?: string | { id: string } | null;
  created?: number | null;
  attempt_count?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
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

/** Ids de TODOS los descuentos de la suscripción, sin repetir (el principal y los de `discounts`). */
export function idsDeDescuentos(sub: Pick<SuscripcionPago, "discount" | "discounts">): string[] {
  const ids = new Set<string>();
  if (sub.discount?.id) ids.add(sub.discount.id);
  for (const d of sub.discounts ?? []) {
    const id = typeof d === "string" ? d : d?.id;
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Ids de los descuentos que son la promo del primer mes (informativo: la bitácora lo distingue). */
export function idsDePromo(sub: Pick<SuscripcionPago, "discount" | "discounts">): string[] {
  const promo = new Set<string>();
  for (const d of [sub.discount, ...(sub.discounts ?? [])]) {
    if (d && typeof d === "object" && d.id && d.coupon?.id?.startsWith(PREFIJO_CUPON_PROMO)) promo.add(d.id);
  }
  return [...promo];
}

/**
 * Los descuentos de la suscripción al subir de plan. DECISIÓN DE RAFAEL (#10): al subir de plan se paga el
 * precio normal del plan, sin cupones —ni la promo del primer mes ni uno que haya puesto un admin—, así que
 * se quitan TODOS. `undefined` = la suscripción no trae ninguno (no se manda nada); `""` = vaciarlos
 * (así lo pide Stripe). Por eso el «Vas a pagar» del GET es siempre lista + IVA, sin restar nada.
 * «Pagar mi plan» no pasa por aquí: cobra la factura abierta tal cual.
 */
export function descuentosParaSubir(sub: Pick<SuscripcionPago, "discount" | "discounts">): "" | undefined {
  return idsDeDescuentos(sub).length > 0 ? "" : undefined;
}

/** ¿Stripe rechazó la petición por una clave de idempotencia en curso / con otros parámetros? */
export function esErrorDeIdempotencia(err: unknown): boolean {
  const e = err as { code?: string; type?: string; raw?: { code?: string; type?: string } } | null;
  return (e?.code ?? e?.raw?.code) === "idempotency_error" || (e?.type ?? e?.raw?.type) === "StripeIdempotencyError";
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
  candadoSubir: (clinicId: string) => `pago-pendiente:subir:${clinicId}`,
  reponerDescuentoCliente: (clinicId: string, descuentoId: string) => `pago-pendiente:reponer-descuento-cliente:${clinicId}:${descuentoId}`,
  quitarDescuentoCliente: (clinicId: string, descuentoId: string) => `pago-pendiente:quitar-descuento-cliente:${clinicId}:${descuentoId}`,
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
  stripeNoContesto: MENSAJES_CHECKOUT.proveedorNoContesto,
  cambioEnCurso: "Ya hay un cambio de plan en curso, espera unos segundos.",
  // Verdadero en los dos casos en que el cobro está en pausa: meses pagados por adelantado, o el mes que se pagó al
  // reactivarse tras una suspensión (revisión t4, M7). No dice «por adelantado».
  cobroEnPausa: "Tu plan ya está pagado por ahora, así que no podemos cambiártelo desde aquí. Escríbenos a soporte y lo hacemos contigo.",
  pagoYaRegistrado: "Tu pago ya se registró.",
  subidaSinCobro: "No pudimos completar el cobro del cambio de plan. Escríbenos a soporte y lo revisamos contigo.",
  facturaNoSePuedePagar: "Esta factura ya no se puede pagar. Recarga la página para ver tu estado actual.",
  noHayUrl: MENSAJES_CHECKOUT.noPudimosAbrirPago,
  pagosNoDisponibles: MENSAJES_CHECKOUT.pagosNoDisponibles,
  sinPlanAsociado: MENSAJES_CHECKOUT.sinPlanAsociado,
} as const;
