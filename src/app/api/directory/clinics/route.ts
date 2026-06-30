import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DIRECTORY_MAP_MAX,
  DIRECTORY_PAGE_SIZE,
  getCategoryBySlug,
  type DirectoryClinic,
  type DirectoryClinicsResponse,
} from "@/lib/directory/types";
import { boundingBox, haversineKm, isValidLatLng, parseCoord } from "@/lib/directory/distance";
// Fuente ÚNICA de la visibilidad + select público + mapeo (no se duplica aquí).
import {
  resolveCityVariants,
  visibilityWhere,
  queryDirectoryClinics,
  toDirectoryClinic,
} from "@/lib/directory/query";
import { getRatingsForClinics } from "@/lib/reviews/service";

// GET /api/directory/clinics — API pública del directorio (sin auth).
// Query params:
//   category — slug en español de la categoría (ej. "dental"); inválida → 400.
//   q        — búsqueda libre (trim, máx 100 chars) sobre name/city/state/description.
//   city     — slug de ciudad (ej. "guadalajara"); se traduce al texto libre real
//              de Clinic.city. Sin coincidencias → lista vacía (no error).
//   slug     — lookup puntual de UNA clínica (ignora category/q/page; items de 0 o 1).
//   page     — base 1, clamp [1, 500]. pageSize fijo = DIRECTORY_PAGE_SIZE.
// Solo datos públicos (nunca email/tokens/billing). Cache CDN 120s + SWR 600s.

// API de query params: nunca prerender (sin esto, el build intenta renderizarla
// estática y el try/catch convierte el DynamicServerError de Next en un 500).
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, s-maxage=120, stale-while-revalidate=600";

function emptyResponse(page: number): DirectoryClinicsResponse {
  return { items: [], total: 0, page, pageSize: DIRECTORY_PAGE_SIZE, totalPages: 0 };
}

