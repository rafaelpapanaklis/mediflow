import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicReviews } from "@/lib/reviews/service";

// GET /api/directory/reviews?slug=<clinicSlug>&page=<n> — reseñas PÚBLICAS
// publicadas de una clínica (perfil del directorio). Sin auth. Solo clínicas
// públicas y no canceladas (misma visibilidad que el directorio).
export const dynamic = "force-dynamic";
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug")?.trim() ?? "";
    if (!slug) return NextResponse.json({ error: "slug requerido" }, { status: 400 });

    const clinic = await prisma.clinic.findFirst({
      where: {
        slug,
        isPublic: true,
        AND: [{ OR: [{ subscriptionStatus: null }, { subscriptionStatus: { notIn: ["cancelled"] } }] }],
      },
      select: { id: true },
    });
    if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

    const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
    const page = Number.isFinite(pageRaw) ? Math.min(500, Math.max(1, pageRaw)) : 1;

    const data = await getPublicReviews(clinic.id, page);
    return NextResponse.json(data, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (err) {
    console.error("[directory/reviews]", err);
    return NextResponse.json({ error: "Error al cargar reseñas" }, { status: 500 });
  }
}
