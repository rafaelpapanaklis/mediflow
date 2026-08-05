import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isStripeConfigured, STRIPE_SETUP_INSTRUCTIONS } from "@/lib/stripe";
import { stripClinicSecrets } from "@/lib/clinic-secrets";
import { formatWhatsappDisplay, type AccountManagerDTO } from "@/lib/account-manager/types";
import { getLiveSubscriptionSnapshot, type StripeLivePaymentMethod } from "@/lib/admin/stripe-payment-method";
import { getResolvedPlan } from "@/lib/plans";
import type { ClinicRecurringCharge } from "@/components/admin/clinic-payment-method-card";
import { AdminClinicDetailClient, type PlatformPayments } from "./clinic-detail-client";

export const metadata: Metadata = { title: "Detalle Clínica — Admin DaleControl" };

export default async function AdminClinicDetailPage({ params }: { params: { id: string } }) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: params.id },
    include: {
      users:        { select: { id: true, supabaseId: true, firstName: true, lastName: true, email: true, phone: true, role: true, createdAt: true, isActive: true } },
      _count:       { select: { patients: true, appointments: true, invoices: true, records: true, users: true, files: true } },
      schedules:    true,
      clinicModules: {
        select: {
          status:           true,
          paymentMethod:    true,
          activatedAt:      true,
          cancelledAt:      true,
          currentPeriodEnd: true,
          module:           { select: { key: true } },
        },
      },
    },
  });

  if (!clinic) notFound();

  // Manager de cuenta asignado. Query APARTE y en try/catch: si
  // sql/account-managers.sql todavía no está aplicado, la ficha de la clínica
  // se sigue viendo entera y el bloque cae al estado "sin manager".
  let accountManager: AccountManagerDTO | null = null;
  try {
    const withManager = await prisma.clinic.findUnique({
      where: { id: params.id },
      select: {
        accountManager: {
          select: {
            id: true, name: true, photoUrl: true, whatsappE164: true, whatsappDisplay: true,
            days: true, startMinutes: true, endMinutes: true, timezone: true, status: true,
          },
        },
      },
    });
    const m = withManager?.accountManager;
    if (m) {
      accountManager = {
        ...m,
        photoUrl: m.photoUrl ?? null,
        whatsappDisplay: m.whatsappDisplay || formatWhatsappDisplay(m.whatsappE164),
      };
    }
  } catch (e) {
    console.warn("[admin/clinics/:id] manager de cuenta no disponible:", e);
  }

  // Para la modal de eliminar — total de clínicas para decidir si está permitido.
  const totalClinics = await prisma.clinic.count();

  const recentActivity = await prisma.medicalRecord.findMany({
    where:   { clinicId: params.id },
    orderBy: { createdAt: "desc" },
    take:    5,
    include: { doctor: { select: { firstName: true, lastName: true } } },
  });

  // OJO: esto es prisma.invoice = lo que la clínica le factura A SUS PACIENTES.
  // No es lo que la clínica nos paga a nosotros (eso vive en
  // subscription_invoices, más abajo).
  const revenueStats = await prisma.invoice.aggregate({
    where: { clinicId: params.id, status: { in: ["PAID", "PARTIAL"] } },
    _sum:  { paid: true },
    _count: { id: true },
  });

  // Lo que ESTA clínica nos ha pagado a nosotros por su suscripción. En
  // try/catch para que un problema con subscription_invoices no tire la ficha.
  let platformPayments: PlatformPayments = {
    total: 0, count: 0, lastPaidAt: null, lastAmount: null, lastMethod: null,
  };
  try {
    const [agg, last] = await Promise.all([
      prisma.subscriptionInvoice.aggregate({
        where:  { clinicId: params.id, status: "paid" },
        _sum:   { amount: true },
        _count: { id: true },
      }),
      // paidAt puede venir null en filas viejas y en Postgres un ORDER BY DESC
      // las pondría primero: filtrarlas es lo que hace que "último pago" sea el
      // último de verdad.
      prisma.subscriptionInvoice.findFirst({
        where:   { clinicId: params.id, status: "paid", paidAt: { not: null } },
        orderBy: { paidAt: "desc" },
        select:  { paidAt: true, amount: true, method: true },
      }),
    ]);
    platformPayments = {
      total:      agg._sum.amount ?? 0,
      count:      agg._count.id,
      lastPaidAt: last?.paidAt ? last.paidAt.toISOString() : null,
      lastAmount: last?.amount ?? null,
      lastMethod: last?.method ?? null,
    };
  } catch (e) {
    console.warn("[admin/clinics/:id] pagos de suscripción no disponibles:", e);
  }

  // Método de pago e importe VIGENTES en Stripe (solo lectura, una sola
  // consulta). El campo del alta (paymentMethodCollected) no se actualiza nunca,
  // así que no sirve para saber qué tarjeta se va a cobrar.
  // getLiveSubscriptionSnapshot nunca lanza.
  const stripeSnapshot = clinic.stripeCustomerId
    ? await getLiveSubscriptionSnapshot({
        stripeCustomerId:     clinic.stripeCustomerId,
        stripeSubscriptionId: clinic.stripeSubscriptionId ?? null,
      })
    : null;
  const livePaymentMethod: StripeLivePaymentMethod | null = stripeSnapshot?.paymentMethod ?? null;

  // Contraste contra el precio de lista del plan (plan_configs, fuente única).
  // Sólo se compara cuando el ciclo es de 1 mes o 1 año: para "cada 3 meses" no
  // hay precio de plan equivalente y se informa el importe sin juzgarlo.
  let recurringCharge: ClinicRecurringCharge | null = null;
  if (stripeSnapshot?.recurring) {
    const r = stripeSnapshot.recurring;
    const plan = await getResolvedPlan(clinic.plan);
    recurringCharge = {
      amountMxn:     r.amountMxn,
      currency:      r.currency,
      interval:      r.interval,
      intervalCount: r.intervalCount,
      planAmountMxn: r.intervalCount === 1
        ? (r.interval === "year" ? plan.priceMxnAnnual : plan.priceMxnMonthly)
        : null,
      planLabel:     plan.label,
    };
  }

  // Catálogo de módulos del marketplace para el tab "Módulos". Filtramos
  // por isActive=true y category="Dental" (los 6 dentales del seed).
  const moduleCatalog = await prisma.module.findMany({
    where:   { isActive: true, category: "Dental" },
    orderBy: { sortOrder: "asc" },
    select:  {
      id:              true,
      key:             true,
      name:            true,
      description:     true,
      iconKey:         true,
      iconBg:          true,
      iconColor:       true,
      priceMxnMonthly: true,
    },
  });

  const clinicModuleRows = clinic.clinicModules.map((cm) => ({
    moduleKey:        cm.module.key,
    status:           cm.status,
    paymentMethod:    cm.paymentMethod,
    activatedAt:      cm.activatedAt.toISOString(),
    cancelledAt:      cm.cancelledAt ? cm.cancelledAt.toISOString() : null,
    currentPeriodEnd: cm.currentPeriodEnd.toISOString(),
  }));

  return (
    <AdminClinicDetailClient
      clinic={stripClinicSecrets(clinic) as any}
      recentActivity={recentActivity as any}
      totalRevenue={revenueStats._sum.paid ?? 0}
      totalInvoices={revenueStats._count.id}
      stripeConfigured={isStripeConfigured()}
      stripeInstructions={STRIPE_SETUP_INSTRUCTIONS}
      totalClinicsInSystem={totalClinics}
      moduleCatalog={moduleCatalog}
      clinicModuleRows={clinicModuleRows}
      accountManager={accountManager}
      livePaymentMethod={livePaymentMethod}
      recurringCharge={recurringCharge}
      platformPayments={platformPayments}
    />
  );
}
