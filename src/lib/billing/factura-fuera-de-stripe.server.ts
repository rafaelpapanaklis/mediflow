import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  esMesDeServicioSuspendido,
  inicioDelMarcadoFueraDeStripe,
  reanudarCobroDespuesDelPrepago,
} from "@/lib/billing/cobro-rechazado";
import { subscriptionItemInterval, subscriptionPeriodEndSeconds } from "@/lib/billing/proration";
import {
  aplicarReglaDeSuspension,
  facturasAbiertasDelPlan,
  type ResultadoRealineo,
} from "@/lib/billing/reactivacion-tras-suspension.server";
import { getStripeSafe } from "@/lib/stripe";
import { cobrarAparteExcedentePendiente } from "@/lib/cfdi-overage";

/**
 * PAGO MANUAL CONFIRMADO ⇒ qué pasa con la tarjeta de la clínica (ws1-t1).
 *
 * Decisiones de Rafael:
 *  · NUNCA se cancela la suscripción de tarjeta.
 *  · #1(a) Pago DENTRO de las 24 h de gracia (aún no suspendida): la factura del ciclo queda PAGADA FUERA DE STRIPE
 *    (`invoices.pay(id, { paid_out_of_band: true })`); Stripe deja de reintentarla y el ciclo sigue igual.
 *  · Q4 (corregida en la octava vuelta) Pago DESPUÉS de una suspensión: los meses sin servicio NO se deben. Las facturas
 *    abiertas de esos meses se ANULAN (void) en Stripe y quedan en la base como «No cobrada: servicio suspendido»; el
 *    acceso son 30 días (N×30) desde el día y hora del pago y el siguiente cobro de la tarjeta es al terminar esos días
 *    (`reactivacion-tras-suspension.server.ts`, con la justificación del mecanismo). No hay «adeudo» de meses suspendidos.
 *  · Q1 Pago de VARIOS meses dentro de la gracia: el cobro de la tarjeta se pausa (`pause_collection`) hasta que termine lo
 *    prepagado; la suscripción sigue `active` (no «En prueba»).
 *
 * Se llama desde TODA confirmación de pago manual: `activate_clinic` y «verificar pago» (/admin/billing),
 * `/api/admin/subscriptions`, SPEI directo confirmado y el SPEI/OXXO de Stripe acreditado. Solo toca facturas ABIERTAS o
 * INCOBRABLES de renovación / alta de la suscripción del PLAN (no los prorrateos de un cambio de plan).
 *
 * NUNCA lanza ni deshace la activación: si Stripe no contesta devuelve `fallo` (el admin ve el aviso con el botón de
 * reintentar, y queda en bitácora). Idempotente: claves `fuera-de-stripe:<factura>`, `anular-suspendida:<factura>`,
 * `realinear:<suscripción>:<hasta>` y `pausa-prepago:<suscripción>:<hasta>`.
 */

export const MENSAJE_FALLO_MARCADO =
  "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.";
export const MENSAJE_FALLO_PAUSA =
  "No pudimos pausar el cobro de la tarjeta durante los meses prepagados; Stripe podría cobrarla. Reintenta o pausa la suscripción a mano en Stripe.";

export type ResultadoPausa =
  /** Nada que pausar: el pago cubre solo el ciclo de la factura marcada, o la suscripción no es mensual. */
  | { tipo: "sin_pausa" }
  /**
   * El cobro de la tarjeta queda pausado hasta `hasta` (ISO); después Stripe vuelve a cobrar solo. `realineada`: además el
   * ciclo se movió a «hoy» (pago tras una suspensión), de modo que ese cobro cae al terminar lo pagado.
   */
  | { tipo: "pausada"; hasta: string; realineada?: boolean };

export type ResultadoMarcado =
  /** Stripe no está configurado o la clínica no tiene suscripción de tarjeta viva: nada que marcar. */
  | { tipo: "sin_tarjeta" }
  /** Hay suscripción de tarjeta pero ninguna factura abierta / incobrable del plan. */
  | { tipo: "nada"; pausa?: ResultadoPausa }
  /** `facturas`: pagadas fuera de Stripe (ciclo en gracia). `anuladas`: facturas de meses suspendidos anuladas (void). */
  | { tipo: "marcadas"; facturas: string[]; anuladas?: string[]; pausa?: ResultadoPausa }
  | { tipo: "fallo"; mensaje: string; marcadas: string[]; anuladas?: string[]; pausa?: ResultadoPausa };

const ESTADOS_VIVOS = new Set(["active", "past_due", "unpaid", "trialing"]);

export function claveFueraDeStripe(invoiceId: string): string {
  return `fuera-de-stripe:${invoiceId}`;
}

type StripeMinimo = Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems">;

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
 * de tarjeta viva. `creadasAntesDe`: solo las que existían cuando se confirmó el pago manual; la renovación del mes
 * siguiente es otra cosa y no se toca.
 */
