import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  CASH_METHOD,
  computeReceivables,
  money,
  netRevenueSeries,
  refundPaymentWhere,
  revenuePaymentWhere,
} from "@/lib/caja";
import { bucketKeyOf, eachBucket } from "@/lib/analytics/query";
import { NOT_A_SALE_STATUSES, expenseWindowEnd, resolveFinanzasWindow, serieEnd } from "@/lib/finanzas-periodo";

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

  const win = resolveFinanzasWindow(new URL(req.url).searchParams);
  if ("error" in win) return NextResponse.json({ error: win.error }, { status: 400 });
  const { from, to } = win;
  // Los gastos de «este mes» llegan al FIN del mes, no a ahora: un gasto con
  // fecha futura (la renta del 30 registrada el 5) tiene que verse y restar.
  // Cobros, ventas y citas siguen cortando en `to` (ver finanzas-periodo.ts).
  const expenseTo = expenseWindowEnd(new URL(req.url).searchParams.get("period"), new Date(), to);

  try {

    // Cobros del periodo SIN reembolsos ni facturas canceladas
    // (revenuePaymentWhere, el mismo criterio que el home y la agenda). Ojo:
    // esto excluye la FILA del reembolso, no el pago original — el neto se
    // calcula abajo con netRevenueSeries.
    const revenueWhere = revenuePaymentWhere(clinicId, { gte: from, lte: to });

    // Lote 1 — agregados (máx 6 promesas por Promise.all, regla del repo).
    const [efectivoAgg, ventas, citas, saldos] = await Promise.all([
      // efectivo: mismo criterio que caja.ts (method === "cash").
      //
      // ⚠️ Es efectivo RECIBIDO (así se etiqueta en la UI) y va en BRUTO: el
      // reembolso no guarda con qué método salió el dinero (ver
      // sql/payment-refund-method.sql), así que restarle TODOS los reembolsos
      // descontaría también los que salieron por transferencia o tarjeta.
      prisma.payment.aggregate({
        _sum:  { amount: true },
        where: { ...revenueWhere, method: CASH_METHOD },
      }),
      // ventas: facturas EMITIDAS creadas en el periodo. Ni canceladas ni
      // borradores: un DRAFT (nace de «presupuesto → factura») aún no se
      // confirma, no se puede cobrar ni enviar — no es una venta. Mismo
      // criterio que porCobrar aquí abajo y que caja.ts.
      prisma.invoice.count({
        where: { clinicId, createdAt: { gte: from, lte: to }, status: { notIn: [...NOT_A_SALE_STATUSES] } },
      }),
      // citas del periodo (startsAt) con status distinto de cancelada
      // (NO_SHOW sí cuenta: la cita existió).
      prisma.appointment.count({
        where: { clinicId, startsAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      }),
      // porCobrar / vencido: los saldos GLOBALES de la clínica (no limitados
      // al periodo), de `computeReceivables` — la MISMA función que pinta Caja.
      // Antes aquí «vencido» era el saldo entero de toda factura con `dueDate`
      // pasada, y una factura a plazos con una mensualidad atrasada no contaba.
      computeReceivables(clinicId),
    ]);

    // Lote 2 — filas del periodo para serie/porDoctor (se agrupan en JS; un
    // mes son cientos de filas). Los gastos toleran tabla faltante (P2021).
    const [paymentRows, refundRows, invoiceRows, expenseRows] = await Promise.all([
      // El KPI de ingresos y la serie diaria salen de ESTAS MISMAS filas, así
      // que la suma de la serie es el KPI por construcción, no por casualidad.
      prisma.payment.findMany({
        where:  revenueWhere,
        select: { amount: true, paidAt: true },
      }),
      // Reembolsos del periodo (espejo exacto de revenueWhere): lo devuelto se
      // RESTA. Sin esto, un cobro de $10,000 reembolsado completo dentro del
      // mismo mes seguía reportando $10,000 de ingresos y de utilidad.
      prisma.payment.findMany({
        where:  refundPaymentWhere(clinicId, { gte: from, lte: to }),
        select: { amount: true, paidAt: true },
      }),
      // Misma población que `ventas`: sin borradores ni canceladas.
      prisma.invoice.findMany({
        where:  { clinicId, createdAt: { gte: from, lte: to }, status: { notIn: [...NOT_A_SALE_STATUSES] } },
        select: { doctorId: true, total: true },
      }),
      prisma.expense
        .findMany({
          where:  { clinicId, date: { gte: from, lte: expenseTo } },
          select: { amount: true, date: true },
        })
        .catch((e: any): { amount: number; date: Date }[] => {
          if (isMissingTable(e)) return []; // sql/expenses.sql sin correr → gastos = 0
          throw e;
        }),
    ]);

    // Ingresos NETOS del periodo (cobros − reembolsos) y su reparto por día.
    // El reembolso resta en el día en que se devolvió el dinero.
    const neto = netRevenueSeries(paymentRows, refundRows, (d) => bucketKeyOf(d, "day"));

    // serie: un punto POR DÍA del periodo (días sin datos = 0), hora MX,
    // orden cronológico (eachBucket ya lo garantiza).
    const gastosPorDia: Record<string, number> = {};
    let gastosTotal = 0;
    for (const g of expenseRows) {
      const k = bucketKeyOf(g.date, "day");
      gastosPorDia[k] = (gastosPorDia[k] ?? 0) + (g.amount ?? 0);
      gastosTotal += g.amount ?? 0;
    }
    // La serie llega hasta `to`, o hasta el último gasto futuro si lo hay: así
    // la suma de serie[].gastos sigue siendo el KPI. Sin gastos futuros es la
    // misma serie de siempre.
    const serieTo = serieEnd(to, expenseRows.map((g) => g.date));
    const serie = eachBucket(from, serieTo, "day").map((fecha) => ({
      fecha,
      ingresos: money(neto.porBucket[fecha] ?? 0),
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

    const ingresos = neto.ingresos;

    return NextResponse.json({
      ingresos: money(ingresos),
      // Lo devuelto en el periodo, ya restado de `ingresos`. Clave ADITIVA (el
      // contrato no se renombra): la UI puede mostrarlo sin otra consulta y el
      // dueño ve de dónde salió la caída del número.
      reembolsos: money(neto.reembolsos),
      gastos:   money(gastosTotal),
      utilidad: money(ingresos - gastosTotal),
      ventas,
      citas,
      efectivo: money(efectivoAgg._sum.amount ?? 0),
      serie,
      porDoctor,
      saldos: {
        porCobrar: money(saldos.porCobrar),
        vencido:   money(saldos.vencido),
        // true solo si la clínica pasa de 100 000 facturas abiertas: las dos
        // cifras son un mínimo y la pantalla lo dice (no se corta en silencio).
        incompleto: saldos.incompleto,
      },
    });
  } catch (err: any) {
    console.error("[finanzas] GET error:", err?.message ?? err);
    return NextResponse.json({ error: "Error al calcular el resumen de finanzas." }, { status: 500 });
  }
}
