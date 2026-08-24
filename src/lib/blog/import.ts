import { isBlogCategory, BLOG_CATEGORY_SLUGS } from "./categories";
import {
  BLOG_IMPORT_LIMITS,
  BLOG_LIMITS,
  isReservedBlogSlug,
  isValidBlogSlug,
  normalizeFaq,
  readingMinutesFor,
  type BlogFaqItem,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Importador JSON de artículos — validación + programación del drip.
//
// Los artículos llegan YA REDACTADOS en un .json (cero llamadas a IA en todo
// este módulo). Aquí sólo se valida el contrato y se calcula el calendario.
//
// Principio de diseño: **un item inválido NO aborta el lote**. Cada item se
// juzga por separado y el reporte final lista insertados y rechazados con el
// motivo por slug, para que quien generó el lote lo arregle y reimporte sólo
// esos. Lo único que aborta es un archivo entero mal formado (no es un array,
// pesa de más, trae más de 200 items).
//
// Este archivo es PURO: no toca Prisma. El route handler le pasa qué slugs ya
// existen en BD y cuál es el último scheduledAt, y recibe filas listas para
// createMany.
// ─────────────────────────────────────────────────────────────────────────────

export interface BlogImportItemInput {
  slug?: unknown;
  title?: unknown;
  metaTitle?: unknown;
  metaDescription?: unknown;
  category?: unknown;
  cluster?: unknown;
  tags?: unknown;
  excerpt?: unknown;
  contentMd?: unknown;
  faq?: unknown;
  relatedSlugs?: unknown;
  scheduledAt?: unknown;
}

/** Fila lista para `prisma.blogPost.create`. */
export interface BlogImportRow {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  contentMd: string;
  category: string;
  cluster: string | null;
  tags: string[];
  faq: BlogFaqItem[];
  relatedSlugs: string[];
  status: "scheduled";
  scheduledAt: Date;
  readingMinutes: number;
}

export interface BlogImportRejection {
  /** Slug del item, o "#<índice>" si ni siquiera trae uno legible. */
  slug: string;
  reason: string;
}

export interface BlogImportPlan {
  rows: BlogImportRow[];
  rejected: BlogImportRejection[];
  perDay: number;
  /** Categorías tocadas — para revalidar sólo lo necesario. */
  categories: string[];
}

/** Error de archivo (aborta el lote entero, a diferencia de un item malo). */
export class BlogImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BlogImportError";
    this.status = status;
  }
}

