import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  CICLO_ALINEADO_DIAS,
  MARCA_PERIODO_PAGADO,
  NOTA_SERVICIO_SUSPENDIDO,
  enPeriodoPagado,
  finDeLoPagado,
  mesesDelIntervalo,
} from "@/lib/billing/cobro-rechazado";
import { subscriptionPeriodEndSeconds } from "@/lib/billing/proration";
import { cobrarAparteExcedentePendiente } from "@/lib/cfdi-overage";

/**
 * PAGO TRAS UNA SUSPENSIÓN POR FALTA DE PAGO (ws1-t1, octava vuelta — corrección de Q4 de Rafael; mecanismo del ciclo
 * cambiado en la décima).
 *
 *   «Si se tiene 4 meses el servicio suspendido por falta de pago, no debe 4 meses, porque el servicio estuvo suspendido
 *    sin poder usarse. Si vuelve a pagar después de 4 meses, de ese día y hora que pagó se le agregan 30 días.»
 *
 * Dos piezas, reutilizables por TODA vía de pago (admin confirma SPEI/transferencia/efectivo, SPEI directo, SPEI/OXXO de
 * Stripe, cobro de tarjeta que entra solo y «Pagar ahora / Subir de plan» de la pantalla de suspendida):
 *
 *  1. `anularFacturasDeMesesSuspendidos` — las facturas abiertas / incobrables / en borrador de los meses sin servicio se
 *     ANULAN en Stripe (void: no las cobra ni las reintenta, y nada se borra) y en la base quedan registradas como
 *     «No cobrada: servicio suspendido» (status `void`: ni ingreso ni adeudo).
 *  2. `realinearCiclo` — el siguiente cobro de la tarjeta pasa a ser EXACTAMENTE al terminar lo pagado.
 *
 * ── Por qué `trial_end` para mover el ciclo (décima vuelta; antes era `pause_collection` + `billing_cycle_anchor`) ───────
 *  · `subscriptions.update({ trial_end: T, proration_behavior: "none" })` es el mecanismo que Stripe documenta para cambiar
 *    la fecha de cobro de una suscripción existente: «Setting the trial_end sets the billing cycle anchor to the same
 *    date». No genera ningún cobro (el trial no cobra) ni depende de cómo trate Stripe una factura que nace pausada.
 *    A T Stripe cobra solo el plan completo. T es el fin de lo pagado (`finDeLoPagado`): el acceso y el cobro coinciden
 *    al instante, sin días pagados dos veces ni huecos, para 1 mes, N meses, planes mensuales o anuales.
 *  · La alternativa anterior (pausa `void` + ancla «now» en una llamada) dependía de cuatro comportamientos de Stripe que
 *    nadie ha probado: que la factura del reinicio nazca anulada, que anular facturas deje la suscripción `active`, que
 *    `resumes_at` limpie la pausa y qué pasa con los borradores. Si alguno fallaba era un DOBLE COBRO. Con `trial_end` lo
 *    peor que puede pasar es que Stripe rechace el cambio: la operación falla cerrada (no se cobra, no se mueve nada).
 *  · Costo: Stripe reporta la suscripción como `trialing`. NUESTRA app la trata como periodo pagado: la llamada deja la
 *    MARCA `metadata.periodo_pagado_hasta` y el webhook escribe `active` en la base cuando ve `trialing` + marca
 *    (`estadoVisibleDeSuscripcion`), así que la clínica NUNCA sale «En prueba» y ve «Pagado hasta {fecha}». Lo que sí ve el
 *    portal de facturación de Stripe / los correos de Stripe es «prueba hasta T» (es verdad: no se cobra hasta T).
 *    `cobroPausado` (cambio de plan bloqueado) y `resolveOverageBilling` (excedente CFDI) reconocen la marca.
 *  · Red de seguridad: si la factura que devuelve el cambio trae un cobro (no debería), se reporta `cobro_inesperado`.
 *    Interruptor de emergencia: `COBRO_REALINEAR_CICLO=0` apaga SOLO este paso (las facturas se anulan igual; el ciclo
 *    viejo sigue y la tarjeta cobra en su fecha de siempre: avisa al admin en el reporte del pago).
 *  ⚠️ Sin llaves de Stripe en este servidor no se probó contra Stripe real: probar con un reloj de pruebas (test clock) antes
 *    de integrar (suscripción mensual con un cobro fallido, esperar 2 ciclos, confirmar un pago manual).
 *
 * Todo es idempotente (claves de idempotencia; un periodo ya puesto hasta esa fecha se reconoce) y NUNCA lanza hacia quien
 * llama: devuelve los fallos para que se avise. Nunca borra ni cancela nada.
 */

