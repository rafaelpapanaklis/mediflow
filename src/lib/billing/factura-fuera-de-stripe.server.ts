import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  enPeriodoPagado,
  esMesDeServicioSuspendido,
  inicioDelMarcadoFueraDeStripe,
} from "@/lib/billing/cobro-rechazado";
import {
  MENSAJE_FALLO_ANULAR,
  anularFacturasDeMesesSuspendidos,
  aplicarReglaDeSuspension,
  facturasAbiertasDelPlan,
  mensajeCobroInesperado,
  realinearCiclo,
  type ResultadoRealineo,
} from "@/lib/billing/reactivacion-tras-suspension.server";
import { reintentarReglasPendientes, reglasPendientes, textoReglaTardia } from "@/lib/billing/regla-cobro-tarjeta.server";
import { avisarAdminUnaVez } from "@/lib/billing/aviso-admin-envio.server";
import { subscriptionPeriodEndSeconds } from "@/lib/billing/proration";
import { getStripeSafe } from "@/lib/stripe";

/**
 * PAGO MANUAL CONFIRMADO ⇒ qué pasa con la tarjeta de la clínica (ws1-t1).
 *
 * Decisiones de Rafael:
 *  · NUNCA se cancela la suscripción de tarjeta.
 *  · #1(a) Pago DENTRO de las 24 h de gracia (aún no suspendida): la factura del ciclo queda PAGADA FUERA DE STRIPE
 *    (`invoices.pay(id, { paid_out_of_band: true })`); Stripe deja de reintentarla y el ciclo sigue igual.
 *  · Q4 (corregida en la octava vuelta) Pago DESPUÉS de una suspensión: los meses sin servicio NO se deben. Las facturas
 *    abiertas de esos meses se ANULAN (void) en Stripe y quedan en la base como «No cobrada: servicio suspendido»; el
 *    acceso es un mes de calendario por mes pagado desde el día y hora del pago y el siguiente cobro de la tarjeta es
 *    EXACTAMENTE al terminar lo pagado
 *    (`reactivacion-tras-suspension.server.ts`, con la justificación del mecanismo). No hay «adeudo» de meses suspendidos.
 *  · Q1 Pago de VARIOS meses (o con la clínica al corriente): el siguiente cobro de la tarjeta pasa a ser EXACTAMENTE al
 *    terminar lo pagado (`trial_end` + marca de periodo pagado; la clínica nunca sale «En prueba»).
 *
 * Se llama desde TODA confirmación de pago manual: `activate_clinic` y «verificar pago» (/admin/billing),
 * `/api/admin/subscriptions`, SPEI directo confirmado y el SPEI/OXXO de Stripe acreditado. Solo toca facturas ABIERTAS o
 * INCOBRABLES de renovación / alta de la suscripción del PLAN (no los prorrateos de un cambio de plan).
 *
 * NUNCA lanza ni deshace la activación: si Stripe no contesta devuelve `fallo` (el admin ve el aviso con el botón de
 * reintentar, y queda en bitácora). Idempotente: claves `fuera-de-stripe:<factura>`, `anular-suspendida:<factura>` y
 * `periodo-pagado:<suscripción>:<hasta>`.
 */

export const MENSAJE_FALLO_REGLA_TARJETA =
  "No pudimos terminar de aplicar un cobro de tarjeta a esta clínica (anular los meses sin servicio). Reintenta en un momento.";
export const MENSAJE_FALLO_MARCADO =
  "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.";
/**
 * `movido`: el siguiente cobro de la tarjeta se movió a `hasta` (ISO, el fin de lo pagado).
 * `apagado`: el ajuste automático está apagado (`COBRO_REALINEAR_CICLO=0`) y la tarjeta cobrará en su fecha anterior (Y15).
 */
export type ResultadoCiclo = { tipo: "movido"; hasta: string } | { tipo: "apagado" };

export type ResultadoMarcado =
  /** Stripe no está configurado o la clínica no tiene suscripción de tarjeta viva: nada que marcar. */
  | { tipo: "sin_tarjeta" }
  /** Hay suscripción de tarjeta pero ninguna factura abierta / incobrable del plan. */
  | { tipo: "nada"; ciclo?: ResultadoCiclo; revisar?: string }
  /** `facturas`: pagadas fuera de Stripe (ciclo en gracia). `anuladas`: facturas de meses suspendidos anuladas (void). */
  | { tipo: "marcadas"; facturas: string[]; anuladas?: string[]; ciclo?: ResultadoCiclo; revisar?: string }
  | { tipo: "fallo"; mensaje: string; marcadas: string[]; anuladas?: string[]; ciclo?: ResultadoCiclo; revisar?: string };

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
    const suspendida = args.estabaSuspendida === true || esMesDeServicioSuspendido({ facturaCreadaEn: f.status_transitions?.finalized_at ?? f.created ?? 0, pagoEn: args.pagadoEn });
    (suspendida ? suspendidas : resto).push(f);
  }
  resto.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return { suspendidas, delCiclo: resto[0] ?? null };
}

