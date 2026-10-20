import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import {
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  inicioDelMarcadoFueraDeStripe,
  reanudarCobroDespuesDelPrepago,
} from "@/lib/billing/cobro-rechazado";
import {
  facturasPendientesDelPlan,
  marcarFacturasDelPlanPagadasFueraDeStripe,
  suscripcionDeTarjetaViva,
} from "@/lib/billing/factura-fuera-de-stripe.server";
import { subscriptionItemInterval, subscriptionPeriodEndSeconds } from "@/lib/billing/proration";

/**
 * Clínicas con la TARJETA viva y una factura del plan ABIERTA (o incobrable) DESPUÉS de un pago manual (ws1-t1).
 *
 * Cuando el marcado «pagada fuera de Stripe» falla al confirmar un pago manual, el aviso del admin vive en la pantalla
 * donde se confirmó y se pierde al recargar (y en el SPEI/OXXO de Stripe no hay pantalla). En vez de guardar el fallo
 * en una columna nueva, se DERIVA de la verdad: hay un pago manual reciente en `subscription_invoices` y Stripe sigue
 * teniendo abierta una factura del plan que ya existía cuando se registró. Si el marcado funcionó, no aparece; si no,
 * sigue apareciendo hasta que se marque, sin importar quién lo intentó. Alimenta el aviso persistente de /admin › Pagos
 * y el reintento automático del cron diario.
 *
 * Solo pagos manuales confirmados DESDE la fecha de corte (`INICIO_MARCADO_FUERA_DE_STRIPE`) y solo la factura del MISMO
 * ciclo que el pago (la última creada hasta él, sin otra renovación en medio): la renovación del mes siguiente y todo lo
 * anterior al despliegue no se perdonan solos.
 */

export interface ClinicaConFacturaPendiente {
  clinicId: string;
  clinicName: string;
  /** El último pago manual del plan que la dejó «al corriente». */
  pagoManualEn: Date;
  /** Facturas del CICLO del pago que siguen abiertas (el marcado falló): se pueden reintentar. */
  facturas: string[];
  /** Facturas de meses ANTERIORES que siguen abiertas como adeudo (Q4: un pago solo marca los meses que cubre). Solo informativo. */
  adeudo: string[];
  /** Q1: el pago cubre varios meses y la pausa del cobro de la tarjeta falta o llega menos lejos (fecha de reanudación esperada). */
  pausaPendiente: string | null;
}

const DIAS_DE_VENTANA = 60;
const TOPE_CLINICAS = 100;

