export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { AuditoriaClient } from "./auditoria-client";

export const metadata: Metadata = { title: "Auditoría — Admin DaleControl" };

export default async function AdminAuditoriaPage() {
  // Lista de clínicas para el selector (solo id+name; el super admin ve todas).
  const clinics = await prisma.clinic.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return <AuditoriaClient clinics={clinics} />;
}
