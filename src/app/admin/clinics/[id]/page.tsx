import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isStripeConfigured, STRIPE_SETUP_INSTRUCTIONS } from "@/lib/stripe";
import { AdminClinicDetailClient } from "./clinic-detail-client";

export const metadata: Metadata = { title: "Detalle Clínica — Admin MediFlow" };

export default async function AdminClinicDetailPage({ params }: { params: { id: string } }) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: params.id },
    include: {
      users:        { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, createdAt: true, isActive: true } },
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

  // Para la modal de eliminar — total de clínicas para decidir si está permitido.
  const totalClinics = await prisma.clinic.count();

  const recentActivity = await prisma.medicalRecord.findMany({
    where:   { clinicId: params.id },
    orderBy: { createdAt: "desc" },
    take:    5,
    include: { doctor: { select: { firstName: true, lastName: true } } },
  });

  const revenueStats = await prisma.invoice.aggregate({
    where: { clinicId: params.id, status: { in: ["PAID", "PARTIAL"] } },
    _sum:  { paid: true },
    _count: { id: true },
  });

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
      clinic={clinic as any}
      recentActivity={recentActivity as any}
      totalRevenue={revenueStats._sum.paid ?? 0}
      totalInvoices={revenueStats._count.id}
      stripeConfigured={isStripeConfigured()}
      stripeInstructions={STRIPE_SETUP_INSTRUCTIONS}
      totalClinicsInSystem={totalClinics}
      moduleCatalog={moduleCatalog}
      clinicModuleRows={clinicModuleRows}
    />
  );
}