// ── Helpers de campo ─────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (let i = 0; i < v.length && out.length < maxItems; i++) {
    const s = str(v[i]).slice(0, maxLen);
    if (s && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

// ── Calendario del drip ──────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha UTC a las HH:00:00.000 del mismo día. */
function atPublishHour(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCHours(BLOG_IMPORT_LIMITS.publishHourUtc, 0, 0, 0);
  return out;
}

/**
 * Primer día del nuevo lote:
 *  - si ya hay artículos programados → el día SIGUIENTE al último (no rellena
 *    días a medias: cada importación ocupa días limpios y es predecible);
 *  - si no hay nada → hoy a las 13:00 UTC si aún no pasó, o mañana.
 *
 * El resultado NUNCA es anterior al primer hueco válido contado desde now: se
 * toma el MÁXIMO entre "último + 1 día" y ese hueco. El "último programado" que
 * manda el route handler es el mayor scheduledAt de la BD sin mirar el status,
 * así que tras un tiempo sin importar queda en el pasado (los ya publicados lo
 * conservan). Calcular "último + 1 día" a secas metió el 18-ago-2026 un lote de
 * 60 artículos con fechas del 12 al 17, todas vencidas, y el cron (status
 * scheduled, scheduledAt <= now, take 200) los habría publicado TODOS en una
 * sola corrida en vez de gotearlos. Si vuelve a pasar con filas ya insertadas,
 * el remedio manual es sql/blog_reprogramar_drip.sql.
 */
export function firstDripSlot(lastScheduledAt: Date | null, now: Date): Date {
  const today = atPublishHour(now);
  const fromNow =
    today.getTime() > now.getTime() ? today : atPublishHour(new Date(now.getTime() + DAY_MS));
  if (!lastScheduledAt) return fromNow;
  const afterLast = atPublishHour(new Date(lastScheduledAt.getTime() + DAY_MS));
  return afterLast.getTime() > fromNow.getTime() ? afterLast : fromNow;
}

/**
 * Slot del i-ésimo artículo AUTO-programado del lote: `perDay` por día, todos a
 * las 13:00 UTC. No se separan por minutos dentro del día a propósito — el cron
 * corre una sola vez al día a esa hora, así que espaciarlos por minutos no
 * cambiaría nada y sólo haría el calendario más difícil de leer.
 */
export function dripSlotFor(first: Date, index: number, perDay: number): Date {
  const day = Math.floor(index / Math.max(1, perDay));
  return atPublishHour(new Date(first.getTime() + day * DAY_MS));
}

// ── Validación del archivo ───────────────────────────────────────────────────

/** Parsea el texto del .json y verifica la forma general del lote. */
export function parseImportFile(text: string): BlogImportItemInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BlogImportError("El archivo no es JSON válido.");
  }
  if (!Array.isArray(parsed)) {
    throw new BlogImportError("El JSON debe ser un array de artículos.");
  }
  if (parsed.length === 0) {
    throw new BlogImportError("El archivo no contiene artículos.");
  }
  if (parsed.length > BLOG_IMPORT_LIMITS.maxItems) {
    throw new BlogImportError(
      `Máximo ${BLOG_IMPORT_LIMITS.maxItems} artículos por archivo (trae ${parsed.length}).`,
    );
  }
  return parsed as BlogImportItemInput[];
}

/**
 * Valida cada item y le asigna su hueco en el calendario.
 *
 * @param items          array ya parseado
 * @param takenSlugs     slugs que YA existen en BD (mapa para lookup barato)
 * @param lastScheduledAt último scheduledAt de la BD, o null
 * @param perDay         artículos por día
 * @param now            reloj (inyectado para poder testear)
 */
