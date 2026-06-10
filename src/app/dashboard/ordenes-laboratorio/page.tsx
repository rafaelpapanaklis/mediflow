export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type {
  DentalLabDTO,
  DentalLabOrderDTO,
  DentalLabOrderEventDTO,
  DentalLabOrderFileDTO,
} from "@/lib/laboratorios/types";
import { OrdenesClient } from "./ordenes-client";

export const metadata: Metadata = { title: "Órdenes de laboratorio — DaleControl" };

const iso = (d: Date): string => d.toISOString();

// Include canónico de una orden de laboratorio (espejo de orderInclude de compras).
const orderInclude = {
  lab: true,
  events: true,
  files: true,
} satisfies Prisma.DentalLabOrderInclude;

type OrderWith = Prisma.DentalLabOrderGetPayload<{ include: typeof orderInclude }>;

function toDentalLabOrderDTO(o: OrderWith): DentalLabOrderDTO {
  const timeline: DentalLabOrderEventDTO[] = o.events.map((e) => ({
    status: e.status,
    at: e.at ? iso(e.at) : null,
    eta: e.eta ? iso(e.eta) : null,
    actor:
      e.actorId || e.actorName || e.actorRole
        ? { id: e.actorId, name: e.actorName, role: e.actorRole }
        : null,
    detail: e.detail,
  }));
  const files: DentalLabOrderFileDTO[] = o.files.map((f) => ({
    id: f.id,
    url: f.url,
    name: f.name,
    fileType: f.fileType,
    sizeBytes: f.sizeBytes,
    uploadedAt: iso(f.uploadedAt),
  }));
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    clinicId: o.clinicId,
    labId: o.labId,
    lab: {
      id: o.lab.id,
      name: o.lab.name,
      slug: o.lab.slug,
      rfc: o.lab.rfc,
      email: o.lab.email,
      phone: o.lab.phone,
      whatsapp: o.lab.whatsapp,
      website: o.lab.website,
      address: o.lab.address,
      city: o.lab.city,
      state: o.lab.state,
      logoUrl: o.lab.logoUrl,
      coverImageUrl: o.lab.coverImageUrl,
      description: o.lab.description,
      founded: o.lab.founded,
      services: o.lab.services,
      hours: (o.lab.hours as DentalLabDTO["hours"]) ?? null,
      coverageZones: o.lab.coverageZones,
      rating: o.lab.rating,
      ratingCount: o.lab.ratingCount,
      onTimePct: o.lab.onTimePct,
      totalOrders: o.lab.totalOrders,
      status: o.lab.status,
      traffic: {
        level: o.lab.trafficLevel,
        manualOverride:
          o.lab.trafficManualMin != null && o.lab.trafficManualMax != null
            ? {
                minMinutes: o.lab.trafficManualMin,
                maxMinutes: o.lab.trafficManualMax,
                note: o.lab.trafficNote,
              }
            : null,
        updatedAt: iso(o.lab.trafficUpdatedAt),
      },
      createdAt: iso(o.lab.createdAt),
      updatedAt: iso(o.lab.updatedAt),
    },
    serviceId: o.serviceId,
    patientId: o.patientId,
    patientName: o.patientName,
    internalRef: o.internalRef,
    status: o.status,
    notes: o.notes,
    basePrice: o.basePrice,
    extrasTotal: o.extrasTotal,
    total: o.total,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    paidAt: o.paidAt ? iso(o.paidAt) : null,
    priority: o.priority,
    pickupAt: o.pickupAt ? iso(o.pickupAt) : null,
    etaAt: o.etaAt ? iso(o.etaAt) : null,
    courier: (o.courier as unknown as DentalLabOrderDTO["courier"]) ?? null,
    timeline,
    files,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}

export default async function OrdenesLaboratorioPage() {
  const user = await getCurrentUser();

  const orders = await prisma.dentalLabOrder.findMany({
    where: { clinicId: user.clinicId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });

  const orderDTOs = orders.map(toDentalLabOrderDTO);

  return <OrdenesClient orders={orderDTOs} />;
}