export async function facturasPendientesDelPlan(
  stripe: StripeMinimo,
  stripeSubscriptionId: string,
  creadasAntesDe?: Date | null,
  subViva?: Stripe.Subscription,
): Promise<Stripe.Invoice[] | null> {
  if (!subViva && !(await suscripcionDeTarjetaViva(stripe, stripeSubscriptionId))) return null;
  return facturasAbiertasDelPlan(stripe, stripeSubscriptionId, creadasAntesDe);
}

/**
 * Reparte las facturas abiertas en las de MESES SUSPENDIDOS (a anular) y la del CICLO (a pagar fuera de Stripe: solo la
 * más reciente). Con `estabaSuspendida: true` todas son de meses suspendidos; si no, cada una se juzga por su fecha contra
 * la del pago (más vieja que la gracia = mes sin servicio).
 */
export function repartirPendientes(
  pendientes: Stripe.Invoice[],
  args: { pagadoEn: Date; estabaSuspendida?: boolean },
): { suspendidas: Stripe.Invoice[]; delCiclo: Stripe.Invoice | null } {
  const suspendidas: Stripe.Invoice[] = [];
  const resto: Stripe.Invoice[] = [];
  for (const f of pendientes) {
    // Con el estado de antes (`true`) TODAS son de meses suspendidos. Sin él, o con `false` (p. ej. una cortesía que le dio
    // acceso a una clínica con facturas viejas abiertas), una factura creada hace más que la gracia antes del pago también
    // es de un mes sin servicio: ninguna factura vieja se queda viva para que Stripe la reintente (V7).
    const suspendida = args.estabaSuspendida === true || esMesDeServicioSuspendido({ facturaCreadaEn: f.created ?? 0, pagoEn: args.pagadoEn });
    (suspendida ? suspendidas : resto).push(f);
  }
  resto.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return { suspendidas, delCiclo: resto[0] ?? null };
}

