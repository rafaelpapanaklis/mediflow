export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BillingClient } from "./billing-client";

export default async function BillingPage() {
  const user = await getCurrentUser();

  const [invoices, patients, clinic] = await Promise.all([
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
  ]);

  const totalPaid    = invoices.filter(i => i.status === "PAID").reduce((s, i) => s + i.paid, 0);
  const totalPending = invoices.filter(i => ["PENDING","PARTIAL"].includes(i.status)).reduce((s, i) => s + i.balance, 0);

  return (
    <BillingClient
      invoices={invoices as any}
      patients={patients}
      totalPaid={totalPaid}
      totalPending={totalPending}
      clinic={{ facturApiEnabled: clinic?.facturApiEnabled ?? false, rfcEmisor: clinic?.rfcEmisor ?? null }}
    />
  );
}
