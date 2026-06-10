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

// GET /api/directory/clinics — API pública del directorio (sin auth).
// Query params:
//   category — slug en español de la categoría (ej. "dental"); inválida → 400.
//   q        — búsqueda libre (trim, máx 100 chars) sobre name/city/state/description.
//   slug     — lookup puntual de UNA clínica (ignora category/q/page; items de 0 o 1).
//   page     — base 1, clamp [1, 500]. pageSize fijo = DIRECTORY_PAGE_SIZE.
// Solo datos públicos (nunca email/tokens/billing). Cache CDN 120s + SWR 600s.

// API de query params: nunca prerender (sin esto, el build intenta renderizarla
// estática y el try/catch convierte el DynamicServerError de Next en un 500).
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, s-maxage=120, stale-while-revalidate=600";

/** Visibilidad base (SIEMPRE, también con slug): públicas y no canceladas. */
function visibilityWhere(): any {
  return {
    isPublic: true,
    AND: [
      { OR: [{ subscriptionStatus: null }, { subscriptionStatus: { notIn: ["cancelled"] } }] },
    ],
  };
}

/** findMany con el select de SOLO datos públicos y el orden del directorio. */
function queryDirectoryClinics(where: any, skip: number, take: number) {
  return prisma.clinic.findMany({
    where,
    orderBy: [{ landingActive: "desc" }, { name: "asc" }],
    skip,
    take,
    select: {
      id: true,
      name: true,
      slug: true,
      category: true,
      city: true,
      state: true,
      address: true,
      phone: true,
      latitude: true,
      longitude: true,
      logoUrl: true,
      description: true,
      landingCoverUrl: true,
      landingTagline: true,
      landingThemeColor: true,
      landingActive: true,
      landingServices: true,
      schedules: {
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      },
      users: {
        where: { isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          specialty: true,
          color: true,
          avatarUrl: true,
          services: true,
        },
        orderBy: { firstName: "asc" },
      },
    },
  });
}

/** users[].services ∪ landingServices (strings u objetos { name }) → no vacíos, dedup case-insensitive, máx 6. */
function buildFeaturedServices(users: any[], landingServices: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: unknown) => {
    if (out.length >= 6 || typeof value !== "string") return;
    const name = value.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const u of users ?? []) {
    if (Array.isArray(u?.services)) for (const s of u.services) add(s);
  }
  if (Array.isArray(landingServices)) {
    for (const entry of landingServices) {
      if (typeof entry === "string") add(entry);
      else if (entry && typeof entry === "object" && !Array.isArray(entry)) add((entry as any).name);
    }
  }
  return out;
}

function toDirectoryClinic(row: any): DirectoryClinic {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    city: row.city,
    state: row.state,
    address: row.address,
    phone: row.phone,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    logoUrl: row.logoUrl,
    coverUrl: row.landingCoverUrl,
    description: row.description,
    tagline: row.landingTagline,
    themeColor: row.landingThemeColor,
    landingActive: row.landingActive,
    featuredServices: buildFeaturedServices(row.users, row.landingServices),
    doctors: (row.users ?? []).map((u: any) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      specialty: u.specialty,
      color: u.color,
      avatarUrl: u.avatarUrl,
      services: Array.isArray(u.services) ? u.services : [],
    })),
    schedules: (row.schedules ?? []).map((s: any) => ({
      dayOfWeek: s.dayOfWeek,
      enabled: s.enabled,
      openTime: s.openTime,
      closeTime: s.closeTime,
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // slug → lookup puntual de UNA clínica (reabrir el popup al volver del registro)
    const slug = searchParams.get("slug")?.trim() ?? "";
    if (slug) {
      const rows = await queryDirectoryClinics({ ...visibilityWhere(), slug }, 0, 1);
      const items = rows.map(toDirectoryClinic);
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
      let items = rows.map(toDirectoryClinic);
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
      let items = rows.map(toDirectoryClinic).map((c) => ({ ...c, distanceKm: distanceOf(c) }));
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

    const body: DirectoryClinicsResponse = {
      items: rows.map(toDirectoryClinic),
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
