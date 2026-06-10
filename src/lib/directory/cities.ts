// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZACIÓN DE CIUDADES DEL DIRECTORIO — módulo PURO (sin prisma, sin
// "use client", sin dependencias). Importable desde server y client igual que
// types.ts.
//
// El campo Clinic.city es TEXTO LIBRE en el schema (no se toca prisma). Aquí lo
// convertimos a un slug canónico estable para las URLs /descubre/[cat]/[ciudad]
// y a una etiqueta legible con acentos correctos. Variantes comunes (CDMX,
// "Ciudad de México", "D.F."…) colapsan al MISMO slug para no fragmentar el SEO
// ni el filtro. Para ciudades desconocidas: slug sin acentos + etiqueta a partir
// del texto que escribió la clínica (preservando sus acentos).
// ─────────────────────────────────────────────────────────────────────────────

/** Una ciudad derivada de los datos reales del directorio. */
export interface CityOption {
  /** Slug de URL canónico, ej. "ciudad-de-mexico". */
  slug: string;
  /** Etiqueta legible con acentos, ej. "Ciudad de México". */
  label: string;
  /** Cuántas clínicas (públicas) hay en esa ciudad dentro del recorte actual. */
  count: number;
}

/** Quita acentos/diacríticos: "México" → "Mexico". */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Clave normalizada para buscar alias: minúsculas, sin acentos, espacios simples. */
function aliasKey(raw: string): string {
  return stripAccents(raw.toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Conectores que van en minúscula dentro de un nombre de ciudad (salvo al inicio). */
const LOWER_WORDS = new Set(["de", "del", "la", "las", "los", "y", "el", "en"]);

/** "MÉRIDA" / "ciudad de mexico" → "Mérida" / "Ciudad de México" (acentos del input se preservan). */
function titleCaseCity(raw: string): string {
  const words = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => (i > 0 && LOWER_WORDS.has(stripAccents(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Texto libre → slug: sin acentos, minúsculas, kebab-case. */
function slugifyCity(raw: string): string {
  return stripAccents(raw.trim().toLowerCase())
    .replace(/[._]+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Alias (clave en aliasKey) → slug canónico. Solo abreviaturas/variantes claras
// del MISMO lugar; nunca fusionamos municipios vecinos distintos.
const CITY_ALIAS_TO_SLUG: Record<string, string> = {
  "cdmx": "ciudad-de-mexico",
  "ciudad de mexico": "ciudad-de-mexico",
  "cd de mexico": "ciudad-de-mexico",
  "cd mexico": "ciudad-de-mexico",
  "mexico city": "ciudad-de-mexico",
  "mexico df": "ciudad-de-mexico",
  "mexico d f": "ciudad-de-mexico",
  "distrito federal": "ciudad-de-mexico",
  "df": "ciudad-de-mexico",
  "d f": "ciudad-de-mexico",
  "gdl": "guadalajara",
  "mty": "monterrey",
  "qro": "queretaro",
  "santiago de queretaro": "queretaro",
  "slp": "san-luis-potosi",
  "puebla de zaragoza": "puebla",
  "cd juarez": "ciudad-juarez",
  "juarez": "ciudad-juarez",
};

// Slug canónico → etiqueta con acentos correctos. Cubre ciudades MX frecuentes;
// para el resto se usa el texto de la clínica titulado.
const CITY_CANONICAL_LABEL: Record<string, string> = {
  "ciudad-de-mexico": "Ciudad de México",
  "guadalajara": "Guadalajara",
  "monterrey": "Monterrey",
  "puebla": "Puebla",
  "queretaro": "Querétaro",
  "merida": "Mérida",
  "cancun": "Cancún",
  "tijuana": "Tijuana",
  "leon": "León",
  "san-luis-potosi": "San Luis Potosí",
  "aguascalientes": "Aguascalientes",
  "toluca": "Toluca",
  "morelia": "Morelia",
  "chihuahua": "Chihuahua",
  "culiacan": "Culiacán",
  "hermosillo": "Hermosillo",
  "veracruz": "Veracruz",
  "oaxaca": "Oaxaca",
  "cuernavaca": "Cuernavaca",
  "saltillo": "Saltillo",
  "mexicali": "Mexicali",
  "durango": "Durango",
  "torreon": "Torreón",
  "acapulco": "Acapulco",
  "playa-del-carmen": "Playa del Carmen",
  "puerto-vallarta": "Puerto Vallarta",
  "tampico": "Tampico",
  "villahermosa": "Villahermosa",
  "tuxtla-gutierrez": "Tuxtla Gutiérrez",
  "tepic": "Tepic",
  "pachuca": "Pachuca",
  "campeche": "Campeche",
  "ciudad-juarez": "Ciudad Juárez",
  "ensenada": "Ensenada",
  "mazatlan": "Mazatlán",
  "reynosa": "Reynosa",
  "xalapa": "Xalapa",
  "irapuato": "Irapuato",
  "celaya": "Celaya",
  "zapopan": "Zapopan",
};

/** Slug → etiqueta legible (acentos canónicos si la conocemos; si no, "humaniza" el slug). */
export function cityLabelFromSlug(slug: string): string {
  return CITY_CANONICAL_LABEL[slug] ?? titleCaseCity(slug.replace(/-/g, " "));
}

/**
 * Texto libre de Clinic.city → { slug, label } canónico, o null si está vacío.
 * - Aplica alias (CDMX/DF/…)
 * - slug sin acentos; label con acentos (canónico si lo conocemos, si no del input)
 */
export function normalizeCity(raw: string | null | undefined): { slug: string; label: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const aliasSlug = CITY_ALIAS_TO_SLUG[aliasKey(trimmed)];
  const slug = aliasSlug ?? slugifyCity(trimmed);
  if (!slug) return null;

  const label = CITY_CANONICAL_LABEL[slug] ?? titleCaseCity(trimmed);
  return { slug, label };
}

/** Solo el slug canónico (o null) de un texto libre de ciudad. */
export function citySlug(raw: string | null | undefined): string | null {
  return normalizeCity(raw)?.slug ?? null;
}

/**
 * Lista de textos libres de ciudad → ciudades únicas con conteo, ordenadas por
 * número de clínicas desc y luego alfabético (es). Los vacíos se ignoran.
 */
export function deriveCities(raws: (string | null | undefined)[]): CityOption[] {
  const map = new Map<string, CityOption>();
  for (const raw of raws) {
    const norm = normalizeCity(raw);
    if (!norm) continue;
    const current = map.get(norm.slug);
    if (current) current.count += 1;
    else map.set(norm.slug, { slug: norm.slug, label: norm.label, count: 1 });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"),
  );
}
