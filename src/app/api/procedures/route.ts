import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";

// Default dental procedures with MX average prices
const DENTAL_SEED = [
  { name: "Profilaxis (limpieza)", category: "dental", basePrice: 600, duration: 30 },
  { name: "Tartrectomía", category: "dental", basePrice: 900, duration: 45 },
  { name: "Consulta general", category: "dental", basePrice: 400, duration: 30 },
  { name: "Extracción simple", category: "dental", basePrice: 800, duration: 30 },
  { name: "Extracción quirúrgica", category: "dental", basePrice: 2500, duration: 60 },
  { name: "Restauración resina 1 cara", category: "dental", basePrice: 700, duration: 30 },
  { name: "Restauración resina 2 caras", category: "dental", basePrice: 900, duration: 45 },
  { name: "Restauración resina 3 caras", category: "dental", basePrice: 1200, duration: 60 },
  { name: "Amalgama", category: "dental", basePrice: 600, duration: 30 },
  { name: "Corona porcelana", category: "dental", basePrice: 6500, duration: 60 },
  { name: "Corona metal-porcelana", category: "dental", basePrice: 4500, duration: 60 },
  { name: "Corona de zirconio", category: "dental", basePrice: 9000, duration: 60 },
  { name: "Endodoncia unirradicular", category: "dental", basePrice: 2500, duration: 60 },
  { name: "Endodoncia birradicular", category: "dental", basePrice: 3500, duration: 90 },
  { name: "Endodoncia multirradicular", category: "dental", basePrice: 4500, duration: 120 },
  { name: "Implante dental", category: "dental", basePrice: 18000, duration: 90 },
  { name: "Ortodoncia brackets", category: "dental", basePrice: 25000, duration: 60 },
  { name: "Ortodoncia invisible", category: "dental", basePrice: 45000, duration: 60 },
  { name: "Carilla dental", category: "dental", basePrice: 5500, duration: 60 },
  { name: "Blanqueamiento", category: "dental", basePrice: 3500, duration: 90 },
  { name: "Periodoncia (curetaje)", category: "dental", basePrice: 2500, duration: 60 },
  { name: "Cirugía periodontal", category: "dental", basePrice: 6000, duration: 90 },
  { name: "Injerto óseo", category: "dental", basePrice: 8000, duration: 90 },
  { name: "Férula oclusal", category: "dental", basePrice: 2800, duration: 45 },
  { name: "Radiografía periapical", category: "dental", basePrice: 200, duration: 10 },
  { name: "Radiografía panorámica", category: "dental", basePrice: 500, duration: 15 },
];

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get("all") === "1";

  let procedures = await prisma.procedureCatalog.findMany({
    where: { clinicId: ctx.clinicId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  // Auto-seed dental procedures for dental clinics on first access
  if (procedures.length === 0 && (ctx.clinicCategory === "DENTAL" || ctx.clinic.specialty === "dental" || ctx.clinic.specialty === "Odontología")) {
    await prisma.procedureCatalog.createMany({
      data: DENTAL_SEED.map(p => ({ ...p, clinicId: ctx.clinicId })),
    });
    procedures = await prisma.procedureCatalog.findMany({
      where: { clinicId: ctx.clinicId, isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  return NextResponse.json(procedures);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  try {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Nombre es requerido" }, { status: 400 });
    if (body.basePrice === undefined || body.basePrice < 0) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });

    const procedure = await prisma.procedureCatalog.create({
      data: {
        clinicId: ctx.clinicId,
        name: body.name.trim(),
        code: body.code?.trim() || null,
        category: body.category?.trim() || "general",
        basePrice: Number(body.basePrice),
        duration: body.duration ? Number(body.duration) : null,
        description: body.description?.trim() || null,
      },
    });
    revalidateAfter("procedures");
    return NextResponse.json(procedure, { status: 201 });
  } catch (err: any) {
    console.error("Create procedure error:", err);
    return NextResponse.json({ error: err.message ?? "Error al crear procedimiento" }, { status: 500 });
  }
}
