export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { dentalLabEnabledB2BMethods } from "@/lib/laboratorios/types";
import { LabDetailClient } from "./lab-detail-client";

export default async function LabDetailPage({ params }: { params: { labId: string } }) {
  // Sesión de clínica. El usuario trae la clínica activa incluida → de ahí
  // sacamos la dirección de recolección (clinicId SIEMPRE de sesión, nunca del
  // request, igual que getAuthContext en el POST de órdenes).
  const me = await getCurrentUser();

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
    mapsUrl: lab.mapsUrl,
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
    // Tráfico del lab → ETA de recolección/entrega del mensajero.
    trafficLevel: lab.trafficLevel,
    trafficManualMin: lab.trafficManualMin,
    trafficManualMax: lab.trafficManualMax,
    trafficNote: lab.trafficNote,
    trafficUpdatedAt: lab.trafficUpdatedAt.toISOString(),
    // Métodos de pago B2B habilitados por el lab (para el selector del modal).
    paymentMethods: dentalLabEnabledB2BMethods(lab),
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

  // Dirección de recolección = la de la clínica en sesión.
  const clinic = {
    address: me.clinic?.address ?? null,
    mapsUrl: me.clinic?.mapsUrl ?? null,
  };

  return <LabDetailClient lab={data} services={services} clinic={clinic} />;
}
