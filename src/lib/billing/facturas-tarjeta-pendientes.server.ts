import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import { METODOS_DE_PAGO_MANUAL_DEL_PLAN } from "@/lib/billing/cobro-rechazado";
import {
  facturasPendientesDelPlan,
  marcarFacturasDelPlanPagadasFueraDeStripe,
} from "@/lib/billing/factura-fuera-de-stripe.server";

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
 * Solo facturas creadas ANTES del último pago manual: la renovación del mes siguiente es otra deuda y no se perdona.
 */

export interface ClinicaConFacturaPendiente {
  clinicId: string;
  clinicName: string;
  /** El último pago manual del plan que la dejó «al corriente». */
  pagoManualEn: Date;
  facturas: string[];
}

const DIAS_DE_VENTANA = 60;
const TOPE_CLINICAS = 100;

export async function clinicasConFacturaPendienteTrasPagoManual(
  opciones: { stripe?: Pick<Stripe, "subscriptions" | "invoices"> | null; ahora?: Date } = {},
): Promise<ClinicaConFacturaPendiente[]> {
  const stripe = opciones.stripe === undefined ? getStripeSafe() : opciones.stripe;
  if (!stripe) return [];
  const ahora = opciones.ahora ?? new Date();
  const desde = new Date(ahora.getTime() - DIAS_DE_VENTANA * 86_400_000);

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
    select: { id: true, name: true, stripeSubscriptionId: true },
  });

  const salida: ClinicaConFacturaPendiente[] = [];
  // De 4 en 4: la pantalla de /admin no debe disparar decenas de llamadas a Stripe a la vez.
  for (let i = 0; i < clinicas.length; i += 4) {
    const lote = await Promise.all(
      clinicas.slice(i, i + 4).map(async (c) => {
        const corte = ultimoPorClinica.get(c.id)!;
        try {
          const pendientes = await facturasPendientesDelPlan(stripe, c.stripeSubscriptionId!, corte);
          return pendientes && pendientes.length > 0
            ? ({ clinicId: c.id, clinicName: c.name, pagoManualEn: corte, facturas: pendientes.map((f) => f.id!) } as ClinicaConFacturaPendiente)
            : null;
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

/** El reintento automático (cron diario): marca las facturas que quedaron abiertas después de un pago manual. Nunca lanza. */
export async function reintentarMarcadoPendiente(
  opciones: { stripe?: Pick<Stripe, "subscriptions" | "invoices"> | null; ahora?: Date } = {},
): Promise<ResumenReintento> {
  const resumen: ResumenReintento = { revisadas: 0, marcadas: [], fallos: [] };
  try {
    const stripe = opciones.stripe === undefined ? getStripeSafe() : opciones.stripe;
    const pendientes = await clinicasConFacturaPendienteTrasPagoManual({ ...opciones, stripe });
    resumen.revisadas = pendientes.length;
    for (const p of pendientes) {
      const clinica = await prisma.clinic.findUnique({ where: { id: p.clinicId }, select: { stripeSubscriptionId: true } });
      const r = await marcarFacturasDelPlanPagadasFueraDeStripe({
        stripe,
        stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
        creadasAntesDe: p.pagoManualEn,
      });
      if (r.tipo === "marcadas") resumen.marcadas.push(...r.facturas);
      else if (r.tipo === "fallo") resumen.fallos.push(p.clinicId);
    }
  } catch (e) {
    console.error("[facturas-tarjeta-pendientes] reintento:", (e as Error)?.message ?? e);
  }
  return resumen;
}
