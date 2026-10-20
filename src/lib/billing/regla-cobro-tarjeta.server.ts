import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sincronizarSedesIncluidas } from "@/lib/billing/sedes-incluidas";
import {
  clinicaEstabaSuspendida,
  esMesDeServicioSuspendido,
  finDeLoPagado,
  mesesDelIntervalo,
} from "@/lib/billing/cobro-rechazado";
import { subscriptionPeriodFields } from "@/lib/billing/proration";
import { isPaymentFailed } from "@/lib/plan-status";
import { referenciaDeFactura } from "@/lib/marketplace/module-purchase-core";
import { aplicarReglaDeSuspension, facturasAbiertasDelPlan } from "@/lib/billing/reactivacion-tras-suspension.server";
import { avisarAdminUnaVez } from "@/lib/billing/aviso-admin-envio.server";
import { avisoFalloReglaSuspension, avisoStripeSigueRechazada } from "@/lib/billing/avisos-admin";

/**
 * COBRO DE TARJETA A UNA CLÍNICA SUSPENDIDA (ws1-t1) — la regla de «los meses suspendidos no se deben» aplicada a un
 * `invoice.paid` (el reintento de Stripe que entra solo, «Pagar mi plan», el enlace de «Subir de plan»).
 *
 * Vive aquí (y no en la ruta del webhook) para que el MISMO código lo usen el webhook, el botón «Reintentar» de
 * /admin → Pagos y el cron diario: cuando la regla no se completa queda un RASTRO en `billing_email_logs`
 * (`<factura>:regla_fallo`) que se cierra con otro (`<factura>:regla_ok`) al completarse; nada se borra y no hace falta
 * una tabla nueva. Mientras haya un `regla_fallo` sin `regla_ok`, esa clínica aparece como pendiente de reintento.
 */

type StripeRegla = Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems">;

export type ResultadoReglaCobro = { aplicada: false } | { aplicada: true; fin: Date; estadoStripe: string | null };

export const KIND_REGLA_FALLO = "regla_fallo";
export const KIND_REGLA_OK = "regla_ok";
const VENTANA_RASTROS_MS = 14 * 86_400_000;

async function crearRastro(invoiceId: string, clinicId: string, kind: string): Promise<void> {
  try {
    await prisma.billingEmailLog.create({ data: { invoiceId: `${invoiceId}:${kind}`, clinicId, kind, email: "-" } });
  } catch (e) {
    if ((e as { code?: string } | null)?.code !== "P2002") console.error("[regla-cobro-tarjeta] rastro", kind, (e as Error)?.message ?? e);
  }
}

export const registrarReglaFallida = (invoiceId: string, clinicId: string) => crearRastro(invoiceId, clinicId, KIND_REGLA_FALLO);
export const registrarReglaCompletada = (invoiceId: string, clinicId: string) => crearRastro(invoiceId, clinicId, KIND_REGLA_OK);

/** Facturas (de una clínica, o de todas) cuya regla falló y aún no se completó. Dentro de los últimos 14 días. */
export async function reglasPendientes(clinicId?: string): Promise<Array<{ clinicId: string; invoiceId: string }>> {
  const filas = await prisma.billingEmailLog.findMany({
    where: { kind: { in: [KIND_REGLA_FALLO, KIND_REGLA_OK] }, createdAt: { gte: new Date(Date.now() - VENTANA_RASTROS_MS) }, ...(clinicId ? { clinicId } : {}) },
    select: { invoiceId: true, clinicId: true, kind: true },
  });
  const cerradas = new Set<string>();
  for (const f of filas) if (f.kind === KIND_REGLA_OK) cerradas.add(f.invoiceId.replace(/:regla_ok$/, ""));
  const salida: Array<{ clinicId: string; invoiceId: string }> = [];
  for (const f of filas) {
    if (f.kind !== KIND_REGLA_FALLO) continue;
    const id = f.invoiceId.replace(/:regla_fallo$/, "");
    if (!cerradas.has(id)) salida.push({ clinicId: f.clinicId, invoiceId: id });
  }
  return salida;
}

/**
 * Aplica la regla a un cobro de tarjeta. «Estaba suspendida» NO depende solo del estado de la base (Stripe no garantiza el
 * orden de los eventos: un `customer.subscription.updated` puede haberla dejado `active` antes de este `invoice.paid`):
 * también cuenta que la factura pagada se haya finalizado hace más que la gracia, que queden otras facturas abiertas de
 * meses sin servicio, o que la regla de esta misma factura haya fallado antes (rastro). Vale para renovaciones y para la
 * factura de «Subir» (`subscription_update`) pagada después de que falló; en ese caso, al ser un cambio de plan que puede
 * pagar una clínica AL CORRIENTE, exige prueba de suspensión (Y10). Solo cobros reales (monto > 0).
 *
 * Si algo de la regla falla se LANZA el error ANTES de reactivar a la clínica: el webhook responde 5xx y Stripe reenvía el
 * evento; el admin recibe UN aviso por factura y queda el rastro para «Reintentar» y el cron.
 */
