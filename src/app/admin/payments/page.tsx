import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AdminPaymentsClient } from "./payments-client";

export const metadata: Metadata = { title: "Pagos — Admin MediFlow" };

export default async function AdminPaymentsPage() {
  const clinics = await prisma.clinic.findMany({
    where: { trialEndsAt: { not: null } },
    orderBy: { trialEndsAt: "asc" },
    include: {
      users: { take: 1, select: { email: true, firstName: true, lastName: true, phone: true } },
      _count: { select: { patients: true } },
    },
  });

  return <AdminPaymentsClient clinics={clinics as any} />;
}
