export const dynamic = "force-dynamic";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PaymentsClient } from "./payments-client";

// Helpers que no fallan: si la query truena por (p. ej.) una tabla que no
// existe todavía o un campo null raro, devolvemos valores seguros para que
// la página no crashée en producción.
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; }
  catch (e) {
    console.error("[admin/payments] query failed:", e);
    return fallback;
  }
}

export default async function PaymentsPage() {
  try {
    return await renderPaymentsPage();
  } catch (err: any) {
    console.error("[admin/payments] render failed:", err);
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-red-950/50 border border-red-800 rounded-2xl p-6">
          <h1 className="text-xl font-bold text-red-400 mb-3">Error al cargar /admin/payments</h1>
          <p className="text-sm text-red-300 mb-4">{err?.message ?? "Error desconocido"}</p>
          {String(err?.message ?? "").match(/column|relation|does not exist/i) && (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-slate-300 space-y-2">
              <p className="font-bold">La base de datos necesita migraciones pendientes.</p>
              <p className="text-slate-400">Aplica estos SQL en Supabase → SQL Editor (en orden):</p>
              <ul className="list-disc list-inside text-xs font-mono text-brand-400">
                <li>sql/admin-notes.sql</li>
                <li>sql/admin-announcements.sql</li>
                <li>sql/coupons.sql</li>
              </ul>
            </div>
          )}
          <Link href="/admin" className="inline-block mt-4 text-xs font-bold text-brand-400 hover:underline">← Volver al dashboard</Link>
        </div>
      </div>
    );
  }
}

async function renderPaymentsPage() {
  const now = new Date();
  const firstOfMonth      = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfPrevMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfPrevMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  // Ejecutamos todas las queries en paralelo pero cada una con fallback
  // seguro para que un fallo individual no tire toda la página.
  const [totalClinics, activeClinics, trialClinics, recentPayments, pendingTransfers] =
    await Promise.all([
      safe(prisma.clinic.count(), 0),
      safe(prisma.clinic.count({ where: { subscriptionStatus: "active" } }), 0),
      // Antes: { in: ["trialing", null as any] } — Prisma no matchea NULL dentro
      // de IN y en algunas versiones lanza error. Usamos OR explícito.
      safe(prisma.clinic.count({
        where: {
          AND: [
            { OR: [{ subscriptionStatus: "trialing" }, { subscriptionStatus: null }] },
            { trialEndsAt: { gt: now } },
          ],
        },
      }), 0),
      safe(prisma.subscriptionInvoice.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { clinic: { select: { id: true, name: true, plan: true } } },
      }), [] as any[]),
      safe(prisma.subscriptionInvoice.findMany({
        where: { status: "pending" },
        include: { clinic: { select: { id: true, name: true, plan: true, email: true } } },
        orderBy: { createdAt: "desc" },
      }), [] as any[]),
    ]);

  const [expiredClinics, overdueClinics, thisMonthRev, prevMonthRev] =
    await Promise.all([
      safe(prisma.clinic.count({
        where: {
          OR: [
            { subscriptionStatus: "cancelled" },
            { trialEndsAt: { lt: now }, subscriptionStatus: { not: "active" } },
          ],
        },
      }), 0),
      safe(prisma.clinic.findMany({
        where: { subscriptionStatus: { not: "active" }, trialEndsAt: { lt: now } },
        select: { id: true, name: true, plan: true, email: true, trialEndsAt: true },
        orderBy: { trialEndsAt: "desc" },
        take: 50,
      }), [] as any[]),
      safe(prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", paidAt: { gte: firstOfMonth } },
        _sum: { amount: true },
        _count: true,
      }), { _sum: { amount: 0 }, _count: 0 } as any),
      safe(prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", paidAt: { gte: firstOfPrevMonth, lte: lastOfPrevMonth } },
        _sum: { amount: true },
      }), { _sum: { amount: 0 } } as any),
    ]);

  const mrrResult = await safe(
    prisma.clinic.aggregate({
      where: { subscriptionStatus: "active" },
      _sum: { monthlyPrice: true },
    }),
    { _sum: { monthlyPrice: 0 } } as any,
  );

  const clinics = await safe(
    prisma.clinic.findMany({
      select: { id: true, name: true, plan: true, email: true, monthlyPrice: true },
      orderBy: { name: "asc" },
    }),
    [] as any[],
  );

  const thisMonth = thisMonthRev._sum.amount ?? 0;
  const prevMonth = prevMonthRev._sum.amount ?? 0;

  return (
    <PaymentsClient
      metrics={{
        totalClinics,
        activeClinics,
        trialClinics,
        expiredClinics,
        currentMRR: mrrResult._sum.monthlyPrice ?? 0,
        thisMonthRevenue: thisMonth,
        thisMonthPayments: thisMonthRev._count ?? 0,
        prevMonthRevenue: prevMonth,
        revenueChange:
          prevMonth > 0
            ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100)
            : 0,
      }}
      recentPayments={recentPayments as any}
      pendingTransfers={pendingTransfers as any}
      overdueClinics={overdueClinics as any}
      clinics={clinics as any}
    />
  );
}
