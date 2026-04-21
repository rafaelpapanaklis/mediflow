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
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <div
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.35)",
            borderRadius: 12,
            padding: 22,
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--danger)", margin: 0, marginBottom: 10 }}>
            Error al cargar /admin/payments
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 14 }}>
            {err?.message ?? "Error desconocido"}
          </p>
          {String(err?.message ?? "").match(/column|relation|does not exist/i) && (
            <div
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 14,
                fontSize: 12,
                color: "var(--text-2)",
              }}
            >
              <p style={{ fontWeight: 600, margin: 0, marginBottom: 6 }}>
                La base de datos necesita migraciones pendientes.
              </p>
              <p style={{ color: "var(--text-3)", margin: 0, marginBottom: 8 }}>
                Aplica estos SQL en Supabase → SQL Editor (en orden):
              </p>
              <ul className="mono" style={{ fontSize: 11, color: "#c4b5fd", paddingLeft: 18, margin: 0 }}>
                <li>sql/admin-notes.sql</li>
                <li>sql/admin-announcements.sql</li>
                <li>sql/coupons.sql</li>
              </ul>
            </div>
          )}
          <Link
            href="/admin"
            style={{ display: "inline-block", marginTop: 14, fontSize: 12, fontWeight: 600, color: "#c4b5fd", textDecoration: "none" }}
          >
            ← Volver al dashboard
          </Link>
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
