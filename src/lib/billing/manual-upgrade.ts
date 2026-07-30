import "server-only";
import { prisma } from "@/lib/prisma";
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
      select: { changes: true },
    });
    return pickPurchasedInterval(rows.map((r) => r.changes));
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
