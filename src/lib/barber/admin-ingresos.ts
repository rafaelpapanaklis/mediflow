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
 * REGLAS
 *  - PAGA = la matriz tiene `stripeSubscriptionId` Y su estado es "active"
 *    (el que escribe el webhook cuando Stripe cobró). Mismo criterio que el
 *    MRR del dental: sólo "active" suma; un `past_due` (Stripe reintentando)
 *    o un `trialing` (todavía sin cobro) no son dinero.
 *  - CORTESÍA = tiene acceso (active/trialing/paid) pero no por una
 *    suscripción de Stripe que cobre. Activada a mano: NO es ingreso.
 *  - PRUEBA = Stripe en `trialing`: suscripción real, todavía sin cobro.
 *  - SIN PAGAR = sin acceso: pending_payment, past_due, canceled, suspended…
 *  - La MATRIZ es la cuenta: las sucursales heredan el estado de su matriz y
 *    la suscripción se paga una sola vez (ver applyBarberSubscription). Aquí
 *    sólo entran matrices; contar sucursales cobraría dos veces.
 *  - Dinero en Decimal y precios SIEMPRE de `barber_plan_configs` (los pasa
 *    quien llama); en este archivo no hay un solo importe escrito a mano.
 *
 * LÍMITE CONOCIDO: el `stripeSubscriptionId` no se limpia al cancelar. Una
 * barbería que canceló en Stripe y luego se REACTIVÓ a mano desde el admin
 * queda «active» con el id viejo y saldría como «paga». Sin una llamada a
 * Stripe o una tabla de cobros no se distingue; hoy no hay ninguna así.
 * ═══════════════════════════════════════════════════════════════════════
 */

export type CobroBarberia = "stripe" | "cortesia" | "prueba" | "sin_pagar";

/** Único estado de Stripe que cuenta como ingreso del mes. */
export const BARBER_ESTADO_QUE_COBRA = "active";

export interface CuentaParaCobro {
  plan: string | null;
  subscriptionStatus: string | null;
  /** El id o, si ya se resolvió, un booleano «tiene suscripción de Stripe». */
  stripeSubscriptionId: string | boolean | null;
}

export function clasificarCobro(shop: Omit<CuentaParaCobro, "plan">): CobroBarberia {
  const status = shop.subscriptionStatus ?? "";
  if (!BARBER_ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return "sin_pagar";
  const conStripe = Boolean(shop.stripeSubscriptionId);
  if (conStripe && status === BARBER_ESTADO_QUE_COBRA) return "stripe";
  if (conStripe && status === "trialing") return "prueba";
  return "cortesia";
}

const CERO = new Prisma.Decimal(0);

function planDe(plan: string | null): BarberPlanId {
  return isBarberPlanId(plan) ? plan : "BASICO";
}

/** Lo que esta matriz le paga HOY al mes a DaleControl: su plan si paga por Stripe; $0 si no. */
export function pagoMensual(
  shop: CuentaParaCobro,
  precios: Partial<Record<BarberPlanId, Prisma.Decimal>>,
): Prisma.Decimal {
  if (clasificarCobro(shop) !== "stripe") return CERO;
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
}

/** Resumen de cobro del vertical a partir de las MATRICES (parentId = null). */
export function resumirIngresosBarber(
  matrices: CuentaParaCobro[],
  precios: Partial<Record<BarberPlanId, Prisma.Decimal>>,
): ResumenIngresosBarber {
  const cuenta: Record<CobroBarberia, number> = { stripe: 0, cortesia: 0, prueba: 0, sin_pagar: 0 };
  const porPlan = new Map<BarberPlanId, { pagan: number; mrr: Prisma.Decimal }>(
    BARBER_PLAN_IDS.map((id) => [id, { pagan: 0, mrr: CERO }]),
  );
  let mrr = CERO;
  for (const m of matrices) {
    const cobro = clasificarCobro(m);
    cuenta[cobro] += 1;
    if (cobro !== "stripe") continue;
    const monto = pagoMensual(m, precios);
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
  };
}
