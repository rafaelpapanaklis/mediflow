import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type { DentalLabDTO } from "@/lib/laboratorios/types";
import { parsePageParams } from "@/lib/pagination";

// Mapea un DentalLab de Prisma al DTO de red (fechas Date → ISO string).
// Helper local — NO se comparte un serializers.ts (regla del módulo).
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

// GET /api/dental-labs — laboratorios APPROVED para el directorio de la clínica.
// El laboratorio es GLOBAL (sin clinicId): solo exige sesión válida de clínica.
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const searchParams = new URL(req.url).searchParams;
  const search = searchParams.get("search");
  const service = searchParams.get("service");

  const where: any = { status: "APPROVED" };

  // services es String[] de keys del catálogo (s1..s9).
  if (service) {
    where.services = { has: service };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
    ];
  }

  const { take, skip } = parsePageParams(searchParams);
  const labs = await prisma.dentalLab.findMany({
    where,
    orderBy: { name: "asc" },
    take,
    skip,
  });

  const dtos = labs.map(toDentalLabDTO);
  return NextResponse.json(dtos);
}
