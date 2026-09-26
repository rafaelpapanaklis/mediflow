import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isStripeConfigured, STRIPE_SETUP_INSTRUCTIONS } from "@/lib/stripe";
import { stripClinicSecrets } from "@/lib/clinic-secrets";
import { formatWhatsappDisplay, type AccountManagerDTO } from "@/lib/account-manager/types";
import { getLiveSubscriptionSnapshot, type StripeLivePaymentMethod } from "@/lib/admin/stripe-payment-method";
import { getResolvedPlan, getResolvedPlanForClinic } from "@/lib/plans";
import { activeOverrides } from "@/lib/billing/plan-overrides";
import { loadPlanPrices } from "@/lib/admin/mrr";
import { DIAS_VENTANA_ACTIVIDAD, MINUTOS_EN_LINEA, SUPERFICIE_PANEL } from "@/lib/admin/salud-clinica";
import { inicioDeHaceDias } from "@/lib/admin/zona-horaria";
import { leerSaldoIaClinica, type SaldoIaClinicaDTO } from "@/lib/admin/saldo-ia-clinica";
import type { ClinicRecurringCharge } from "@/components/admin/clinic-payment-method-card";
import { AdminClinicDetailClient, type PlatformPayments } from "./clinic-detail-client";
import type { PlanOverridesDTO } from "./plan-overrides-card";

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

  // ── Actividad de la clínica, para el cálculo de salud ──────────────────
  // Agregados, NINGUNO por fila. "Última cita" mira solo citas ya pasadas (una
  // agendada para dentro de un mes haría parecer viva a una clínica apagada);
  // el resto mide CUÁNTO trabaja: citas, facturas y notas de la ventana y de
  // la ventana anterior, para la tendencia.
  //
  // Las ventanas cortan en la MEDIANOCHE DE MÉRIDA (@/lib/admin/zona-horaria),
  // no en la del servidor.
  const ahora = new Date();
  const desdeVentana = inicioDeHaceDias(DIAS_VENTANA_ACTIVIDAD, ahora);
  const desdePrevia  = inicioDeHaceDias(DIAS_VENTANA_ACTIVIDAD * 2, ahora);
  const desdeEnLinea = new Date(ahora.getTime() - MINUTOS_EN_LINEA * 60_000);

  const [citasPasadas, citasVentana, citasPrevias, citasFuturas, sesionPanel] = await Promise.all([
    prisma.appointment.aggregate({
      where: { clinicId: params.id, startsAt: { lte: ahora } },
      _count: { _all: true },
      _max:   { startsAt: true },
    }),
    prisma.appointment.count({
      where: { clinicId: params.id, startsAt: { gte: desdeVentana, lte: ahora } },
    }),
    prisma.appointment.count({
      where: { clinicId: params.id, startsAt: { gte: desdePrevia, lt: desdeVentana } },
    }),
    prisma.appointment.aggregate({
      where: { clinicId: params.id, startsAt: { gt: ahora } },
      _count: { _all: true },
      _min:   { startsAt: true },
    }),
    // ⛔ NO User.lastLogin: está vacío en las 36 filas de producción. La fuente
    // de "alguien está trabajando en el panel" es analytics_sessions con
    // surface="dashboard" (surface="public" son visitas a la web, no trabajo).
    prisma.analyticsSession.aggregate({
      where: { clinicId: params.id, surface: SUPERFICIE_PANEL },
      _max:  { lastSeenAt: true },
    }),
  ]);

  const [facturasVentana, facturasPrevias, notasVentana, notasPrevias] = await Promise.all([
    prisma.invoice.count({ where: { clinicId: params.id, createdAt: { gte: desdeVentana } } }),
    prisma.invoice.count({ where: { clinicId: params.id, createdAt: { gte: desdePrevia, lt: desdeVentana } } }),
    prisma.medicalRecord.count({ where: { clinicId: params.id, createdAt: { gte: desdeVentana } } }),
    prisma.medicalRecord.count({ where: { clinicId: params.id, createdAt: { gte: desdePrevia, lt: desdeVentana } } }),
  ]);

  const ultimoAccesoAt = sesionPanel._max.lastSeenAt ?? null;

  // Precios de lista desde plan_configs (fuente única). El selector de plan de
  // la ficha los pintaba desde la tabla de fallback del código.
  const planPrices = await loadPlanPrices();

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

  // Saldo de IA de la clínica (ai_wallets + ai_wallet_transactions + SPEI en
  // revisión), de lectura. En try/catch: si algo falla, la ficha se sigue
  // viendo entera y el bloque lo dice.
  let saldoIa: SaldoIaClinicaDTO | null = null;
  try {
    saldoIa = await leerSaldoIaClinica(params.id);
  } catch (e) {
    console.warn("[admin/clinics/:id] saldo de IA no disponible:", e);
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
    // Con las condiciones conservadas: el contraste es contra lo que ESTA clínica
    // debería pagar (una Clínica de antes: $1,719, no el $1,489 de lista).
    const plan = await getResolvedPlanForClinic(clinic);
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

  // Condiciones conservadas de la clínica (planes nuevos de sep-2026): lo que
  // guarda su fila, lo que dice su plan HOY y lo que de verdad le aplica.
  const listPlan = await getResolvedPlan(clinic.plan);
  const planOverrides: PlanOverridesDTO = {
    active: activeOverrides(clinic) !== null,
    planOverrideFor: clinic.planOverrideFor ?? null,
    maxUsersOverride: clinic.maxUsersOverride ?? null,
    maxClinicsOverride: clinic.maxClinicsOverride ?? null,
    priceMxnMonthlyOverride: clinic.priceMxnMonthlyOverride ?? null,
    priceMxnAnnualOverride: clinic.priceMxnAnnualOverride ?? null,
    list: {
      maxUsers: listPlan.maxUsers,
      maxClinics: listPlan.maxClinics,
      priceMxnMonthly: listPlan.priceMxnMonthly,
      priceMxnAnnual: listPlan.priceMxnAnnual,
    },
  };

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
      saldoIa={saldoIa}
      planPrices={planPrices}
      planOverrides={planOverrides}
      ahoraISO={ahora.toISOString()}
      actividad={{
        citasPasadas:  citasPasadas._count._all,
        ultimaCitaAt:  citasPasadas._max.startsAt ? citasPasadas._max.startsAt.toISOString() : null,
        citasVentana,
        citasFuturas:  citasFuturas._count._all,
        proximaCitaAt: citasFuturas._min.startsAt ? citasFuturas._min.startsAt.toISOString() : null,
        citasVentanaPrevia: citasPrevias,
        facturasVentana,
        facturasVentanaPrevia: facturasPrevias,
        notasVentana,
        notasVentanaPrevia: notasPrevias,
        ultimoAccesoAt: ultimoAccesoAt ? ultimoAccesoAt.toISOString() : null,
        enLinea: ultimoAccesoAt !== null && ultimoAccesoAt >= desdeEnLinea,
      }}
    />
  );
}
