import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage, CFDI_DEFAULT_TZ, type CfdiOverage } from "@/lib/cfdi-quota";
import {
  resolveOverageBilling,
  chargeOverageOffSession,
  addOverageInvoiceItem,
  CFDI_OVERAGE_METHOD,
} from "@/lib/cfdi-overage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/cfdi-overage  — Vercel Cron "0 7 1 * *" (07:00 UTC el día 1).
 *
 * Cierra los periodos CFDI ya vencidos y sin cobrar: por cada clínica con
 * excedente calcula (stamped − incluidas) × cfdiOverageCents del plan vigente y
 * lo cobra según su modo de pago:
 *   - mensual + suscripción Stripe → InvoiceItem (se suma a su próxima mensualidad),
 *   - anual + tarjeta guardada     → cobro off-session directo el día 1,
 *   - sin método automático        → adeudo manual (SubscriptionInvoice pending).
 *
 * Idempotente: procesa solo filas con billedAt=null y marca billedAt al cerrar,
 * así que re-correr el cron NO cobra doble; además los cobros a Stripe llevan
 * idempotencyKey estable (clínica+periodo). Errores aislados por clínica.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/cfdi-overage] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Periodo en curso en horario de México (el cron corre 07:00 UTC día 1 = 01:00
  // MX día 1). Se cierran TODOS los periodos ANTERIORES sin cobrar (catch-up si
  // alguna corrida se saltó). "YYYY-MM" comparado como texto = orden cronológico.
  const currentPeriod = cfdiPeriodFor(now, CFDI_DEFAULT_TZ);

  let scanned = 0, noOverage = 0, invoiceItems = 0, charged = 0, chargeFailed = 0;
  let manual = 0, errors = 0;

  const pendingRows = await prisma.cfdiUsage.findMany({
    where: { billedAt: null, period: { lt: currentPeriod }, stamped: { gt: 0 } },
    select: { id: true, clinicId: true, period: true, stamped: true },
  });

  for (const row of pendingRows) {
    scanned++;
    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id: row.clinicId },
        select: {
          name: true,
          plan: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
          stripePaymentMethodId: true,
        },
      });
      if (!clinic) {
        await closePeriod(row.id, "none", 0, null);
        noOverage++;
        continue;
      }

      const plan = await getResolvedPlan(clinic.plan);
      const q = cfdiOverage(row.stamped, plan.cfdiMonthly, plan.cfdiOverageCents);

      if (q.overage <= 0 || q.overageTotalCents <= 0) {
        await closePeriod(row.id, "none", 0, null);
        noOverage++;
        continue;
      }

      const billing = await resolveOverageBilling(clinic);

      // (a) Mensual con suscripción → sumar a la próxima mensualidad.
      if (billing.mode === "monthly_sub" && billing.customerId) {
        const r = await addOverageInvoiceItem({
          clinicId: row.clinicId,
          customerId: billing.customerId,
          amountCents: q.overageTotalCents,
          period: row.period,
          overage: q.overage,
        });
        if (r.ok) {
          await closePeriod(row.id, "invoice_item", q.overageTotalCents, r.invoiceItemId);
          invoiceItems++;
        } else {
          await recordManualDebt(row, q, "pending", r.invoiceItemId);
          manual++;
        }
        continue;
      }

      // (b) Anual con tarjeta → cobro off-session directo.
      if (billing.mode === "annual_card" && billing.customerId && billing.paymentMethodId) {
        const r = await chargeOverageOffSession({
          clinicId: row.clinicId,
          customerId: billing.customerId,
          paymentMethodId: billing.paymentMethodId,
          amountCents: q.overageTotalCents,
          period: row.period,
        });
        if (r.status === "succeeded") {
          await closePeriod(row.id, "charged", q.overageTotalCents, r.paymentIntentId);
          charged++;
        } else {
          // Tarjeta rechazada → adeudo manual visible (no se pierde el excedente).
          await recordManualDebt(row, q, "failed", r.paymentIntentId);
          chargeFailed++;
        }
        continue;
      }

      // (c) Sin método automático (SPEI/pago único) o sin customer/tarjeta útil.
      await recordManualDebt(row, q, "pending", null);
      manual++;
    } catch (e) {
      errors++;
      console.error(`[cron/cfdi-overage] error en clínica ${row.clinicId} (${row.period}):`, e);
    }
  }

  return NextResponse.json({
    ok: true,
    currentPeriod,
    scanned,
    noOverage,
    invoiceItems,
    charged,
    chargeFailed,
    manual,
    errors,
    timestamp: now.toISOString(),
  });
}

/** Cierra el periodo (marca billedAt) con el estado dado. Idempotente por billedAt. */
async function closePeriod(
  id: string,
  billingStatus: string,
  overageCents: number,
  stripeRef: string | null,
): Promise<void> {
  await prisma.cfdiUsage.update({
    where: { id },
    data: {
      billingStatus,
      overageCents,
      stripeRef: stripeRef ?? undefined,
      billedAt: new Date(),
    },
  });
}

/**
 * Registra el excedente como ADEUDO manual en el ledger existente
 * (SubscriptionInvoice, method=cfdi_overage → no lo mal-activa el admin) y cierra
 * el periodo. Gana la carrera con updateMany(billedAt:null) para no duplicar el
 * adeudo si dos corridas coinciden.
 */
async function recordManualDebt(
  row: { id: string; clinicId: string; period: string },
  q: CfdiOverage,
  status: "pending" | "failed",
  stripeRef: string | null,
): Promise<void> {
  const won = await prisma.cfdiUsage.updateMany({
    where: { id: row.id, billedAt: null },
    data: {
      billingStatus: status,
      overageCents: q.overageTotalCents,
      stripeRef: stripeRef ?? undefined,
      billedAt: new Date(),
    },
  });
  if (won.count === 0) return; // otra corrida ya cerró este periodo.

  const [y, m] = row.period.split("-").map(Number);
  const periodStart = new Date(Date.UTC(y, m - 1, 1));
  const periodEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  const amountPesos = q.overageTotalCents / 100;

  await prisma.subscriptionInvoice.create({
    data: {
      clinicId: row.clinicId,
      amount: amountPesos,
      currency: "MXN",
      status: "pending",
      method: CFDI_OVERAGE_METHOD,
      reference: stripeRef ?? undefined,
      periodStart,
      periodEnd,
      notes: `Facturas CFDI adicionales ${row.period}: ${q.overage} × $${(q.overageCents / 100).toFixed(2)} = $${amountPesos.toFixed(2)} MXN`,
    },
  });
}
