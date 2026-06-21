export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClinicCreditTotal } from "@/lib/patient-credit";
import { BillingClient } from "./billing-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";

export default async function BillingPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "billing.view");

  const [invoices, patients, clinic, creditTotal] = await Promise.all([
    prisma.invoice.findMany({
      where:   { clinicId: user.clinicId },
      include: {
        patient:  { select: { id: true, firstName: true, lastName: true } },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.patient.findMany({
      where:   { clinicId: user.clinicId, status: "ACTIVE" },
      select:  { id: true, firstName: true, lastName: true, patientNumber: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.clinic.findUnique({
      where:  { id: user.clinicId },
      select: { facturApiEnabled: true, rfcEmisor: true },
    }),
    // Saldo a favor total de la clínica (resiliente si patient_credits no existe aún).
    getClinicCreditTotal(user.clinicId),
  ]);

  const totalPaid    = invoices.filter(i => i.status === "PAID").reduce((s, i) => s + i.paid, 0);
  const totalPending = invoices.filter(i => ["PENDING", "PARTIAL"].includes(i.status)).reduce((s, i) => s + i.balance, 0);
  const totalOverdue = invoices.filter(i => i.status === "OVERDUE").reduce((s, i) => s + i.balance, 0);

  // Count facturas creadas este mes
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);
  const monthInvoices = invoices.filter(i => new Date(i.createdAt) >= firstOfMonth).length;

  return (
    <BillingClient
      invoices={invoices as any}
      patients={patients}
      totalPaid={totalPaid}
      totalPending={totalPending}
      totalOverdue={totalOverdue}
      monthInvoices={monthInvoices}
      creditTotal={creditTotal}
      clinic={{ facturApiEnabled: clinic?.facturApiEnabled ?? false, rfcEmisor: clinic?.rfcEmisor ?? null }}
    />
  );
}
