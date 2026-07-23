import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";
import { resolveOverageBilling, CFDI_OVERAGE_METHOD } from "@/lib/cfdi-overage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cfdi/usage
 *
 * Consumo de facturas CFDI del mes en curso de la clínica de la sesión, para la
 * card "Facturación CFDI" del panel (Configuración → Suscripción). Admin de la
 * clínica. Aísla por clinicId de la sesión (nunca del cliente).
 */
export async function GET(_req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const clinicId = ctx!.clinicId;
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      plan: true,
      timezone: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      stripePaymentMethodId: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const period = cfdiPeriodFor(new Date(), clinic.timezone);

  const [usage, plan, debtRows] = await Promise.all([
    prisma.cfdiUsage.findUnique({
      where: { clinicId_period: { clinicId, period } },
      select: { stamped: true },
    }),
    getResolvedPlan(clinic.plan),
    // Adeudos por excedente de meses previos sin pagar (SPEI/sin método/cobro
    // fallido) — mismo ledger SubscriptionInvoice con método propio.
    prisma.subscriptionInvoice.findMany({
      where: { clinicId, status: "pending", method: CFDI_OVERAGE_METHOD },
      select: { amount: true },
    }),
  ]);

  const q = cfdiOverage(usage?.stamped ?? 0, plan.cfdiMonthly, plan.cfdiOverageCents);
  const debtCents = Math.round(debtRows.reduce((sum, r) => sum + (r.amount ?? 0), 0) * 100);

  // Cómo se cobrará el excedente (para el copy de la card). Solo consulta Stripe
  // cuando SÍ hay excedente — evita un round-trip en cada carga de la pestaña
  // para las clínicas dentro de cupo (la mayoría).
  const billing = q.overage > 0 ? await resolveOverageBilling(clinic) : null;

  return NextResponse.json({
    period,
    used: q.used,
    included: q.included,
    remaining: Math.max(0, q.included - q.used),
    overage: q.overage,
    overagePriceCents: q.overageCents,
    overageProjectionCents: q.overageTotalCents,
    debtCents,
    debtCount: debtRows.length,
    billingMode: billing?.mode ?? "manual",
  });
}
