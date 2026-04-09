export const dynamic = "force-dynamic";
import { prisma } from "@/lib/prisma";
import { AdminPaymentsClient } from "./payments-client";

export default async function AdminPaymentsPage() {
  const [clinics, invoices] = await Promise.all([
    prisma.clinic.findMany({
      select: { id:true, name:true, plan:true, subscriptionStatus:true, monthlyPrice:true },
      orderBy: { name: "asc" },
    }),
    prisma.subscriptionInvoice.findMany({
      include: { clinic: { select: { name:true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return <AdminPaymentsClient clinics={clinics as any} invoices={invoices as any} />;
}
