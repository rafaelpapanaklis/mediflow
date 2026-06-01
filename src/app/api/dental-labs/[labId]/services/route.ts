import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type { DentalLabServiceDTO } from "@/lib/laboratorios/types";

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

// GET /api/dental-labs/[labId]/services — solo los servicios activos del
// laboratorio (que debe estar APPROVED).
export async function GET(
  req: NextRequest,
  { params }: { params: { labId: string } }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verifica primero que el lab exista y esté APPROVED, para no filtrar
  // datos de labs no aprobados.
  const lab = await prisma.dentalLab.findFirst({
    where: { id: params.labId, status: "APPROVED" },
    select: { id: true },
  });
  if (!lab) {
    return NextResponse.json({ error: "Laboratorio no encontrado" }, { status: 404 });
  }

  const services = await prisma.dentalLabService.findMany({
    where: { labId: params.labId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const dtos: DentalLabServiceDTO[] = services.map(toServiceDTO);
  return NextResponse.json(dtos);
}
