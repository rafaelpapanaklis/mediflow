/**
 * Nivel "CLIENTE" del admin (CRM de la plataforma).
 *
 * Un CLIENTE = la cuenta dueña (User.supabaseId con role SUPER_ADMIN). Una
 * misma persona puede ser dueña de varias clínicas con planes distintos; aquí
 * agrupamos sus clínicas y calculamos métricas agregadas (MRR, ingresos, LTV,
 * health score, tags) reutilizando las fórmulas/criterios del resto de /admin.
 *
 * Solo lectura, global (lo usa el admin); el guard isAdminAuthed vive en las
 * rutas/page que consumen estas funciones. SIN cambios de schema: todo se
 * computa al vuelo desde campos existentes.
 */

import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/billing/plans";

const DAY = 86_400_000;

// ───────────────────────── Tipos públicos ─────────────────────────

/** Estado normalizado de una clínica (derivado de subscriptionStatus + trial). */
export type ClinicNormStatus = "active" | "trial" | "past_due" | "expired" | "churn" | "none";

/** Estado agregado de un cliente a partir de todas sus clínicas. */
export type ClienteAggStatus = "activo" | "trial" | "mixto" | "churn";

/** Segmentos derivados del health score / señales. */
export type ClienteTag = "vip" | "nuevo" | "en_riesgo";

export interface ClienteClinicaBrief {
  id: string;
  name: string;
  plan: string;
  status: ClinicNormStatus;
}

/** Fila de la lista /admin/clientes. */
export interface ClienteRow {
  supabaseId: string;
  ownerName: string;
  ownerEmail: string;
  clinicsCount: number;
  clinics: ClienteClinicaBrief[];
  plans: string[];
  mrr: number;
  aggStatus: ClienteAggStatus;
  createdAt: string;            // ISO — alta (min createdAt de sus clínicas)
  lastAccess: string | null;    // ISO — último acceso (max lastLogin)
  totalPatients: number;
  totalAppointments: number;
  affiliateName: string | null;
  healthScore: number;          // 0-100
  tags: ClienteTag[];
}

/** Cobro de suscripción (SubscriptionInvoice) dentro del detalle de cliente. */
export interface ClienteInvoice {
  id: string;
  clinicId: string;
  clinicName: string;
  amount: number;
  currency: string;
  status: string;            // pending | paid | failed
  method: string | null;     // stripe | transfer | deposit | oxxo | paypal | …
  reference: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  refunded: boolean;         // derivado de la marca en notes (sin schema)
  manualPending: boolean;    // pendiente y método manual (SPEI/transferencia/…)
  refundable: boolean;       // pagado, método stripe y con referencia de Stripe
}

/** Clínica dentro del detalle de cliente. */
export interface ClienteClinica {
  id: string;
  name: string;
  slug: string;
  plan: string;
  planPrice: number;
  status: ClinicNormStatus;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  monthlyPrice: number;
  patients: number;
  appointments: number;
  aiTokensUsed: number;
  aiTokensLimit: number;
  ingresos: number;             // suscripción pagada acumulada (SubscriptionInvoice)
  role: string;
  // Facturación
  nextBillingDate: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  paymentMethodType: string | null;
  paymentMethodLast4: string | null;
  paymentMethodCollected: boolean;
  preferredPaymentMethod: string | null;
  invoices: ClienteInvoice[];
}

/** Detalle completo de /admin/clientes/[supabaseId]. */
export interface ClienteDetalle {
  supabaseId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  createdAt: string;
  lastAccess: string | null;
  clinicsCount: number;
  mrr: number;
  aggStatus: ClienteAggStatus;
  healthScore: number;
  tags: ClienteTag[];
  totalPatients: number;
  totalAppointments: number;
  ingresosTotales: number;      // suma histórica de pagos de suscripción
  ltv: number;                  // estimado (MRR × 24)
  affiliateName: string | null;
  pendingPaymentsCount: number;
  clinics: ClienteClinica[];
  planDistribution: { plan: string; count: number; mrr: number }[];
  revenueSeries: { label: string; value: number }[];
  activityPerClinic: { name: string; pacientes: number; citas: number }[];
}

