import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { getAccessibleOfficeIds } from "@/lib/realty-auth";
import {
  makeRealtyFolio,
  makeRealtySlug,
  type RealtyCurrency,
  type RealtyDocumentKind,
  type RealtyOperation,
  type RealtyPropertyDocumentDTO,
  type RealtyPropertyKind,
  type RealtyPropertyPhotoDTO,
  type RealtyPropertyStatus,
  type RealtyPropertyTourDTO,
} from "@/lib/realty/types";
import { REALTY_DOC_URL_TTL, REALTY_PHOTO_URL_TTL, signRealtyUrls } from "@/lib/realty/media";
import {
  REALTY_DEFAULT_PAGE_SIZE,
  REALTY_LEVELS_KEY,
  REALTY_PAGE_SIZES,
  activeAmenityKeys,
  isAmenityKey,
  levelsFrom,
  type RealtyOwnerDetail,
  type RealtyOwnerInput,
  type RealtyOwnerPage,
  type RealtyPropertyDetail,
  type RealtyPropertyFacets,
  type RealtyPropertyFilters,
  type RealtyPropertyInput,
  type RealtyPropertyListItem,
  type RealtyPropertyPage,
  type RealtyPropertySection,
  type RealtyPropertySort,
  type RealtyExclusiveInput,
} from "@/lib/realty/properties-shared";

/**
 * DaleControl INMUEBLES — la cartera. Consultas, filtros y escrituras de
 * RealtyProperty, RealtyPropertyOwner y RealtyExclusive.
 *
 * 🔴 AISLAMIENTO. Toda función recibe el `ctx` de getRealtyContext() y
 * arranca su `where` con el accountId de la SESIÓN, nunca con uno del
 * request. Y ojo con la trampa de Prisma que ya nos costó antes: un
 * `accountId: undefined` no filtra "por nada" — BORRA el filtro y devuelve
 * la tabla entera de todos los inquilinos. Por eso el accountId se pone
 * siempre como literal del ctx y jamás como variable opcional.
 *
 * El recorte por OFICINA sale de getAccessibleOfficeIds (punto único). Un
 * inmueble puede tener officeId NULL (cartera sin oficina asignada) y un
 * `{ in: [...] }` a secas DESCARTA los nulos, así que va como OR explícito.
 *
 * ── ESTE ARCHIVO ES server-only ────────────────────────────────────────
 * Los tipos, las constantes y las funciones puras del módulo NO viven aquí
 * sino en `properties-shared.ts`: un componente "use client" que importara
 * de aquí aunque fuera una constante arrastraría prisma al navegador y el
 * build fallaría. Misma convención que plan-shared.ts / plans.ts.
 * Se re-exportan abajo para que el servidor tenga un solo sitio del que
 * importar.
 *
 * ── DOS HUECOS DEL SCHEMA, DOCUMENTADOS ────────────────────────────────
 * 1. NO existe columna de NIVELES/pisos → Json `amenities`, llave `_niveles`.
 * 2. NO existe `publishedAt` → "Días en cartera" se calcula desde
 *    `createdAt`. Decir "días publicado" sobre createdAt sería mentir.
 * Los dos están reportados para que una ola siguiente los promueva a
 * columna de verdad. Esta terminal NO toca prisma/schema.prisma.
 */

export * from "@/lib/realty/properties-shared";

const MS_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_DAY);
}