export type StripeParaSuspension = Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems">;

/** Las facturas que de verdad son el cobro del plan; un prorrateo (subscription_update) no se toca. */
export const MOTIVOS_DEL_PLAN = new Set(["subscription_cycle", "subscription_create"]);

export const MENSAJE_FALLO_ANULAR =
  "No pudimos anular en Stripe las facturas de los meses sin servicio; Stripe podría cobrarlas. Reintenta o anúlalas a mano en Stripe.";
export const MENSAJE_FALLO_EXCEDENTE =
  "No pudimos separar el excedente de facturas CFDI antes de mover el cobro de la tarjeta; se perdería en una factura anulada. Reintenta.";
/** Z14: reintentar no sirve mientras haya un cargo pendiente de OTRA suscripción (un módulo): hay que facturarlo o quitarlo primero. */
export const MENSAJE_FALLO_EXCEDENTE_OTRA_SUSCRIPCION =
  "No se pudo mover el siguiente cobro de la tarjeta: hay un cargo pendiente de otra suscripción del cliente (un módulo) que se cobraría junto con el excedente de facturas CFDI. Reintentar no sirve hasta que ese cargo se facture; revisa los cargos pendientes del cliente en Stripe.";
export const MENSAJE_FALLO_REALINEAR =
  "No pudimos mover el siguiente cobro de la tarjeta a la nueva fecha; Stripe podría cobrar antes de tiempo. Pulsa «Reintentar» en /admin → Pagos: repite el paso completo (con la marca de periodo pagado). No pongas una prueba a mano en Stripe.";
export function mensajeCobroInesperado(facturaId: string): string {
  return `Stripe cobró la tarjeta al mover el ciclo (factura ${facturaId}): reembolsa ese cobro en Stripe.`;
}

/** Interruptor de emergencia del reinicio del ancla (ver arriba). */
export function realinearActivo(): boolean {
  return process.env.COBRO_REALINEAR_CICLO !== "0";
}

/**
 * Las facturas ABIERTAS, INCOBRABLES o en BORRADOR de renovación / alta de la suscripción del plan (nunca prorrateos), con
 * paginación (M8: antes máximo 20 por estado). Un borrador es una renovación que Stripe aún no finaliza: si se dejara,
 * al finalizarse cobraría un mes sin servicio. `creadasHasta`: solo las creadas hasta ese momento (el del pago); la
 * renovación posterior es otra cosa.
 */
export async function facturasAbiertasDelPlan(
  stripe: Pick<Stripe, "invoices">,
  stripeSubscriptionId: string,
  creadasHasta?: Date | null,
): Promise<Stripe.Invoice[]> {
  const pendientes: Stripe.Invoice[] = [];
  for (const status of ["open", "uncollectible", "draft"] as const) {
    let despuesDe: string | undefined;
    for (let pagina = 0; pagina < 10; pagina++) {
      const lista = await stripe.invoices.list({ subscription: stripeSubscriptionId, status, limit: 100, ...(despuesDe ? { starting_after: despuesDe } : {}) });
      pendientes.push(
        ...lista.data.filter(
          (f) =>
            f.billing_reason &&
            MOTIVOS_DEL_PLAN.has(f.billing_reason) &&
            (!creadasHasta || (f.created ?? 0) * 1000 <= creadasHasta.getTime()),
        ),
      );
      const ultimo = lista.data[lista.data.length - 1];
      if (!lista.has_more || !ultimo?.id) break;
      despuesDe = ultimo.id;
    }
  }
  return pendientes;
}

