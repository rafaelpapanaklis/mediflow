import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MonthlyRow { month: string; paid: number; payments: number; newClinics: number; churned: number }

function emptyMetrics(from: Date, to: Date) {
  return {
    summary: {
      from:          from.toISOString(),
      to:            to.toISOString(),
      mrr: 0, arr: 0, arpu: 0, ltv: 0,
      churnRate: 0, trialConversion: 0,
      activeClinics: 0, trialClinics: 0, totalClinics: 0,
      newClinicsPeriod: 0, churnedPeriod: 0,
      periodRevenue: 0, periodPayments: 0,
    },
    monthlySeries: [] as MonthlyRow[],
    periodInvoices: [] as any[],
  };
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; }
  catch (e) { console.error("[admin/reports] query failed:", e); return fallback; }
}

async function computeMetrics(from: Date, to: Date) {
  const now = new Date();

  const [
    allClinics,
    activeClinics,
    trialClinics,
    periodInvoices,
    periodPayments,
    newClinicsPeriod,
    churnedPeriod,
  ] = await Promise.all([
    safe(prisma.clinic.findMany({ select: { id: true, plan: true, monthlyPrice: true, subscriptionStatus: true, createdAt: true, trialEndsAt: true } }), [] as any[]),
    safe(prisma.clinic.findMany({ where: { subscriptionStatus: "active" }, select: { monthlyPrice: true, plan: true } }), [] as any[]),
    // Antes usaba { in: ["trialing", null as any] }. Prisma no matchea NULL
    // dentro de IN; se reemplaza por OR explícito.
    safe(prisma.clinic.findMany({
      where: {
        AND: [
          { OR: [{ subscriptionStatus: "trialing" }, { subscriptionStatus: null }] },
          { trialEndsAt: { gt: now } },
        ],
      },
      select: { id: true },
    }), [] as { id: string }[]),
    safe(prisma.subscriptionInvoice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { clinic: { select: { name: true, plan: true } } },
      orderBy: { createdAt: "desc" },
    }), [] as any[]),
    safe(prisma.subscriptionInvoice.aggregate({
      where: { status: "paid", paidAt: { gte: from, lte: to } },
      _sum: { amount: true }, _count: true,
    }), { _sum: { amount: 0 }, _count: 0 } as any),
    safe(prisma.clinic.count({ where: { createdAt: { gte: from, lte: to } } }), 0),
    safe(prisma.clinic.count({ where: { subscriptionStatus: "cancelled", updatedAt: { gte: from, lte: to } } }), 0),
  ]);

  const mrr = activeClinics.reduce((s, c) => s + (c.monthlyPrice ?? 0), 0);
  const arr = mrr * 12;
  const arpu = activeClinics.length > 0 ? mrr / activeClinics.length : 0;

  // LTV estimado simple: ARPU / churn rate mensual
  const churnRate = allClinics.length > 0 ? churnedPeriod / allClinics.length : 0;
  const ltv = churnRate > 0 ? arpu / churnRate : arpu * 24; // fallback: 24 meses si no hay churn

  // Conversión trial → paying en el periodo
  const trialsEnded = allClinics.filter(c => c.trialEndsAt && c.trialEndsAt >= from && c.trialEndsAt <= to).length;
  const converted   = allClinics.filter(c =>
    c.trialEndsAt && c.trialEndsAt >= from && c.trialEndsAt <= to && c.subscriptionStatus === "active",
  ).length;
  const trialConversion = trialsEnded > 0 ? (converted / trialsEnded) * 100 : 0;

  // Mensual (evolución)
  const monthlySeries: MonthlyRow[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end    = new Date(to.getFullYear(),   to.getMonth(),   1);
  // Guard contra loops infinitos / dates inválidas
  let iterations = 0;
  while (cursor <= end && iterations++ < 240) {
    const monthStart = new Date(cursor);
    const monthEnd   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    const monthKey   = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const [paidAgg, newC, churned] = await Promise.all([
      safe(prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", paidAt: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true }, _count: true,
      }), { _sum: { amount: 0 }, _count: 0 } as any),
      safe(prisma.clinic.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }), 0),
      safe(prisma.clinic.count({ where: { subscriptionStatus: "cancelled", updatedAt: { gte: monthStart, lte: monthEnd } } }), 0),
    ]);
    monthlySeries.push({
      month: monthKey,
      paid:       Number(paidAgg?._sum?.amount ?? 0),
      payments:   Number(paidAgg?._count ?? 0),
      newClinics: newC,
      churned,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    summary: {
      from:         from.toISOString(),
      to:           to.toISOString(),
      mrr, arr, arpu, ltv,
      churnRate:    Number((churnRate * 100).toFixed(2)),
      trialConversion: Number(trialConversion.toFixed(2)),
      activeClinics: activeClinics.length,
      trialClinics:  trialClinics.length,
      totalClinics:  allClinics.length,
      newClinicsPeriod,
      churnedPeriod,
      periodRevenue: Number(periodPayments?._sum?.amount ?? 0),
      periodPayments: Number(periodPayments?._count ?? 0),
    },
    monthlySeries,
    periodInvoices,
  };
}

