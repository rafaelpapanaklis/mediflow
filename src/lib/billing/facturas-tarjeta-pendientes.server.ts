import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import {
  CICLO_ALINEADO_DIAS,
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  enPeriodoPagado,
  inicioDelMarcadoFueraDeStripe,
} from "@/lib/billing/cobro-rechazado";
import {
  marcarFacturasDelPlanPagadasFueraDeStripe,
  repartirPendientes,
  suscripcionDeTarjetaViva,
} from "@/lib/billing/factura-fuera-de-stripe.server";
import { facturasAbiertasDelPlan } from "@/lib/billing/reactivacion-tras-suspension.server";
import { subscriptionPeriodEndSeconds } from "@/lib/billing/proration";

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
 * Solo pagos manuales confirmados DESDE la fecha de corte (`INICIO_MARCADO_FUERA_DE_STRIPE`) y solo las facturas que ya
 * existían cuando se pagó: la renovación del mes siguiente y todo lo anterior al despliegue no se tocan solos. De esas, las
 * de meses SUSPENDIDOS se anulan (nunca se deben) y la del ciclo se paga fuera de Stripe. NO existe «adeudo».
 */

export interface ClinicaConFacturaPendiente {
  clinicId: string;
  clinicName: string;
  /** El último pago manual del plan que la dejó «al corriente». */
  pagoManualEn: Date;
  /** Facturas que siguen abiertas tras el pago (el marcado / la anulación falló): se pueden reintentar. */
  facturas: string[];
  /** De ellas, las de meses SUSPENDIDOS (por anular, no por pagar). */
  suspendidas: string[];
  /**
   * El siguiente cobro de la tarjeta debería ser al terminar lo pagado y no lo es: fecha esperada (ISO, el `periodEnd` de la
   * fila del pago, no «hoy»), o null si ya está bien.
   */
  cicloPendiente: string | null;
}

const DIAS_DE_VENTANA = 60;
const TOPE_CLINICAS = 100;

export async function clinicasConFacturaPendienteTrasPagoManual(
  opciones: { stripe?: Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems"> | null; ahora?: Date } = {},
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
    select: { clinicId: true, paidAt: true, periodEnd: true },
  });
  const ultimoPorClinica = new Map<string, Date>();
  const finPagadoPorClinica = new Map<string, Date>();
  for (const p of pagos) {
    if (p.paidAt && !ultimoPorClinica.has(p.clinicId)) {
      ultimoPorClinica.set(p.clinicId, p.paidAt);
      finPagadoPorClinica.set(p.clinicId, p.periodEnd);
    }
  }
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
          const pendientes = await facturasAbiertasDelPlan(stripe, c.stripeSubscriptionId!, corte);
          const { suspendidas } = repartirPendientes(pendientes, { pagadoEn: corte });
          // ¿El siguiente cobro de la tarjeta ya cae al terminar lo pagado? (fin de lo pagado = `periodEnd` de la fila del pago)
          const fin = finPagadoPorClinica.get(c.id) ?? null;
          let cicloPendiente: string | null = null;
          if (fin && fin.getTime() > ahora.getTime() + 86_400_000 && !(enPeriodoPagado(sub, ahora) && (sub.trial_end ?? 0) * 1000 >= fin.getTime() - 86_400_000)) {
            const finCiclo = subscriptionPeriodEndSeconds(sub);
            const alineado = sub.status !== "trialing" && finCiclo && Math.abs(finCiclo * 1000 - fin.getTime()) <= CICLO_ALINEADO_DIAS * 86_400_000;
            if (!alineado) cicloPendiente = fin.toISOString();
          }
          if (pendientes.length === 0 && !cicloPendiente) return null;
          return {
            clinicId: c.id,
            clinicName: c.name,
            pagoManualEn: corte,
            facturas: pendientes.map((f) => f.id!),
            suspendidas: suspendidas.map((f) => f.id!),
            cicloPendiente,
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
  /** Facturas de meses sin servicio anuladas (void). */
  anuladas: string[];
  fallos: string[];
}

/**
 * El reintento automático (cron diario): paga fuera de Stripe la factura del ciclo del último pago manual que quedó abierta,
 * anula las de meses suspendidos, mueve el siguiente cobro de la tarjeta al fin de lo pagado. Nunca lanza.
 */
export async function reintentarMarcadoPendiente(
  opciones: { stripe?: Pick<Stripe, "subscriptions" | "invoices" | "invoiceItems"> | null; ahora?: Date } = {},
): Promise<ResumenReintento> {
  const resumen: ResumenReintento = { revisadas: 0, marcadas: [], anuladas: [], fallos: [] };
  try {
    const stripe = opciones.stripe === undefined ? getStripeSafe() : opciones.stripe;
    const todas = await clinicasConFacturaPendienteTrasPagoManual({ ...opciones, stripe });
    const pendientes = todas.filter((p) => p.facturas.length > 0 || p.cicloPendiente);
    resumen.revisadas = pendientes.length;
    for (const p of pendientes) {
      const clinica = await prisma.clinic.findUnique({ where: { id: p.clinicId }, select: { stripeSubscriptionId: true } });
      const r = await marcarFacturasDelPlanPagadasFueraDeStripe({
        clinicId: p.clinicId,
        stripe,
        stripeSubscriptionId: clinica?.stripeSubscriptionId ?? null,
        creadasAntesDe: p.pagoManualEn,
        pagadoEn: p.pagoManualEn,
        // El fin de lo pagado sale de la fila del PAGO (M9): cada día que tarda el reintento no es un día gratis.
        finPrepago: p.cicloPendiente ? new Date(p.cicloPendiente) : null,
      });
      if (r.tipo === "marcadas") {
        resumen.marcadas.push(...r.facturas);
        resumen.anuladas.push(...(r.anuladas ?? []));
      } else if (r.tipo === "fallo") {
        resumen.marcadas.push(...r.marcadas);
        resumen.anuladas.push(...(r.anuladas ?? []));
        resumen.fallos.push(p.clinicId);
      }
    }
  } catch (e) {
    console.error("[facturas-tarjeta-pendientes] reintento:", (e as Error)?.message ?? e);
  }
  return resumen;
}