export async function reglaDeSuspensionPorCobroDeTarjeta(
  stripe: StripeRegla,
  invoice: Stripe.Invoice,
  clinic: { id: string; name?: string | null; subscriptionStatus: string | null; stripeSubscriptionId: string | null; trialEndsAt: Date | null },
  pagadoEn: Date,
): Promise<ResultadoReglaCobro> {
  const NO: ResultadoReglaCobro = { aplicada: false };
  if (!clinic.stripeSubscriptionId || (invoice.amount_paid ?? 0) <= 0 || !invoice.id) return NO;
  if (referenciaDeFactura(invoice as unknown as Parameters<typeof referenciaDeFactura>[0]).stripeSubscriptionId !== clinic.stripeSubscriptionId) return NO;
  const motivo = invoice.billing_reason;
  const esRenovacion = motivo === "subscription_cycle" || motivo === "subscription_create";
  const esCambio = motivo === "subscription_update";
  if (!esRenovacion && !esCambio) return NO;

  const finalizada = invoice.status_transitions?.finalized_at ?? invoice.created ?? 0;
  const dbVencida = clinicaEstabaSuspendida(clinic, pagadoEn);
  const facturaVieja = esMesDeServicioSuspendido({ facturaCreadaEn: finalizada, pagoEn: pagadoEn });
  const fallidaAntes = (await reglasPendientes(clinic.id)).some((r) => r.invoiceId === invoice.id);
  const reintentada = esRenovacion && (invoice.attempt_count ?? 1) > 1; // un pago que no entró a la primera: vale la pena mirar las demás
  const pruebaPropia = esCambio ? dbVencida || (facturaVieja && isPaymentFailed(clinic.subscriptionStatus)) : dbVencida || facturaVieja;
  if (!fallidaAntes && !pruebaPropia && !reintentada) return NO;

  const viva = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId);
  if (!["active", "past_due", "unpaid", "trialing"].includes(viva.status)) return NO;
  const otras = (await facturasAbiertasDelPlan(stripe, clinic.stripeSubscriptionId)).filter((f) => f.id !== invoice.id);
  const hayMesesSinServicio = otras.some((f) => esMesDeServicioSuspendido({ facturaCreadaEn: f.status_transitions?.finalized_at ?? f.created ?? 0, pagoEn: pagadoEn }));
  if (!fallidaAntes && !pruebaPropia && !hayMesesSinServicio) return NO;

  // Un cobro de tarjeta del plan paga un periodo COMPLETO: una anualidad son 12 meses, no 1 (Y1).
  const fin = finDeLoPagado(pagadoEn, mesesDelIntervalo(viva));
  const r = await aplicarReglaDeSuspension({ stripe, clinicId: clinic.id, sub: viva, pagadoEn, finDeLoPagado: fin, facturas: otras, periodoExacto: true });
  await logAudit({
    clinicId: clinic.id,
    userId: clinic.id,
    entityType: "subscription",
    entityId: invoice.id,
    action: "update",
    changes: {
      _source: {
        before: null,
        after: { event: "invoice.paid", invoiceId: invoice.id, reactivadaTrasSuspension: true, anuladas: r.anuladas, realineo: r.realineo.tipo, fallos: r.fallos },
      },
    },
  }).catch(() => {});
  if (r.fallos.length > 0) {
    await registrarReglaFallida(invoice.id, clinic.id);
    await avisarAdminUnaVez(
      `${invoice.id}:regla_suspension_fallo`,
      clinic.id,
      avisoFalloReglaSuspension({ clinicaId: clinic.id, clinicaNombre: clinic.name, accion: "cobro de tarjeta", fallos: r.fallos }),
    );
    throw new Error("La regla de la suspensión no se completó; Stripe debe reintentar el evento");
  }
  if (fallidaAntes) await registrarReglaCompletada(invoice.id, clinic.id);
  // X5: el estado que Stripe reporta tras la regla (con otras facturas anuladas puede seguir `past_due`/`unpaid`).
  let estadoStripe: string | null = null;
  try {
    estadoStripe = (await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId)).status;
  } catch {
    estadoStripe = null;
  }
  if (estadoStripe === "past_due" || estadoStripe === "unpaid") {
    await avisarAdminUnaVez(
      `${invoice.id}:stripe_sigue_rechazada`,
      clinic.id,
      avisoStripeSigueRechazada({ clinicaId: clinic.id, clinicaNombre: clinic.name, estadoStripe, facturaId: invoice.id }),
    );
  }
  return { aplicada: true, fin, estadoStripe };
}