function cicloDelRealineo(r: ResultadoRealineo): ResultadoCiclo | null {
  if (r.tipo === "apagado") return { tipo: "apagado" };
  if (r.tipo === "hecho" || r.tipo === "ya_estaba" || r.tipo === "cobro_inesperado") return { tipo: "movido", hasta: r.hasta };
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
  /**
   * Es un REINTENTO TARDÍO (cron, «Reintentar»): SIN CÁLCULO DE CICLO. No mueve el ciclo (entre el pago y el reintento Stripe pudo
   * renovar con el ciclo viejo): solo marca la factura del ciclo, anula los meses sin servicio creados HASTA el pago y deja un
   * aviso «revisa en Stripe…» si el fin de periodo no coincide con lo pagado.
   */
  reintento?: boolean;
  /** Nombre de la clínica (solo para el aviso al admin). */
  clinicaNombre?: string | null;
}): Promise<ResultadoMarcado> {
  const { stripe, stripeSubscriptionId } = args;
  if (!stripe || !stripeSubscriptionId) return { tipo: "sin_tarjeta" };
  const marcadas: string[] = [];
  let anuladas: string[] = [];
  let ciclo: ResultadoCiclo | undefined;
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
        // Una en borrador no se puede pagar: se finaliza sin cobrar.
        if (delCiclo.status === "draft") await stripe.invoices.finalizeInvoice(delCiclo.id, { auto_advance: false }, { idempotencyKey: `finalizar-ciclo:${delCiclo.id}` });
        await stripe.invoices.pay(delCiclo.id, { paid_out_of_band: true }, { idempotencyKey: claveFueraDeStripe(delCiclo.id) });
        marcadas.push(delCiclo.id);
      } catch (err) {
        console.error("[factura-fuera-de-stripe] no se pudo marcar", delCiclo.id, (err as Error)?.message ?? err);
        fallo = MENSAJE_FALLO_MARCADO;
      }
    }

    // (2) El siguiente cobro de la tarjeta = fin de lo pagado. Con meses SUSPENDIDOS, además se anulan sus facturas. En un
    // REINTENTO tardío NO se calcula el ciclo: solo se anula lo seguro y se avisa para revisarlo a mano.
    let revisar: string | undefined;
    if (args.reintento === true) {
      if (huboSuspension) {
        const r = await anularFacturasDeMesesSuspendidos(stripe, args.clinicId, suspendidas);
        anuladas = r.anuladas;
        if (r.fallos.length > 0) fallo = fallo ?? MENSAJE_FALLO_ANULAR;
      }
      const finProtegido = args.finPrepago ?? null;
      if (finProtegido && finProtegido.getTime() > Date.now() + 86_400_000) {
        const segs = subscriptionPeriodEndSeconds(sub);
        const yaCoincide = !!segs && Math.abs(segs * 1000 - finProtegido.getTime()) <= 86_400_000;
        const pagado = enPeriodoPagado(sub) && (sub.trial_end ?? 0) * 1000 >= finProtegido.getTime() - 86_400_000;
        if (!yaCoincide && !pagado) {
          let abiertas: string[] = [];
          try {
            abiertas = (await facturasAbiertasDelPlan(stripe, stripeSubscriptionId)).map((f) => f.id!).filter(Boolean);
          } catch {
            abiertas = [];
          }
          revisar = textoReglaTardia({ clinicaNombre: args.clinicaNombre ?? args.clinicId, abiertas, finPeriodoStripe: sub, protegidoHasta: finProtegido });
          await avisarAdminUnaVez(
            `${args.clinicId}:${(args.finPrepago ?? pagadoEn).toISOString()}:ciclo_a_mano`,
            args.clinicId,
            { asunto: `Revisa en Stripe la suscripción de ${args.clinicaNombre ?? args.clinicId}: la regla no se aplicó al momento del pago`, lineas: [revisar] },
          );
        }
      }
    } else if (huboSuspension || args.finPrepago) {
      const finDeLoPagado = args.finPrepago ?? pagadoEn;
      let realineo: ResultadoRealineo;
      if (huboSuspension) {
        const r = await aplicarReglaDeSuspension({ stripe, clinicId: args.clinicId, sub, pagadoEn, finDeLoPagado, facturas: suspendidas, periodoExacto: true });
        anuladas = r.anuladas;
        realineo = r.realineo;
        if (r.fallos.length > 0) fallo = fallo ?? r.fallos[0];
      } else {
        realineo = await realinearCiclo(stripe, sub, { pagadoEn, finDeLoPagado });
        if (realineo.tipo === "fallo") fallo = fallo ?? realineo.mensaje;
        else if (realineo.tipo === "cobro_inesperado") fallo = fallo ?? mensajeCobroInesperado(realineo.facturaId);
      }
      const c = cicloDelRealineo(realineo);
      if (c) ciclo = c;
      // Si el ciclo no se pudo mover, el admin recibe además el aviso «revisa en Stripe…» (el reintento ya no lo mueve).
      if (realineo.tipo === "fallo" || realineo.tipo === "cobro_inesperado") {
        revisar = textoReglaTardia({ clinicaNombre: args.clinicaNombre ?? args.clinicId, abiertas: [], finPeriodoStripe: sub, protegidoHasta: finDeLoPagado });
        await avisarAdminUnaVez(
          `${args.clinicId}:${(args.finPrepago ?? pagadoEn).toISOString()}:ciclo_a_mano`,
          args.clinicId,
          { asunto: `Revisa en Stripe la suscripción de ${args.clinicaNombre ?? args.clinicId}: no se pudo mover el siguiente cobro`, lineas: [revisar] },
        );
      }
    }

    const extra = { ...(anuladas.length > 0 ? { anuladas } : {}), ...(ciclo ? { ciclo } : {}), ...(revisar ? { revisar } : {}) };
    if (fallo) return { tipo: "fallo", mensaje: fallo, marcadas, ...extra };
    if (marcadas.length === 0 && anuladas.length === 0) return { tipo: "nada", ...(ciclo ? { ciclo } : {}), ...(revisar ? { revisar } : {}) };
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
export async function ultimoPagoManualDelPlan(clinicId: string): Promise<{ paidAt: Date; periodEnd: Date } | null> {
  const fila = await prisma.subscriptionInvoice.findFirst({
    where: {
      clinicId,
      status: "paid",
      paidAt: { gte: inicioDelMarcadoFueraDeStripe() },
      OR: [{ method: null }, { method: { in: [...METODOS_DE_PAGO_MANUAL_DEL_PLAN] } }],
    },
    orderBy: { paidAt: "desc" },
    select: { paidAt: true, periodEnd: true },
  });
  return fila?.paidAt ? { paidAt: fila.paidAt, periodEnd: fila.periodEnd } : null;
}

