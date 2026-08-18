export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { LabsClient } from "./labs-client";
import { LAB_SELECT } from "@/lib/b2b/vendor-fields";

export const metadata: Metadata = { title: "Laboratorios — Admin DaleControl" };

// DentalLab es global (sin clinicId): el admin ve TODOS los laboratorios.
export default async function AdminLabsPage() {
  // Tope de seguridad: LabsClient lista en memoria sin paginación. Acota a 100
  // para no traer toda la tabla global de laboratorios. TODO: paginar admin.
  // B2B-12: LabsClient es "use client", así que TODO lo que se le pase viaja
  // en el payload RSC. Sin `select` bajaban las filas enteras —mpAccessToken
  // incluido— con solo ABRIR la lista, sin pulsar nada. Es el mismo patrón que
  // filtró la fila de Clinic en la mini-web (0424d5ab).
  const labs = await prisma.dentalLab.findMany({
    select: LAB_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <LabsClient initial={labs as any} />;
}