/**
 * Q1 (sin suspensión): si lo prepagado (`finPrepago`) rebasa el ciclo de Stripe, pausa el cobro hasta que termine.
 * Idempotente; nunca baja una pausa que ya llegue más lejos. Lanza si Stripe falla (quien llama lo convierte en `fallo`).
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
  // Una pausa que ya llega (casi) igual de lejos —p. ej. la del re-alineo tras una suspensión— se reconoce y no se repite.
  if (sub.pause_collection && yaHasta >= hasta - 5 * 86_400) return { tipo: "pausada", hasta: new Date(yaHasta * 1000).toISOString() };
  // El excedente de CFDI pendiente se separa en su propia factura antes de pausar (V3); si falla, no se pausa.
  await cobrarAparteExcedentePendiente(stripe, typeof sub.customer === "string" ? sub.customer : sub.customer.id, sub.id);
  await stripe.subscriptions.update(
    sub.id,
    { pause_collection: { behavior: "void", resumes_at: hasta } },
    { idempotencyKey: `pausa-prepago:${sub.id}:${hasta}` },
  );
  return { tipo: "pausada", hasta: new Date(hasta * 1000).toISOString() };
}

function pausaDelRealineo(r: ResultadoRealineo): ResultadoPausa | null {
  if (r.tipo === "hecho" || r.tipo === "ya_estaba" || r.tipo === "cobro_inesperado") return { tipo: "pausada", hasta: r.hasta, realineada: true };
  return null;
}

export async function marcarFacturasDelPlanPagadasFueraDeStripe(args: {
  /** La clínica (sale de la sesión del admin o de un registro de Stripe, nunca del cliente): dueña de las filas que se escriben. */
  clinicId: string;
  stripe: StripeMinimo | null;
  stripeSubscriptionId: string | null | undefined;
  /** Solo las facturas creadas hasta este momento (el del pago manual). Sin él, todas las abiertas de hoy. */
  creadasAntesDe?: Date | null;
  /** El día y hora del pago manual. Por omisión, ahora (la confirmación inmediata). */
  pagadoEn?: Date;
  /**
   * El estado de la clínica ANTES de registrar el pago (`clinicaEstabaSuspendida`). `true`: todas las facturas abiertas son
   * de meses suspendidos. `false`: ninguna. Sin él (reintentos) se infiere por fechas.
   */
  estabaSuspendida?: boolean;
  /** Hasta cuándo quedó pagada la clínica (su `trialEndsAt` tras el pago): fin de lo pagado para re-alinear / pausar. */
  finPrepago?: Date | null;
}): Promise<ResultadoMarcado> {
  const { stripe, stripeSubscriptionId } = args;
  if (!stripe || !stripeSubscriptionId) return { tipo: "sin_tarjeta" };
  const marcadas: string[] = [];
  let anuladas: string[] = [];
  let pausa: ResultadoPausa | undefined;
  const pagadoEn = args.pagadoEn ?? new Date();
  try {
    const sub = await suscripcionDeTarjetaViva(stripe, stripeSubscriptionId);
    if (!sub) return { tipo: "sin_tarjeta" };
    const pendientes = await facturasAbiertasDelPlan(stripe, stripeSubscriptionId, args.creadasAntesDe);
    const { suspendidas, delCiclo } = repartirPendientes(pendientes, { pagadoEn, estabaSuspendida: args.estabaSuspendida });
    const huboSuspension = args.estabaSuspendida === true || suspendidas.length > 0;
    let fallo: string | null = null;

    // (1) La factura del CICLO (pago dentro de la gracia, o la del mes en curso): pagada fuera de Stripe.
    if (delCiclo?.id) {
      try {
        await stripe.invoices.pay(delCiclo.id, { paid_out_of_band: true }, { idempotencyKey: claveFueraDeStripe(delCiclo.id) });
        marcadas.push(delCiclo.id);
      } catch (err) {
        console.error("[factura-fuera-de-stripe] no se pudo marcar", delCiclo.id, (err as Error)?.message ?? err);
        fallo = MENSAJE_FALLO_MARCADO;
      }
    }

    // (2) Meses SUSPENDIDOS: ciclo re-alineado a «hoy + lo pagado» y facturas viejas anuladas (nunca se deben).
    let realineado = false;
    let realineoFallo = false;
    if (huboSuspension) {
      // Sin fin de lo pagado no hay a dónde mover el ciclo: las facturas suspendidas se anulan igual.
      const r = await aplicarReglaDeSuspension({
        stripe,
        clinicId: args.clinicId,
        sub,
        pagadoEn,
        finDeLoPagado: args.finPrepago ?? pagadoEn,
        facturas: suspendidas,
      });
      anuladas = r.anuladas;
      realineoFallo = r.realineo.tipo === "fallo";
      const p = pausaDelRealineo(r.realineo);
      if (p) {
        pausa = p;
        realineado = true;
      }
      if (r.fallos.length > 0) fallo = fallo ?? r.fallos[0];
    }

    // (3) Q1 sin suspensión (o con el interruptor del ciclo apagado): pausa aproximada hasta el fin de lo prepagado.
    // (si el re-alineo FALLÓ no se pausa a medias: una pausa aproximada haría que el reintento creyera que ya está hecho)
    if (!realineado && !realineoFallo && args.finPrepago) {
      try {
        const viva = (await suscripcionDeTarjetaViva(stripe, stripeSubscriptionId)) ?? sub;
        const r = await pausarCobroHastaFinDelPrepago(stripe, viva, args.finPrepago);
        if (r.tipo === "pausada") pausa = r; // sin pausa no se ensucia el resultado
      } catch (err) {
        console.error("[factura-fuera-de-stripe] no se pudo pausar el cobro", (err as Error)?.message ?? err);
        fallo = fallo ?? MENSAJE_FALLO_PAUSA;
      }
    }

    const extra = { ...(anuladas.length > 0 ? { anuladas } : {}), ...(pausa ? { pausa } : {}) };
    if (fallo) return { tipo: "fallo", mensaje: fallo, marcadas, ...extra };
    if (marcadas.length === 0 && anuladas.length === 0) return { tipo: "nada", ...(pausa ? { pausa } : {}) };
    return { tipo: "marcadas", facturas: marcadas, ...extra };
  } catch (err) {
    console.error("[factura-fuera-de-stripe] Stripe no contestó:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas, ...(anuladas.length > 0 ? { anuladas } : {}) };
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
 *  · `estabaSuspendida`: el estado de la clínica ANTES de registrar el pago (`clinicaEstabaSuspendida`). Sin él se infiere.
 *  · `soloLasQueYaExistian`: reintentos y cron — corta en el último pago manual registrado (su día y hora son «el pago»).
 */
export async function marcarFacturasDeLaClinica(
  clinicId: string,
  opciones: { estabaSuspendida?: boolean; soloLasQueYaExistian?: boolean } = {},
): Promise<ResultadoMarcado> {
  try {
    if (!clinicId) return { tipo: "sin_tarjeta" };
    const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { stripeSubscriptionId: true, trialEndsAt: true } });
    const corte = opciones.soloLasQueYaExistian ? await ultimoPagoManualDelPlan(clinicId) : null;
    if (opciones.soloLasQueYaExistian && !corte) return { tipo: "nada" };
    return await marcarFacturasDelPlanPagadasFueraDeStripe({
      clinicId,
      stripe: getStripeSafe(),
      stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
      creadasAntesDe: corte,
      pagadoEn: corte ?? undefined,
      estabaSuspendida: opciones.estabaSuspendida,
      finPrepago: clinica?.trialEndsAt ?? null,
    });
  } catch (err) {
    console.error("[factura-fuera-de-stripe] error leyendo la clínica:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas: [] };
  }
}