// visibilityWhere / queryDirectoryClinics / toDirectoryClinic viven en
// @/lib/directory/query (fuente ÚNICA, importados arriba). Antes estaban
// DUPLICADOS aquí y podían divergir del listado SSR de /descubre/[categoria].

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // slug → lookup puntual de UNA clínica (reabrir el popup al volver del registro)
    const slug = searchParams.get("slug")?.trim() ?? "";
    if (slug) {
      const rows = await queryDirectoryClinics({ ...visibilityWhere(), slug }, 0, 1);
      const ratings = await getRatingsForClinics(rows.map((r) => r.id));
      const items = rows.map((r) => toDirectoryClinic(r, ratings.get(r.id)));
      const body: DirectoryClinicsResponse = {
        items,
        total: items.length,
        page: 1,
        pageSize: DIRECTORY_PAGE_SIZE,
        totalPages: items.length > 0 ? 1 : 0,
      };
      return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
    }

    const where = visibilityWhere();

    const categorySlug = searchParams.get("category")?.trim() ?? "";
    if (categorySlug) {
      const categoryDef = getCategoryBySlug(categorySlug);
      if (!categoryDef) {
        return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
      }
      where.category = categoryDef.category;
    }

    const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { state: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
    const page = Number.isFinite(rawPage) ? Math.min(500, Math.max(1, rawPage)) : 1;

    // Ciudad: slug → variantes reales del texto libre de Clinic.city (dentro de
    // visibilidad + categoría). Sin coincidencias → lista vacía. Acota `where`,
    // así que aplica a todos los modos (lista, "cerca de mí" y mapa).
    const citySlug = (searchParams.get("city") ?? "").trim().toLowerCase();
    if (citySlug) {
      const variants = await resolveCityVariants(citySlug, { ...where });
      if (variants.length === 0) {
        return NextResponse.json(emptyResponse(page), { headers: { "Cache-Control": CACHE_CONTROL } });
      }
      where.city = { in: variants };
    }

    // ── "Cerca de mí" + modo mapa ─────────────────────────────────────────────
    // lat/lng (válidos) → orden por distancia + distanceKm en cada item.
    // radius (km, opcional) → filtro duro (bounding box en SQL + círculo en JS).
    // limit (opcional) → MODO MAPA: una sola página de hasta DIRECTORY_MAP_MAX
    //   clínicas CON pin, para graficar markers.
    const userLat = parseCoord(searchParams.get("lat"));
    const userLng = parseCoord(searchParams.get("lng"));
    const nearMode = isValidLatLng(userLat, userLng);

    const rawRadius = parseCoord(searchParams.get("radius"));
    const radiusKm = rawRadius != null ? Math.min(500, Math.max(1, rawRadius)) : null;

    const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
    const mapMode = Number.isFinite(rawLimit) && rawLimit > 0;
    const limit = mapMode ? Math.min(DIRECTORY_MAP_MAX, Math.max(1, rawLimit)) : 0;

    // Prisma/Postgres no ordena por Haversine sin PostGIS: cuando hay que ordenar
    // por distancia, traemos hasta CANDIDATE_CAP filas y ordenamos en memoria.
    // Acotado para no jalar toda la tabla; sobra para el directorio a esta escala.
    const CANDIDATE_CAP = 500;
    const distanceOf = (c: DirectoryClinic): number | null =>
      c.latitude != null && c.longitude != null
        ? Math.round(haversineKm(userLat as number, userLng as number, c.latitude, c.longitude) * 100) / 100
        : null;

    // ── MODO MAPA: solo clínicas con pin, hasta `limit`, una sola página ──────
    if (mapMode) {
      const mapWhere: any = { ...where, latitude: { not: null }, longitude: { not: null } };
      if (nearMode && radiusKm != null) {
        const box = boundingBox(userLat as number, userLng as number, radiusKm);
        mapWhere.latitude = { gte: box.minLat, lte: box.maxLat };
        mapWhere.longitude = { gte: box.minLng, lte: box.maxLng };
      }
      const [count, rows] = await Promise.all([
        prisma.clinic.count({ where: mapWhere }),
        queryDirectoryClinics(mapWhere, 0, nearMode ? CANDIDATE_CAP : limit),
      ]);
      const ratings = await getRatingsForClinics(rows.map((r) => r.id));
      let items = rows.map((r) => toDirectoryClinic(r, ratings.get(r.id)));
      if (nearMode) {
        items = items
          .map((c) => ({ ...c, distanceKm: distanceOf(c) }))
          .filter((c) => (radiusKm != null ? (c.distanceKm ?? Infinity) <= radiusKm : true))
          .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
          .slice(0, limit);
      }
      const body: DirectoryClinicsResponse = {
        items,
        total: nearMode ? items.length : count,
        page: 1,
        pageSize: limit,
        totalPages: 1,
      };
      return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
    }

    // ── MODO LISTA "cerca de mí": orden por distancia; conserva las sin pin ───
    // Sin radio: las clínicas sin pin se mantienen (al final, sin "a X km").
    // Con radio: solo las que caen dentro del radio (las sin pin quedan fuera).
    if (nearMode) {
      const rows = await queryDirectoryClinics({ ...where }, 0, CANDIDATE_CAP);
      const ratings = await getRatingsForClinics(rows.map((r) => r.id));
      let items = rows.map((r) => toDirectoryClinic(r, ratings.get(r.id))).map((c) => ({ ...c, distanceKm: distanceOf(c) }));
      if (radiusKm != null) {
        items = items.filter((c) => c.distanceKm != null && c.distanceKm <= radiusKm);
      }
      items.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
      const total = items.length;
      const start = (page - 1) * DIRECTORY_PAGE_SIZE;
      const body: DirectoryClinicsResponse = {
        items: items.slice(start, start + DIRECTORY_PAGE_SIZE),
        total,
        page,
        pageSize: DIRECTORY_PAGE_SIZE,
        totalPages: Math.ceil(total / DIRECTORY_PAGE_SIZE),
      };
      return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
    }

    // ── MODO NORMAL: paginación en SQL ────────────────────────────────────────
    // Exactamente 2 promesas (regla del repo: máx 7). Queries cortas — PgBouncer.
    const [total, rows] = await Promise.all([
      prisma.clinic.count({ where }),
      queryDirectoryClinics(where, (page - 1) * DIRECTORY_PAGE_SIZE, DIRECTORY_PAGE_SIZE),
    ]);

    const ratings = await getRatingsForClinics(rows.map((r) => r.id));
    const body: DirectoryClinicsResponse = {
      items: rows.map((r) => toDirectoryClinic(r, ratings.get(r.id))),
      total,
      page,
      pageSize: DIRECTORY_PAGE_SIZE,
      totalPages: Math.ceil(total / DIRECTORY_PAGE_SIZE),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (err) {
    console.error("[directory/clinics]", err);
    return NextResponse.json({ error: "Error al cargar el directorio" }, { status: 500 });
  }
}
