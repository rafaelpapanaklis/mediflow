/**
 * EL cálculo del MRR del panel /admin, puro y sin dependencias (por eso es
 * `-core`, como payout-core o audit-core): así se puede probar con
 * `npm run test:mrr` sin base de datos.
 *
 * El punto de entrada de la app es `@/lib/admin/mrr`, que reexporta todo esto y
 * le añade la consulta a Prisma y los precios de plan_configs.
 */

/** Lo mínimo que hace falta de una clínica para valuarla. */
export interface MrrClinicRow {
  plan: string | null;
  monthlyPrice: number | null;
  subscriptionStatus?: string | null;
}

export interface MrrPlanLine {
  plan: string;
  /** Precio de lista de ese plan HOY, desde plan_configs. */
  listPrice: number;
  clinics: number;
  /** Cuántas de esas clínicas cobran un precio negociado (monthlyPrice > 0). */
  negotiated: number;
  /** Suma real aportada por ese plan. */
  total: number;
}

export interface AdminMrr {
  total: number;
  clinics: number;
  /** Desglose por plan, en el orden del catálogo. Para auditar el total. */
  byPlan: MrrPlanLine[];
}

export const EMPTY_MRR: AdminMrr = { total: 0, clinics: 0, byPlan: [] };

/**
 * Qué clínica aporta al MRR: SOLO `subscriptionStatus === "active"`.
 *
 * OJO: NO usar ACTIVE_SUBSCRIPTION_STATUSES (@/lib/plan-status). Ese conjunto
 * incluye "trialing" y "paid" porque responde a otra pregunta — quién tiene
 * ACCESO al panel —, y una clínica en trial paga $0: contarla inflaría el MRR.
 */
export function isMrrBillable(clinic: { subscriptionStatus?: string | null }): boolean {
  return clinic.subscriptionStatus === "active";
}

/**
 * Cuánto aporta UNA clínica al mes. Precedencia:
 *   1) `clinic.monthlyPrice` si es > 0 — precio negociado o activación manual;
 *      es lo que de verdad se le cobra y manda sobre la lista de precios.
 *   2) el precio del plan en plan_configs — el caso normal, porque Stripe
 *      Checkout nunca escribe monthlyPrice.
 * Un plan desconocido vale 0 en vez de inventar un precio.
 */
function clinicMonthlyValue(clinic: MrrClinicRow, listPrice: number): number {
  const negotiated = Number(clinic.monthlyPrice ?? 0);
  return negotiated > 0 ? negotiated : listPrice;
}

/**
 * Orden estable del desglose: el del catálogo de planes, que es el orden en que
 * `loadPlanPrices` construye el record (BASIC → PRO → CLINIC). Un plan que no
 * esté en el catálogo va al final en vez de romper el orden.
 */
function planRank(plan: string, catalog: string[]): number {
  const i = catalog.indexOf(plan);
  return i === -1 ? catalog.length : i;
}

/**
 * EL cálculo. Recibe las filas ya cargadas (las pages que hacen su propio
 * findMany no vuelven a consultar) y los precios de lista de plan_configs.
 * No filtra por estado: el llamador decide qué universo valuar (activas para el
 * MRR, en trial para el MRR potencial).
 */
export function computeMrr(
  clinics: MrrClinicRow[],
  planPrices: Record<string, number>,
): AdminMrr {
  const catalog = Object.keys(planPrices);
  const lines = new Map<string, MrrPlanLine>();
  let total = 0;

  for (const clinic of clinics) {
    const plan = clinic.plan ?? "—";
    const listPrice = planPrices[plan] ?? 0;
    const value = clinicMonthlyValue(clinic, listPrice);

    let line = lines.get(plan);
    if (!line) {
      line = { plan, listPrice, clinics: 0, negotiated: 0, total: 0 };
      lines.set(plan, line);
    }
    line.clinics += 1;
    line.total += value;
    if (Number(clinic.monthlyPrice ?? 0) > 0) line.negotiated += 1;
    total += value;
  }

  return {
    total,
    clinics: clinics.length,
    byPlan: Array.from(lines.values()).sort(
      (a, b) => planRank(a.plan, catalog) - planRank(b.plan, catalog),
    ),
  };
}

/** Resumen por plan para enseñar el desglose en la UI ("2 BASIC · 1 PRO"). */
export function mrrBreakdownHint(mrr: AdminMrr): string {
  if (!mrr.byPlan.length) return "Sin clínicas activas";
  return mrr.byPlan.map((l) => `${l.clinics} ${l.plan}`).join(" · ");
}
