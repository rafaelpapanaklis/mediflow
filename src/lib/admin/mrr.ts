import "server-only";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { computeMrr, EMPTY_MRR, type AdminMrr } from "./mrr-core";

/**
 * FUENTE ÚNICA del MRR del panel /admin.
 *
 * Antes había DOS cálculos que daban números distintos para lo mismo:
 *  - /admin/payments sumaba `Clinic.monthlyPrice`, columna que SOLO escriben
 *    `/api/admin/billing` (verify_payment y activate_clinic). Una clínica que
 *    pagó por Stripe Checkout nunca la recibe → el KPI marcaba $0.
 *  - /admin sumaba el precio del plan desde plan_configs → otro número.
 *
 * Aquí se decide una sola vez. Cualquier superficie que muestre MRR debe llamar
 * a `getAdminMrr()` (o a `computeMrr()` si ya tiene las filas cargadas), nunca
 * reimplementar la suma. La aritmética y la regla de precedencia viven en
 * `./mrr-core` (puro y con tests: `npm run test:mrr`).
 */
export * from "./mrr-core";

/**
 * Precios mensuales de lista por plan. `getPlanLimits` es la fuente única
 * (plan_configs con caché y fallback a plan-shared), así que aquí NUNCA hay
 * números literales. El orden de las claves es el del catálogo y de él sale el
 * orden del desglose.
 */
export async function loadPlanPrices(): Promise<Record<PlanId, number>> {
  const rows = await Promise.all(
    PLAN_IDS.map(async (id) => ({ id, price: (await getPlanLimits(id)).monthlyPrice })),
  );
  const out = {} as Record<PlanId, number>;
  for (const r of rows) out[r.id] = r.price;
  return out;
}

/**
 * MRR de las clínicas activas, para páginas que no cargan las clínicas por su
 * cuenta. Nunca lanza: si la consulta falla devuelve el MRR vacío y la página
 * se sigue renderizando.
 */
export async function getAdminMrr(): Promise<AdminMrr> {
  try {
    const [clinics, planPrices] = await Promise.all([
      prisma.clinic.findMany({
        where: { subscriptionStatus: "active" },
        select: { plan: true, monthlyPrice: true, subscriptionStatus: true },
      }),
      loadPlanPrices(),
    ]);
    return computeMrr(clinics, planPrices);
  } catch (e) {
    console.error("[admin/mrr] no se pudo calcular el MRR:", e);
    return EMPTY_MRR;
  }
}