/**
 * Lo mismo para una clínica por id (lee su `stripeSubscriptionId` y hasta cuándo quedó pagada). `clinicId` sale de la
 * sesión del admin o de un registro de Stripe, nunca del navegador de una clínica. Nunca lanza.
 *  · `estabaSuspendida`: el estado de la clínica ANTES de registrar el pago (`clinicaEstabaSuspendida`). Sin él se infiere.
 *  · `soloLasQueYaExistian`: reintentos y cron — corta en el último pago manual registrado: su día y hora son «el pago» y el
 *    fin de lo pagado es el `periodEnd` de SU fila, no «hoy» (M9: cada día que tarda el reintento no es un día gratis).
 */
export async function marcarFacturasDeLaClinica(
  clinicId: string,
  opciones: { estabaSuspendida?: boolean; soloLasQueYaExistian?: boolean } = {},
): Promise<ResultadoMarcado> {
  try {
    if (!clinicId) return { tipo: "sin_tarjeta" };
    const stripe = getStripeSafe();
    const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { stripeSubscriptionId: true, trialEndsAt: true, name: true } });
    const pago = opciones.soloLasQueYaExistian ? await ultimoPagoManualDelPlan(clinicId) : null;
    // Reintento: además de lo del último pago manual, se repiten las reglas de COBROS DE TARJETA que quedaron a medias
    // (rastro `regla_fallo` sin `regla_ok`): es el «Reintentar» de verdad del cobro con tarjeta, con la marca de periodo pagado.
    let tarjeta: { completadas: string[]; fallos: string[]; revisar: string[] } | null = null;
    if (opciones.soloLasQueYaExistian && stripe) {
      const hay = await reglasPendientes(clinicId);
      if (hay.length > 0) tarjeta = await reintentarReglasPendientes(stripe, clinicId);
    }
    if (opciones.soloLasQueYaExistian && !pago) {
      if (tarjeta) {
        return tarjeta.fallos.length > 0
          ? { tipo: "fallo", mensaje: MENSAJE_FALLO_REGLA_TARJETA, marcadas: [] }
          : { tipo: "marcadas", facturas: [], anuladas: [], ...(tarjeta.revisar.length > 0 ? { revisar: tarjeta.revisar.join(" ") } : {}) };
      }
      return { tipo: "nada" };
    }
    const r = await marcarFacturasDelPlanPagadasFueraDeStripe({
      clinicId,
      stripe,
      stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
      creadasAntesDe: pago?.paidAt ?? null,
      pagadoEn: pago?.paidAt ?? undefined,
      estabaSuspendida: opciones.estabaSuspendida,
      finPrepago: pago ? pago.periodEnd : clinica?.trialEndsAt ?? null,
      reintento: opciones.soloLasQueYaExistian === true,
      clinicaNombre: clinica?.name ?? null,
    });
    if (tarjeta && tarjeta.fallos.length > 0 && r.tipo !== "fallo") return { tipo: "fallo", mensaje: MENSAJE_FALLO_REGLA_TARJETA, marcadas: r.tipo === "marcadas" ? r.facturas : [] };
    if (tarjeta && tarjeta.revisar.length > 0 && r.tipo !== "sin_tarjeta") return { ...r, revisar: [r.revisar, ...tarjeta.revisar].filter(Boolean).join(" ") };
    return r;
  } catch (err) {
    console.error("[factura-fuera-de-stripe] error leyendo la clínica:", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_MARCADO, marcadas: [] };
  }
}