function parseDate(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"), new Date(new Date().getFullYear(), 0, 1));
  const to   = parseDate(url.searchParams.get("to"),   new Date());
  const format = url.searchParams.get("format") ?? "json";

  if (from > to) return NextResponse.json({ error: "from debe ser anterior a to" }, { status: 400 });

  let data;
  try {
    data = await computeMetrics(from, to);
  } catch (err: any) {
    console.error("[admin/reports] computeMetrics failed:", err);
    data = emptyMetrics(from, to);
    // No rompemos la respuesta: devolvemos datos vacíos y el client muestra
    // "Sin datos todavía" en vez de un toast de error.
  }

  if (format !== "xlsx") return NextResponse.json(data);

  // Export XLSX
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet([
    { Métrica: "Periodo",           Valor: `${from.toISOString().slice(0,10)} → ${to.toISOString().slice(0,10)}` },
    { Métrica: "MRR (activo)",      Valor: data.summary.mrr },
    { Métrica: "ARR",               Valor: data.summary.arr },
    { Métrica: "ARPU",              Valor: Number(data.summary.arpu.toFixed(2)) },
    { Métrica: "LTV estimado",      Valor: Number(data.summary.ltv.toFixed(2)) },
    { Métrica: "Churn rate %",      Valor: data.summary.churnRate },
    { Métrica: "Conversión trial %", Valor: data.summary.trialConversion },
    { Métrica: "Clínicas activas",  Valor: data.summary.activeClinics },
    { Métrica: "Clínicas en trial", Valor: data.summary.trialClinics },
    { Métrica: "Clínicas totales",  Valor: data.summary.totalClinics },
    { Métrica: "Nuevas (periodo)",  Valor: data.summary.newClinicsPeriod },
    { Métrica: "Churn (periodo)",   Valor: data.summary.churnedPeriod },
    { Métrica: "Ingresos periodo",  Valor: data.summary.periodRevenue },
    { Métrica: "Pagos periodo",     Valor: data.summary.periodPayments },
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Resumen");

  const monthlySheet = XLSX.utils.json_to_sheet(
    data.monthlySeries.map(m => ({
      Mes:            m.month,
      "Ingresos":     m.paid,
      "# Pagos":      m.payments,
      "Nuevas":       m.newClinics,
      "Churn":        m.churned,
    })),
  );
  XLSX.utils.book_append_sheet(wb, monthlySheet, "Mensual");

  const paymentsSheet = XLSX.utils.json_to_sheet(
    data.periodInvoices.map(inv => ({
      Fecha:          inv.createdAt.toISOString().slice(0, 10),
      Clínica:        inv.clinic?.name ?? "",
      Plan:           inv.clinic?.plan ?? "",
      Monto:          inv.amount,
      Moneda:         inv.currency,
      Método:         inv.method ?? "",
      Estado:         inv.status,
      Referencia:     inv.reference ?? "",
      PeriodoInicio:  inv.periodStart.toISOString().slice(0, 10),
      PeriodoFin:     inv.periodEnd.toISOString().slice(0, 10),
    })),
  );
  XLSX.utils.book_append_sheet(wb, paymentsSheet, "Pagos");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `mediflow-reporte-${from.toISOString().slice(0,10)}_${to.toISOString().slice(0,10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