// ───────────────────────── Helpers puros ─────────────────────────

/** Precio mensual del plan (usa monthlyPrice si está, si no plans.ts). */
export function planPriceMxn(plan: string, monthlyPrice?: number | null): number {
  if (monthlyPrice && monthlyPrice > 0) return monthlyPrice;
  const p = PLANS.find((x) => x.id === plan);
  return p ? p.priceMxn : 0;
}

function clinicStatus(subscriptionStatus: string | null, trialEndsAt: Date | null): ClinicNormStatus {
  if (subscriptionStatus === "active") return "active";
  if (subscriptionStatus === "cancelled") return "churn";
  if (subscriptionStatus === "past_due") return "past_due";
  if (trialEndsAt) return trialEndsAt.getTime() > Date.now() ? "trial" : "expired";
  return "none";
}

function aggregateStatus(norms: ClinicNormStatus[]): ClienteAggStatus {
  if (norms.length === 0) return "churn";
  const allActive = norms.every((s) => s === "active");
  const allTrial = norms.every((s) => s === "trial");
  const allDead = norms.every(
    (s) => s === "churn" || s === "expired" || s === "none" || s === "past_due",
  );
  if (allActive) return "activo";
  if (allTrial) return "trial";
  if (allDead) return "churn";
  return "mixto";
}

/** Health score 0-100: suscripción (45) + engagement (35) + lealtad (12) + antigüedad (8). */
function computeHealthScore(opts: {
  activeCount: number;
  total: number;
  lastAccess: Date | null;
  createdAt: Date | null;
}): number {
  const { activeCount, total, lastAccess, createdAt } = opts;
  let score = 0;
  const activeRatio = total > 0 ? activeCount / total : 0;
  score += Math.round(activeRatio * 45);
  if (lastAccess) {
    const days = (Date.now() - lastAccess.getTime()) / DAY;
    if (days <= 7) score += 35;
    else if (days <= 30) score += 22;
    else if (days <= 90) score += 10;
    else score += 2;
  }
  if (total >= 3) score += 12;
  else if (total === 2) score += 8;
  else score += 4;
  if (createdAt) {
    const days = (Date.now() - createdAt.getTime()) / DAY;
    if (days >= 180) score += 8;
    else if (days >= 30) score += 4;
  }
  return Math.max(0, Math.min(100, score));
}

function deriveTags(opts: {
  createdAt: Date | null;
  mrr: number;
  activeCount: number;
  healthScore: number;
  agg: ClienteAggStatus;
  norms: ClinicNormStatus[];
  lastAccess: Date | null;
}): ClienteTag[] {
  const { createdAt, mrr, activeCount, healthScore, agg, norms, lastAccess } = opts;
  const tags: ClienteTag[] = [];
  if (createdAt && (Date.now() - createdAt.getTime()) / DAY <= 14) tags.push("nuevo");
  if (mrr >= 1999 || activeCount >= 2 || healthScore >= 80) tags.push("vip");
  const staleActive =
    activeCount > 0 && (!lastAccess || (Date.now() - lastAccess.getTime()) / DAY > 14);
  if (healthScore < 40 || agg === "churn" || norms.indexOf("past_due") >= 0 || staleActive) {
    tags.push("en_riesgo");
  }
  return tags;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

// Forma cruda de cada fila User→Clinic devuelta por Prisma.
type OwnerClinicRow = {
  supabaseId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string;
  lastLogin: Date | null;
  clinic: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    monthlyPrice: number | null;
    subscriptionStatus: string | null;
    trialEndsAt: Date | null;
    createdAt: Date;
    aiTokensUsed: number;
    aiTokensLimit: number;
    nextBillingDate: Date | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    paymentMethodType: string | null;
    paymentMethodLast4: string | null;
    paymentMethodCollected: boolean;
    preferredPaymentMethod: string | null;
    affiliate: { name: string } | null;
    _count: { patients: number; appointments: number };
  } | null;
};

