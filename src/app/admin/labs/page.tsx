export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { LabsClient } from "./labs-client";

export const metadata: Metadata = { title: "Laboratorios — Admin MediFlow" };

// DentalLab es global (sin clinicId): el admin ve TODOS los laboratorios.
export default async function AdminLabsPage() {
  const labs = await prisma.dentalLab.findMany({
    orderBy: { createdAt: "desc" },
  });
  return <LabsClient initial={labs as any} />;
}
