import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";

/**
 * PAGO MANUAL CONFIRMADO ⇒ la factura de tarjeta del plan queda PAGADA FUERA DE STRIPE (ws1-t1).
 *
 * Decisión de Rafael (#1(a) de la revisión): si una clínica con la tarjeta rechazada paga a mano (SPEI, transferencia,
 * OXXO, efectivo…) y él lo confirma, esa factura cuenta como pagada: NO se cancela la suscripción de tarjeta, solo se
 * le dice a Stripe que ya no cobre ESA factura (`invoices.pay(id, { paid_out_of_band: true })`). Stripe deja de
 * reintentarla y el mes siguiente cobra la tarjeta como siempre.
 *
 * Se llama desde TODA confirmación de pago manual: `activate_clinic` y «verificar pago» (/admin/billing),
 * `/api/admin/subscriptions` (pago registrado como pagado), SPEI directo confirmado y el SPEI/OXXO de Stripe
 * acreditado. Solo marca facturas ABIERTAS o INCOBRABLES de la suscripción del PLAN de la clínica, y solo las de
 * renovación / alta (no los prorrateos de un cambio de plan).
 *
 * NUNCA lanza ni deshace la activación: si Stripe no contesta devuelve `fallo` (el admin ve el aviso con el botón de
 * reintentar, y queda en bitácora). Idempotente: clave `fuera-de-stripe:<factura>`; sin facturas abiertas no hace nada.
 */

export const MENSAJE_FALLO_MARCADO =
  "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.";

export type ResultadoMarcado =
  /** Stripe no está configurado o la clínica no tiene suscripción de tarjeta viva: nada que marcar. */
  | { tipo: "sin_tarjeta" }
  /** Hay suscripción de tarjeta pero ninguna factura abierta / incobrable del plan. */
  | { tipo: "nada" }
  | { tipo: "marcadas"; facturas: string[] }
  | { tipo: "fallo"; mensaje: string; marcadas: string[] };

const ESTADOS_VIVOS = new Set(["active", "past_due", "unpaid", "trialing"]);
/** Las facturas que de verdad son el cobro del plan; un prorrateo (subscription_update) no se toca. */
const MOTIVOS_DEL_PLAN = new Set(["subscription_cycle", "subscription_create"]);

export function claveFueraDeStripe(invoiceId: string): string {
  return `fuera-de-stripe:${invoiceId}`;
}

type StripeMinimo = Pick<Stripe, "subscriptions" | "invoices">;

export async function marcarFacturasDelPlanPagadasFueraDeStripe(args: {
  stripe: StripeMinimo | null;
  stripeSubscriptionId: string | null | undefined;
}): Promise<ResultadoMarcado> {
  const { stripe, stripeSubscriptionId } = args;
  if (!stripe || !stripeSubscriptionId) return { tipo: "sin_tarjeta" };
  const marcadas: string[] = [];
  try {
    try {
      const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      if (!ESTADOS_VIVOS.has(sub.status)) return { tipo: "sin_tarjeta" };
    } catch (err) {
      const e = err as { code?: string; raw?: { code?: string } } | null;
      if ((e?.code ?? e?.raw?.code) === "resource_missing") return { tipo: "sin_tarjeta" };
      throw err;
    }

    const pendientes: Stripe.Invoice[] = [];
    for (const status of ["open", "uncollectible"] as const) {
      const lista = await stripe.invoices.list({ subscription: stripeSubscriptionId, status, limit: 20 });
      pendientes.push(...lista.data.filter((f) => f.billing_reason && MOTIVOS_DEL_PLAN.has(f.billing_reason)));
    }
    if (pendientes.length === 0) return { tipo: "nada" };

    let fallo: string | null = null;
    for (const f of pendientes) {
      try {
        await stripe.invoices.pay(f.id!, { paid_out_of_band: true }, { idempotencyKey: claveFueraDeStripe(f.id!) });
        marcadas.push(f.id!);
      } catch (err) {
        console.error("[factura-fuera-de-stripe] no se pudo marcar", f.id, (err as Error)?.message ?? err);
        fallo = MENSAJE_FALLO_MARCADO;
      }
    }
    return fallo ? { tipo: "fallo", mensaje: fallo, marcadas } : { tipo: "marcadas", facturas: marcadas };
  } catch (err) {
    console.error("[factura-fuera-de-stripe] Stripe no contestó:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas };
  }
}

/**
 * Lo mismo para una clínica por id (lee su `stripeSubscriptionId`). `clinicId` sale de la sesión del admin o de un
 * registro de Stripe, nunca del navegador de una clínica. Nunca lanza.
 */
export async function marcarFacturasDeLaClinica(clinicId: string): Promise<ResultadoMarcado> {
  try {
    if (!clinicId) return { tipo: "sin_tarjeta" };
    const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { stripeSubscriptionId: true } });
    return await marcarFacturasDelPlanPagadasFueraDeStripe({
      stripe: getStripeSafe(),
      stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
    });
  } catch (err) {
    console.error("[factura-fuera-de-stripe] error leyendo la clínica:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas: [] };
  }
}