const OWNER_CLINIC_SELECT = {
  supabaseId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  lastLogin: true,
  clinic: {
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      monthlyPrice: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      createdAt: true,
      aiTokensUsed: true,
      aiTokensLimit: true,
      nextBillingDate: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      paymentMethodType: true,
      paymentMethodLast4: true,
      paymentMethodCollected: true,
      preferredPaymentMethod: true,
      affiliate: { select: { name: true } },
      _count: { select: { patients: true, appointments: true } },
    },
  },
};

// ───────────────────────── Lista de clientes ─────────────────────────

export async function getClientesList(): Promise<ClienteRow[]> {
  const rows = (await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: OWNER_CLINIC_SELECT,
  })) as unknown as OwnerClinicRow[];

  // Agrupar por supabaseId. Usamos objeto plano (no Map) por el target < ES2015.
  const groups: Record<string, OwnerClinicRow[]> = {};
  rows.forEach((r) => {
    if (!r.clinic) return;
    (groups[r.supabaseId] = groups[r.supabaseId] || []).push(r);
  });

  const result: ClienteRow[] = Object.keys(groups).map((supabaseId) => {
    const grp = groups[supabaseId];
    const clinics = grp.map((r) => r.clinic!);
    const norms = clinics.map((c) => clinicStatus(c.subscriptionStatus, c.trialEndsAt));
    const activeCount = norms.filter((s) => s === "active").length;

    let mrr = 0;
    clinics.forEach((c, i) => {
      if (norms[i] === "active") mrr += planPriceMxn(c.plan, c.monthlyPrice);
    });

    let lastAccess: Date | null = null;
    grp.forEach((r) => { lastAccess = maxDate(lastAccess, r.lastLogin); });
    let createdAt: Date | null = null;
    clinics.forEach((c) => { createdAt = minDate(createdAt, c.createdAt); });

    const totalPatients = clinics.reduce((s, c) => s + c._count.patients, 0);
    const totalAppointments = clinics.reduce((s, c) => s + c._count.appointments, 0);

    let affiliateName: string | null = null;
    clinics.forEach((c) => { if (!affiliateName && c.affiliate) affiliateName = c.affiliate.name; });

    const agg = aggregateStatus(norms);
    const healthScore = computeHealthScore({ activeCount, total: clinics.length, lastAccess, createdAt });
    const tags = deriveTags({ createdAt, mrr, activeCount, healthScore, agg, norms, lastAccess });

    const ownerRow = grp.find((r) => r.firstName || r.lastName) || grp[0];
    const ownerName = `${ownerRow.firstName ?? ""} ${ownerRow.lastName ?? ""}`.trim() || ownerRow.email;

    const distinctPlans: string[] = [];
    clinics.forEach((c) => { if (distinctPlans.indexOf(c.plan) < 0) distinctPlans.push(c.plan); });

    return {
      supabaseId,
      ownerName,
      ownerEmail: ownerRow.email,
      clinicsCount: clinics.length,
      clinics: clinics.map((c, i) => ({ id: c.id, name: c.name, plan: c.plan, status: norms[i] })),
      plans: distinctPlans,
      mrr,
      aggStatus: agg,
      createdAt: (createdAt ?? new Date()).toISOString(),
      lastAccess: lastAccess ? (lastAccess as Date).toISOString() : null,
      totalPatients,
      totalAppointments,
      affiliateName,
      healthScore,
      tags,
    };
  });

  result.sort((a, b) => b.mrr - a.mrr || b.clinicsCount - a.clinicsCount);
  return result;
}

// ───────────────────────── Detalle de un cliente ─────────────────────────

