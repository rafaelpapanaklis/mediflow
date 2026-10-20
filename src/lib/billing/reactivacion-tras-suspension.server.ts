import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { NOTA_SERVICIO_SUSPENDIDO, reanudarCobroTrasRealinear } from "@/lib/billing/cobro-rechazado";
import { subscriptionItemInterval } from "@/lib/billing/proration";
import { cobrarAparteExcedentePendiente } from "@/lib/cfdi-overage";

/**
 * PAGO TRAS UNA SUSPENSIÓN POR FALTA DE PAGO (ws1-t1, octava vuelta — corrección de Q4 de Rafael).
 *
 *   «Si se tiene 4 meses el servicio suspendido por falta de pago, no debe 4 meses, porque el servicio estuvo suspendido
 *    sin poder usarse. Si vuelve a pagar después de 4 meses, de ese día y hora que pagó se le agregan 30 días.»
 *
 * Dos piezas, reutilizables por TODA vía de pago (admin confirma SPEI/transferencia/efectivo, SPEI directo, SPEI/OXXO de
 * Stripe, cobro de tarjeta que entra solo y «Pagar ahora / Subir de plan» de la pantalla de suspendida):
 *
 *  1. `anularFacturasDeMesesSuspendidos` — las facturas abiertas / incobrables de los meses sin servicio se ANULAN en
 *     Stripe (void: Stripe no las cobra ni las reintenta, y nada se borra) y en la base quedan registradas como
 *     «No cobrada: servicio suspendido» (status `void`: ni ingreso ni adeudo).
 *  2. `realinearCiclo` — el siguiente cobro de la tarjeta pasa a ser al terminar lo pagado (hoy + N meses), no en la
 *     fecha del ciclo viejo.
 *
 * ── Por qué ese mecanismo para el ciclo (y no otro) ─────────────────────────────────────────────────────────────────
 *  · `trial_end` mueve el ancla sin cobrar, pero deja la suscripción en `trialing`, que para la clínica es «En prueba»
 *    (justo lo prohibido). Cancelar pierde la tarjeta guardada.
 *  · `billing_cycle_anchor: "now"` es lo único que mueve el ancla de una suscripción activa, pero Stripe emite UNA FACTURA
 *    EN ESE INSTANTE (doc: «After you reset the billing cycle anchor, Stripe immediately sends an invoice») y eso cobraría
 *    la tarjeta otra vez: doble cobro. Por eso va en la MISMA llamada que `pause_collection` (behavior "void", `resumes_at`
 *    = fin de lo pagado − margen): esa factura nace con el cobro pausado y Stripe la ANULA (doc: «Void: voids all invoices
 *    while collection is paused»); las renovaciones intermedias (si pagó N meses) se anulan igual, y al llegar `resumes_at`
 *    Stripe vuelve a cobrar solo en la renovación que cae al terminar lo pagado. La suscripción sigue `active`.
 *  · Red de seguridad: la respuesta trae `latest_invoice` (expand); si la factura del reinicio salió COBRADA (no debería),
 *    se devuelve `cobro_inesperado` con su id para que el admin la reembolse. Interruptor de emergencia: la variable de
 *    entorno `COBRO_REALINEAR_CICLO=0` apaga solo el reinicio del ancla (las facturas viejas se siguen anulando y el cobro
 *    se pausa con la regla aproximada de Q1).
 *  ⚠️ El comportamiento de Stripe aquí se tomó de su documentación; no se pudo probar contra Stripe real desde este
 *    servidor. Probar con un reloj de pruebas (test clock) antes de integrar.
 *
 * Todo es idempotente (claves de idempotencia; la pausa ya puesta se reconoce y no se repite) y NUNCA lanza hacia quien
 * llama: devuelve los fallos para que el admin vea el aviso con «Reintentar». Nunca borra ni cancela nada.
 */

export type StripeParaSuspension = Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems">;

/** Las facturas que de verdad son el cobro del plan; un prorrateo (subscription_update) no se toca. */
export const MOTIVOS_DEL_PLAN = new Set(["subscription_cycle", "subscription_create"]);

