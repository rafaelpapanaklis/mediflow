import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  facturasDeLosMesesPagados,
  inicioDelMarcadoFueraDeStripe,
  reanudarCobroDespuesDelPrepago,
} from "@/lib/billing/cobro-rechazado";
import { subscriptionItemInterval, subscriptionPeriodEndSeconds } from "@/lib/billing/proration";
import { getStripeSafe } from "@/lib/stripe";

/**
 * PAGO MANUAL CONFIRMADO ⇒ la factura de tarjeta del plan queda PAGADA FUERA DE STRIPE, y un prepago de varios meses
 * PAUSA el cobro de la tarjeta (ws1-t1).
 *
 * Decisiones de Rafael sobre el #1(a) de la revisión:
 *  · NO se cancela la suscripción de tarjeta. Si una clínica con la tarjeta rechazada paga a mano (SPEI, transferencia,
 *    OXXO, efectivo…) y él lo confirma, esa factura cuenta como pagada: `invoices.pay(id, { paid_out_of_band: true })`.
 *    Stripe deja de reintentarla y el mes siguiente cobra la tarjeta como siempre.
 *  · Q4 = A: se marcan SOLO las facturas de los MESES que cubre el pago (las más recientes primero); las demás siguen
 *    abiertas como adeudo (no se anulan ni se borran).
 *  · Q1 = A: si el pago cubre VARIOS meses, la tarjeta no se cobra hasta que termine lo prepagado: `pause_collection`
 *    (`behavior: "void"`, `resumes_at`) — la suscripción sigue `active` (no «En prueba»), no se cancela nada y al llegar
 *    la fecha Stripe vuelve a cobrar solo. Ver `reanudarCobroDespuesDelPrepago` para el porqué del mecanismo.
 *
 * Se llama desde TODA confirmación de pago manual: `activate_clinic` y «verificar pago» (/admin/billing),
 * `/api/admin/subscriptions`, SPEI directo confirmado y el SPEI/OXXO de Stripe acreditado. Solo toca facturas ABIERTAS o
 * INCOBRABLES de renovación / alta de la suscripción del PLAN (no los prorrateos de un cambio de plan).
 *
 * NUNCA lanza ni deshace la activación: si Stripe no contesta devuelve `fallo` (el admin ve el aviso con el botón de
 * reintentar, y queda en bitácora). Idempotente: claves `fuera-de-stripe:<factura>` y `pausa-prepago:<suscripción>:<hasta>`.
 */

export const MENSAJE_FALLO_MARCADO =
  "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.";
export const MENSAJE_FALLO_PAUSA =
  "No pudimos pausar el cobro de la tarjeta durante los meses prepagados; Stripe podría cobrarla. Reintenta o pausa la suscripción a mano en Stripe.";

export type ResultadoPausa =
  /** Nada que pausar: el pago cubre solo el ciclo de la factura marcada, o la suscripción no es mensual. */
  | { tipo: "sin_pausa" }
  /** El cobro de la tarjeta queda pausado hasta `hasta` (ISO); después Stripe vuelve a cobrar solo. */
  | { tipo: "pausada"; hasta: string };

export type ResultadoMarcado =
  /** Stripe no está configurado o la clínica no tiene suscripción de tarjeta viva: nada que marcar. */
  | { tipo: "sin_tarjeta" }
  /** Hay suscripción de tarjeta pero ninguna factura abierta / incobrable del plan. */
  | { tipo: "nada"; pausa?: ResultadoPausa }
  | { tipo: "marcadas"; facturas: string[]; pausa?: ResultadoPausa }
  | { tipo: "fallo"; mensaje: string; marcadas: string[]; pausa?: ResultadoPausa };

const ESTADOS_VIVOS = new Set(["active", "past_due", "unpaid", "trialing"]);
/** Las facturas que de verdad son el cobro del plan; un prorrateo (subscription_update) no se toca. */
const MOTIVOS_DEL_PLAN = new Set(["subscription_cycle", "subscription_create"]);

export function claveFueraDeStripe(invoiceId: string): string {
  return `fuera-de-stripe:${invoiceId}`;
}

type StripeMinimo = Pick<Stripe, "subscriptions" | "invoices">;

/** La suscripción de tarjeta VIVA, o `null` si no hay (sin Stripe, inexistente, cancelada). Otros errores suben. */
export async function suscripcionDeTarjetaViva(stripe: StripeMinimo, stripeSubscriptionId: string): Promise<Stripe.Subscription | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    return ESTADOS_VIVOS.has(sub.status) ? sub : null;
  } catch (err) {
    const e = err as { code?: string; raw?: { code?: string } } | null;
    if ((e?.code ?? e?.raw?.code) === "resource_missing") return null;
    throw err;
  }
}