/** Deja en `subscription_invoices` la factura anulada como «No cobrada: servicio suspendido» (nunca lanza). */
export async function registrarComoNoCobrada(invoice: Stripe.Invoice, clinicId: string): Promise<void> {
  try {
    const reference = invoice.id;
    if (!reference || !clinicId) return;
    const actualizadas = await prisma.subscriptionInvoice.updateMany({
      where: { clinicId, reference, status: { in: ["failed", "pending"] } },
      data: { status: "void", notes: NOTA_SERVICIO_SUSPENDIDO },
    });
    if (actualizadas.count > 0) return;
    const ya = await prisma.subscriptionInvoice.findFirst({ where: { clinicId, reference }, select: { id: true } });
    if (ya) return; // ya estaba (anulada antes, o pagada): no se toca
    const periodo = invoice.lines?.data?.[0]?.period ?? null;
    const creada = new Date((invoice.created ?? Math.floor(Date.now() / 1000)) * 1000);
    const inicio = periodo?.start ? new Date(periodo.start * 1000) : creada;
    const fin = periodo?.end ? new Date(periodo.end * 1000) : new Date(inicio.getTime() + 30 * 86_400_000);
    await prisma.subscriptionInvoice.create({
      data: {
        clinicId,
        amount: (invoice.amount_due ?? 0) / 100,
        currency: (invoice.currency ?? "mxn").toUpperCase(),
        status: "void",
        method: "stripe",
        reference,
        periodStart: inicio,
        periodEnd: fin,
        paidAt: null,
        notes: NOTA_SERVICIO_SUSPENDIDO,
      },
    });
  } catch (err) {
    console.error("[reactivacion-tras-suspension] no se pudo registrar la factura no cobrada:", invoice?.id, (err as Error)?.message ?? err);
  }
}

export async function anularFacturasDeMesesSuspendidos(
  stripe: Pick<Stripe, "invoices">,
  clinicId: string,
  facturas: Stripe.Invoice[],
): Promise<{ anuladas: string[]; fallos: string[] }> {
  const anuladas: string[] = [];
  const fallos: string[] = [];
  for (const f of facturas) {
    if (!f.id) continue;
    try {
      // Un borrador no se puede anular: se finaliza SIN cobrarla (`auto_advance: false`) y luego se anula. Nada se borra.
      if (f.status === "draft") await stripe.invoices.finalizeInvoice(f.id, { auto_advance: false }, { idempotencyKey: `finalizar-suspendida:${f.id}` });
      await stripe.invoices.voidInvoice(f.id, {}, { idempotencyKey: `anular-suspendida:${f.id}` });
      anuladas.push(f.id);
    } catch (err) {
      // Ya anulada por otro camino (reintento, Dashboard): cuenta como hecha.
      let yaAnulada = false;
      try {
        yaAnulada = (await stripe.invoices.retrieve(f.id)).status === "void";
      } catch {
        yaAnulada = false;
      }
      if (yaAnulada) anuladas.push(f.id);
      else {
        console.error("[reactivacion-tras-suspension] no se pudo anular", f.id, (err as Error)?.message ?? err);
        fallos.push(f.id);
      }
    }
    if (anuladas.includes(f.id)) await registrarComoNoCobrada(f, clinicId);
  }
  return { anuladas, fallos };
}

export type ResultadoRealineo =
  /** Interruptor apagado, el fin de lo pagado ya casi llegó, o el ciclo de Stripe ya coincide con él: no se tocó nada. */
  | { tipo: "no_aplica" }
  /** `COBRO_REALINEAR_CICLO=0`: el ciclo NO se movió y la tarjeta cobrará en su fecha anterior (se avisa, Y15). */
  | { tipo: "apagado" }
  /** Ya estaba hecho (periodo pagado puesto hasta esa fecha): no se repite. */
  | { tipo: "ya_estaba"; hasta: string }
  | { tipo: "hecho"; hasta: string; estadoStripe: string | null }
  /** El cambio generó un cobro de la tarjeta (no debería): hay que reembolsar `facturaId`. */
  | { tipo: "cobro_inesperado"; hasta: string; facturaId: string; monto: number }
  | { tipo: "fallo"; mensaje: string };

/** ¿Un error de Stripe por clave de idempotencia en curso / reutilizada? (la otra llamada, p. ej. el webhook, lo está haciendo). */
function esErrorDeIdempotencia(err: unknown): boolean {
  const e = err as { type?: string; code?: string; statusCode?: number; message?: string } | null;
  return e?.type === "StripeIdempotencyError" || e?.code === "idempotency_key_in_use" || e?.statusCode === 409 || /idempoten/i.test(e?.message ?? "");
}

/**
 * Mueve el siguiente cobro de la tarjeta a «fin de lo pagado» SIN cobrar, SIN cancelar y SIN que la clínica salga «En
 * prueba» (ver arriba). `finDeLoPagado`: hasta cuándo quedó pagada la clínica; sale de la fecha del PAGO, nunca del momento
 * del reintento (M9). Funciona igual con suscripciones mensuales y anuales.
 */
