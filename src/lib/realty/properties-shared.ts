import type {
  RealtyCurrency,
  RealtyDocumentKind,
  RealtyOperation,
  RealtyPropertyDTO,
  RealtyPropertyKind,
  RealtyPropertyOwnerDTO,
  RealtyPropertyStatus,
} from "@/lib/realty/types";
// Los dos son módulos PUROS del vertical (sin prisma, sin "server-only"):
// se pueden importar desde un componente "use client" sin arrastrar nada.
import { REALTY_AMENITY_KEYS } from "@/lib/realty/types";
import { REALTY_UNLIMITED, isRealtyUnlimited } from "@/lib/realty/plan-shared";

/**
 * DaleControl INMUEBLES — la parte CLIENT-SAFE del módulo de la cartera.
 *
 * ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────
 * `src/lib/realty/properties.ts` y `media.ts` llevan `import "server-only"`
 * (tocan prisma y el service role del Storage). Un componente "use client"
 * que importe de ahí AUNQUE SEA UNA CONSTANTE arrastra el módulo entero al
 * grafo del navegador y `next build` falla en seco con "You're importing a
 * component that needs server-only".
 *
 * Los `import type` sí se borran en compilación y no cuentan; el que rompe
 * es el import de VALORES. Por eso los tipos, las constantes y las
 * funciones PURAS del módulo viven aquí, sin una sola dependencia de
 * servidor, y tanto el servidor como las pantallas importan de este
 * archivo.
 *
 * Es exactamente la convención que la Ola 0 ya usa en el vertical:
 * `plan-shared.ts` (puro, client-safe) junto a `plans.ts` (server-only).
 */

// ── Llaves reservadas del Json `amenities` ─────────────────────────────
/**
 * NIVELES / pisos.
 *
 * 🔴 RealtyProperty NO tiene columna de niveles y esta ola NO toca el
 * schema. Se guarda en el Json libre `amenities` bajo esta llave —el
 * contrato dice que ese mapa admite llaves libres— y las llaves que
 * empiezan con "_" NO son amenidades: no se pintan como casillas.
 * Queda reportado para promoverlo a columna de verdad.
 */
export const REALTY_LEVELS_KEY = "_niveles";

/** ¿Esta llave del Json es una amenidad de verdad (casilla) y no un dato? */
export function isAmenityKey(key: string): boolean {
  return !key.startsWith("_");
}

/** Amenidades activas de un Json, ya limpias de llaves reservadas. */
export function activeAmenityKeys(amenities: unknown): string[] {
  if (!amenities || typeof amenities !== "object" || Array.isArray(amenities)) return [];
  return Object.entries(amenities as Record<string, unknown>)
    .filter(([k, v]) => isAmenityKey(k) && v === true)
    .map(([k]) => k);
}

