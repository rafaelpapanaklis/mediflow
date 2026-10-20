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
import { subscriptionPeriodEndSeconds, subscriptionPeriodFields } from "@/lib/billing/proration";
import { isPaymentFailed } from "@/lib/plan-status";
import { referenciaDeFactura } from "@/lib/marketplace/module-purchase-core";
import { anularFacturasDeMesesSuspendidos, aplicarReglaDeSuspension, facturasAbiertasDelPlan } from "@/lib/billing/reactivacion-tras-suspension.server";
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

export type ResultadoReglaCobro =
  | { aplicada: false }
  | {
      aplicada: true;
      fin: Date;
      estadoStripe: string | null;
      /** Camino TARDÍO (reintento): solo se anularon los meses sin servicio y NO se movió el ciclo; el admin lo revisa a mano. */
      tardia?: boolean;
      /** El aviso «revisa en Stripe…» del camino tardío (el mismo texto que recibe el admin por correo). */
      aviso?: string;
    };

/**
 * Un pago con MÁS de esto de antigüedad ya no se procesa «al momento del pago» (un reenvío tardío del webhook, el cron, «Reintentar»):
 * ese camino NO calcula el ciclo (ni lo mueve ni anula renovaciones posteriores) porque entre el pago y el reintento Stripe pudo
 * renovar con el ciclo viejo. Solo hace lo seguro y avisa al admin (decimocuarta vuelta, recorte del camino tardío).
 */
export const UMBRAL_REGLA_TARDIA_MS = 6 * 3_600_000;

export const KIND_REGLA_FALLO = "regla_fallo";
export const KIND_REGLA_OK = "regla_ok";

/** El rastro guarda en `email` (columna de texto libre) el FIN DE LO PAGADO en ISO: de ahí sale el acceso protegido. */
async function crearRastro(invoiceId: string, clinicId: string, kind: string, fin?: Date): Promise<void> {
  try {
    await prisma.billingEmailLog.create({ data: { invoiceId: `${invoiceId}:${kind}`, clinicId, kind, email: fin ? fin.toISOString() : "-" } });
  } catch (e) {
    if ((e as { code?: string } | null)?.code !== "P2002") console.error("[regla-cobro-tarjeta] rastro", kind, (e as Error)?.message ?? e);
  }
}

export const registrarReglaFallida = (invoiceId: string, clinicId: string, fin?: Date) => crearRastro(invoiceId, clinicId, KIND_REGLA_FALLO, fin);
export const registrarReglaCompletada = (invoiceId: string, clinicId: string, fin?: Date) => crearRastro(invoiceId, clinicId, KIND_REGLA_OK, fin);

/**
 * Hasta cuándo quedó PAGADA la clínica según los rastros de la regla (el `fin` que se anotó al aplicarla o al fallar): es el
 * acceso que se le dio por un cobro de tarjeta y que ningún rechazo posterior puede recortar. null si no hay ninguno vigente.
 */
export async function finProtegidoPorRastros(clinicId: string, ahora: Date = new Date()): Promise<Date | null> {
  const filas = await prisma.billingEmailLog.findMany({
    where: { kind: { in: [KIND_REGLA_FALLO, KIND_REGLA_OK] }, clinicId },
    select: { email: true },
  });
  let max: Date | null = null;
  for (const f of filas) {
    const d = new Date(f.email);
    if (!Number.isNaN(d.getTime()) && d.getTime() > ahora.getTime() && (!max || d.getTime() > max.getTime())) max = d;
  }
  return max;
}

/**
 * Facturas (de una clínica, o de todas) cuya regla falló y aún no se completó. SIN ventana de tiempo (Z8): un pendiente no
 * caduca por viejo —se queda visible hasta que se cierre con `regla_ok`—; la tabla solo crece cuando una regla falla.
 */