export function planImport(
  items: BlogImportItemInput[],
  takenSlugs: Record<string, true>,
  lastScheduledAt: Date | null,
  perDay: number,
  now: Date,
): BlogImportPlan {
  const safePerDay = Math.min(
    Math.max(1, Math.floor(perDay) || BLOG_IMPORT_LIMITS.defaultPerDay),
    BLOG_IMPORT_LIMITS.maxPerDay,
  );
  const first = firstDripSlot(lastScheduledAt, now);

  const rows: BlogImportRow[] = [];
  const rejected: BlogImportRejection[] = [];
  const seenInFile: Record<string, true> = {};
  const categories: Record<string, true> = {};
  // Índice del drip: sólo avanza con los artículos SIN scheduledAt explícito,
  // para que una fecha fijada a mano no consuma un hueco del calendario.
  let autoIndex = 0;

  for (let i = 0; i < items.length; i++) {
    const raw = items[i] ?? ({} as BlogImportItemInput);
    const slug = str(raw.slug);
    const label = slug || `#${i + 1}`;

    const reject = (reason: string) => rejected.push({ slug: label, reason });

    // ── Slug ──
    if (!slug) {
      reject("Falta el campo slug.");
      continue;
    }
    if (isReservedBlogSlug(slug)) {
      reject(`"${slug}" es una ruta reservada del blog y no puede usarse como slug.`);
      continue;
    }
    if (!isValidBlogSlug(slug)) {
      reject(
        `Slug inválido: sólo minúsculas, números y guiones simples (máx ${BLOG_LIMITS.slug}).`,
      );
      continue;
    }
    if (seenInFile[slug]) {
      reject("Slug duplicado dentro del mismo archivo.");
      continue;
    }
    if (takenSlugs[slug]) {
      reject("Ya existe un artículo con este slug en la base de datos.");
      continue;
    }

    // ── Campos requeridos ──
    const title = str(raw.title);
    const metaTitle = str(raw.metaTitle);
    const metaDescription = str(raw.metaDescription);
    const excerpt = str(raw.excerpt);
    const contentMd = typeof raw.contentMd === "string" ? raw.contentMd.trim() : "";
    const category = str(raw.category);

    if (!title) { reject("Falta el campo title."); continue; }
    if (!metaTitle) { reject("Falta el campo metaTitle."); continue; }
    if (!metaDescription) { reject("Falta el campo metaDescription."); continue; }
    if (!excerpt) { reject("Falta el campo excerpt."); continue; }
    if (!contentMd) { reject("Falta el campo contentMd."); continue; }
    if (!category) { reject("Falta el campo category."); continue; }

    // ── Longitudes ──
    if (title.length > BLOG_LIMITS.title) {
      reject(`title de ${title.length} caracteres (máx ${BLOG_LIMITS.title}).`);
      continue;
    }
    if (metaTitle.length > BLOG_LIMITS.metaTitle) {
      reject(`metaTitle de ${metaTitle.length} caracteres (máx ${BLOG_LIMITS.metaTitle}).`);
      continue;
    }
    if (
      metaDescription.length < BLOG_LIMITS.metaDescriptionMin ||
      metaDescription.length > BLOG_LIMITS.metaDescriptionMax
    ) {
      reject(
        `metaDescription de ${metaDescription.length} caracteres (debe ser ${BLOG_LIMITS.metaDescriptionMin}–${BLOG_LIMITS.metaDescriptionMax}).`,
      );
      continue;
    }
    if (excerpt.length > BLOG_LIMITS.excerpt) {
      reject(`excerpt de ${excerpt.length} caracteres (máx ${BLOG_LIMITS.excerpt}).`);
      continue;
    }
    if (contentMd.length > BLOG_LIMITS.contentMd) {
      reject(`contentMd de ${contentMd.length} caracteres (máx ${BLOG_LIMITS.contentMd}).`);
      continue;
    }

    // ── Categoría ──
    if (!isBlogCategory(category)) {
      reject(`Categoría "${category}" no existe. Válidas: ${BLOG_CATEGORY_SLUGS.join(", ")}.`);
      continue;
    }

    // ── scheduledAt explícito (opcional) ──
    let explicit: Date | null = null;
    if (raw.scheduledAt !== null && raw.scheduledAt !== undefined && raw.scheduledAt !== "") {
      if (typeof raw.scheduledAt !== "string") {
        reject("scheduledAt debe ser null o una fecha ISO en texto.");
        continue;
      }
      const d = new Date(raw.scheduledAt);
      if (isNaN(d.getTime())) {
        reject(`scheduledAt "${raw.scheduledAt}" no es una fecha ISO válida.`);
        continue;
      }
      explicit = d;
    }

    const scheduledAt = explicit ?? dripSlotFor(first, autoIndex, safePerDay);
    if (!explicit) autoIndex++;

    seenInFile[slug] = true;
    categories[category] = true;

    rows.push({
      slug,
      title,
      metaTitle,
      metaDescription,
      excerpt,
      contentMd,
      category,
      cluster: str(raw.cluster).slice(0, BLOG_LIMITS.cluster) || null,
      tags: strArray(raw.tags, BLOG_LIMITS.tags, BLOG_LIMITS.tagLength),
      faq: normalizeFaq(raw.faq),
      relatedSlugs: strArray(raw.relatedSlugs, BLOG_LIMITS.relatedSlugs, BLOG_LIMITS.slug),
      status: "scheduled",
      scheduledAt,
      readingMinutes: readingMinutesFor(contentMd),
    });
  }

  return { rows, rejected, perDay: safePerDay, categories: Object.keys(categories) };
}
