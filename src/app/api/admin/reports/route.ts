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
    prisma.clinic.findMany({ select: { id: true, plan: true, monthlyPrice: true, subscriptionStatus: true, createdAt: true, trialEndsAt: true } }),
    prisma.clinic.findMany({ where: { subscriptionStatus: "active" }, select: { monthlyPrice: true, plan: true } }),
    prisma.clinic.findMany({ where: { subscriptionStatus: { in: ["trialing", null as any] }, trialEndsAt: { gt: now } }, select: { id: true } }),
    prisma.subscriptionInvoice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { clinic: { select: { name: true, plan: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.subscriptionInvoice.aggregate({
      where: { status: "paid", paidAt: { gte: from, lte: to } },
      _sum: { amount: true }, _count: true,
    }),
    prisma.clinic.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.clinic.count({ where: { subscriptionStatus: "cancelled", updatedAt: { gte: from, lte: to } } }),
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
  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
    const monthKey   = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const [paidAgg, newC, churned] = await Promise.all([
      prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", paidAt: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true }, _count: true,
      }),
      prisma.clinic.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.clinic.count({ where: { subscriptionStatus: "cancelled", updatedAt: { gte: monthStart, lte: monthEnd } } }),
    ]);
    monthlySeries.push({
      month: monthKey,
      paid:       paidAgg._sum.amount ?? 0,
      payments:   paidAgg._count,
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
      periodRevenue: periodPayments._sum.amount ?? 0,
      periodPayments: periodPayments._count,
    },
    monthlySeries,
    periodInvoices,
  };
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") ?? new Date(new Date().getFullYear(), 0, 1));
  const to   = new Date(url.searchParams.get("to")   ?? new Date());
  const format = url.searchParams.get("format") ?? "json";

  const data = await computeMetrics(from, to);

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