export async function reglasPendientes(clinicId?: string): Promise<Array<{ clinicId: string; invoiceId: string; fin?: Date }>> {
  const filas = await prisma.billingEmailLog.findMany({
    where: { kind: { in: [KIND_REGLA_FALLO, KIND_REGLA_OK] }, ...(clinicId ? { clinicId } : {}) },
    select: { invoiceId: true, clinicId: true, kind: true, email: true },
  });
  const cerradas = new Set<string>();
  for (const f of filas) if (f.kind === KIND_REGLA_OK) cerradas.add(f.invoiceId.replace(/:regla_ok$/, ""));
  const salida: Array<{ clinicId: string; invoiceId: string; fin?: Date }> = [];
  for (const f of filas) {
    if (f.kind !== KIND_REGLA_FALLO) continue;
    const id = f.invoiceId.replace(/:regla_fallo$/, "");
    const fin = new Date(f.email);
    if (!cerradas.has(id)) salida.push({ clinicId: f.clinicId, invoiceId: id, ...(Number.isNaN(fin.getTime()) ? {} : { fin }) });
  }
  return salida;
}

/** El aviso del camino tardío (admin): qué revisar a mano en Stripe. */
export function textoReglaTardia(a: { clinicaNombre: string; abiertas: string[]; finPeriodoStripe: Stripe.Subscription; protegidoHasta: Date }): string {
  const segs = subscriptionPeriodEndSeconds(a.finPeriodoStripe);
  const fmt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
  return (
    `La regla no se aplicó al momento del pago. Revisa en Stripe la suscripción de ${a.clinicaNombre}: ` +
    `factura(s) abiertas ${a.abiertas.length > 0 ? a.abiertas.join(", ") : "(ninguna)"} y fin de periodo ${segs ? fmt(new Date(segs * 1000)) : "(desconocido)"}. ` +
    `El acceso de la clínica está protegido hasta ${fmt(a.protegidoHasta)}. ` +
    "Si el fin de periodo de Stripe queda antes de esa fecha, la tarjeta cobrará antes de tiempo (días solapados): ajusta la fecha de cobro a mano."
  );
}

