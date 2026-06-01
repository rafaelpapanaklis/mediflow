export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { LabDetailClient } from "./lab-detail-client";

export default async function LabDetailPage({ params }: { params: { labId: string } }) {
  await getCurrentUser(); // exige sesión de clínica

  const lab = await prisma.dentalLab.findFirst({
    where: { id: params.labId, status: "APPROVED" },
    include: {
      labServices: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!lab) notFound();

  const data = {
    id: lab.id,
    name: lab.name,
    logoUrl: lab.logoUrl,
    description: lab.description,
    city: lab.city,
    state: lab.state,
    address: lab.address,
    phone: lab.phone,
    whatsapp: lab.whatsapp,
    website: lab.website,
    email: lab.email,
    services: lab.services,
    coverageZones: lab.coverageZones,
    rating: lab.rating,
    ratingCount: lab.ratingCount,
    onTimePct: lab.onTimePct,
    totalOrders: lab.totalOrders,
    founded: lab.founded,
  };

  const services = lab.labServices.map((s) => ({
    id: s.id,
    serviceKey: s.serviceKey,
    name: s.name,
    description: s.description,
    priceFrom: s.priceFrom,
    unit: s.unit,
    daysMin: s.daysMin,
    daysMax: s.daysMax,
    imageUrl: s.imageUrl,
  }));

  return <LabDetailClient lab={data} services={services} />;
}