export const MENSAJE_FALLO_ANULAR =
  "No pudimos anular en Stripe las facturas de los meses sin servicio; Stripe podría cobrarlas. Reintenta o anúlalas a mano en Stripe.";
export const MENSAJE_FALLO_EXCEDENTE =
  "No pudimos separar el excedente de facturas CFDI antes de mover el cobro de la tarjeta; se perdería en una factura anulada. Reintenta.";
export const MENSAJE_FALLO_REALINEAR =
  "No pudimos mover el siguiente cobro de la tarjeta a la nueva fecha; Stripe podría cobrar antes de tiempo. Reintenta o ajústalo a mano en Stripe.";
export function mensajeCobroInesperado(facturaId: string): string {
  return `Stripe cobró la tarjeta al mover el ciclo (factura ${facturaId}): reembolsa ese cobro en Stripe.`;
}

/** Interruptor de emergencia del reinicio del ancla (ver arriba). */
export function realinearActivo(): boolean {
  return process.env.COBRO_REALINEAR_CICLO !== "0";
}

/**
 * Las facturas ABIERTAS o INCOBRABLES de renovación / alta de la suscripción del plan (nunca prorrateos). `creadasHasta`:
 * solo las creadas hasta ese momento (el del pago); la renovación posterior es otra cosa.
 */