/** ¿Alguna línea de la factura cubre (casi) un periodo COMPLETO del plan? Un prorrateo cubre solo unos días. */
export function esPeriodoCompleto(invoice: Stripe.Invoice, sub: Stripe.Subscription): boolean {
  const mesesPlan = mesesDelIntervalo(sub);
  const esperado = mesesPlan * 30.44 * 86_400;
  let max = 0;
  for (const l of invoice.lines?.data ?? []) {
    const linea = l as { period?: { start?: number; end?: number }; proration?: boolean; parent?: { subscription_item_details?: { proration?: boolean } | null } | null };
    // AA1: una línea de PRORRATEO nunca cuenta, por larga que sea (un prorrateo de 30 días no es un periodo pagado).
    if (linea.proration === true || linea.parent?.subscription_item_details?.proration === true) continue;
    const p = linea.period;
    if (!p?.start || !p?.end) continue;
    // Y el periodo tiene que EMPEZAR cuando se creó la factura (el ciclo nuevo de «Subir»), no antes.
    if (invoice.created && Math.abs(p.start - invoice.created) > 86_400) continue;
    max = Math.max(max, p.end - p.start);
  }
  return max >= esperado * 0.9;
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
  opciones: { tardia?: boolean } = {},
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
  // Z1: SOLO una factura de renovación / alta del plan paga un periodo. Un cambio de plan (`subscription_update`) es un
  // prorrateo —cubre unos días— y no da un periodo completo ni anula las otras facturas. La única excepción es la factura de
  // «Subir de plan» (ciclo nuevo desde el clic, cobro completo): sus líneas cubren un periodo COMPLETO del plan, y la clínica
  // tiene que estar vencida. Ante la duda no se calcula nada: la clínica se reactiva con el periodo de Stripe (abajo).
  const pruebaPropia = esCambio ? dbVencida : dbVencida || facturaVieja;
  if (!fallidaAntes && !pruebaPropia && !reintentada) return NO;

  const viva = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId);
  if (!["active", "past_due", "unpaid", "trialing"].includes(viva.status)) return NO;
  if (esCambio && !esPeriodoCompleto(invoice, viva)) return NO;
  // AA2: solo las facturas creadas HASTA el pago. Una renovación que nació DESPUÉS (la regla tardó en completarse y Stripe renovó
  // con el ciclo viejo) es otra deuda: anularla regalaría ese mes. El margen de 1 minuto cubre el reloj de Stripe.
  const otras = (await facturasAbiertasDelPlan(stripe, clinic.stripeSubscriptionId, new Date(pagadoEn.getTime() + 60_000))).filter((f) => f.id !== invoice.id);
  const esMes = (f: Stripe.Invoice) => esMesDeServicioSuspendido({ facturaCreadaEn: f.status_transitions?.finalized_at ?? f.created ?? 0, pagoEn: pagadoEn });
  const hayMesesSinServicio = otras.some(esMes);
  if (!fallidaAntes && !pruebaPropia && !hayMesesSinServicio) return NO;
  // Se anulan los meses sin servicio: TODAS las abiertas si la clínica estaba vencida; si no, solo las que de verdad son viejas
  // (la renovación de hoy dentro de la gracia no se anula, Z1).
  const aAnular = dbVencida || fallidaAntes ? otras : otras.filter(esMes);

  // Un cobro de tarjeta del plan paga un periodo COMPLETO: una anualidad son 12 meses, no 1 (Y1).
  const fin = finDeLoPagado(pagadoEn, mesesDelIntervalo(viva));

  // CAMINO TARDÍO (reintento: cron, «Reintentar», o un reenvío del webhook muchas horas después): SIN CÁLCULO DE CICLO. Entre el pago
  // y este momento Stripe pudo renovar con el ciclo viejo, y cualquier cálculo (mover el ciclo, anular renovaciones) se equivoca de
  // un lado o del otro. Solo se hace lo seguro: anular los meses sin servicio creados HASTA el pago, proteger el acceso de la clínica
  // hasta el fin de lo pagado y avisar al admin para que lo revise en Stripe.
  if (opciones.tardia === true || Date.now() - pagadoEn.getTime() > UMBRAL_REGLA_TARDIA_MS) {
    const { anuladas, fallos: noAnuladas } = await anularFacturasDeMesesSuspendidos(stripe, clinic.id, aAnular);
    if (noAnuladas.length > 0) {
      await registrarReglaFallida(invoice.id, clinic.id, fin);
      throw new Error("No se pudieron anular todas las facturas de los meses sin servicio; se reintenta");
    }
    try {
      await reactivarSiStripeYaCobro(stripe, invoice, clinic, { fin });
    } catch (e) {
      console.error("[regla-cobro-tarjeta] no se pudo reactivar (camino tardío):", (e as Error)?.message ?? e);
      await registrarReglaFallida(invoice.id, clinic.id, fin);
      throw e;
    }
    await registrarReglaCompletada(invoice.id, clinic.id, fin);
    let abiertas: string[] = [];
    try {
      abiertas = (await facturasAbiertasDelPlan(stripe, clinic.stripeSubscriptionId)).map((f) => f.id!).filter(Boolean);
    } catch {
      abiertas = [];
    }
    const aviso = textoReglaTardia({ clinicaNombre: clinic.name ?? clinic.id, abiertas, finPeriodoStripe: viva, protegidoHasta: fin });
    await avisarAdminUnaVez(`${invoice.id}:regla_tardia`, clinic.id, { asunto: `Revisa en Stripe la suscripción de ${clinic.name ?? clinic.id}: la regla de la suspensión no se aplicó al momento del pago`, lineas: [aviso] });
    await logAudit({
      clinicId: clinic.id,
      userId: clinic.id,
      entityType: "subscription",
      entityId: invoice.id,
      action: "update",
      changes: { _source: { before: null, after: { event: "invoice.paid", invoiceId: invoice.id, reglaTardia: true, anuladas, sinMoverElCiclo: true } } },
    }).catch(() => {});
    return { aplicada: true, fin, estadoStripe: viva.status, tardia: true, aviso };
  }

  const r = await aplicarReglaDeSuspension({ stripe, clinicId: clinic.id, sub: viva, pagadoEn, finDeLoPagado: fin, facturas: aAnular, periodoExacto: true, facturaPagada: [invoice.id] });
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
    // Z2: la clínica PAGÓ. Ante un fallo de la regla se reactiva igual con el acceso de lo pagado (nunca se deja sin servicio a
    // quien ya pagó); lo pendiente queda visible (rastro `regla_fallo`) y se avisa al admin. Después se lanza el error para que
    // Stripe reenvíe el evento.
    try {
      await reactivarSiStripeYaCobro(stripe, invoice, clinic, { fin });
    } catch (e) {
      console.error("[regla-cobro-tarjeta] no se pudo reactivar tras el fallo de la regla:", (e as Error)?.message ?? e);
    }
    await registrarReglaFallida(invoice.id, clinic.id, fin);
    await avisarAdminUnaVez(
      `${invoice.id}:regla_suspension_fallo`,
      clinic.id,
      avisoFalloReglaSuspension({ clinicaId: clinic.id, clinicaNombre: clinic.name, accion: "cobro de tarjeta", fallos: r.fallos }),
    );
    throw new Error("La regla de la suspensión no se completó; Stripe debe reintentar el evento");
  }
  if (fallidaAntes) await registrarReglaCompletada(invoice.id, clinic.id, fin);
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
  const periodFields: { trialEndsAt?: Date; nextBillingDate?: Date } = vivaActiva ? subscriptionPeriodFields(viva) : tras ? { trialEndsAt: tras.fin, nextBillingDate: tras.fin } : {};
  // Nunca se acorta un acceso ya dado (Z3): lo que escribe es el MÁXIMO entre lo calculado, el fin de lo pagado (`tras`) y lo que
  // la clínica ya tenía. Si falló mover el ciclo, el periodo de Stripe puede ser menor que lo pagado.
  const actual = await prisma.clinic.findUnique({ where: { id: clinic.id }, select: { trialEndsAt: true } });
  const fechas = [periodFields.trialEndsAt, tras?.fin, actual?.trialEndsAt].filter((f): f is Date => f instanceof Date);
  const sinRetroceso = fechas.length > 0 ? new Date(Math.max(...fechas.map((f) => f.getTime()))) : undefined;
  const datosFechas = {
    ...periodFields,
    ...(sinRetroceso ? { trialEndsAt: sinRetroceso } : {}),
  };
  await prisma.clinic.update({
    where: { id: clinic.id },
    data: { subscriptionStatus: "active", ...datosFechas },
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
      ...(datosFechas.trialEndsAt ? { trialEndsAt: { before: null, after: datosFechas.trialEndsAt } } : {}),
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
): Promise<{ completadas: string[]; fallos: string[]; revisar: string[] }> {
  const completadas: string[] = [];
  const fallos: string[] = [];
  const revisar: string[] = [];
  let pendientes: Array<{ clinicId: string; invoiceId: string; fin?: Date }> = [];
  try {
    pendientes = await reglasPendientes(clinicId);
  } catch (e) {
    console.error("[regla-cobro-tarjeta] no se pudieron leer los rastros:", (e as Error)?.message ?? e);
    return { completadas, fallos, revisar };
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
      // Siempre el camino TARDÍO: un reintento nunca calcula el ciclo.
      const r = await reglaDeSuspensionPorCobroDeTarjeta(stripe, factura, clinica, pagadoEn, { tardia: true });
      if (r.aplicada && r.aviso) revisar.push(r.aviso);
      // Z12: si ya no aplica (suscripción cancelada, la factura no es del plan…) se CIERRA el pendiente para que no reaparezca.
      if (!r.aplicada) await registrarReglaCompletada(p.invoiceId, p.clinicId, p.fin);
      completadas.push(p.invoiceId);
    } catch (e) {
      console.error("[regla-cobro-tarjeta] reintento", p.invoiceId, (e as Error)?.message ?? e);
      fallos.push(p.invoiceId);
    }
  }
  return { completadas, fallos, revisar };
}
