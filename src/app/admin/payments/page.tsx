export const dynamic = "force-dynamic";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAdminMrr, mrrBreakdownHint, EMPTY_MRR } from "@/lib/admin/mrr";
import { comparePaymentDateDesc } from "@/lib/admin/payment-date";
import { isInTrial, isPlanExpired } from "@/lib/plan-status";
import { PaymentsClient } from "./payments-client";

/** Tope de la pestaña "Todos los pagos". */
const RECENT_PAYMENTS_LIMIT = 100;

/** Lo mínimo para clasificar el plan de una clínica con plan-status. */
type PlanRow = {
  id: string;
  name: string;
  plan: string;
  email: string | null;
  trialEndsAt: Date;
  subscriptionStatus: string | null;
};

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
              <ul className="mono" style={{ fontSize: 11, color: "var(--brand)", paddingLeft: 18, margin: 0 }}>
                <li>sql/admin-notes.sql</li>
                <li>sql/admin-announcements.sql</li>
                <li>sql/coupons.sql</li>
              </ul>
            </div>
          )}
          <Link
            href="/admin"
            style={{ display: "inline-block", marginTop: 14, fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}
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
  //
  // Los pagos se piden en DOS tandas porque la lista se ordena por la misma
  // fecha que se pinta (paidAt ?? createdAt) y Prisma no sabe ordenar por un
  // COALESCE. Cada tanda trae su tope ya ordenada por SU fecha, así que la
  // unión contiene con certeza los `RECENT_PAYMENTS_LIMIT` más recientes de
  // verdad: si una fila entra en el top real, ningún otro registro de su propia
  // tanda la desplaza. Ordenar sólo en JS sobre "los 100 últimos por createdAt"
  // dejaría fuera un cobro viejo verificado hoy.
  const [totalClinics, activeClinics, planRows, paidPayments, unpaidPayments, pendingTransfers] =
    await Promise.all([
      safe(prisma.clinic.count(), 0),
      safe(prisma.clinic.count({ where: { subscriptionStatus: "active" } }), 0),
      // Estado de plan de TODAS las clínicas con la MISMA regla que el gate
      // (src/lib/plan-status.ts). Antes eran tres `where` escritos a ojo
      // (`trialEndsAt < now` + `not: "active"`) que no coincidían con
      // isPlanExpired: "trialing"/"paid" salían como vencidas y una cancelada
      // con periodo por delante también.
      safe(prisma.clinic.findMany({
        select: { id: true, name: true, plan: true, email: true, trialEndsAt: true, subscriptionStatus: true },
      }) as Promise<PlanRow[]>, [] as PlanRow[]),
      safe(prisma.subscriptionInvoice.findMany({
        where: { paidAt: { not: null } },
        orderBy: { paidAt: "desc" },
        take: RECENT_PAYMENTS_LIMIT,
        include: { clinic: { select: { id: true, name: true, plan: true } } },
      }), [] as any[]),
      // Sin paidAt (pendientes/fallidos): ahí createdAt SÍ es su fecha real.
      safe(prisma.subscriptionInvoice.findMany({
        where: { paidAt: null },
        orderBy: { createdAt: "desc" },
        take: RECENT_PAYMENTS_LIMIT,
        include: { clinic: { select: { id: true, name: true, plan: true } } },
      }), [] as any[]),
      safe(prisma.subscriptionInvoice.findMany({
        where: { status: "pending" },
        include: { clinic: { select: { id: true, name: true, plan: true, email: true } } },
        orderBy: { createdAt: "desc" },
      }), [] as any[]),
    ]);

  const recentPayments = paidPayments
    .concat(unpaidPayments)
    .sort(comparePaymentDateDesc)
    .slice(0, RECENT_PAYMENTS_LIMIT);

  // Trial/cortesía vigente y VENCIDAS de verdad (las que el gate bloquea hoy),
  // la vencida más reciente arriba.
  const trialClinics   = planRows.filter((c) => isInTrial(c, now)).length;
  const expiredRows    = planRows.filter((c) => isPlanExpired(c, now));
  const expiredClinics = expiredRows.length;
  const overdueClinics = expiredRows
    .slice()
    .sort((a, b) => new Date(b.trialEndsAt).getTime() - new Date(a.trialEndsAt).getTime())
    .slice(0, 50);

  const [thisMonthRev, prevMonthRev] =
    await Promise.all([
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

  // MRR compartido con /admin. Antes esta página sumaba Clinic.monthlyPrice,
  // columna que sólo escribe /api/admin/billing: las clínicas que pagan por
  // Stripe Checkout la tienen en 0 y el KPI marcaba $0 con 5 clínicas activas.
  const mrr = await safe(getAdminMrr(), EMPTY_MRR);

  const clinics = await safe(
    prisma.clinic.findMany({
      select: { id: true, name: true, plan: true, email: true, monthlyPrice: true },
      orderBy: { name: "asc" },
    }),
    [] as any[],
  );

  // Prisma tipa `_sum` como `... | null` (puede venir null si 0 filas matchean
  // el where); usamos optional chaining para no explotar con "cannot read
  // properties of null". Number() fuerza a primitivo JS por si algún Float
  // llegara como Decimal del driver.
  const thisMonth = Number(thisMonthRev?._sum?.amount ?? 0);
  const prevMonth = Number(prevMonthRev?._sum?.amount ?? 0);
  const thisMonthPayments = Number(thisMonthRev?._count ?? 0);

  // Sanitizamos los arrays a plain objects antes de pasarlos al client
  // component. Evita que cualquier Decimal/class-instance/valor no serializable
  // reviente el Flight boundary (error no atrapable por el try/catch de arriba
  // porque ocurre durante el render de React, después del return).
  const serialized = JSON.parse(JSON.stringify({
    recentPayments, pendingTransfers, overdueClinics, clinics,
  }));

  return (
    <PaymentsClient
      metrics={{
        totalClinics,
        activeClinics,
        trialClinics,
        expiredClinics,
        currentMRR: mrr.total,
        mrrBreakdown: mrrBreakdownHint(mrr),
        thisMonthRevenue: thisMonth,
        thisMonthPayments,
        prevMonthRevenue: prevMonth,
        revenueChange:
          prevMonth > 0
            ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100)
            : 0,
      }}
      recentPayments={serialized.recentPayments}
      pendingTransfers={serialized.pendingTransfers}
      overdueClinics={serialized.overdueClinics}
      clinics={serialized.clinics}
    />
  );
}