export async function realinearCiclo(
  stripe: Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems">,
  sub: Stripe.Subscription,
  args: {
    pagadoEn: Date;
    finDeLoPagado: Date;
    /** Sin tolerancia: el ciclo se mueve aunque ya casi coincida (clínica que estaba SUSPENDIDA: cada día cuenta, Y4). */
    exacto?: boolean;
    /** Facturas que NO son un cobro del cambio de ciclo (la que acaba de pagar el cliente): su `latest_invoice` no es alarma. */
    ignorarFacturas?: string[];
  },
): Promise<ResultadoRealineo> {
  const trialEnd = Math.floor(args.finDeLoPagado.getTime() / 1000);
  // Stripe exige un `trial_end` futuro; si lo pagado termina en menos de un día no hay nada que mover.
  if (trialEnd * 1000 <= Date.now() + 86_400_000) return { tipo: "no_aplica" };
  const hasta = new Date(trialEnd * 1000).toISOString();
  const yaHecho = (s: Stripe.Subscription) => enPeriodoPagado(s) && (s.trial_end ?? 0) >= trialEnd - 86_400;
  if (yaHecho(sub)) return { tipo: "ya_estaba", hasta: new Date((sub.trial_end ?? trialEnd) * 1000).toISOString() };
  const finCiclo = subscriptionPeriodEndSeconds(sub);
  // Z3/AA4: NUNCA un `trial_end` antes del fin de un periodo que Stripe YA cobró, sin tolerancia en ESE sentido (ni 1 hora): si
  // el periodo actual está pagado (`active`) y termina después de lo que se busca, cortarlo quitaría días pagados y la tarjeta
  // volvería a cobrar antes de tiempo. No se mueve nada. Solo cuenta un periodo PAGADO: con `past_due`/`unpaid` el «periodo
  // actual» es el que Stripe abrió y no se cobró, y ese sí se mueve.
  if ((sub.status === "active" || sub.status === "trialing") && finCiclo && finCiclo > trialEnd) return { tipo: "no_aplica" };
  // Si el ciclo de Stripe ya termina (casi) cuando termina lo pagado, no hay nada que mover.
  if (!args.exacto && sub.status !== "trialing" && finCiclo && Math.abs(finCiclo - trialEnd) <= CICLO_ALINEADO_DIAS * 86_400) return { tipo: "no_aplica" };
  // Z17: el interruptor apagado solo se avisa si HABÍA algo que mover (lo anterior ya salió como «no aplica»).
  if (!realinearActivo()) return { tipo: "apagado" };
  // La factura más reciente ANTES del cambio: si el cambio no crea ninguna, la `latest_invoice` que devuelve es esta (p. ej. el
  // mes recién pagado) y NO es un cobro del cambio (Y3).
  const latestAntes = typeof sub.latest_invoice === "string" ? sub.latest_invoice : (sub.latest_invoice as { id?: string } | null | undefined)?.id ?? null;
  const inicioLlamada = Date.now();
  try {
    // El excedente de CFDI ya sumado a «la próxima mensualidad» se pasa a su propia factura: la que genere el cambio de
    // ciclo se lo llevaría (V3).
    try {
      await cobrarAparteExcedentePendiente(stripe, typeof sub.customer === "string" ? sub.customer : sub.customer.id, sub);
    } catch (err) {
      console.error("[reactivacion-tras-suspension] no se pudo separar el excedente de CFDI:", sub.id, (err as Error)?.message ?? err);
      return { tipo: "fallo", mensaje: (err as { code?: string } | null)?.code === "ITEMS_DE_OTRA_SUSCRIPCION" ? MENSAJE_FALLO_EXCEDENTE_OTRA_SUSCRIPCION : MENSAJE_FALLO_EXCEDENTE };
    }
    const actualizada = await stripe.subscriptions.update(
      sub.id,
      {
        trial_end: trialEnd,
        proration_behavior: "none",
        metadata: { [MARCA_PERIODO_PAGADO]: hasta },
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `periodo-pagado:${sub.id}:${trialEnd}` },
    );
    const ultima = (actualizada as { latest_invoice?: unknown }).latest_invoice;
    if (ultima && typeof ultima === "object") {
      const f = ultima as { id?: string; status?: string | null; amount_paid?: number | null; amount_due?: number | null; created?: number | null };
      // Solo cuenta una factura NUEVA: distinta de la de antes y creada por esta llamada.
      const esNueva = !!f.id && f.id !== latestAntes && !(args.ignorarFacturas ?? []).includes(f.id) && (f.created ?? 0) * 1000 >= inicioLlamada - 15_000;
      if (esNueva && ((f.amount_paid ?? 0) > 0 || ((f.amount_due ?? 0) > 0 && f.status !== "void"))) {
        // M5: cualquier factura con importe que NO sea una anulada es un cobro (o está por serlo).
        console.error("[reactivacion-tras-suspension] el cambio de ciclo generó un cobro", f.id, f.status);
        if (f.id && (f.status === "open" || f.status === "draft")) {
          try {
            if (f.status === "draft") await stripe.invoices.finalizeInvoice(f.id, { auto_advance: false });
            await stripe.invoices.voidInvoice(f.id);
            return { tipo: "hecho", hasta, estadoStripe: actualizada?.status ?? null };
          } catch {
            /* no se pudo anular: se reporta abajo */
          }
        }
        return { tipo: "cobro_inesperado", hasta, facturaId: f.id ?? "", monto: ((f.amount_paid ?? f.amount_due) ?? 0) / 100 };
      }
    }
    return { tipo: "hecho", hasta, estadoStripe: actualizada?.status ?? null };
  } catch (err) {
    // M3: otra llamada idéntica (el webhook y «Pagar» a la vez) tiene la clave en curso: se relee y, si ya quedó, es éxito.
    try {
      const releida = await stripe.subscriptions.retrieve(sub.id);
      if (yaHecho(releida)) return { tipo: "ya_estaba", hasta: new Date((releida.trial_end ?? trialEnd) * 1000).toISOString() };
    } catch {
      /* se reporta el error original */
    }
    console.error("[reactivacion-tras-suspension] no se pudo mover el ciclo:", sub.id, esErrorDeIdempotencia(err) ? "(idempotencia)" : "", (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_REALINEAR };
  }
}

export interface ResultadoReactivacion {
  anuladas: string[];
  realineo: ResultadoRealineo;
  /** Hasta cuándo quedó pagada la clínica (el `trial_end` que se buscó). */
  finDeLoPagado: Date;
  /** Mensajes para el aviso del admin; vacío = todo en orden. */
  fallos: string[];
}

/**
 * La regla completa: se mueve el ciclo y SIEMPRE se anulan las facturas de los meses suspendidos (nunca se deben, Y6: si el
 * cambio de ciclo falla, dejarlas abiertas las dejaría cobrables por los reintentos de Stripe). Si el ciclo falló, el
 * resultado lo dice y quien llama deja la marca para que el reintento (webhook 5xx / «Reintentar» / cron) lo complete.
 *
 *  `facturas`  las facturas abiertas de los meses suspendidos (excluyendo la que acaba de pagar un cobro de tarjeta).
 *  `pagadoEn`  el día y hora del pago.
 *  `finDeLoPagado`  hasta cuándo quedó pagado. Para un cobro de TARJETA del plan (sin `periodoExacto`) se toma al menos un
 *    periodo completo del plan desde el pago: una anualidad son 12 meses, no 1 (Y1). Las vías manuales pasan
 *    `periodoExacto: true` con los meses que pagó el admin.
 *
 *  Para «Pagar ahora / Subir de plan» (ws1-t2): tras cobrar con éxito llamar a esta función con `facturas` = las demás
 *  abiertas del plan.
 */
export async function aplicarReglaDeSuspension(args: {
  stripe: StripeParaSuspension;
  clinicId: string;
  sub: Stripe.Subscription;
  pagadoEn: Date;
  finDeLoPagado: Date;
  facturas: Stripe.Invoice[];
  periodoExacto?: boolean;
  /** La(s) factura(s) que acaba de pagar el cliente: nunca se toman por un cobro inesperado del cambio de ciclo. */
  facturaPagada?: string[];
}): Promise<ResultadoReactivacion> {
  const fin = args.periodoExacto
    ? args.finDeLoPagado
    : new Date(Math.max(args.finDeLoPagado.getTime(), finDeLoPagado(args.pagadoEn, mesesDelIntervalo(args.sub)).getTime()));
  // Una clínica que estaba suspendida: sin tolerancia, cada día cuenta (Y4).
  const realineo = await realinearCiclo(args.stripe, args.sub, { pagadoEn: args.pagadoEn, finDeLoPagado: fin, exacto: true, ignorarFacturas: args.facturaPagada });
  const fallos: string[] = [];
  if (realineo.tipo === "fallo") fallos.push(realineo.mensaje);
  if (realineo.tipo === "cobro_inesperado") fallos.push(mensajeCobroInesperado(realineo.facturaId));
  const { anuladas, fallos: noAnuladas } = await anularFacturasDeMesesSuspendidos(args.stripe, args.clinicId, args.facturas);
  if (noAnuladas.length > 0) fallos.push(MENSAJE_FALLO_ANULAR);
  return { anuladas, realineo, fallos, finDeLoPagado: fin };
}
