export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { LabsClient } from "./labs-client";

export const metadata: Metadata = { title: "Laboratorios — Admin DaleControl" };

// DentalLab es global (sin clinicId): el admin ve TODOS los laboratorios.
export default async function AdminLabsPage() {
  // Tope de seguridad: LabsClient lista en memoria sin paginación. Acota a 100
  // para no traer toda la tabla global de laboratorios. TODO: paginar admin.
  const labs = await prisma.dentalLab.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <LabsClient initial={labs as any} />;
}
