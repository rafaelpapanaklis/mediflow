import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { assertBarberFeature, barberGateErrorPayload } from "@/lib/barber/gating";
import { moneyErrorResponse } from "@/lib/barber/cash";
import {
  buildCashFlowCsv,
  buildReportsCsv,
  getReportsSummary,
  type ReportsCsvLabels,
  type ReportsCsvMoneyLabels,
} from "@/lib/barber/stats";
import { RESUMEN_INCOME_METHODS } from "@/lib/barber/caja-resumen";
import { BARBER_PAYOUT_KINDS, CASH_EXPENSE_CATEGORIES } from "@/lib/barber/caja-movimientos-core";
import { MOVEMENTS_LIMIT } from "@/lib/barber/caja-dinero";
import { getBarberT } from "@/i18n/dictionaries/barber";

export const dynamic = "force-dynamic";

/** Etiquetas del CSV en el idioma de la barbería (barber.reportes.csv.*). */
function csvLabelsFor(t: ReturnType<typeof getBarberT>): ReportsCsvLabels {
  const c = (key: string) => t(`barber.reportes.csv.${key}`);
  return {
    section: c("section"),
    day: c("day"),
    tickets: c("tickets"),
    services: c("services"),
    products: c("products"),
    other: c("other"),
    tips: c("tips"),
    discounts: c("discounts"),
    revenue: c("revenue"),
    total: c("total"),
    barber: c("barber"),
    produced: c("produced"),
    avgTicket: c("avgTicket"),
    commission: c("commission"),
    item: c("item"),
    qty: c("qty"),
    cost: c("cost"),
    margin: c("margin"),
    marginPct: c("marginPct"),
    weekday: c("weekday"),
    hour: c("hour"),
    visits: c("visits"),
    client: c("client"),
    phone: c("phone"),
    noShows: c("noShows"),
    lastAt: c("lastAt"),
    method: c("method"),
    share: c("share"),
    metric: c("metric"),
    value: c("value"),
    sections: {
      summary: c("sections.summary"),
      byDay: c("sections.byDay"),
      byBarber: c("sections.byBarber"),
      services: c("sections.services"),
      products: c("sections.products"),
      occupancy: c("sections.occupancy"),
      noShows: c("sections.noShows"),
      retention: c("sections.retention"),
      payments: c("sections.payments"),
    },
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((i) => t(`barber.reportes.weekdaysLong.${i}`)),
    methods: {
      CASH: t("barber.reportes.methods.CASH"),
      CARD: t("barber.reportes.methods.CARD"),
      SPEI: t("barber.reportes.methods.SPEI"),
      STRIPE: t("barber.reportes.methods.STRIPE"),
    },
    metrics: {
      period: c("metrics.period"),
      tickets: c("metrics.tickets"),
      revenue: c("metrics.revenue"),
      tips: c("metrics.tips"),
      total: c("metrics.total"),
      avgTicket: c("metrics.avgTicket"),
      prevRevenue: c("metrics.prevRevenue"),
      noShowRate: c("metrics.noShowRate"),
      newClients: c("metrics.newClients"),
      returningClients: c("metrics.returningClients"),
      newReturned: c("metrics.newReturned"),
      returnRate: c("metrics.returnRate"),
    },
    money: moneyLabelsFor(t),
  };
}

/** Etiquetas de «Ingresos y gastos» (ws6-t5): barber.reportes.csv.* y barber.reportes.money.*. */
function moneyLabelsFor(t: ReturnType<typeof getBarberT>): ReportsCsvMoneyLabels {
  const c = (key: string) => t(`barber.reportes.csv.${key}`);
  const m = (key: string, vars?: Record<string, string | number>) => t(`barber.reportes.money.${key}`, vars);
  const map = (prefix: string, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, m(`${prefix}.${k}`)]));
  return {
    sections: {
      money: c("sections.money"),
      byMethod: c("sections.moneyByMethod"),
      byCategory: c("sections.moneyByCategory"),
      byKind: c("sections.moneyByKind"),
    },
    metrics: {
      charged: c("metrics.charged"),
      tips: c("metrics.tips"),
      income: c("metrics.income"),
      expenses: c("metrics.expenses"),
      expensesCash: c("metrics.expensesCash"),
      payouts: c("metrics.payouts"),
      barberCost: c("metrics.barberCost"),
      note: c("metrics.note"),
      profit: c("metrics.profit"),
      prevProfit: c("metrics.prevProfit"),
      cashNet: c("metrics.cashNet"),
      payoutsDrawer: c("metrics.payoutsDrawer"),
      payoutsOutside: c("metrics.payoutsOutside"),
    },
    onlineNotIncluded: m("onlineNotIncluded"),
    truncated: m("truncated", { limit: MOVEMENTS_LIMIT }),
    method: c("method"),
    category: c("metrics.category"),
    kind: c("metrics.kind"),
    count: c("metrics.count"),
    total: c("total"),
    barber: c("barber"),
    paidOut: c("metrics.paidOut"),
    paidDrawer: c("metrics.paidDrawer"),
    paidOutside: c("metrics.paidOutside"),
    advances: c("metrics.advances"),
    methods: map("methods", RESUMEN_INCOME_METHODS),
    // N9: las etiquetas de la Caja (barber.caja.mov.cat.*), una sola fuente.
    categories: Object.fromEntries(CASH_EXPENSE_CATEGORIES.map((k) => [k, t(`barber.caja.mov.cat.${k}`)])),
    kinds: map("kind", BARBER_PAYOUT_KINDS),
  };
}

// GET /api/barber/stats/reports?range=today|week|month|custom&from=&to=
//     &branchId=<id|all>&barberId=&format=json|csv
//
// Feature `analytics` (plan Profesional) + suscripción al día, verificadas
// AQUÍ con assertBarberFeature (gating.ts) → 402/403 FEATURE_LOCKED con el
// plan que sí la incluye. Permiso: cash.view o commissions.view
// (getReportsSummary). Un rol BARBER recibe SOLO su producción, visitas y
// comisiones; pedir barberId ajeno → 403 FORBIDDEN_SCOPE.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "analytics");
    const sp = req.nextUrl.searchParams;
    const plan = await getBarberPlan(ctx.barbershop.plan);
    const summary = await getReportsSummary(ctx, {
      range: sp.get("range"),
      from: sp.get("from"),
      to: sp.get("to"),
      branchId: sp.get("branchId"),
      barberId: sp.get("barberId"),
      features: plan.features,
    });

    if (sp.get("format") === "csv") {
      const labels = csvLabelsFor(getBarberT(ctx.barbershop.locale));
      // section=money: solo «Ingresos y gastos» (el botón de esa tarjeta). Sin
      // cash.view la sección no viaja → 403, no un archivo vacío.
      const onlyMoney = sp.get("section") === "money";
      if (onlyMoney && !summary.cashFlow) {
        return NextResponse.json({ error: "Sin permiso para ver la caja", code: "FORBIDDEN" }, { status: 403 });
      }
      const csv = onlyMoney ? buildCashFlowCsv(summary, labels) : buildReportsCsv(summary, labels);
      const name = onlyMoney ? "ingresos-y-gastos" : "reportes";
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}-${summary.period.from}-${summary.period.to}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const gate = barberGateErrorPayload(e);
    if (gate) return NextResponse.json(gate.body, { status: gate.status });
    return moneyErrorResponse(e);
  }
}