export async function clinicasConFacturaPendienteTrasPagoManual(
  opciones: { stripe?: Pick<Stripe, "subscriptions" | "invoices"> | null; ahora?: Date } = {},
): Promise<ClinicaConFacturaPendiente[]> {
  const stripe = opciones.stripe === undefined ? getStripeSafe() : opciones.stripe;
  if (!stripe) return [];
  const ahora = opciones.ahora ?? new Date();
  // Ventana de 60 días, pero NUNCA antes de la fecha de corte: los pagos manuales confirmados antes de que existiera
  // esta regla no se marcan (R1).
  const desde = new Date(Math.max(ahora.getTime() - DIAS_DE_VENTANA * 86_400_000, inicioDelMarcadoFueraDeStripe().getTime()));

  const pagos = await prisma.subscriptionInvoice.findMany({
    where: {
      status: "paid",
      paidAt: { gte: desde },
      OR: [{ method: null }, { method: { in: [...METODOS_DE_PAGO_MANUAL_DEL_PLAN] } }],
    },
    orderBy: { paidAt: "desc" },
    select: { clinicId: true, paidAt: true },
  });
  const ultimoPorClinica = new Map<string, Date>();
  for (const p of pagos) if (p.paidAt && !ultimoPorClinica.has(p.clinicId)) ultimoPorClinica.set(p.clinicId, p.paidAt);
  if (ultimoPorClinica.size === 0) return [];

  const clinicas = await prisma.clinic.findMany({
    where: { id: { in: [...ultimoPorClinica.keys()].slice(0, TOPE_CLINICAS) }, stripeSubscriptionId: { not: null } },
    select: { id: true, name: true, stripeSubscriptionId: true, trialEndsAt: true },
  });

  const salida: ClinicaConFacturaPendiente[] = [];
  // De 4 en 4: la pantalla de /admin no debe disparar decenas de llamadas a Stripe a la vez.
  for (let i = 0; i < clinicas.length; i += 4) {
    const lote = await Promise.all(
      clinicas.slice(i, i + 4).map(async (c) => {
        const corte = ultimoPorClinica.get(c.id)!;
        try {
          const sub = await suscripcionDeTarjetaViva(stripe, c.stripeSubscriptionId!);
          if (!sub) return null;
          const ciclo = (await facturasPendientesDelPlan(stripe, c.stripeSubscriptionId!, corte, true, sub)) ?? [];
          const todas = (await facturasPendientesDelPlan(stripe, c.stripeSubscriptionId!, corte, false, sub)) ?? [];
          const idsCiclo = new Set(ciclo.map((f) => f.id));
          const adeudo = todas.filter((f) => !idsCiclo.has(f.id)).map((f) => f.id!);
          // ¿Falta (o llega corta) la pausa del cobro por el prepago de varios meses?
          const finCiclo = subscriptionPeriodEndSeconds(sub);
          const reanuda =
            finCiclo && c.trialEndsAt
              ? reanudarCobroDespuesDelPrepago({
                  finDelPeriodoStripe: new Date(finCiclo * 1000),
                  finPrepago: c.trialEndsAt,
                  intervalo: subscriptionItemInterval(sub.items?.data?.[0]),
                })
              : null;
          const pausaPendiente =
            reanuda && (sub.pause_collection?.resumes_at ?? 0) < Math.floor(reanuda.getTime() / 1000) ? reanuda.toISOString() : null;
          if (ciclo.length === 0 && adeudo.length === 0 && !pausaPendiente) return null;
          return {
            clinicId: c.id,
            clinicName: c.name,
            pagoManualEn: corte,
            facturas: ciclo.map((f) => f.id!),
            adeudo,
            pausaPendiente,
          } as ClinicaConFacturaPendiente;
        } catch (e) {
          console.error("[facturas-tarjeta-pendientes] Stripe no contestó para", c.id, (e as Error)?.message ?? e);
          return null; // se reintenta en la siguiente pasada
        }
      }),
    );
    salida.push(...lote.filter((x): x is ClinicaConFacturaPendiente => x !== null));
  }
  return salida;
}

export interface ResumenReintento {
  revisadas: number;
  marcadas: string[];
  fallos: string[];
}

/**
 * El reintento automático (cron diario): marca la factura del ciclo del último pago manual que quedó abierta y pausa el
 * cobro de la tarjeta si lo prepagado rebasa el ciclo. Las facturas de meses anteriores (adeudo) NO se tocan. Nunca lanza.
 */
export async function reintentarMarcadoPendiente(
  opciones: { stripe?: Pick<Stripe, "subscriptions" | "invoices"> | null; ahora?: Date } = {},
): Promise<ResumenReintento> {
  const resumen: ResumenReintento = { revisadas: 0, marcadas: [], fallos: [] };
  try {
    const stripe = opciones.stripe === undefined ? getStripeSafe() : opciones.stripe;
    const todas = await clinicasConFacturaPendienteTrasPagoManual({ ...opciones, stripe });
    const pendientes = todas.filter((p) => p.facturas.length > 0 || p.pausaPendiente);
    resumen.revisadas = pendientes.length;
    for (const p of pendientes) {
      const clinica = await prisma.clinic.findUnique({ where: { id: p.clinicId }, select: { stripeSubscriptionId: true, trialEndsAt: true } });
      const r = await marcarFacturasDelPlanPagadasFueraDeStripe({
        stripe,
        stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
        creadasAntesDe: p.pagoManualEn,
        soloMismoCiclo: true,
        finPrepago: clinica?.trialEndsAt ?? null,
      });
      if (r.tipo === "marcadas") resumen.marcadas.push(...r.facturas);
      else if (r.tipo === "fallo") resumen.fallos.push(p.clinicId);
    }
  } catch (e) {
    console.error("[facturas-tarjeta-pendientes] reintento:", (e as Error)?.message ?? e);
  }
  return resumen;
}
