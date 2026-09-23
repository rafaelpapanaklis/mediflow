import "server-only";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { computeMrr, EMPTY_MRR, findIncludedBranchIds, type AdminMrr } from "./mrr-core";

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
 * Los ids de las sedes incluidas en el plan de su clínica madre (valen $0 en
 * el MRR). El criterio es `findIncludedBranchIds` (@/lib/admin/mrr-core); aquí
 * sólo se cargan sus dos entradas, para TODO el sistema y no por pantalla: una
 * sede es incluida o no lo es, mire quien mire.
 *
 * Se cargan TODAS las clínicas, archivadas incluidas, porque cualquiera puede
 * ser la madre de una sede viva. Dueño = fila User `SUPER_ADMIN` activa, la
 * misma definición que `countOwnedClinics` (@/lib/branches), que es la que
 * deja crear la sede.
 */
export async function loadIncludedBranchIds(): Promise<Set<string>> {
  const [clinics, owners] = await Promise.all([
    prisma.clinic.findMany({
      select: {
        id: true,
        createdAt: true,
        subscriptionStatus: true,
        monthlyPrice: true,
        stripeSubscriptionId: true,
        paypalSubscriptionId: true,
        subscriptionId: true,
        nextBillingDate: true,
      },
    }),
    prisma.user.findMany({
      where: { role: "SUPER_ADMIN", isActive: true },
      select: { supabaseId: true, clinicId: true },
    }),
  ]);
  return findIncludedBranchIds(clinics, owners);
}

/**
 * MRR de las clínicas activas, para páginas que no cargan las clínicas por su
 * cuenta. Nunca lanza: si la consulta falla devuelve el MRR vacío y la página
 * se sigue renderizando.
 */
export async function getAdminMrr(): Promise<AdminMrr> {
  try {
    const [clinics, planPrices, sedes] = await Promise.all([
      prisma.clinic.findMany({
        where: { subscriptionStatus: "active" },
        select: { id: true, plan: true, monthlyPrice: true, subscriptionStatus: true },
      }),
      loadPlanPrices(),
      loadIncludedBranchIds(),
    ]);
    return computeMrr(
      clinics.map((c) => ({ ...c, includedBranch: sedes.has(c.id) })),
      planPrices,
    );
  } catch (e) {
    console.error("[admin/mrr] no se pudo calcular el MRR:", e);
    return EMPTY_MRR;
  }
}