/** Niveles guardados en el Json, o null. */
export function levelsFrom(amenities: unknown): number | null {
  if (!amenities || typeof amenities !== "object" || Array.isArray(amenities)) return null;
  const v = (amenities as Record<string, unknown>)[REALTY_LEVELS_KEY];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Amenidades del catálogo + las libres que ya tenga guardadas la cuenta. */
export function knownAmenityKeys(extra: string[] = []): string[] {
  return Array.from(new Set([...REALTY_AMENITY_KEYS, ...extra.filter(isAmenityKey)]));
}

// ── Filtros, orden y paginado (el contrato no los define) ──────────────
export const REALTY_PROPERTY_SORTS = [
  "recientes",
  "antiguos",
  "precioAsc",
  "precioDesc",
  "diasDesc",
  "diasAsc",
] as const;
export type RealtyPropertySort = (typeof REALTY_PROPERTY_SORTS)[number];

export const REALTY_PAGE_SIZES = [12, 24, 48] as const;
export const REALTY_DEFAULT_PAGE_SIZE = 24;

/** Umbral del badge "Exclusiva vence en N días". */
export const REALTY_EXCLUSIVE_WARN_DAYS = 30;

export interface RealtyPropertyFilters {
  q?: string;
  kind?: RealtyPropertyKind[];
  operation?: RealtyOperation | null;
  status?: RealtyPropertyStatus[];
  priceMin?: number | null;
  priceMax?: number | null;
  currency?: RealtyCurrency | null;
  bedroomsMin?: number | null;
  bathroomsMin?: number | null;
  city?: string | null;
  colonia?: string | null;
  assignedUserId?: string | null;
  /** true = solo con recorrido; false = solo SIN recorrido; null = da igual. */
  hasTour?: boolean | null;
  /** true = solo con exclusiva VIGENTE; false = solo sin ella. */
  hasExclusive?: boolean | null;
  /** true = solo publicados en la web; false = solo despublicados. */
  isPublished?: boolean | null;
  sort?: RealtyPropertySort;
  page?: number;
  pageSize?: number;
}

/** Fila del listado. Es un shape PROPIO: el DTO del contrato trae de más. */
export interface RealtyPropertyListItem {
  id: string;
  title: string;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  price: number;
  rentPrice: number | null;
  currency: RealtyCurrency;
  colonia: string | null;
  city: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  builtM2: number | null;
  /** Portada YA firmada (o "" si el inmueble no tiene fotos). */
  coverUrl: string;
  photoCount: number;
  hasTour: boolean;
  isPublished: boolean;
  publicUrlSlug: string | null;
  shortTermFolio: string | null;
  /**
   * Días desde que entró a la cartera (createdAt).
   * 🔴 NO son "días publicado": el schema no tiene `publishedAt`, así que
   * la columna se llama "Días en cartera". Reportado para promoverlo.
   */
  daysListed: number;
  createdAt: string;
  /** Fin de la exclusiva VIGENTE, o null si no tiene. */
  exclusiveEndsAt: string | null;
  /** Días que le quedan a la exclusiva. null si no hay exclusiva vigente. */
  exclusiveDaysLeft: number | null;
  commissionPct: number | null;
}

export interface RealtyPropertyPage {
  rows: RealtyPropertyListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Valores REALES de la cartera para llenar los desplegables de filtro. */
export interface RealtyPropertyFacets {
  cities: string[];
  colonias: string[];
  agents: { id: string; name: string }[];
}

export interface RealtyPropertyDocumentRow {
  id: string;
  kind: RealtyDocumentKind;
  name: string;
  url: string;
  bytes: number;
  createdAt: string;
}

export interface RealtyPropertyDetail extends RealtyPropertyDTO {
  documents: RealtyPropertyDocumentRow[];
  /** Exclusiva más reciente (vigente o no). La ficha enseña su estado. */
  exclusive:
    | {
        id: string;
        ownerId: string;
        startsAt: string;
        endsAt: string;
        commissionPct: number;
        signedDocUrl: string | null;
        daysLeft: number;
        isActive: boolean;
      }
    | null;
  /** Niveles/pisos (viven en el Json `amenities`; ver REALTY_LEVELS_KEY). */
  levels: number | null;
  daysListed: number;
}

// ── Secciones de la ficha (el guardado por partes) ─────────────────────
export type RealtyPropertySection =
  | "basicos"
  | "precio"
  | "medidas"
  | "amenidades"
  | "ubicacion"
  | "propietario"
  | "notas"
  | "publicacion";

export interface RealtyPropertyInput {
  kind?: RealtyPropertyKind;
  operation?: RealtyOperation;
  status?: RealtyPropertyStatus;
  title?: string;
  description?: string | null;
  price?: number;
  rentPrice?: number | null;
  currency?: RealtyCurrency;
  maintenanceFee?: number | null;
  commissionPct?: number | null;
  landM2?: number | null;
  builtM2?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  halfBathrooms?: number | null;
  parking?: number | null;
  ageYears?: number | null;
  levels?: number | null;
  amenities?: string[];
  address?: string | null;
  colonia?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
  showExactAddress?: boolean;
  ownerId?: string | null;
  assignedUserId?: string | null;
  internalNotes?: string | null;
  isPublished?: boolean;
}

// ── Propietarios ───────────────────────────────────────────────────────
export interface RealtyOwnerListItem extends RealtyPropertyOwnerDTO {
  propertyCount: number;
  activeExclusives: number;
}

export interface RealtyOwnerPage {
  rows: RealtyOwnerListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface RealtyOwnerDetail extends RealtyPropertyOwnerDTO {
  properties: {
    id: string;
    title: string;
    kind: RealtyPropertyKind;
    operation: RealtyOperation;
    status: RealtyPropertyStatus;
    price: number;
    rentPrice: number | null;
    currency: RealtyCurrency;
    colonia: string | null;
    city: string | null;
  }[];
  exclusives: {
    id: string;
    propertyId: string;
    propertyTitle: string;
    startsAt: string;
    endsAt: string;
    commissionPct: number;
    daysLeft: number;
    isActive: boolean;
  }[];
}

export interface RealtyOwnerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  rfc?: string | null;
  notes?: string | null;
}

export interface RealtyExclusiveInput {
  ownerId: string;
  startsAt: string;
  endsAt: string;
  commissionPct: number;
  signedDocUrl?: string | null;
}

// ── Cupo de archivos ───────────────────────────────────────────────────
export interface RealtyStorageUsage {
  usedBytes: number;
  quotaBytes: number;
  /** 0-100, ya recortado. 0 cuando el plan es ilimitado. */
  percent: number;
  isUnlimited: boolean;
  /** Bytes libres. Infinity si es ilimitado. */
  freeBytes: number;
  /** ≥ 90 %: la pantalla avisa pero deja subir. */
  nearLimit: boolean;
  /** Sin espacio: la subida se bloquea. */
  full: boolean;
}

/**
 * Función PURA: recibe el consumo y el cupo del plan, devuelve el estado.
 * La usa el servidor (con el valor vivo de la base) y podría usarla el
 * cliente sin arrastrar prisma.
 */
export function realtyStorageUsage(
  usedBytesRaw: bigint | number,
  storageQuotaMb: number,
): RealtyStorageUsage {
  const usedBytes = Number(usedBytesRaw);
  if (isRealtyUnlimited(storageQuotaMb)) {
    return {
      usedBytes,
      quotaBytes: REALTY_UNLIMITED,
      percent: 0,
      isUnlimited: true,
      freeBytes: Number.POSITIVE_INFINITY,
      nearLimit: false,
      full: false,
    };
  }
  const quotaBytes = Math.max(0, storageQuotaMb) * 1024 * 1024;
  const freeBytes = Math.max(0, quotaBytes - usedBytes);
  const percent = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 100;
  return {
    usedBytes,
    quotaBytes,
    percent,
    isUnlimited: false,
    freeBytes,
    nearLimit: percent >= 90,
    full: freeBytes <= 0,
  };
}

/** "2.4 GB", "860 MB", "12 KB". Para los avisos de cupo. */
export function formatRealtyBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
