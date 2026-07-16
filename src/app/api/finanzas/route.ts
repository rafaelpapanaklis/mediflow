import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { CASH_METHOD, money } from "@/lib/caja";
import { MX_OFFSET_MS, bucketKeyOf, eachBucket } from "@/lib/analytics/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// FINANZAS — resumen financiero de la clínica (dirección financiera).
// Solo LEE payments/invoices/appointments (la Caja NO se toca) y suma los
// gastos del módulo (tabla expenses — ver sql/expenses.sql).
//
// GET /api/finanzas?period=hoy|mes|mes_anterior|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
// (default: mes). Ventanas ancladas al día natural de México (UTC-6 fijo,
// misma lógica que src/lib/caja.ts y src/lib/analytics/query.ts).
//
// Payment NO tiene clinicId: SIEMPRE se aísla vía invoice.clinicId, y el
// clinicId sale de la sesión (jamás de query). El contrato JSON está
// acordado con el equipo de UI — NO renombrar claves.
// ═══════════════════════════════════════════════════════════════════

/** Inicio del día natural de México para `now` (réplica de caja.ts, que no lo exporta). */
function startOfTodayMx(now: Date): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  return new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth(), mx.getUTCDate()) + MX_OFFSET_MS);
}

/** Día 1 del mes de México (con delta de meses), expresado como instante UTC. */
function startOfMonthMx(now: Date, monthDelta = 0): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  return new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth() + monthDelta, 1) + MX_OFFSET_MS);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resuelve la ventana [from, to] del periodo pedido (default "mes"). */
function resolveWindow(sp: URLSearchParams): { from: Date; to: Date } | { error: string } {
  const now = new Date();
  const period = sp.get("period") ?? "mes";
  if (period === "hoy") return { from: startOfTodayMx(now), to: now };
  if (period === "mes_anterior") {
    const currentStart = startOfMonthMx(now, 0);
    return { from: startOfMonthMx(now, -1), to: new Date(currentStart.getTime() - 1) };
  }
  if (period === "custom") {
    const fromRaw = sp.get("from") ?? "";
    const toRaw = sp.get("to") ?? "";
    if (!DATE_ONLY_RE.test(fromRaw) || !DATE_ONLY_RE.test(toRaw)) {
      return { error: "period=custom requiere from y to en formato YYYY-MM-DD." };
    }
    // Fecha sin hora = día natural de México (-06:00), igual que analytics/query.ts.
    const from = new Date(`${fromRaw}T00:00:00.000-06:00`);
    const to = new Date(`${toRaw}T23:59:59.999-06:00`);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
      return { error: "Rango de fechas inválido (from debe ser <= to)." };
    }
    return { from, to };
  }
  // "mes" (default y cualquier valor desconocido): del día 1 MX a ahora.
  return { from: startOfMonthMx(now, 0), to: now };
}

