import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
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
 * Cuántas filas de bitácora se revisan hacia atrás buscando la última COMPRA.
 * Entre una compra y otra pueden acumularse filas de `entityType: "subscription"`
 * / `action: "create"` que no son compras (cada intento de Checkout del
 * diferencial deja una), así que no alcanza con mirar la más reciente.
 */
const AUDIT_LOOKBACK = 50;

/**
 * Ciclo (mensual/anual) que compró una clínica que paga por SPEI/OXXO, o `null`
 * si NO se pudo confirmar.
 *
 * `Clinic` no guarda el ciclo, pero `/api/billing/checkout` deja el `billing`
 * elegido en la bitácora (`entityType: "subscription"`, `action: "create"`,
 * `changes._created.after.billing`). Se busca la última fila que SÍ lo registre
 * (ver `pickPurchasedInterval`: las filas sin `billing` se saltan, no se toman
 * como mensuales).
 *
 * PERO esa fila se escribe al CREAR la sesión, pagada o no, y el checkout de un
 * MÓDULO deja una con la misma forma (ola 2b, retenido run-2): un checkout anual
 * abandonado bajaba ~36 % los upgrades de un pagador mensual. Por eso solo cuenta
 * una fila de compra DEL PLAN cuya sesión Stripe confirma pagada y de ESTA
 * clínica (`metadata.kind`/`clinicId`); se pregunta de la más reciente a la más
 * antigua y se para en la primera pagada. Las activaciones del webhook no dejan
 * una fila propia que sirva (su `userId` de relleno no pasa la FK de
 * `audit_logs`), así que Stripe es la fuente. Si Stripe no contesta → null.
 *
 * Cuando no hay dato NO se asume "month": eso sobre-cobraba ~56% a las clínicas
 * anuales (el anual cuesta mucho menos por día). Se devuelve null y
 * `computeManualUpgradeQuote` cotiza por el criterio conservador. Hay clínicas
 * que legítimamente no tienen la fila: las que activó un admin a mano
 * (`/api/admin/billing`, que audita con otro `entityType`).
 */
export async function inferManualInterval(clinicId: string): Promise<BillingInterval | null> {
  // Sin clinicId, Prisma DESCARTA el filtro y leería bitácora de otras clínicas.
  if (!clinicId) return null;
  try {
    const rows = await prisma.auditLog.findMany({
      where: { clinicId, entityType: "subscription", action: "create" },
      orderBy: { createdAt: "desc" },
      take: AUDIT_LOOKBACK,
      select: { changes: true, entityId: true },
    });
    const stripe = getStripeSafe();
    if (!stripe) return null;
    for (const r of rows) {
      const after = (r.changes as { _created?: { after?: { billing?: unknown; moduleKey?: unknown; sessionId?: unknown } } } | null)
        ?._created?.after;
      const ciclo = pickPurchasedInterval([r.changes]);
      if (!ciclo || after?.moduleKey) continue; // sin ciclo, o checkout de un módulo
      const sessionId = typeof after?.sessionId === "string" ? after.sessionId : r.entityId;
      if (!sessionId || !sessionId.startsWith("cs_")) continue;
      let s: { payment_status?: string | null; metadata?: Record<string, string> | null };
      try {
        s = await stripe.checkout.sessions.retrieve(sessionId);
      } catch (e) {
        if ((e as { code?: string })?.code === "resource_missing") continue;
        return null; // Stripe no contesta: no se adivina con una fila sin confirmar
      }
      if (s.payment_status === "paid" && s.metadata?.kind === "platform-subscription" && s.metadata?.clinicId === clinicId) {
        // Manda lo que Stripe cobró; la fila de bitácora solo dijo qué sesión mirar.
        return pickPurchasedInterval([{ _created: { after: { billing: s.metadata?.billing } } }]) ?? ciclo;
      }
    }
    return null;
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