export async function getClienteDetalle(supabaseId: string): Promise<ClienteDetalle | null> {
  const rows = (await prisma.user.findMany({
    where: { supabaseId, isActive: true },
    select: OWNER_CLINIC_SELECT,
  })) as unknown as OwnerClinicRow[];

  const withClinic = rows.filter((r) => !!r.clinic);
  if (withClinic.length === 0) return null;

  const clinicsRaw = withClinic.map((r) => r.clinic!);
  const clinicIds = clinicsRaw.map((c) => c.id);

  const subInvoices = await prisma.subscriptionInvoice.findMany({
    where: { clinicId: { in: clinicIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, clinicId: true, amount: true, currency: true, status: true,
      method: true, reference: true, periodStart: true, periodEnd: true,
      paidAt: true, createdAt: true, notes: true,
    },
  });

  // Serie mensual (últimos 12 meses) + ingresos por clínica + total histórico.
  const now = new Date();
  const monthBuckets: Record<string, number> = {};
  const series: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthBuckets[key] = 0;
    series.push({ key, label: d.toLocaleDateString("es-MX", { month: "short" }) });
  }

  const clinicNameById: Record<string, string> = {};
  clinicsRaw.forEach((c) => { clinicNameById[c.id] = c.name; });

  const REFUND_MARK = "[REEMBOLSADO";
  const MANUAL_METHODS = ["transfer", "deposit", "oxxo", "spei", "paypal", "cash"];

  const ingresosPorClinica: Record<string, number> = {};
  const invoicesByClinic: Record<string, ClienteInvoice[]> = {};
  let ingresosTotales = 0;
  let pendingPaymentsCount = 0;

  subInvoices.forEach((inv) => {
    const amt = inv.amount || 0;

    // Ingresos / serie: solo cobros pagados.
    if (inv.status === "paid") {
      ingresosTotales += amt;
      ingresosPorClinica[inv.clinicId] = (ingresosPorClinica[inv.clinicId] || 0) + amt;
      const when = inv.paidAt || inv.createdAt;
      if (when) {
        const dt = new Date(when);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        if (key in monthBuckets) monthBuckets[key] += amt;
      }
    }
    if (inv.status === "pending") pendingPaymentsCount += 1;

    const refunded = !!inv.notes && inv.notes.indexOf(REFUND_MARK) >= 0;
    const manualPending =
      inv.status === "pending" && (!inv.method || MANUAL_METHODS.indexOf(inv.method) >= 0);
    const ref = inv.reference || "";
    const isStripeRef = /^(pi_|ch_|in_|py_|re_)/.test(ref);
    const refundable = inv.status === "paid" && inv.method === "stripe" && isStripeRef && !refunded;

    const row: ClienteInvoice = {
      id: inv.id,
      clinicId: inv.clinicId,
      clinicName: clinicNameById[inv.clinicId] || "",
      amount: amt,
      currency: inv.currency || "MXN",
      status: inv.status,
      method: inv.method ?? null,
      reference: inv.reference ?? null,
      periodStart: inv.periodStart ? inv.periodStart.toISOString() : null,
      periodEnd: inv.periodEnd ? inv.periodEnd.toISOString() : null,
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      createdAt: inv.createdAt.toISOString(),
      refunded,
      manualPending,
      refundable,
    };
    (invoicesByClinic[inv.clinicId] = invoicesByClinic[inv.clinicId] || []).push(row);
  });
  const revenueSeries = series.map((s) => ({ label: s.label, value: monthBuckets[s.key] || 0 }));

  const norms = clinicsRaw.map((c) => clinicStatus(c.subscriptionStatus, c.trialEndsAt));
  const activeCount = norms.filter((s) => s === "active").length;

  let mrr = 0;
  clinicsRaw.forEach((c, i) => {
    if (norms[i] === "active") mrr += planPriceMxn(c.plan, c.monthlyPrice);
  });

  let lastAccess: Date | null = null;
  withClinic.forEach((r) => { lastAccess = maxDate(lastAccess, r.lastLogin); });
  let createdAt: Date | null = null;
  clinicsRaw.forEach((c) => { createdAt = minDate(createdAt, c.createdAt); });

  const totalPatients = clinicsRaw.reduce((s, c) => s + c._count.patients, 0);
  const totalAppointments = clinicsRaw.reduce((s, c) => s + c._count.appointments, 0);

  let affiliateName: string | null = null;
  clinicsRaw.forEach((c) => { if (!affiliateName && c.affiliate) affiliateName = c.affiliate.name; });

  const agg = aggregateStatus(norms);
  const healthScore = computeHealthScore({ activeCount, total: clinicsRaw.length, lastAccess, createdAt });
  const tags = deriveTags({ createdAt, mrr, activeCount, healthScore, agg, norms, lastAccess });
  const ltv = mrr * 24;

  const roleByClinic: Record<string, string> = {};
  withClinic.forEach((r) => { if (r.clinic) roleByClinic[r.clinic.id] = r.role; });

  const clinics: ClienteClinica[] = clinicsRaw.map((c, i) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    plan: c.plan,
    planPrice: planPriceMxn(c.plan, c.monthlyPrice),
    status: norms[i],
    subscriptionStatus: c.subscriptionStatus,
    trialEndsAt: c.trialEndsAt ? c.trialEndsAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    monthlyPrice: c.monthlyPrice || 0,
    patients: c._count.patients,
    appointments: c._count.appointments,
    aiTokensUsed: c.aiTokensUsed,
    aiTokensLimit: c.aiTokensLimit,
    ingresos: ingresosPorClinica[c.id] || 0,
    role: roleByClinic[c.id] || "SUPER_ADMIN",
    nextBillingDate: c.nextBillingDate ? c.nextBillingDate.toISOString() : null,
    stripeCustomerId: c.stripeCustomerId,
    stripeSubscriptionId: c.stripeSubscriptionId,
    paymentMethodType: c.paymentMethodType,
    paymentMethodLast4: c.paymentMethodLast4,
    paymentMethodCollected: c.paymentMethodCollected,
    preferredPaymentMethod: c.preferredPaymentMethod,
    invoices: invoicesByClinic[c.id] || [],
  }));

  const planDistMap: Record<string, { plan: string; count: number; mrr: number }> = {};
  clinicsRaw.forEach((c, i) => {
    if (!planDistMap[c.plan]) planDistMap[c.plan] = { plan: c.plan, count: 0, mrr: 0 };
    planDistMap[c.plan].count += 1;
    if (norms[i] === "active") planDistMap[c.plan].mrr += planPriceMxn(c.plan, c.monthlyPrice);
  });
  const planDistribution = Object.keys(planDistMap).map((k) => planDistMap[k]);

  const activityPerClinic = clinicsRaw.map((c) => ({
    name: c.name,
    pacientes: c._count.patients,
    citas: c._count.appointments,
  }));

  const ownerRow = withClinic.find((r) => r.firstName || r.lastName) || withClinic[0];
  const ownerName = `${ownerRow.firstName ?? ""} ${ownerRow.lastName ?? ""}`.trim() || ownerRow.email;

  return {
    supabaseId,
    ownerName,
    ownerEmail: ownerRow.email,
    ownerPhone: ownerRow.phone ?? null,
    createdAt: (createdAt ?? new Date()).toISOString(),
    lastAccess: lastAccess ? (lastAccess as Date).toISOString() : null,
    clinicsCount: clinicsRaw.length,
    mrr,
    aggStatus: agg,
    healthScore,
    tags,
    totalPatients,
    totalAppointments,
    ingresosTotales,
    ltv,
    affiliateName,
    pendingPaymentsCount,
    clinics,
    planDistribution,
    revenueSeries,
    activityPerClinic,
  };
}
