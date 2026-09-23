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
  /**
   * Sede incluida en la suscripción de su clínica madre: vale $0 y no suma.
   * Lo decide `findIncludedBranchIds` (abajo), nunca el llamador a ojo.
   */
  includedBranch?: boolean;
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
  /** Clínicas valuadas, SIN las sedes incluidas (esas van en `includedBranches`). */
  clinics: number;
  /** Desglose por plan, en el orden del catálogo. Para auditar el total. */
  byPlan: MrrPlanLine[];
  /**
   * Sedes que entraron al cálculo y NO suman porque van incluidas en el plan
   * de su clínica madre. La pantalla lo dice debajo del MRR: un número sin
   * explicación es lo que infló esta cifra 3×.
   */
  includedBranches: number;
}

export const EMPTY_MRR: AdminMrr = { total: 0, clinics: 0, byPlan: [], includedBranches: 0 };

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
 *   2) sede incluida en el plan de su madre → $0. Ya está pagada dentro de la
 *      suscripción de la madre (CLINIC incluye hasta `maxClinics` sedes).
 *   3) el precio del plan en plan_configs — el caso normal, porque Stripe
 *      Checkout nunca escribe monthlyPrice.
 * Un plan desconocido vale 0 en vez de inventar un precio.
 *
 * OJO con los DOS ceros de `monthlyPrice`: 0 a secas es «sin precio negociado,
 * cóbrale la lista» (paso 3); 0 en una sede incluida es «no paga aparte»
 * (paso 2). El 0 no los distingue — los distingue `includedBranch`.
 */
function clinicMonthlyValue(clinic: MrrClinicRow, listPrice: number): number {
  const negotiated = Number(clinic.monthlyPrice ?? 0);
  if (negotiated > 0) return negotiated;
  if (clinic.includedBranch) return 0;
  return listPrice;
}

/** Una sede incluida que de verdad no paga: sin precio propio. */
function isIncludedBranch(clinic: MrrClinicRow): boolean {
  return !!clinic.includedBranch && !(Number(clinic.monthlyPrice ?? 0) > 0);
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
  let includedBranches = 0;

  for (const clinic of clinics) {
    // La sede incluida no es una clínica más del desglose: "3 CLINIC" junto a
    // un solo precio de CLINIC confundiría. Se cuenta aparte.
    if (isIncludedBranch(clinic)) {
      includedBranches += 1;
      continue;
    }
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
    clinics: clinics.length - includedBranches,
    byPlan: Array.from(lines.values()).sort(
      (a, b) => planRank(a.plan, catalog) - planRank(b.plan, catalog),
    ),
    includedBranches,
  };
}

/** Resumen por plan para enseñar el desglose en la UI ("2 BASIC · 1 PRO"). */
export function mrrBreakdownHint(mrr: AdminMrr): string {
  if (!mrr.byPlan.length) return "Sin clínicas activas";
  return mrr.byPlan.map((l) => `${l.clinics} ${l.plan}`).join(" · ");
}

/**
 * La línea que va debajo del MRR diciendo a quién NO cuenta. `null` si no hay
 * sedes incluidas (no se pinta nada).
 */
export function includedBranchesHint(includedBranches: number): string | null {
  if (includedBranches <= 0) return null;
  return includedBranches === 1
    ? "No incluye 1 sede incluida en el plan de su clínica madre"
    : `No incluye ${includedBranches} sedes incluidas en el plan de su clínica madre`;
}

// ── Qué clínica es una sede incluida ──────────────────────────────────────
//
// El schema NO tiene `parentClinicId`: nada dice «esta sede es de aquella
// madre». Lo que sí hay, y ya usa `manual-subscription-lapse.ts` para no
// suspender sucursales, es la HUELLA con la que nace una sede en
// POST /api/clinics: `subscriptionStatus: "active"`, `monthlyPrice: 0`, sin
// suscripción propia (ni Stripe, ni PayPal, ni la legacy) y sin
// `nextBillingDate`. Todo pagador — tarjeta, SPEI/OXXO, alta a mano desde
// /admin — deja al menos una de esas marcas; la sede, ninguna.
//
// La huella sola no basta: hace falta una MADRE. La madre es otra clínica del
// MISMO dueño (supabaseId con rol SUPER_ADMIN): la que tiene cobro propio, o,
// si ninguna del grupo lo tiene, la activa más antigua (una sede siempre nace
// después de su madre, desde la sesión de la madre).
//
// Lo que NO es una sede incluida, aunque comparta dueño:
//   · una clínica con su propia suscripción (Stripe, PayPal, SPEI/OXXO o alta
//     a mano) → tiene cobro propio → suma lo suyo;
//   · una sede con precio negociado (`monthlyPrice > 0`) → suma ese precio;
//   · una clínica sin cobro propio y SIN hermana que haga de madre → suma la
//     lista (el 0 de siempre: «sin precio negociado»).

/** Lo que hace falta de una clínica para decidir si es sede incluida. */
export interface BranchBillingRow {
  id: string;
  createdAt: Date | string;
  subscriptionStatus?: string | null;
  monthlyPrice: number | null;
  stripeSubscriptionId?: string | null;
  paypalSubscriptionId?: string | null;
  /** Legacy (Stripe/MP). */
  subscriptionId?: string | null;
  nextBillingDate?: Date | string | null;
}

/** Una fila User dueña: `role: "SUPER_ADMIN"`. */
export interface ClinicOwnerRow {
  supabaseId: string;
  clinicId: string;
}

/** ¿Se le cobra a esta clínica por su cuenta? Cualquier rastro de cobro vale. */
export function hasOwnBilling(c: BranchBillingRow): boolean {
  return (
    Number(c.monthlyPrice ?? 0) > 0 ||
    !!c.stripeSubscriptionId ||
    !!c.paypalSubscriptionId ||
    !!c.subscriptionId ||
    !!c.nextBillingDate
  );
}

/** La huella con la que nace una sede en POST /api/clinics. */
function looksLikeIncludedBranch(c: BranchBillingRow): boolean {
  return c.subscriptionStatus === "active" && !hasOwnBilling(c);
}

function time(d: Date | string): number {
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Los ids de las sedes incluidas en el plan de su madre. Puro: recibe TODAS
 * las clínicas que puedan hacer de madre (archivadas incluidas: una madre
 * archivada no convierte en pagadoras a sus sedes) y las filas dueñas.
 */
export function findIncludedBranchIds(
  clinics: BranchBillingRow[],
  owners: ClinicOwnerRow[],
): Set<string> {
  const byId = new Map(clinics.map((c) => [c.id, c]));
  const groups = new Map<string, BranchBillingRow[]>();
  for (const o of owners) {
    const c = byId.get(o.clinicId);
    if (!c) continue;
    const g = groups.get(o.supabaseId);
    if (!g) groups.set(o.supabaseId, [c]);
    else if (!g.includes(c)) g.push(c);
  }

  const out = new Set<string>();
  groups.forEach((group) => {
    if (group.length < 2) return;
    const payers = group.filter(hasOwnBilling);
    // Sin ninguna pagadora, la madre es la activa más antigua del grupo.
    let fallbackMother: BranchBillingRow | null = null;
    if (payers.length === 0) {
      for (const c of group) {
        if (c.subscriptionStatus !== "active") continue;
        if (!fallbackMother || time(c.createdAt) < time(fallbackMother.createdAt)) fallbackMother = c;
      }
      if (!fallbackMother) return;
    }
    for (const c of group) {
      if (c === fallbackMother) continue;
      if (looksLikeIncludedBranch(c)) out.add(c.id);
    }
  });
  return out;
}
