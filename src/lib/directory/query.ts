// ─────────────────────────────────────────────────────────────────────────────
// CAPA DE DATOS DEL DIRECTORIO (server-only) — fuente ÚNICA del `select` de
// SOLO datos públicos y de las consultas que comparten la API
// /api/directory/clinics, las páginas /descubre/[categoria]/[ciudad], el
// sitemap y los bloques de interlinking. Importar SOLO desde server components
// y route handlers (usa prisma).
//
// Reglas del repo respetadas aquí: Promise.all ≤ 7 (usamos 2), queries cortas
// (PgBouncer), nunca exponer email/tokens/billing. La ciudad (Clinic.city) es
// texto libre: se resuelve a slug canónico con @/lib/directory/cities.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  DIRECTORY_PAGE_SIZE,
  getCategoryByEnum,
  type DirectoryClinic,
  type ClinicCategoryValue,
} from "./types";
import { normalizeCity, deriveCities, cityLabelFromSlug, type CityOption } from "./cities";

/**
 * Visibilidad base del directorio: públicas y con plan no cancelado.
 * SOLO exige isPublic + suscripción ≠ "cancelled". NO requiere ciudad, pin
 * (lat/lng) ni categoría real: una clínica con plan activo + isPublic SIEMPRE
 * cuenta en "Todas" aunque le falten datos opcionales. Los filtros por
 * categoría/ciudad/mapa se agregan ENCIMA de esta base solo cuando aplican.
 * Fuente ÚNICA: la API /api/directory/clinics importa esto (no lo duplica).
 */
export function visibilityWhere(): any {
  return {
    isPublic: true,
    AND: [
      { OR: [{ subscriptionStatus: null }, { subscriptionStatus: { notIn: ["cancelled"] } }] },
    ],
  };
}

/** findMany con el `select` de SOLO datos públicos y el orden del directorio. */
export function queryDirectoryClinics(where: any, skip: number, take: number) {
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

/** users[].services ∪ landingServices → no vacíos, dedup case-insensitive, máx 6. */
export function buildFeaturedServices(users: any[], landingServices: unknown): string[] {
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

/** Fila de prisma → DirectoryClinic (shape público del contrato). */
export function toDirectoryClinic(row: any, rating?: { avg: number; count: number }): DirectoryClinic {
  return {
    ratingAvg: rating?.avg ?? 0,
    ratingCount: rating?.count ?? 0,
    id: row.id,
    name: row.name,
    slug: row.slug,
    // Defensivo: si por un dato legacy llegara null/indefinido, cae a OTHER —
    // no rompe el contrato (categoría no-nula) ni desaparece de "Todas". OTHER
    // se etiqueta como "Especialidad" y queda fuera del grid por categoría.
    category: (row.category ?? "OTHER") as ClinicCategoryValue,
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

// ── Ciudades ─────────────────────────────────────────────────────────────────

/**
 * Variantes RAW de Clinic.city cuyo slug normalizado == citySlug, dentro del
 * recorte `baseWhere`. Permite filtrar por ciudad con texto libre sin tocar el
 * schema: se traduce el slug pedido a los strings exactos que existen en la DB.
 * Devuelve [] si ninguna clínica del recorte cae en esa ciudad.
 */
export async function resolveCityVariants(citySlug: string, baseWhere: any): Promise<string[]> {
  const slug = citySlug.trim().toLowerCase();
  if (!slug) return [];
  const rows = await prisma.clinic.findMany({
    where: baseWhere,
    select: { city: true },
    distinct: ["city"],
  });
  const out: string[] = [];
  for (const r of rows) {
    if (r.city && normalizeCity(r.city)?.slug === slug) out.push(r.city);
  }
  return out;
}

/** Ciudades reales del directorio (con conteo) dentro del recorte `baseWhere`. */
export async function getDirectoryCities(baseWhere: any): Promise<CityOption[]> {
  const rows = await prisma.clinic.findMany({
    where: baseWhere,
    select: { city: true },
  });
  return deriveCities(rows.map((r) => r.city));
}

// ── Combinaciones categoría + ciudad (SSG / interlinking / sitemap) ──────────

export interface CategoryCityCombo {
  categoria: string;       // slug de categoría
  ciudad: string;          // slug de ciudad
  cityLabel: string;       // etiqueta con acentos
  categoryLabel: string;   // label corto de la categoría
  plural: string;          // plural natural de la categoría
  count: number;           // clínicas en esa combinación
}

/**
 * TODAS las combinaciones (categoría visible × ciudad) con ≥1 clínica pública.
 * Una sola query liviana de 2 columnas; se agrupa en memoria. OTHER se excluye
 * (no tiene slug de directorio). Ordenadas por conteo desc.
 */
export async function getCategoryCityCombos(): Promise<CategoryCityCombo[]> {
  const rows = await prisma.clinic.findMany({
    where: visibilityWhere(),
    select: { category: true, city: true },
  });
  const map = new Map<string, CategoryCityCombo>();
  for (const r of rows) {
    const cat = getCategoryByEnum(r.category);
    if (!cat) continue; // OTHER u otros fuera del grid
    const city = normalizeCity(r.city);
    if (!city) continue;
    const key = `${cat.slug}/${city.slug}`;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else
      map.set(key, {
        categoria: cat.slug,
        ciudad: city.slug,
        cityLabel: city.label,
        categoryLabel: cat.label,
        plural: cat.plural,
        count: 1,
      });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.cityLabel.localeCompare(b.cityLabel, "es"),
  );
}

/** Slugs de clínicas con landing pública activa (para el sitemap). Cap defensivo. */
export async function getListedClinicSlugs(limit = 5000): Promise<string[]> {
  const rows = await prisma.clinic.findMany({
    where: { ...visibilityWhere(), landingActive: true },
    select: { slug: true },
    orderBy: { name: "asc" },
    take: limit,
  });
  return rows.map((r) => r.slug);
}

// ── Datos de UNA página de ciudad (categoría + ciudad) ───────────────────────

export interface CityPageData {
  cityLabel: string;
  items: DirectoryClinic[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Página de listado para /descubre/[categoria]/[ciudad].
 * Devuelve null si la combinación NO tiene clínicas (→ la página hace notFound,
 * cero thin content). `categoryEnum` ya validado por el caller.
 */
export async function getCityPageData(
  categoryEnum: string,
  categorySlugForVariants: string,
  citySlug: string,
  page: number,
): Promise<CityPageData | null> {
  const base = { ...visibilityWhere(), category: categoryEnum };
  const variants = await resolveCityVariants(citySlug, base);
  if (variants.length === 0) return null;

  const where = { ...base, city: { in: variants } };
  const safePage = Number.isFinite(page) ? Math.min(500, Math.max(1, page)) : 1;

  // Exactamente 2 promesas (regla del repo). Queries cortas — PgBouncer.
  const [total, rows] = await Promise.all([
    prisma.clinic.count({ where }),
    queryDirectoryClinics(where, (safePage - 1) * DIRECTORY_PAGE_SIZE, DIRECTORY_PAGE_SIZE),
  ]);
  if (total === 0) return null;

  const cityLabel = deriveCities(variants)[0]?.label ?? cityLabelFromSlug(citySlug);
  return {
    cityLabel,
    items: rows.map((r) => toDirectoryClinic(r)),
    total,
    page: safePage,
    totalPages: Math.ceil(total / DIRECTORY_PAGE_SIZE),
  };
}