function num(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Texto de búsqueda saneado. "" significa "sin búsqueda". */
function cleanQuery(q: string | undefined): string {
  return (q ?? "").trim().slice(0, 120);
}

/**
 * El `where` base de TODA lectura de la cartera. Un solo lugar: si alguien
 * agrega una consulta nueva, la usa y no vuelve a escribir el aislamiento.
 */
async function scopeWhere(ctx: RealtyContext): Promise<Prisma.RealtyPropertyWhereInput> {
  const officeIds = await getAccessibleOfficeIds(ctx);
  return {
    accountId: ctx.accountId,
    // Un inmueble sin oficina asignada lo ve cualquiera de la cuenta: es
    // cartera "de la casa", no de una sucursal. El `in` solo no lo traería.
    OR: [{ officeId: { in: officeIds } }, { officeId: null }],
  };
}

function buildFilterWhere(
  f: RealtyPropertyFilters,
  now: Date,
): Prisma.RealtyPropertyWhereInput[] {
  const and: Prisma.RealtyPropertyWhereInput[] = [];

  const q = cleanQuery(f.q);
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { colonia: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { shortTermFolio: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (f.kind && f.kind.length > 0) and.push({ kind: { in: f.kind } });
  if (f.status && f.status.length > 0) and.push({ status: { in: f.status } });

  // "En venta" también trae los AMBAS: un inmueble que se vende o se renta
  // sí es resultado de una búsqueda de venta. Filtrar por igualdad exacta
  // escondería justo la cartera más flexible.
  if (f.operation === "VENTA") and.push({ operation: { in: ["VENTA", "AMBAS"] } });
  else if (f.operation === "RENTA") and.push({ operation: { in: ["RENTA", "AMBAS"] } });
  else if (f.operation === "AMBAS") and.push({ operation: "AMBAS" });

  if (f.currency) and.push({ currency: f.currency });

  // El rango de precio mira la columna que corresponde a la operación
  // buscada: en RENTA el `price` está en 0 y filtrar por él no devolvería
  // nada. Sin operación elegida, vale cualquiera de las dos.
  const min = typeof f.priceMin === "number" && f.priceMin > 0 ? f.priceMin : null;
  const max = typeof f.priceMax === "number" && f.priceMax > 0 ? f.priceMax : null;
  if (min !== null || max !== null) {
    const range: Prisma.DecimalFilter = {};
    if (min !== null) range.gte = new Prisma.Decimal(min);
    if (max !== null) range.lte = new Prisma.Decimal(max);
    if (f.operation === "RENTA") and.push({ rentPrice: range });
    else if (f.operation === "VENTA") and.push({ price: range });
    else and.push({ OR: [{ price: range }, { rentPrice: range }] });
  }

  if (typeof f.bedroomsMin === "number" && f.bedroomsMin > 0) {
    and.push({ bedrooms: { gte: f.bedroomsMin } });
  }
  if (typeof f.bathroomsMin === "number" && f.bathroomsMin > 0) {
    and.push({ bathrooms: { gte: f.bathroomsMin } });
  }

  if (f.city) and.push({ city: { equals: f.city, mode: "insensitive" } });
  if (f.colonia) and.push({ colonia: { equals: f.colonia, mode: "insensitive" } });
  if (f.assignedUserId) and.push({ assignedUserId: f.assignedUserId });

  if (f.hasTour === true) and.push({ tours: { some: {} } });
  else if (f.hasTour === false) and.push({ tours: { none: {} } });

  // VIGENTE = ya empezó y todavía no termina. Una exclusiva que vence
  // mañana cuenta; una que venció ayer, no.
  const vigente: Prisma.RealtyExclusiveWhereInput = {
    startsAt: { lte: now },
    endsAt: { gte: now },
  };
  if (f.hasExclusive === true) and.push({ exclusives: { some: vigente } });
  else if (f.hasExclusive === false) and.push({ exclusives: { none: vigente } });

  if (f.isPublished === true) and.push({ isPublished: true });
  else if (f.isPublished === false) and.push({ isPublished: false });

  return and;
}

function orderFor(sort: RealtyPropertySort): Prisma.RealtyPropertyOrderByWithRelationInput[] {
  switch (sort) {
    case "antiguos":
      return [{ createdAt: "asc" }];
    case "precioAsc":
      // 🔴 En Postgres, DESC pone los NULL PRIMERO y ASC los pone al final.
      // Un inmueble sin precio arriba de todo en "más barato" es ruido, así
      // que el desempate va por fecha y el nulo se hunde por el orden ASC.
      return [{ price: "asc" }, { createdAt: "desc" }];
    case "precioDesc":
      return [{ price: "desc" }, { createdAt: "desc" }];
    case "diasDesc":
      // Más días en cartera = más viejo = createdAt ascendente.
      return [{ createdAt: "asc" }];
    case "diasAsc":
      return [{ createdAt: "desc" }];
    case "recientes":
    default:
      return [{ createdAt: "desc" }];
  }
}

/** Listado paginado de la cartera. Paginado del lado del SERVIDOR. */
export async function listRealtyProperties(
  ctx: RealtyContext,
  filters: RealtyPropertyFilters = {},
): Promise<RealtyPropertyPage> {
  const now = new Date();
  const base = await scopeWhere(ctx);
  const where: Prisma.RealtyPropertyWhereInput = {
    ...base,
    AND: buildFilterWhere(filters, now),
  };

  const pageSize = REALTY_PAGE_SIZES.includes(
    filters.pageSize as (typeof REALTY_PAGE_SIZES)[number],
  )
    ? (filters.pageSize as number)
    : REALTY_DEFAULT_PAGE_SIZE;
  const total = await prisma.realtyProperty.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Una página fuera de rango (el usuario filtró estando en la 7) devuelve
  // la última que existe en vez de una tabla vacía sin explicación.
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);

  const rows = await prisma.realtyProperty.findMany({
    where,
    orderBy: orderFor(filters.sort ?? "recientes"),
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      title: true,
      kind: true,
      operation: true,
      status: true,
      price: true,
      rentPrice: true,
      currency: true,
      colonia: true,
      city: true,
      assignedUserId: true,
      bedrooms: true,
      bathrooms: true,
      builtM2: true,
      isPublished: true,
      publicUrlSlug: true,
      shortTermFolio: true,
      commissionPct: true,
      createdAt: true,
      assignedUser: { select: { firstName: true, lastName: true } },
      // La portada: isCover primero y, si nadie la marcó, la de menor orden.
      photos: {
        orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
        take: 1,
        select: { url: true },
      },
      _count: { select: { photos: true, tours: true } },
      exclusives: {
        where: { startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: { endsAt: "desc" },
        take: 1,
        select: { endsAt: true },
      },
    },
  });

  // Todas las portadas en UN round-trip (ver signRealtyUrls).
  const covers = await signRealtyUrls(
    rows.map((r) => r.photos[0]?.url ?? null),
    REALTY_PHOTO_URL_TTL,
  );

  return {
    rows: rows.map((r, i): RealtyPropertyListItem => {
      const exc = r.exclusives[0];
      return {
        id: r.id,
        title: r.title,
        kind: r.kind as RealtyPropertyKind,
        operation: r.operation as RealtyOperation,
        status: r.status as RealtyPropertyStatus,
        price: num(r.price) ?? 0,
        rentPrice: num(r.rentPrice),
        currency: r.currency as RealtyCurrency,
        colonia: r.colonia,
        city: r.city,
        assignedUserId: r.assignedUserId,
        assignedUserName: r.assignedUser
          ? `${r.assignedUser.firstName} ${r.assignedUser.lastName}`.trim()
          : null,
        bedrooms: r.bedrooms,
        bathrooms: r.bathrooms,
        builtM2: num(r.builtM2),
        coverUrl: covers[i] ?? "",
        photoCount: r._count.photos,
        hasTour: r._count.tours > 0,
        isPublished: r.isPublished,
        publicUrlSlug: r.publicUrlSlug,
        shortTermFolio: r.shortTermFolio,
        daysListed: Math.max(0, daysBetween(r.createdAt, now)),
        createdAt: r.createdAt.toISOString(),
        exclusiveEndsAt: exc ? exc.endsAt.toISOString() : null,
        exclusiveDaysLeft: exc ? Math.max(0, daysBetween(now, exc.endsAt)) : null,
        commissionPct: num(r.commissionPct),
      };
    }),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/**
 * Valores para llenar los desplegables de filtro: las ciudades y colonias
 * que la cuenta USA de verdad, y sus asesores. Sale de la propia cartera
 * para no ofrecer un filtro que no devuelve nada.
 */
export async function getRealtyPropertyFacets(ctx: RealtyContext): Promise<RealtyPropertyFacets> {
  const base = await scopeWhere(ctx);
  const [places, agents] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: base,
      select: { city: true, colonia: true },
      distinct: ["city", "colonia"],
      take: 500,
    }),
    prisma.realtyUser.findMany({
      where: { accountId: ctx.accountId, active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
    }),
  ]);

  const cities = Array.from(
    new Set(places.map((p) => (p.city ?? "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "es"));
  const colonias = Array.from(
    new Set(places.map((p) => (p.colonia ?? "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "es"));

  return {
    cities,
    colonias,
    agents: agents.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}`.trim() })),
  };
}

/**
 * Un inmueble de la cuenta viva, con todo lo que la ficha necesita.
 * Devuelve null si no existe O si es de otra cuenta — el caller responde
 * 404 en los dos casos: decir "existe pero no es tuyo" ya es filtrar.
 */
export async function getRealtyProperty(
  ctx: RealtyContext,
  id: string,
): Promise<RealtyPropertyDetail | null> {
  const now = new Date();
  const scope = await scopeWhere(ctx);
  const p = await prisma.realtyProperty.findFirst({
    // findFirst y no findUnique: el único es por `id` y no incluye la
    // cuenta, así que findUnique traería el inmueble de OTRO inquilino y
    // el filtro tendría que ir después, a mano. Aquí no hay ese hueco.
    //
    // 🔴 Y va con el MISMO scopeWhere que el listado, no solo con el
    // accountId. Si el detalle filtrara menos que la lista, un asesor
    // recortado a su oficina no vería el inmueble en /inmuebles pero sí
    // podría abrir su ficha escribiendo la URL — y la ficha trae notas
    // internas, comisión y las escrituras firmadas. La lista y el detalle
    // tienen que decir lo mismo.
    where: { ...scope, id },
    include: {
      assignedUser: { select: { firstName: true, lastName: true } },
      owner: { select: { name: true } },
      photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      tours: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      documents: { orderBy: { createdAt: "desc" } },
      exclusives: { orderBy: { endsAt: "desc" }, take: 1 },
    },
  });
  if (!p) return null;

  const [photoUrls, tourUrls, docUrls] = await Promise.all([
    signRealtyUrls(
      p.photos.map((f) => f.url),
      REALTY_PHOTO_URL_TTL,
    ),
    signRealtyUrls(
      p.tours.map((t) => t.fileUrl),
      REALTY_PHOTO_URL_TTL,
    ),
    signRealtyUrls(
      p.documents.map((d) => d.url),
      REALTY_DOC_URL_TTL,
    ),
  ]);

  const exc = p.exclusives[0] ?? null;
  const amenities = (p.amenities ?? null) as Record<string, unknown> | null;

  return {
    id: p.id,
    accountId: p.accountId,
    officeId: p.officeId,
    assignedUserId: p.assignedUserId,
    assignedUserName: p.assignedUser
      ? `${p.assignedUser.firstName} ${p.assignedUser.lastName}`.trim()
      : null,
    ownerId: p.ownerId,
    ownerName: p.owner?.name ?? null,
    kind: p.kind as RealtyPropertyKind,
    operation: p.operation as RealtyOperation,
    status: p.status as RealtyPropertyStatus,
    price: num(p.price) ?? 0,
    currency: p.currency as RealtyCurrency,
    rentPrice: num(p.rentPrice),
    maintenanceFee: num(p.maintenanceFee),
    landM2: num(p.landM2),
    builtM2: num(p.builtM2),
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    halfBathrooms: p.halfBathrooms,
    parking: p.parking,
    ageYears: p.ageYears,
    amenities,
    address: p.address,
    colonia: p.colonia,
    city: p.city,
    state: p.state,
    zip: p.zip,
    lat: num(p.lat),
    lng: num(p.lng),
    showExactAddress: p.showExactAddress,
    title: p.title,
    description: p.description,
    internalNotes: p.internalNotes,
    commissionPct: num(p.commissionPct),
    isPublished: p.isPublished,
    publicUrlSlug: p.publicUrlSlug,
    shortTermFolio: p.shortTermFolio,
    createdAt: p.createdAt.toISOString(),
    photos: p.photos.map(
      (f, i): RealtyPropertyPhotoDTO => ({
        id: f.id,
        sortOrder: f.sortOrder,
        url: photoUrls[i] ?? "",
        width: f.width,
        height: f.height,
        bytes: f.bytes,
        isCover: f.isCover,
        watermarked: f.watermarked,
      }),
    ),
    tours: p.tours.map(
      (t, i): RealtyPropertyTourDTO => ({
        id: t.id,
        kind: t.kind as RealtyPropertyTourDTO["kind"],
        provider: t.provider,
        externalUrl: t.externalUrl,
        // Para una panorámica propia esto es la URL FIRMADA, no el path:
        // el visor la consume tal cual desde el navegador.
        fileUrl: t.fileUrl ? (tourUrls[i] ?? "") : null,
        bytes: t.bytes,
        sortOrder: t.sortOrder,
      }),
    ),
    documents: p.documents.map(
      (d, i): RealtyPropertyDocumentDTO => ({
        id: d.id,
        kind: d.kind as RealtyDocumentKind,
        name: d.name,
        url: docUrls[i] ?? "",
        bytes: d.bytes,
        createdAt: d.createdAt.toISOString(),
      }),
    ),
    exclusive: exc
      ? {
          id: exc.id,
          ownerId: exc.ownerId,
          startsAt: exc.startsAt.toISOString(),
          endsAt: exc.endsAt.toISOString(),
          commissionPct: num(exc.commissionPct) ?? 0,
          signedDocUrl: exc.signedDocUrl,
          daysLeft: daysBetween(now, exc.endsAt),
          isActive: exc.startsAt <= now && exc.endsAt >= now,
        }
      : null,
    levels: levelsFrom(amenities),
    daysListed: Math.max(0, daysBetween(p.createdAt, now)),
  };
}

/**
 * Existencia + pertenencia, sin traerse la ficha entera. Lo usan las rutas
 * de fotos/tours/documentos antes de escribir: es la puerta del tenant.
 */
export async function assertOwnedProperty(
  ctx: RealtyContext,
  propertyId: string,
): Promise<{ id: string; title: string } | null> {
  // Mismo alcance que el listado y que la ficha: quien no puede VER el
  // inmueble tampoco le cuelga fotos, recorridos ni documentos.
  const scope = await scopeWhere(ctx);
  return prisma.realtyProperty.findFirst({
    where: { ...scope, id: propertyId },
    select: { id: true, title: true },
  });
}

// ── Escrituras: el alta y el guardado POR SECCIÓN ──────────────────────
function dec(v: number | null | undefined): Prisma.Decimal | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return new Prisma.Decimal(v);
}

function intOrNull(v: number | null | undefined, max = 9999): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(0, Math.round(v)));
}

function textOrNull(v: string | null | undefined, max = 500): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Arma el Json `amenities` conservando las llaves reservadas. Se construye
 * ENTERO cada vez (no se hace merge de casillas sueltas): una amenidad que
 * el usuario desmarcó tiene que desaparecer, y un merge la dejaría viva.
 */
function buildAmenities(
  amenityKeys: string[] | undefined,
  levels: number | null | undefined,
  previous: Record<string, unknown> | null,
): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};

  // Llaves reservadas anteriores que no toca esta pantalla (las de otras olas).
  if (previous) {
    for (const [k, v] of Object.entries(previous)) {
      if (!isAmenityKey(k) && k !== REALTY_LEVELS_KEY) out[k] = v;
    }
  }

  const keys = amenityKeys ?? (previous ? activeAmenityKeys(previous) : []);
  for (const raw of keys) {
    const k = String(raw).slice(0, 40);
    // Solo llaves de amenidad: un "_niveles" colado por el cliente no
    // puede entrar por la puerta de las casillas.
    if (!k || !isAmenityKey(k)) continue;
    out[k] = true;
  }

  const lv = levels === undefined ? levelsFrom(previous) : levels;
  if (lv !== null && lv !== undefined && Number.isFinite(lv) && lv > 0) {
    out[REALTY_LEVELS_KEY] = Math.min(200, Math.round(lv));
  }
  return out as Prisma.InputJsonValue;
}

/**
 * Folio único por cuenta. Reintenta ante choque: el alfabeto son 32^4 ≈ 1 M
 * combinaciones, así que con una cartera grande el choque deja de ser
 * teórico. Si tras varios intentos no hay hueco, se deja NULL — el folio es
 * una comodidad para dictar por teléfono, no puede impedir dar de alta.
 */
async function freeFolio(accountId: string): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    const folio = makeRealtyFolio();
    const taken = await prisma.realtyProperty.findFirst({
      where: { accountId, shortTermFolio: folio },
      select: { id: true },
    });
    if (!taken) return folio;
  }
  return null;
}

/** Slug público único por cuenta, derivado del título. */
async function freeSlug(accountId: string, title: string, selfId?: string): Promise<string> {
  const base = makeRealtySlug(title) || "inmueble";
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.realtyProperty.findFirst({
      where: { accountId, publicUrlSlug: candidate, ...(selfId ? { NOT: { id: selfId } } : {}) },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** ¿El propietario es de esta cuenta? Un ownerId ajeno cruzaría inquilinos. */
async function validOwnerId(accountId: string, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  const owner = await prisma.realtyPropertyOwner.findFirst({
    where: { id: ownerId, accountId },
    select: { id: true },
  });
  return owner?.id ?? null;
}

/** ¿El asesor es de esta cuenta y sigue activo? */
async function validAgentId(accountId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = await prisma.realtyUser.findFirst({
    where: { id: userId, accountId, active: true },
    select: { id: true },
  });
  return u?.id ?? null;
}

export async function createRealtyProperty(
  ctx: RealtyContext,
  input: RealtyPropertyInput,
): Promise<{ id: string }> {
  const title = textOrNull(input.title, 160) ?? "Inmueble sin título";
  const [folio, slug, ownerId, assignedUserId] = await Promise.all([
    freeFolio(ctx.accountId),
    freeSlug(ctx.accountId, title),
    validOwnerId(ctx.accountId, input.ownerId ?? null),
    validAgentId(ctx.accountId, input.assignedUserId ?? null),
  ]);

  return prisma.realtyProperty.create({
    data: {
      accountId: ctx.accountId,
      kind: input.kind ?? "CASA",
      operation: input.operation ?? "VENTA",
      status: input.status ?? "DISPONIBLE",
      title,
      description: textOrNull(input.description, 8000),
      price: dec(input.price ?? 0) ?? new Prisma.Decimal(0),
      currency: input.currency ?? "MXN",
      rentPrice: dec(input.rentPrice),
      maintenanceFee: dec(input.maintenanceFee),
      commissionPct: dec(input.commissionPct),
      landM2: dec(input.landM2),
      builtM2: dec(input.builtM2),
      bedrooms: intOrNull(input.bedrooms, 99),
      bathrooms: intOrNull(input.bathrooms, 99),
      halfBathrooms: intOrNull(input.halfBathrooms, 99),
      parking: intOrNull(input.parking, 99),
      ageYears: intOrNull(input.ageYears, 300),
      amenities: buildAmenities(input.amenities, input.levels ?? null, null),
      address: textOrNull(input.address, 240),
      colonia: textOrNull(input.colonia, 120),
      city: textOrNull(input.city, 120),
      state: textOrNull(input.state, 120),
      zip: textOrNull(input.zip, 10),
      lat: dec(input.lat),
      lng: dec(input.lng),
      showExactAddress: input.showExactAddress === true,
      internalNotes: textOrNull(input.internalNotes, 8000),
      // Nada se publica solo: el interruptor de la web se enciende a mano.
      isPublished: false,
      publicUrlSlug: slug,
      shortTermFolio: folio,
      ownerId,
      assignedUserId,
    },
    select: { id: true },
  });
}

/**
 * Guardado POR SECCIÓN. Cada sección escribe SOLO sus columnas: así dos
 * pestañas abiertas en el mismo inmueble no se pisan los campos que la otra
 * no tocó, que es justo lo que pasa con un formulario de un solo botón.
 */
export async function updateRealtyPropertySection(
  ctx: RealtyContext,
  id: string,
  section: RealtyPropertySection,
  input: RealtyPropertyInput,
): Promise<boolean> {
  // Mismo alcance que la lectura: no se edita lo que no se puede ver.
  const scope = await scopeWhere(ctx);
  const current = await prisma.realtyProperty.findFirst({
    where: { ...scope, id },
    select: { id: true, amenities: true, title: true, publicUrlSlug: true },
  });
  if (!current) return false;

  const data: Prisma.RealtyPropertyUpdateManyMutationInput = {};

  switch (section) {
    case "basicos": {
      if (input.kind) data.kind = input.kind;
      if (input.operation) data.operation = input.operation;
      if (input.status) data.status = input.status;
      if (input.title !== undefined) {
        const title = textOrNull(input.title, 160) ?? current.title;
        data.title = title;
        // El slug se regenera solo si aún no había uno: cambiarlo después
        // rompería las ligas que el asesor ya mandó por WhatsApp.
        if (!current.publicUrlSlug) {
          data.publicUrlSlug = await freeSlug(ctx.accountId, title, id);
        }
      }
      if (input.description !== undefined) {
        data.description = textOrNull(input.description, 8000);
      }
      break;
    }
    case "precio": {
      if (input.price !== undefined) data.price = dec(input.price) ?? new Prisma.Decimal(0);
      if (input.rentPrice !== undefined) data.rentPrice = dec(input.rentPrice);
      if (input.currency) data.currency = input.currency;
      if (input.maintenanceFee !== undefined) data.maintenanceFee = dec(input.maintenanceFee);
      if (input.commissionPct !== undefined) data.commissionPct = dec(input.commissionPct);
      break;
    }
    case "medidas": {
      if (input.landM2 !== undefined) data.landM2 = dec(input.landM2);
      if (input.builtM2 !== undefined) data.builtM2 = dec(input.builtM2);
      if (input.bedrooms !== undefined) data.bedrooms = intOrNull(input.bedrooms, 99);
      if (input.bathrooms !== undefined) data.bathrooms = intOrNull(input.bathrooms, 99);
      if (input.halfBathrooms !== undefined) {
        data.halfBathrooms = intOrNull(input.halfBathrooms, 99);
      }
      if (input.parking !== undefined) data.parking = intOrNull(input.parking, 99);
      if (input.ageYears !== undefined) data.ageYears = intOrNull(input.ageYears, 300);
      // Niveles vive en el Json: se reescribe conservando las casillas.
      if (input.levels !== undefined) {
        data.amenities = buildAmenities(
          undefined,
          input.levels,
          (current.amenities ?? null) as Record<string, unknown> | null,
        );
      }
      break;
    }
    case "amenidades": {
      data.amenities = buildAmenities(
        input.amenities ?? [],
        undefined,
        (current.amenities ?? null) as Record<string, unknown> | null,
      );
      break;
    }
    case "ubicacion": {
      if (input.address !== undefined) data.address = textOrNull(input.address, 240);
      if (input.colonia !== undefined) data.colonia = textOrNull(input.colonia, 120);
      if (input.city !== undefined) data.city = textOrNull(input.city, 120);
      if (input.state !== undefined) data.state = textOrNull(input.state, 120);
      if (input.zip !== undefined) data.zip = textOrNull(input.zip, 10);
      if (input.lat !== undefined) data.lat = dec(input.lat);
      if (input.lng !== undefined) data.lng = dec(input.lng);
      if (input.showExactAddress !== undefined) {
        data.showExactAddress = input.showExactAddress === true;
      }
      break;
    }
    case "propietario": {
      // Las relaciones no se escriben con updateMany: van por
      // updateRealtyPropertyRelations. Aquí no hay nada que hacer.
      return true;
    }
    case "notas": {
      if (input.internalNotes !== undefined) {
        data.internalNotes = textOrNull(input.internalNotes, 8000);
      }
      break;
    }
    case "publicacion": {
      if (input.isPublished !== undefined) {
        data.isPublished = input.isPublished === true;
        if (input.isPublished === true && !current.publicUrlSlug) {
          data.publicUrlSlug = await freeSlug(ctx.accountId, current.title, id);
        }
      }
      break;
    }
  }

  if (Object.keys(data).length === 0) return true;

  // updateMany y no update: el `where` lleva el accountId, así que un id de
  // otra cuenta no escribe nada en vez de escribir "por id" a ciegas.
  const res = await prisma.realtyProperty.updateMany({
    where: { ...scope, id },
    data,
  });
  return res.count > 0;
}

/**
 * `updateMany` no sabe de relaciones, así que la sección de
 * propietario/asesor se escribe aparte — pero SOLO después de comprobar
 * que la fila es de la cuenta, y validando que el dueño y el asesor
 * también lo sean.
 */
export async function updateRealtyPropertyRelations(
  ctx: RealtyContext,
  id: string,
  ownerId: string | null | undefined,
  assignedUserId: string | null | undefined,
): Promise<{ ok: boolean; reason?: "not_found" | "bad_owner" | "bad_agent" }> {
  const exists = await assertOwnedProperty(ctx, id);
  if (!exists) return { ok: false, reason: "not_found" };

  // Unchecked: es la variante de Prisma que admite las COLUMNAS de llave
  // foránea (ownerId / assignedUserId) en vez de un connect/disconnect. Es
  // justo lo que queremos aquí — el id ya viene validado contra la cuenta.
  const data: Prisma.RealtyPropertyUncheckedUpdateManyInput = {};

  if (ownerId !== undefined) {
    if (ownerId === null) {
      data.ownerId = null; // el usuario SÍ pidió desligar
    } else {
      const valid = await validOwnerId(ctx.accountId, ownerId);
      // 🔴 Un id que no valida NO se convierte en null en silencio. Antes
      // lo hacía, y desligar al propietario sin avisar es peor que no
      // guardar: el asesor cree que quedó ligado y la exclusiva se queda
      // sin dueño. Falla ruidoso.
      if (!valid) return { ok: false, reason: "bad_owner" };
      data.ownerId = valid;
    }
  }

  if (assignedUserId !== undefined) {
    if (assignedUserId === null) {
      data.assignedUserId = null;
    } else {
      const valid = await validAgentId(ctx.accountId, assignedUserId);
      if (!valid) return { ok: false, reason: "bad_agent" };
      data.assignedUserId = valid;
    }
  }

  if (Object.keys(data).length === 0) return { ok: true };

  const res = await prisma.realtyProperty.updateMany({
    where: { id, accountId: ctx.accountId },
    data,
  });
  return res.count > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function setRealtyPropertyStatus(
  ctx: RealtyContext,
  id: string,
  status: RealtyPropertyStatus,
): Promise<boolean> {
  const scope = await scopeWhere(ctx);
  const res = await prisma.realtyProperty.updateMany({
    where: { ...scope, id },
    data: { status },
  });
  return res.count > 0;
}

export async function setRealtyPropertyPublished(
  ctx: RealtyContext,
  id: string,
  isPublished: boolean,
): Promise<boolean> {
  return updateRealtyPropertySection(ctx, id, "publicacion", { isPublished });
}

/**
 * Borrar el inmueble. Devuelve los bytes liberados para que el caller
 * descuente el consumo: la fila se va por cascada, pero el objeto en
 * Storage NO — se quedaría ocupando cupo para siempre.
 *
 * 🔴 RealtyExclusive apunta al inmueble con onDelete: NoAction a propósito
 * (el papel firmado no se borra con el inmueble). Si hay exclusivas, el
 * delete TRUENA con una violación de llave foránea. Se avisa en vez de
 * dejar salir un 500 sin explicación.
 */
export async function deleteRealtyProperty(
  ctx: RealtyContext,
  id: string,
): Promise<{ ok: boolean; reason?: "not_found" | "has_exclusive"; freedBytes: number }> {
  const scope = await scopeWhere(ctx);
  const p = await prisma.realtyProperty.findFirst({
    where: { ...scope, id },
    select: {
      id: true,
      photos: { select: { bytes: true } },
      tours: { select: { bytes: true } },
      documents: { select: { bytes: true } },
      _count: { select: { exclusives: true } },
    },
  });
  if (!p) return { ok: false, reason: "not_found", freedBytes: 0 };
  if (p._count.exclusives > 0) return { ok: false, reason: "has_exclusive", freedBytes: 0 };

  const freedBytes =
    p.photos.reduce((s, f) => s + (f.bytes || 0), 0) +
    p.tours.reduce((s, t) => s + (t.bytes || 0), 0) +
    p.documents.reduce((s, d) => s + (d.bytes || 0), 0);

  await prisma.realtyProperty.deleteMany({ where: { id, accountId: ctx.accountId } });
  return { ok: true, freedBytes };
}

/** Paths en Storage de todo lo que cuelga del inmueble (para el borrado). */
export async function propertyStoragePaths(
  ctx: RealtyContext,
  id: string,
): Promise<string[]> {
  const scope = await scopeWhere(ctx);
  const p = await prisma.realtyProperty.findFirst({
    where: { ...scope, id },
    select: {
      photos: { select: { url: true } },
      tours: { select: { fileUrl: true } },
      documents: { select: { url: true } },
    },
  });
  if (!p) return [];
  return [
    ...p.photos.map((f) => f.url),
    ...p.tours.map((t) => t.fileUrl ?? ""),
    ...p.documents.map((d) => d.url),
  ].filter((s): s is string => !!s && !s.startsWith("http"));
}

// ── Propietarios ───────────────────────────────────────────────────────
export async function listRealtyOwners(
  ctx: RealtyContext,
  opts: { q?: string; page?: number; pageSize?: number } = {},
): Promise<RealtyOwnerPage> {
  const now = new Date();
  const q = cleanQuery(opts.q);
  const where: Prisma.RealtyPropertyOwnerWhereInput = {
    accountId: ctx.accountId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { rfc: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const pageSize = Math.min(100, Math.max(5, Math.floor(opts.pageSize ?? 25)));
  const total = await prisma.realtyPropertyOwner.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pageCount);

  const rows = await prisma.realtyPropertyOwner.findMany({
    where,
    orderBy: { name: "asc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      _count: { select: { properties: true } },
      exclusives: {
        where: { startsAt: { lte: now }, endsAt: { gte: now } },
        select: { id: true },
      },
    },
  });

  return {
    rows: rows.map((o) => ({
      id: o.id,
      name: o.name,
      phone: o.phone,
      email: o.email,
      rfc: o.rfc,
      notes: o.notes,
      createdAt: o.createdAt.toISOString(),
      propertyCount: o._count.properties,
      activeExclusives: o.exclusives.length,
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

export async function getRealtyOwner(
  ctx: RealtyContext,
  id: string,
): Promise<RealtyOwnerDetail | null> {
  const now = new Date();
  const o = await prisma.realtyPropertyOwner.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      properties: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          kind: true,
          operation: true,
          status: true,
          price: true,
          rentPrice: true,
          currency: true,
          colonia: true,
          city: true,
        },
      },
      exclusives: {
        orderBy: { endsAt: "desc" },
        include: { property: { select: { title: true } } },
      },
    },
  });
  if (!o) return null;

  return {
    id: o.id,
    name: o.name,
    phone: o.phone,
    email: o.email,
    rfc: o.rfc,
    notes: o.notes,
    createdAt: o.createdAt.toISOString(),
    properties: o.properties.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind as RealtyPropertyKind,
      operation: p.operation as RealtyOperation,
      status: p.status as RealtyPropertyStatus,
      price: num(p.price) ?? 0,
      rentPrice: num(p.rentPrice),
      currency: p.currency as RealtyCurrency,
      colonia: p.colonia,
      city: p.city,
    })),
    exclusives: o.exclusives.map((e) => ({
      id: e.id,
      propertyId: e.propertyId,
      propertyTitle: e.property.title,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      commissionPct: num(e.commissionPct) ?? 0,
      daysLeft: daysBetween(now, e.endsAt),
      isActive: e.startsAt <= now && e.endsAt >= now,
    })),
  };
}

export async function createRealtyOwner(
  ctx: RealtyContext,
  input: RealtyOwnerInput,
): Promise<{ id: string; name: string }> {
  return prisma.realtyPropertyOwner.create({
    data: {
      accountId: ctx.accountId,
      name: textOrNull(input.name, 160) ?? "Propietario",
      phone: textOrNull(input.phone, 30),
      email: textOrNull(input.email, 160),
      rfc: textOrNull(input.rfc, 20),
      notes: textOrNull(input.notes, 4000),
    },
    select: { id: true, name: true },
  });
}

export async function updateRealtyOwner(
  ctx: RealtyContext,
  id: string,
  input: Partial<RealtyOwnerInput>,
): Promise<boolean> {
  const data: Prisma.RealtyPropertyOwnerUpdateManyMutationInput = {};
  if (input.name !== undefined) {
    const name = textOrNull(input.name, 160);
    // Un propietario sin nombre no se puede identificar en ninguna lista:
    // se ignora el vacío en vez de guardarlo.
    if (name) data.name = name;
  }
  if (input.phone !== undefined) data.phone = textOrNull(input.phone, 30);
  if (input.email !== undefined) data.email = textOrNull(input.email, 160);
  if (input.rfc !== undefined) data.rfc = textOrNull(input.rfc, 20);
  if (input.notes !== undefined) data.notes = textOrNull(input.notes, 4000);
  if (Object.keys(data).length === 0) return true;

  const res = await prisma.realtyPropertyOwner.updateMany({
    where: { id, accountId: ctx.accountId },
    data,
  });
  return res.count > 0;
}

/**
 * Borrar propietario. RealtyProperty.owner tiene onDelete: NoAction a
 * propósito, así que con inmuebles a su nombre el delete TRUENA en la base.
 * Se comprueba antes para dar un mensaje que se entienda, en vez de un 500.
 */
export async function deleteRealtyOwner(
  ctx: RealtyContext,
  id: string,
): Promise<{ ok: boolean; reason?: "not_found" | "has_properties" | "has_exclusives" }> {
  const o = await prisma.realtyPropertyOwner.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, _count: { select: { properties: true, exclusives: true } } },
  });
  if (!o) return { ok: false, reason: "not_found" };
  if (o._count.properties > 0) return { ok: false, reason: "has_properties" };
  if (o._count.exclusives > 0) return { ok: false, reason: "has_exclusives" };

  await prisma.realtyPropertyOwner.deleteMany({ where: { id, accountId: ctx.accountId } });
  return { ok: true };
}

/** Los propietarios para el desplegable de la ficha (sin paginar). */
export async function listOwnerOptions(
  ctx: RealtyContext,
): Promise<{ id: string; name: string; phone: string | null }[]> {
  return prisma.realtyPropertyOwner.findMany({
    where: { accountId: ctx.accountId },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

// ── Exclusiva ──────────────────────────────────────────────────────────
/**
 * Alta o edición de la exclusiva del inmueble. Se guarda UNA por inmueble
 * (la vigente): si ya hay, se actualiza; si no, se crea.
 */
export async function saveRealtyExclusive(
  ctx: RealtyContext,
  propertyId: string,
  input: RealtyExclusiveInput,
): Promise<{ ok: boolean; reason?: "not_found" | "bad_owner" | "bad_dates" }> {
  const prop = await assertOwnedProperty(ctx, propertyId);
  if (!prop) return { ok: false, reason: "not_found" };

  const ownerId = await validOwnerId(ctx.accountId, input.ownerId);
  if (!ownerId) return { ok: false, reason: "bad_owner" };

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, reason: "bad_dates" };
  }
  if (endsAt <= startsAt) return { ok: false, reason: "bad_dates" };

  const pct = Math.min(100, Math.max(0, Number(input.commissionPct) || 0));
  const existing = await prisma.realtyExclusive.findFirst({
    where: { accountId: ctx.accountId, propertyId },
    orderBy: { endsAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    await prisma.realtyExclusive.updateMany({
      where: { id: existing.id, accountId: ctx.accountId },
      data: {
        ownerId,
        startsAt,
        endsAt,
        commissionPct: new Prisma.Decimal(pct),
        ...(input.signedDocUrl !== undefined
          ? { signedDocUrl: textOrNull(input.signedDocUrl, 500) }
          : {}),
      },
    });
  } else {
    await prisma.realtyExclusive.create({
      data: {
        accountId: ctx.accountId,
        propertyId,
        ownerId,
        startsAt,
        endsAt,
        commissionPct: new Prisma.Decimal(pct),
        signedDocUrl: textOrNull(input.signedDocUrl ?? null, 500),
      },
    });
  }
  return { ok: true };
}

export async function deleteRealtyExclusive(
  ctx: RealtyContext,
  propertyId: string,
): Promise<boolean> {
  const res = await prisma.realtyExclusive.deleteMany({
    where: { accountId: ctx.accountId, propertyId },
  });
  return res.count > 0;
}
