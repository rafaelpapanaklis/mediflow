export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { AdminClinicsClient } from "./clinics-client";

export const metadata: Metadata = { title: "Clínicas — Admin MediFlow" };

export default async function AdminClinicsPage() {
  const clinics = await prisma.clinic.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, slug: true, specialty: true, country: true,
      plan: true, trialEndsAt: true, createdAt: true,
      aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true,
      _count: { select: { patients: true, users: true, appointments: true } },
      users:  { take: 1, select: { email: true, firstName: true, lastName: true } },
    },
  });
  return <AdminClinicsClient clinics={clinics as any} />;
}
