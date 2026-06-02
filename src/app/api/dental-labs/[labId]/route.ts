import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type { DentalLabDTO, DentalLabServiceDTO } from "@/lib/laboratorios/types";

// Mapea un DentalLab de Prisma al DTO de red (sin el array labServices, que va
// aparte en la respuesta). Fechas Date → ISO string. Helper local.
function toDentalLabDTO(l: any): DentalLabDTO {
  return {
    id: l.id,
    name: l.name,
    slug: l.slug,
    rfc: l.rfc,
    email: l.email,
    phone: l.phone,
    whatsapp: l.whatsapp,
    website: l.website,
    address: l.address,
    city: l.city,
    state: l.state,
    logoUrl: l.logoUrl,
    coverImageUrl: l.coverImageUrl,
    description: l.description,
    founded: l.founded,
    services: l.services,
    hours: (l.hours ?? null) as DentalLabDTO["hours"],
    coverageZones: l.coverageZones,
    rating: l.rating,
    ratingCount: l.ratingCount,
    onTimePct: l.onTimePct,
    totalOrders: l.totalOrders,
    status: l.status,
    traffic: {
      level: l.trafficLevel,
      manualOverride:
        l.trafficManualMin != null && l.trafficManualMax != null
          ? {
              minMinutes: l.trafficManualMin,
              maxMinutes: l.trafficManualMax,
              note: l.trafficNote ?? null,
            }
          : null,
      updatedAt: l.trafficUpdatedAt.toISOString(),
    },
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function toServiceDTO(s: any): DentalLabServiceDTO {
  return {
    id: s.id,
    labId: s.labId,
    serviceKey: s.serviceKey,
    name: s.name,
    description: s.description,
    priceFrom: s.priceFrom,
    unit: s.unit,
    daysMin: s.daysMin,
    daysMax: s.daysMax,
    imageUrl: s.imageUrl,
    isActive: s.isActive,
  };
}

// GET /api/dental-labs/[labId] — ficha del laboratorio + sus servicios activos.
// Solo APPROVED, para no filtrar datos de labs no aprobados.
export async function GET(
  req: NextRequest,
  { params }: { params: { labId: string } }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lab = await prisma.dentalLab.findFirst({
    where: { id: params.labId, status: "APPROVED" },
    include: {
      labServices: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!lab) {
    return NextResponse.json({ error: "Laboratorio no encontrado" }, { status: 404 });
  }

  const services: DentalLabServiceDTO[] = lab.labServices.map(toServiceDTO);

  return NextResponse.json({
    lab: toDentalLabDTO(lab),
    services,
  });
}