/**
 * Las facturas ABIERTAS o INCOBRABLES de renovación / alta de la suscripción del plan, o `null` si no hay una suscripción
 * de tarjeta viva. `creadasAntesDe`: solo las que existían cuando se confirmó el pago manual. `soloMismoCiclo`: solo la
 * del ciclo del pago (la última factura del plan creada hasta él), para el reintento automático (R1).
 */
export async function facturasPendientesDelPlan(
  stripe: StripeMinimo,
  stripeSubscriptionId: string,
  creadasAntesDe?: Date | null,
  soloMismoCiclo = false,
  subViva?: Stripe.Subscription,
): Promise<Stripe.Invoice[] | null> {
  if (!subViva && !(await suscripcionDeTarjetaViva(stripe, stripeSubscriptionId))) return null;
  if (soloMismoCiclo) {
    // El CICLO del pago manual = la última factura del plan creada hasta ese pago. Si Stripe ya había abierto otra
    // renovación en medio, las anteriores no son de este ciclo y NO se marcan solas (R1): solo esa última, y solo si
    // sigue abierta o incobrable.
    const todas = await stripe.invoices.list({ subscription: stripeSubscriptionId, limit: 20 });
    const delPlan = todas.data
      .filter((f) => f.billing_reason && MOTIVOS_DEL_PLAN.has(f.billing_reason))
      .filter((f) => !creadasAntesDe || (f.created ?? 0) * 1000 <= creadasAntesDe.getTime())
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const ciclo = delPlan[0];
    return ciclo && (ciclo.status === "open" || ciclo.status === "uncollectible") ? [ciclo] : [];
  }
  const pendientes: Stripe.Invoice[] = [];
  for (const status of ["open", "uncollectible"] as const) {
    const lista = await stripe.invoices.list({ subscription: stripeSubscriptionId, status, limit: 20 });
    pendientes.push(
      ...lista.data.filter(
        (f) =>
          f.billing_reason &&
          MOTIVOS_DEL_PLAN.has(f.billing_reason) &&
          (!creadasAntesDe || (f.created ?? 0) * 1000 <= creadasAntesDe.getTime()),
      ),
    );
  }
  return pendientes;
}

/**
 * Q1: si lo prepagado (`finPrepago`) rebasa el ciclo de Stripe, pausa el cobro hasta que termine. Idempotente; nunca baja
 * una pausa que ya llegue más lejos. Lanza si Stripe falla (quien llama lo convierte en `fallo`).
 */
export async function pausarCobroHastaFinDelPrepago(
  stripe: StripeMinimo,
  sub: Stripe.Subscription,
  finPrepago: Date,
): Promise<ResultadoPausa> {
  const finCiclo = subscriptionPeriodEndSeconds(sub);
  if (!finCiclo) return { tipo: "sin_pausa" };
  const reanuda = reanudarCobroDespuesDelPrepago({
    finDelPeriodoStripe: new Date(finCiclo * 1000),
    finPrepago,
    intervalo: subscriptionItemInterval(sub.items?.data?.[0]),
  });
  if (!reanuda) return { tipo: "sin_pausa" };
  const yaHasta = sub.pause_collection?.resumes_at ?? 0;
  const hasta = Math.max(Math.floor(reanuda.getTime() / 1000), yaHasta);
  if (sub.pause_collection && yaHasta >= hasta) return { tipo: "pausada", hasta: new Date(hasta * 1000).toISOString() };
  await stripe.subscriptions.update(
    sub.id,
    { pause_collection: { behavior: "void", resumes_at: hasta } },
    { idempotencyKey: `pausa-prepago:${sub.id}:${hasta}` },
  );
  return { tipo: "pausada", hasta: new Date(hasta * 1000).toISOString() };
}

