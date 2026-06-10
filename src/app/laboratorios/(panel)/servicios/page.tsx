export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import type { DentalLabServiceDTO } from "@/lib/laboratorios/types";
import { ServiciosClient } from "./servicios-client";

export const metadata: Metadata = {
  title: "Servicios · Laboratorio — DaleControl",
  robots: { index: false, follow: false },
};

export default async function LabServiciosPage() {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");
  if (ctx.status !== "APPROVED") redirect("/laboratorios/pendiente");

  const services = await prisma.dentalLabService.findMany({
    where: { labId: ctx.labId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  const initialServices: DentalLabServiceDTO[] = services.map((s) => ({
    id: s.id,
    labId: s.labId,
    serviceKey: s.serviceKey,
    name: s.name,
    description: s.description ?? null,
    priceFrom: s.priceFrom,
    unit: s.unit,
    daysMin: s.daysMin ?? null,
    daysMax: s.daysMax ?? null,
    imageUrl: s.imageUrl ?? null,
    isActive: s.isActive,
  }));

  return <ServiciosClient initialServices={initialServices} />;
}
