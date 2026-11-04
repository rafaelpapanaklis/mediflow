import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import { esTablaInexistente } from "@/lib/billing/spei-directo";
import {
  computeManualUpgradeQuote,
  pickPurchasedInterval,
  type BillingInterval,
  type ManualUpgradeQuote,
} from "@/lib/billing/proration";

/**
 * Cotización del diferencial de un upgrade para clínicas SIN suscripción de
 * tarjeta en Stripe (pagaron SPEI/OXXO: pago único, `stripeSubscriptionId` es
 * null y `subscriptionStatus` quedó en "active").
 *
 * Sin suscripción no hay prorrateo de Stripe: lo calculamos nosotros sobre los
 * días que le quedan del periodo pagado (`trialEndsAt` = "pagado-hasta"). La
 * aritmética vive en `computeManualUpgradeQuote` (puro, testeable); aquí solo se
 * resuelve el ciclo comprado, que sí necesita la BD.
 */
export type { ManualUpgradeQuote };

type PlanPrices = { priceMxn: number; priceMxnAnnual: number };

/**
 * Ciclo (mensual/anual) que compró una clínica que paga por SPEI/OXXO, o `null`
 * si NO se pudo confirmar.
 *
 * `Clinic` no guarda el ciclo. Sale de los PAGOS CONFIRMADOS, nunca de la
 * intención (ola 2b, retenido run-2 + revisión t8 M1):
 *  · las sesiones de Checkout de Stripe COMPLETAS y PAGADAS del plan
 *    (`metadata.kind = platform-subscription`, el mismo `clinicId`) del cliente
 *    de Stripe de la clínica; el ciclo es `metadata.billing`, lo que se cobró;
 *  · las transferencias SPEI directo CONFIRMADAS (`spei_transfer_requests`,
 *    que guardan su `billing`).
 * Gana la más reciente de las dos. Las sesiones se recorren TODAS (página a
 * página, de la más reciente a la más antigua) hasta la primera pagada: no hay
 * ventana que una clínica pueda inundar. Antes se leía la fila de bitácora que
 * deja /api/billing/checkout al CREAR la sesión (pagada o no; también la del
 * checkout de un módulo), y con «sin dato» se cobra el menor de los dos ciclos:
 * abrir y abandonar checkouts anuales abarataba ~36 % los upgrades mensuales.
 *
 * Cuando no hay dato NO se asume "month": eso sobre-cobraba ~56% a las clínicas
 * anuales (el anual cuesta mucho menos por día). Se devuelve null y
 * `computeManualUpgradeQuote` cotiza por el criterio conservador. Hoy quedan sin
 * dato las que activó un admin a mano (`/api/admin/billing` no registra ciclo).
 * Si Stripe no contesta → null (y el cobro del diferencial, que también va por
 * Stripe, no se puede crear).
 */
/**
 * `spei_transfer_requests` es OPCIONAL (la crea sql/spei-transferencia-directa.sql). Sin ella, SPEI directo no
 * aporta dato y manda Stripe: antes la lectura iba en el mismo `try` y su error tiraba también la compra pagada
 * de Stripe → null → se cobraba el ciclo menor a TODAS las clínicas (revisión t8, M3). La ausencia se recuerda en
 * globalThis (sobrevive a las recargas de `next dev`) para no repetir la consulta fallida en cada cotización, que
 * deja un error en los logs de Postgres. Cualquier otro error SÍ lanza (y la cotización cae a null, como antes).
 */
const SIN_TABLA_SPEI = Symbol.for("dalecontrol.spei-directo.sin-tabla");
/** Cada cuánto se vuelve a probar si ya se pegó el SQL. Técnico, no de negocio. */
const REPROBAR_TABLA_SPEI_MS = 10 * 60_000;

async function ultimaTransferenciaConfirmada(clinicId: string): Promise<{ billing: string; resolvedAt: Date | null } | null> {
  const g = globalThis as Record<symbol, number | undefined>;
  const hasta = g[SIN_TABLA_SPEI];
  if (hasta && hasta > Date.now()) return null;
  try {
    return await prisma.speiTransferRequest.findFirst({
      where: { clinicId, status: "confirmed", resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      select: { billing: true, resolvedAt: true },
    });
  } catch (e) {
    if (!esTablaInexistente(e)) throw e;
    g[SIN_TABLA_SPEI] = Date.now() + REPROBAR_TABLA_SPEI_MS;
    return null;
  }
}

export async function inferManualInterval(clinicId: string): Promise<BillingInterval | null> {
  // Sin clinicId, Prisma DESCARTA el filtro y leería datos de otras clínicas.
  if (!clinicId) return null;
  try {
    const clinica = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { stripeCustomerId: true } });
    let porStripe: { en: number; ciclo: BillingInterval } | null = null;
    if (clinica?.stripeCustomerId) {
      const stripe = getStripeSafe();
      if (!stripe) return null;
      let despuesDe: string | undefined;
      buscar: for (;;) {
        const pagina = await stripe.checkout.sessions.list({
          customer: clinica.stripeCustomerId,
          status: "complete",
          limit: 100,
          ...(despuesDe ? { starting_after: despuesDe } : {}),
        });
        for (const s of pagina.data) {
          if (s.payment_status !== "paid" || s.metadata?.kind !== "platform-subscription" || s.metadata?.clinicId !== clinicId) continue;
          const ciclo = pickPurchasedInterval([{ _created: { after: { billing: s.metadata?.billing } } }]);
          if (ciclo) {
            porStripe = { en: s.created * 1000, ciclo };
            break buscar;
          }
        }
        despuesDe = pagina.data[pagina.data.length - 1]?.id;
        if (!pagina.has_more || !despuesDe) break;
      }
    }

    const transferencia = await ultimaTransferenciaConfirmada(clinicId);
    const cicloSpei = transferencia ? pickPurchasedInterval([{ _created: { after: { billing: transferencia.billing } } }]) : null;
    const porSpei = cicloSpei && transferencia?.resolvedAt ? { en: transferencia.resolvedAt.getTime(), ciclo: cicloSpei } : null;

    if (porStripe && porSpei) return porSpei.en > porStripe.en ? porSpei.ciclo : porStripe.ciclo;
    return (porStripe ?? porSpei)?.ciclo ?? null;
  } catch {
    return null;
  }
}

export async function buildManualUpgradeQuote(args: {
  clinicId: string;
  /** "Pagado-hasta" de la clínica (Clinic.trialEndsAt). NO es un trial gratis. */
  paidUntil: Date | string | null | undefined;
  currentPlan: PlanPrices;
  targetPlan: PlanPrices;
  now?: Date;
}): Promise<ManualUpgradeQuote> {
  const interval = await inferManualInterval(args.clinicId);
  return computeManualUpgradeQuote({
    interval,
    paidUntil: args.paidUntil,
    currentPlan: args.currentPlan,
    targetPlan: args.targetPlan,
    now: args.now,
  });
}