export async function marcarFacturasDelPlanPagadasFueraDeStripe(args: {
  stripe: StripeMinimo | null;
  stripeSubscriptionId: string | null | undefined;
  /** Solo las facturas creadas hasta este momento (el del pago manual). Sin él, todas las abiertas de hoy. */
  creadasAntesDe?: Date | null;
  /** Solo la factura del MISMO ciclo que el pago manual (sin otra renovación en medio): el reintento automático y «Reintentar». */
  soloMismoCiclo?: boolean;
  /** Q4: cuántos meses cubre el pago; se marcan SOLO las facturas de esos meses (las más recientes). Por defecto 1. */
  meses?: number;
  /** Q1: hasta cuándo queda pagado el acceso. Si rebasa el ciclo de Stripe, el cobro de la tarjeta se pausa hasta entonces. */
  finPrepago?: Date | null;
}): Promise<ResultadoMarcado> {
  const { stripe, stripeSubscriptionId } = args;
  if (!stripe || !stripeSubscriptionId) return { tipo: "sin_tarjeta" };
  const marcadas: string[] = [];
  let pausa: ResultadoPausa | undefined;
  try {
    const pendientes = await facturasPendientesDelPlan(stripe, stripeSubscriptionId, args.creadasAntesDe, args.soloMismoCiclo);
    if (pendientes === null) return { tipo: "sin_tarjeta" };

    // Q4: solo las facturas de los meses que cubre el pago; el resto se queda abierto (adeudo).
    const aMarcar = args.soloMismoCiclo ? pendientes : facturasDeLosMesesPagados(pendientes, args.meses ?? 1);
    let fallo: string | null = null;
    for (const f of aMarcar) {
      try {
        await stripe.invoices.pay(f.id!, { paid_out_of_band: true }, { idempotencyKey: claveFueraDeStripe(f.id!) });
        marcadas.push(f.id!);
      } catch (err) {
        console.error("[factura-fuera-de-stripe] no se pudo marcar", f.id, (err as Error)?.message ?? err);
        fallo = MENSAJE_FALLO_MARCADO;
      }
    }

    // Q1: prepago de varios meses ⇒ pausar el cobro de la tarjeta hasta que termine (no se cancela nada).
    if (args.finPrepago) {
      try {
        const sub = await suscripcionDeTarjetaViva(stripe, stripeSubscriptionId);
        const r = sub ? await pausarCobroHastaFinDelPrepago(stripe, sub, args.finPrepago) : null;
        if (r?.tipo === "pausada") pausa = r; // sin pausa no se ensucia el resultado
      } catch (err) {
        console.error("[factura-fuera-de-stripe] no se pudo pausar el cobro", (err as Error)?.message ?? err);
        fallo = fallo ?? MENSAJE_FALLO_PAUSA;
      }
    }

    if (fallo) return { tipo: "fallo", mensaje: fallo, marcadas, ...(pausa ? { pausa } : {}) };
    if (aMarcar.length === 0) return { tipo: "nada", ...(pausa ? { pausa } : {}) };
    return { tipo: "marcadas", facturas: marcadas, ...(pausa ? { pausa } : {}) };
  } catch (err) {
    console.error("[factura-fuera-de-stripe] Stripe no contestó:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas };
  }
}

/**
 * Cuándo se registró el ÚLTIMO pago manual del plan de la clínica (fila pagada con método nulo o de la lista de pagos
 * manuales, incluida la activación de /admin), o null. Es el corte de «las facturas que ya existían». Solo cuenta lo
 * confirmado DESDE el despliegue de la regla (R1).
 */
export async function ultimoPagoManualDelPlan(clinicId: string): Promise<Date | null> {
  const fila = await prisma.subscriptionInvoice.findFirst({
    where: {
      clinicId,
      status: "paid",
      paidAt: { gte: inicioDelMarcadoFueraDeStripe() },
      OR: [{ method: null }, { method: { in: [...METODOS_DE_PAGO_MANUAL_DEL_PLAN] } }],
    },
    orderBy: { paidAt: "desc" },
    select: { paidAt: true },
  });
  return fila?.paidAt ?? null;
}

/**
 * Lo mismo para una clínica por id (lee su `stripeSubscriptionId` y hasta cuándo quedó pagada). `clinicId` sale de la
 * sesión del admin o de un registro de Stripe, nunca del navegador de una clínica. Nunca lanza.
 *  · `meses`: los meses que cubre el pago recién confirmado (Q4: solo se marcan las facturas de esos meses).
 *  · `soloLasQueYaExistian`: reintentos y cron — corta en el último pago manual registrado y toma solo la factura de su ciclo.
 */
export async function marcarFacturasDeLaClinica(
  clinicId: string,
  opciones: { meses?: number; soloLasQueYaExistian?: boolean } = {},
): Promise<ResultadoMarcado> {
  try {
    if (!clinicId) return { tipo: "sin_tarjeta" };
    const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { stripeSubscriptionId: true, trialEndsAt: true } });
    const corte = opciones.soloLasQueYaExistian ? await ultimoPagoManualDelPlan(clinicId) : null;
    if (opciones.soloLasQueYaExistian && !corte) return { tipo: "nada" };
    return await marcarFacturasDelPlanPagadasFueraDeStripe({
      stripe: getStripeSafe(),
      stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
      creadasAntesDe: corte,
      soloMismoCiclo: opciones.soloLasQueYaExistian === true,
      meses: opciones.meses,
      finPrepago: clinica?.trialEndsAt ?? null,
    });
  } catch (err) {
    console.error("[factura-fuera-de-stripe] error leyendo la clínica:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas: [] };
  }
}
