import { NextRequest, NextResponse } from "next/server";
import { getCategoryBySlug, type DirectoryCitiesResponse } from "@/lib/directory/types";
import { visibilityWhere, getDirectoryCities } from "@/lib/directory/query";

// GET /api/directory/cities — ciudades REALES del directorio derivadas de la DB.
// Query params:
//   category — slug en español (opcional); acota a esa categoría. Inválida → 400.
// Devuelve { cities: { slug, label, count }[] } ordenadas por conteo desc.
// Solo lee Clinic.city (texto libre) y lo normaliza a slug canónico. Cache 300s.

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=900";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const where = visibilityWhere();
    const categorySlug = searchParams.get("category")?.trim() ?? "";
    if (categorySlug) {
      const categoryDef = getCategoryBySlug(categorySlug);
      if (!categoryDef) {
        return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
      }
      where.category = categoryDef.category;
    }

    const cities = await getDirectoryCities(where);
    const body: DirectoryCitiesResponse = { cities };
    return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (err) {
    console.error("[directory/cities]", err);
    return NextResponse.json({ cities: [] }, { status: 200 });
  }
}
