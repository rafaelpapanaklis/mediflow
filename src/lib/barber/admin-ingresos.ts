import { Prisma } from "@prisma/client";
import {
  BARBER_ACTIVE_SUBSCRIPTION_STATUSES,
  BARBER_PLAN_IDS,
  isBarberPlanId,
  type BarberPlanId,
} from "@/lib/barber/plan-shared";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — quién PAGA y cuánto entra al mes (panel de plataforma).
 *
 * Puro: sin prisma ni "server-only", para probarlo con `tsx --test` y para
 * que la lista, las métricas de /admin/barberias y el bloque «Barberías» de
 * la portada de /admin digan EL MISMO número.
 *
 * Por qué existe (Rafael, 15-nov-2026): el «MRR de barber» sumaba el precio
 * de lista de TODA matriz con acceso (active/trialing/paid). En producción
 * hay barberías «active» activadas a mano, sin Stripe: no pagan nada y se
 * contaban como ingreso. El ingreso es SOLO lo que cobra Stripe.
 *
 * DOS FUENTES (decisión #5 de Rafael, 15-nov-2026)
 *  · «cobros» — con sql/barber_cobros.sql pegado, cada cobro de Stripe queda
 *    en barber_subscription_payments y lo que Stripe cobra HOY en
 *    barber_subscriptions (cobros.ts → cargarCobrosAdmin):
 *      - PAGA = la matriz tiene un COBRO VIGENTE (un cobro pagado cuyo
 *        periodo no ha vencido) y su estado da acceso. Una reactivada a mano
 *        con un id viejo de Stripe ya NO cuenta (no tiene cobro vigente).
 *      - Su pago al mes = el importe REAL de su suscripción en Stripe
 *        (anual ÷ 12), no el precio de lista de hoy.
 *      - «Cobrado este mes» = la suma de lo que Stripe cobró en el mes.
 *  · «lista» — sin las tablas (antes de pegar el SQL) se queda el criterio
 *    de antes: `stripeSubscriptionId` + "active", a precio de lista, y
 *    «cobrado este mes» sin dato. La UI lo rotula.
 *
 * REGLAS QUE NO CAMBIAN
 *  - CORTESÍA = tiene acceso (active/trialing/paid) pero no paga por Stripe.
 *  - PRUEBA = Stripe en `trialing`: suscripción real, todavía sin cobro.
 *  - SIN PAGAR = sin acceso: pending_payment, past_due, canceled, suspended…
 *  - La MATRIZ es la cuenta: las sucursales heredan el estado de su matriz y
 *    la suscripción se paga una sola vez (ver applyBarberSubscription). Aquí
 *    sólo entran matrices; contar sucursales cobraría dos veces.
 *  - Dinero en Decimal y precios SIEMPRE de `barber_plan_configs` o de Stripe
 *    (los pasa quien llama); aquí no hay un solo importe escrito a mano.
 * ═══════════════════════════════════════════════════════════════════════
 */

export type CobroBarberia = "stripe" | "cortesia" | "prueba" | "sin_pagar";
export type FuenteIngresoBarber = "cobros" | "lista";

/** Único estado de Stripe que cuenta como ingreso del mes. */
export const BARBER_ESTADO_QUE_COBRA = "active";

export interface CuentaParaCobro {
  /** Id de la matriz: con él se busca su registro de cobros. */
  id?: string;
  plan: string | null;
  subscriptionStatus: string | null;
  /** El id o, si ya se resolvió, un booleano «tiene suscripción de Stripe». */
  stripeSubscriptionId: string | boolean | null;
}

/** Lo que el registro de cobros sabe de UNA matriz (cobros.ts lo arma). */
export interface RegistroCobro {
  /** Tiene un cobro pagado cuyo periodo no ha vencido. */
  vigente: boolean;
  /** Pesos al mes que cobra Stripe hoy (anual ÷ 12); null = sin dato. */
  mensual: Prisma.Decimal | null;
  /** Cobrado en el mes en curso, en pesos. */
  cobradoMes: Prisma.Decimal;
}

/** El registro completo; null/undefined = tablas sin pegar (fuente «lista»). */
export interface RegistroCobros {
  porBarberia: Map<string, RegistroCobro>;
  cobradoMes: Prisma.Decimal;
}

function registroDe(shop: CuentaParaCobro, cobros: RegistroCobros | null | undefined): RegistroCobro | null {
  if (!cobros || !shop.id) return null;
  return cobros.porBarberia.get(shop.id) ?? null;
}

export function clasificarCobro(
  shop: Omit<CuentaParaCobro, "plan">,
  cobros?: RegistroCobros | null,
): CobroBarberia {
  const status = shop.subscriptionStatus ?? "";
  if (!BARBER_ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return "sin_pagar";
  const conStripe = Boolean(shop.stripeSubscriptionId);
  if (cobros) {
    if (registroDe(shop as CuentaParaCobro, cobros)?.vigente) return "stripe";
  } else if (conStripe && status === BARBER_ESTADO_QUE_COBRA) {
    return "stripe";
  }
  if (conStripe && status === "trialing") return "prueba";
  return "cortesia";
}

const CERO = new Prisma.Decimal(0);

function planDe(plan: string | null): BarberPlanId {
  return isBarberPlanId(plan) ? plan : "BASICO";
}

/**
 * Lo que esta matriz le paga HOY al mes a DaleControl: $0 si no paga; si
 * paga, el importe REAL de Stripe (con registro) o su plan a precio de lista
 * (sin registro, o con registro pero sin términos guardados todavía).
 */
export function pagoMensual(
  shop: CuentaParaCobro,
  precios: Partial<Record<BarberPlanId, Prisma.Decimal>>,
  cobros?: RegistroCobros | null,
): Prisma.Decimal {
  if (clasificarCobro(shop, cobros) !== "stripe") return CERO;
  const real = registroDe(shop, cobros)?.mensual;
  if (real) return real;
  return precios[planDe(shop.plan)] ?? CERO;
}

export interface ResumenIngresosBarber {
  /** Matrices dadas de alta (cualquier estado). Una sucursal no es una barbería más. */
  barberias: number;
  pagan: number;
  cortesia: number;
  prueba: number;
  sinPagar: number;
  /** Ingreso mensual recurrente: sólo las que pagan por Stripe. String decimal ("749.00"). */
  mrr: string;
  porPlan: { planId: BarberPlanId; pagan: number; mrr: string }[];
  /** «cobros» = importes reales de Stripe; «lista» = sin registro, a precio de lista. */
  fuente?: FuenteIngresoBarber;
  /** Lo que Stripe cobró en el mes en curso (México). null = sin registro. */
  cobradoMes?: string | null;
}

/** Resumen de cobro del vertical a partir de las MATRICES (parentId = null). */
export function resumirIngresosBarber(
  matrices: CuentaParaCobro[],
  precios: Partial<Record<BarberPlanId, Prisma.Decimal>>,
  cobros?: RegistroCobros | null,
): ResumenIngresosBarber {
  const cuenta: Record<CobroBarberia, number> = { stripe: 0, cortesia: 0, prueba: 0, sin_pagar: 0 };
  const porPlan = new Map<BarberPlanId, { pagan: number; mrr: Prisma.Decimal }>(
    BARBER_PLAN_IDS.map((id) => [id, { pagan: 0, mrr: CERO }]),
  );
  let mrr = CERO;
  for (const m of matrices) {
    const cobro = clasificarCobro(m, cobros);
    cuenta[cobro] += 1;
    if (cobro !== "stripe") continue;
    const monto = pagoMensual(m, precios, cobros);
    mrr = mrr.add(monto);
    const b = porPlan.get(planDe(m.plan))!;
    b.pagan += 1;
    b.mrr = b.mrr.add(monto);
  }
  return {
    barberias: matrices.length,
    pagan: cuenta.stripe,
    cortesia: cuenta.cortesia,
    prueba: cuenta.prueba,
    sinPagar: cuenta.sin_pagar,
    mrr: mrr.toFixed(2),
    porPlan: BARBER_PLAN_IDS.map((planId) => {
      const b = porPlan.get(planId)!;
      return { planId, pagan: b.pagan, mrr: b.mrr.toFixed(2) };
    }),
    fuente: cobros ? "cobros" : "lista",
    cobradoMes: cobros ? cobros.cobradoMes.toFixed(2) : null,
  };
}