export async function facturasAbiertasDelPlan(
  stripe: Pick<Stripe, "invoices">,
  stripeSubscriptionId: string,
  creadasHasta?: Date | null,
): Promise<Stripe.Invoice[]> {
  const pendientes: Stripe.Invoice[] = [];
  for (const status of ["open", "uncollectible"] as const) {
    const lista = await stripe.invoices.list({ subscription: stripeSubscriptionId, status, limit: 20 });
    pendientes.push(
      ...lista.data.filter(
        (f) =>
          f.billing_reason &&
          MOTIVOS_DEL_PLAN.has(f.billing_reason) &&
          (!creadasHasta || (f.created ?? 0) * 1000 <= creadasHasta.getTime()),
      ),
    );
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
  /** Interruptor apagado, suscripción no mensual, o no queda nada prepagado: no se tocó el ciclo. */
  | { tipo: "no_aplica" }
  /** Ya estaba hecho (pausa puesta hasta esa fecha): no se repite. */
  | { tipo: "ya_estaba"; hasta: string }
  | { tipo: "hecho"; hasta: string; estadoStripe: string | null }
  /** El reinicio del ancla cobró la tarjeta (no debería): hay que reembolsar `facturaId`. */
  | { tipo: "cobro_inesperado"; hasta: string; facturaId: string; monto: number }
  | { tipo: "fallo"; mensaje: string };

/**
 * Mueve el siguiente cobro de la tarjeta a «fin de lo pagado» SIN cobrar, SIN «En prueba» y SIN cancelar (ver arriba).
 * `finDeLoPagado`: hasta cuándo quedó pagada la clínica (hoy + N meses desde el pago).
 */
export async function realinearCiclo(
  stripe: Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems">,
  sub: Stripe.Subscription,
  args: { pagadoEn: Date; finDeLoPagado: Date },
): Promise<ResultadoRealineo> {
  if (!realinearActivo()) return { tipo: "no_aplica" };
  if (subscriptionItemInterval(sub.items?.data?.[0]) !== "month") return { tipo: "no_aplica" };
  const reanuda = Math.floor(reanudarCobroTrasRealinear(args.finDeLoPagado).getTime() / 1000);
  if (reanuda * 1000 <= args.pagadoEn.getTime()) return { tipo: "no_aplica" };
  const hasta = new Date(reanuda * 1000).toISOString();
  const yaHasta = sub.pause_collection?.resumes_at ?? 0;
  if (sub.pause_collection && yaHasta >= reanuda - 86_400) return { tipo: "ya_estaba", hasta: new Date(yaHasta * 1000).toISOString() };
  try {
    // El excedente de CFDI ya sumado a «la próxima mensualidad» se pasa a su propia factura: la que nace al reiniciar el
    // ancla se anula y se lo llevaría (V3).
    try {
      await cobrarAparteExcedentePendiente(stripe, typeof sub.customer === "string" ? sub.customer : sub.customer.id, sub.id);
    } catch (err) {
      console.error("[reactivacion-tras-suspension] no se pudo separar el excedente de CFDI:", sub.id, (err as Error)?.message ?? err);
      return { tipo: "fallo", mensaje: MENSAJE_FALLO_EXCEDENTE };
    }
    const actualizada = await stripe.subscriptions.update(
      sub.id,
      {
        pause_collection: { behavior: "void", resumes_at: reanuda },
        billing_cycle_anchor: "now",
        proration_behavior: "none",
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `realinear:${sub.id}:${reanuda}` },
    );
    const ultima = (actualizada as { latest_invoice?: unknown }).latest_invoice;
    if (ultima && typeof ultima === "object") {
      const f = ultima as { id?: string; status?: string | null; amount_paid?: number | null };
      if (f.status === "paid" && (f.amount_paid ?? 0) > 0 && f.id) {
        console.error("[reactivacion-tras-suspension] el reinicio del ciclo COBRÓ la tarjeta", f.id);
        return { tipo: "cobro_inesperado", hasta, facturaId: f.id, monto: (f.amount_paid ?? 0) / 100 };
      }
    }
    return { tipo: "hecho", hasta, estadoStripe: actualizada?.status ?? null };
  } catch (err) {
    console.error("[reactivacion-tras-suspension] no se pudo mover el ciclo:", sub.id, (err as Error)?.message ?? err);
    return { tipo: "fallo", mensaje: MENSAJE_FALLO_REALINEAR };
  }
}

export interface ResultadoReactivacion {
  anuladas: string[];
  realineo: ResultadoRealineo;
  /** Mensajes para el aviso del admin; vacío = todo en orden. */
  fallos: string[];
}

/**
 * La regla completa, en el orden que no deja a nadie sin protección: primero se mueve el ciclo (la clínica ya no puede
 * ser cobrada por el ciclo viejo) y, solo si salió bien, se anulan las facturas de los meses suspendidos; si el ciclo
 * falló, esas facturas se quedan abiertas a propósito para que el reintento (cron / «Reintentar») las vea y repita todo.
 *
 *  `facturas`  las facturas abiertas de los meses suspendidos (excluyendo la que acaba de pagar un cobro de tarjeta).
 *  `pagadoEn`  el día y hora del pago.  `finDeLoPagado`  pagadoEn + N meses (el `trialEndsAt` que quedó).
 *
 *  Para «Pagar ahora / Subir de plan» (ws1-t2): tras cobrar con éxito llamar a esta función con el estado de la clínica
 *  de ANTES (`clinicaEstabaSuspendida`) y `facturas` = las demás abiertas del plan; con `billing_cycle_anchor: "now"` ya
 *  hecho por su propio `subscriptions.update`, el ciclo ya está alineado y `realinearCiclo` lo reconoce solo si hay pausa;
 *  si no la hay basta `anularFacturasDeMesesSuspendidos`.
 */
export async function aplicarReglaDeSuspension(args: {
  stripe: StripeParaSuspension;
  clinicId: string;
  sub: Stripe.Subscription;
  pagadoEn: Date;
  finDeLoPagado: Date;
  facturas: Stripe.Invoice[];
}): Promise<ResultadoReactivacion> {
  const realineo = await realinearCiclo(args.stripe, args.sub, { pagadoEn: args.pagadoEn, finDeLoPagado: args.finDeLoPagado });
  const fallos: string[] = [];
  if (realineo.tipo === "fallo") {
    fallos.push(realineo.mensaje);
    return { anuladas: [], realineo, fallos };
  }
  if (realineo.tipo === "cobro_inesperado") fallos.push(mensajeCobroInesperado(realineo.facturaId));
  const { anuladas, fallos: noAnuladas } = await anularFacturasDeMesesSuspendidos(args.stripe, args.clinicId, args.facturas);
  if (noAnuladas.length > 0) fallos.push(MENSAJE_FALLO_ANULAR);
  return { anuladas, realineo, fallos };
}