/**
 * Clínica en past_due / unpaid + factura del plan pagada + suscripción VIVA en active/trialing → active y
 * el acceso al fin del periodo pagado. Idempotente (la segunda vez la clínica ya no está rechazada) y
 * tolerante: sin respuesta de Stripe no toca nada y queda el `customer.subscription.updated`.
 * `tras`: la regla de la suspensión ya se aplicó con éxito; el pago firmado basta (X5).
 */
export async function reactivarSiStripeYaCobro(
  stripe: Pick<Stripe, "subscriptions">,
  invoice: Stripe.Invoice,
  clinic: { id: string; subscriptionStatus: string | null; stripeSubscriptionId: string | null },
  tras?: { fin: Date },
): Promise<void> {
  if (!clinic.stripeSubscriptionId) return;
  if (!tras && !isPaymentFailed(clinic.subscriptionStatus)) return;
  // Solo la suscripción del PLAN de esta clínica: la factura de otra (un módulo ya se cortó arriba) no cuenta.
  if (referenciaDeFactura(invoice as unknown as Parameters<typeof referenciaDeFactura>[0]).stripeSubscriptionId !== clinic.stripeSubscriptionId) return;
  let viva: Stripe.Subscription;
  try {
    viva = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId);
  } catch {
    if (!tras) return;
    viva = { id: clinic.stripeSubscriptionId, status: "unknown" } as unknown as Stripe.Subscription;
  }
  const vivaActiva = viva.status === "active" || viva.status === "trialing";
  if (!vivaActiva && !tras) return;
  // X5: tras la regla, el `invoice.paid` firmado ya prueba el pago: la clínica queda activa aunque Stripe siga reportando
  // `past_due`/`unpaid` por facturas anuladas. Las fechas salen de la suscripción si está activa, y si no, del fin de lo pagado.
  const periodFields = vivaActiva ? subscriptionPeriodFields(viva) : tras ? { trialEndsAt: tras.fin, nextBillingDate: tras.fin } : {};
  await prisma.clinic.update({
    where: { id: clinic.id },
    data: { subscriptionStatus: "active", ...periodFields },
  });
  await sincronizarSedesIncluidas(clinic.id);
  await logAudit({
    clinicId: clinic.id,
    userId: clinic.id,
    entityType: "subscription",
    entityId: invoice.id ?? viva.id,
    action: "update",
    changes: {
      subscriptionStatus: { before: clinic.subscriptionStatus, after: "active" },
      ...(periodFields.trialEndsAt ? { trialEndsAt: { before: null, after: periodFields.trialEndsAt } } : {}),
      _source: { before: null, after: { event: "invoice.paid", invoiceId: invoice.id, subscriptionId: viva.id, estadoStripe: viva.status } },
    },
  });
}

/**
 * Reintento de las reglas que fallaron (botón «Reintentar» de /admin y cron diario): vuelve a leer cada factura en Stripe,
 * aplica la regla con SU instante de pago (no el del reintento) y reactiva a la clínica. Nunca lanza.
 */
export async function reintentarReglasPendientes(
  stripe: StripeRegla,
  clinicId?: string,
): Promise<{ completadas: string[]; fallos: string[] }> {
  const completadas: string[] = [];
  const fallos: string[] = [];
  let pendientes: Array<{ clinicId: string; invoiceId: string }> = [];
  try {
    pendientes = await reglasPendientes(clinicId);
  } catch (e) {
    console.error("[regla-cobro-tarjeta] no se pudieron leer los rastros:", (e as Error)?.message ?? e);
    return { completadas, fallos };
  }
  for (const p of pendientes) {
    try {
      const clinica = await prisma.clinic.findUnique({
        where: { id: p.clinicId },
        select: { id: true, name: true, subscriptionStatus: true, stripeSubscriptionId: true, trialEndsAt: true },
      });
      if (!clinica) continue;
      const factura = await stripe.invoices.retrieve(p.invoiceId);
      const pagadoEn = new Date((factura.status_transitions?.paid_at ?? factura.created ?? Math.floor(Date.now() / 1000)) * 1000);
      const r = await reglaDeSuspensionPorCobroDeTarjeta(stripe, factura, clinica, pagadoEn);
      if (r.aplicada) await reactivarSiStripeYaCobro(stripe, factura, clinica, { fin: r.fin });
      completadas.push(p.invoiceId);
    } catch (e) {
      console.error("[regla-cobro-tarjeta] reintento", p.invoiceId, (e as Error)?.message ?? e);
      fallos.push(p.invoiceId);
    }
  }
  return { completadas, fallos };
}