/** La tabla expenses puede no existir aún (sql/expenses.sql se corre a mano). */
function isMissingTable(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

function fullName(u?: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!u) return "—";
  const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return n || "—";
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // Finanzas = dirección financiera (utilidad, nómina): mismo permiso que
  // Analytics (solo admin/owner), NO billing.view (la recepción opera Caja).
  const denied = denyIfMissingPermission(ctx, "analytics.view");
  if (denied) return denied;
  const { clinicId } = ctx;

  const win = resolveWindow(new URL(req.url).searchParams);
  if ("error" in win) return NextResponse.json({ error: win.error }, { status: 400 });
  const { from, to } = win;

  try {
    const todayStart = startOfTodayMx(new Date());

    // Lote 1 — agregados (máx 6 promesas por Promise.all, regla del repo).
    const [ingresosAgg, efectivoAgg, ventas, citas, porCobrarAgg, vencidoAgg] = await Promise.all([
      // ingresos: pagos del periodo (paidAt), aislados vía invoice.clinicId.
      prisma.payment.aggregate({
        _sum:  { amount: true },
        where: { paidAt: { gte: from, lte: to }, invoice: { clinicId } },
      }),
      // efectivo: mismo criterio que caja.ts (method === "cash").
      prisma.payment.aggregate({
        _sum:  { amount: true },
        where: { method: CASH_METHOD, paidAt: { gte: from, lte: to }, invoice: { clinicId } },
      }),
      // ventas: facturas creadas en el periodo; el contrato solo pide excluir
      // canceladas (CANCELLED) — DRAFT sí cuenta como venta en curso.
      prisma.invoice.count({
        where: { clinicId, createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      }),
      // citas del periodo (startsAt) con status distinto de cancelada
      // (NO_SHOW sí cuenta: la cita existió).
      prisma.appointment.count({
        where: { clinicId, startsAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      }),
      // porCobrar: saldo pendiente GLOBAL de facturas abiertas (no limitado
      // al periodo). Mismo filtro que caja.ts: excluye DRAFT/CANCELLED.
      prisma.invoice.aggregate({
        _sum:  { balance: true },
        where: { clinicId, status: { notIn: ["DRAFT", "CANCELLED"] }, balance: { gt: 0 } },
      }),
      // vencido: subset con Invoice.dueDate < hoy MX y balance > 0 (mismo
      // criterio que overdueToday en caja.ts). Se usa dueDate y NO el status
      // OVERDUE porque nada garantiza que un job marque OVERDUE — la fecha de
      // vencimiento es la fuente de verdad.
      prisma.invoice.aggregate({
        _sum:  { balance: true },
        where: {
          clinicId,
          status:  { notIn: ["DRAFT", "CANCELLED"] },
          balance: { gt: 0 },
          dueDate: { lt: todayStart },
        },
      }),
    ]);

    // Lote 2 — filas del periodo para serie/porDoctor (se agrupan en JS; un
    // mes son cientos de filas). Los gastos toleran tabla faltante (P2021).
    const [paymentRows, invoiceRows, expenseRows] = await Promise.all([
      prisma.payment.findMany({
        where:  { paidAt: { gte: from, lte: to }, invoice: { clinicId } },
        select: { amount: true, paidAt: true },
      }),
      prisma.invoice.findMany({
        where:  { clinicId, createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
        select: { doctorId: true, total: true },
      }),
      prisma.expense
        .findMany({
          where:  { clinicId, date: { gte: from, lte: to } },
          select: { amount: true, date: true },
        })
        .catch((e: any): { amount: number; date: Date }[] => {
          if (isMissingTable(e)) return []; // sql/expenses.sql sin correr → gastos = 0
          throw e;
        }),
    ]);

    // serie: un punto POR DÍA del periodo (días sin datos = 0), hora MX,
    // orden cronológico (eachBucket ya lo garantiza).
    const ingresosPorDia: Record<string, number> = {};
    for (const p of paymentRows) {
      const k = bucketKeyOf(p.paidAt, "day");
      ingresosPorDia[k] = (ingresosPorDia[k] ?? 0) + (p.amount ?? 0);
    }
    const gastosPorDia: Record<string, number> = {};
    let gastosTotal = 0;
    for (const g of expenseRows) {
      const k = bucketKeyOf(g.date, "day");
      gastosPorDia[k] = (gastosPorDia[k] ?? 0) + (g.amount ?? 0);
      gastosTotal += g.amount ?? 0;
    }
    const serie = eachBucket(from, to, "day").map((fecha) => ({
      fecha,
      ingresos: money(ingresosPorDia[fecha] ?? 0),
      gastos:   money(gastosPorDia[fecha] ?? 0),
    }));

    // porDoctor: total facturado del periodo agrupado por Invoice.doctorId
    // (String suelto que apunta a User — /api/invoices lo valida con role
    // DOCTOR al crear; aquí solo se resuelve el nombre con un findMany).
    const SIN_DOCTOR = "__sin_doctor__";
    const totalPorDoctor: Record<string, number> = {};
    for (const inv of invoiceRows) {
      const key = inv.doctorId ?? SIN_DOCTOR;
      totalPorDoctor[key] = (totalPorDoctor[key] ?? 0) + (inv.total ?? 0);
    }
    const doctorIds = Object.keys(totalPorDoctor).filter((k) => k !== SIN_DOCTOR);
    const doctores = doctorIds.length
      ? await prisma.user.findMany({
          where:  { id: { in: doctorIds }, clinicId }, // multi-tenant: solo usuarios de la clínica
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nombrePorId: Record<string, string> = {};
    for (const d of doctores) nombrePorId[d.id] = fullName(d);
    const porDoctor = doctorIds.map((id) => ({
      doctorId: id,
      doctor:   nombrePorId[id] ?? "—",
      ingresos: money(totalPorDoctor[id] ?? 0),
    }));
    // doctorId null → "Sin doctor" SOLO si su suma > 0 (contrato).
    if ((totalPorDoctor[SIN_DOCTOR] ?? 0) > 0) {
      porDoctor.push({
        doctorId: "sin-doctor",
        doctor:   "Sin doctor",
        ingresos: money(totalPorDoctor[SIN_DOCTOR]),
      });
    }
    porDoctor.sort((a, b) => b.ingresos - a.ingresos);

    const ingresos = ingresosAgg._sum.amount ?? 0;

    return NextResponse.json({
      ingresos: money(ingresos),
      gastos:   money(gastosTotal),
      utilidad: money(ingresos - gastosTotal),
      ventas,
      citas,
      efectivo: money(efectivoAgg._sum.amount ?? 0),
      serie,
      porDoctor,
      saldos: {
        porCobrar: money(porCobrarAgg._sum.balance ?? 0),
        vencido:   money(vencidoAgg._sum.balance ?? 0),
      },
    });
  } catch (err: any) {
    console.error("[finanzas] GET error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al calcular el resumen de finanzas." }, { status: 500 });
  }
}
