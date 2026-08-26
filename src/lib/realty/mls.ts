import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { REALTY_PHOTO_URL_TTL, signRealtyUrls } from "@/lib/realty/media";
import { aInmueblePublico, type RealtyWebInmuebleDTO } from "@/lib/realty/landing";
import type {
  RealtyCurrency,
  RealtyOperation,
  RealtyPropertyKind,
  RealtyPropertyStatus,
} from "@/lib/realty/types";
import {
  REALTY_MLS_MAX_ADOPTIONS,
  REALTY_MLS_MAX_PAGE_SIZE,
  REALTY_MLS_PAGE_SIZE,
  REALTY_MLS_SORTS,
  isRealtyMlsField,
  normalizePct,
  sanitizeExposedFields,
  type RealtyMlsAdoptionDTO,
  type RealtyMlsAgencyDTO,
  type RealtyMlsAgreementDTO,
  type RealtyMlsAgreementStatus,
  type RealtyMlsDashboard,
  type RealtyMlsField,
  type RealtyMlsFilters,
  type RealtyMlsListingDTO,
  type RealtyMlsMineDTO,
  type RealtyMlsPhotoDTO,
  type RealtyMlsReceivableDTO,
  type RealtyMlsSearchResult,
  type RealtyMlsShareInput,
  type RealtyMlsSort,
  type RealtyMlsTourDTO,
} from "@/components/realty/mls/mls-contract";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — BOLSA INMOBILIARIA (MLS interna). El motor.
 *
 * 🔴 ESTA ES LA ÚNICA PARTE DEL PRODUCTO DONDE UNA CUENTA VE DATOS DE
 * OTRA. Todo lo demás del vertical arranca su `where` con el accountId de
 * la sesión y ahí se acaba la conversación. Aquí no se puede, así que el
 * aislamiento tiene que venir de otro lado — y viene de tres reglas que no
 * se negocian:
 *
 *   1. CONSENTIMIENTO EXPLÍCITO. Un inmueble solo existe para otras
 *      cuentas si su dueño creó una fila en realty_mls_listings y la dejó
 *      `active`. No hay "compartido por omisión", no hay herencia, no hay
 *      "si está publicado en tu web ya cuenta". Apagar el interruptor lo
 *      retira de la bolsa de todos en la MISMA consulta.
 *
 *   2. LISTA BLANCA DE CAMPOS. Nada cruza de una cuenta a otra si no está
 *      en REALTY_MLS_PUBLIC_FIELDS (mls-contract.ts). Los DTO se
 *      construyen campo por campo: en este archivo NO hay un solo spread
 *      de una fila de Prisma, y eso es deliberado. Un `...row` es
 *      exactamente cómo se filtra la columna que alguien agregue mañana.
 *
 *   3. EL ID AJENO NO VIAJA. El navegador jamás recibe el accountId de
 *      otra cuenta ni manda uno: para todo —proponer, adoptar, contactar—
 *      manda el `listingId` y el servidor deriva de quién es. Un id que no
 *      viaja es un id que no se puede falsificar.
 *
 * ── LA TRAMPA DE PRISMA QUE YA COSTÓ CARA ──────────────────────────────
 * Un `accountId: undefined` en un `where` NO filtra por nada: BORRA el
 * filtro y devuelve la tabla de todos los inquilinos. Por eso el accountId
 * se escribe siempre como literal del ctx, nunca como variable opcional.
 *
 * ── ESTE ARCHIVO ES server-only ────────────────────────────────────────
 * Los tipos, las constantes y la lista blanca viven en
 * `src/components/realty/mls/mls-contract.ts`, que es puro. Un componente
 * "use client" que importara de aquí —aunque fuera una constante—
 * arrastraría prisma al navegador y el build se caería.
 *
 * ── SIN LLAVES FORÁNEAS ────────────────────────────────────────────────
 * Las tres tablas no tienen FK (ver el comentario del schema). Eso obliga
 * a que cada lectura vuelva a leer el inmueble y la cuenta y COMPRUEBE la
 * invariante `property.accountId === listing.accountId`. Una fila huérfana
 * o incoherente no produce resultados: falla CERRADA, que es como tiene
 * que fallar la única puerta entre inquilinos.
 * ═══════════════════════════════════════════════════════════════════════
 */

export * from "@/components/realty/mls/mls-contract";

/**
 * Cuántas fichas de la bolsa se traen a memoria para filtrar y ordenar.
 *
 * La bolsa no se puede paginar en SQL: sin FK no hay join entre
 * realty_mls_listings (donde vive la comisión compartida) y
 * realty_properties (donde viven precio, recámaras y ciudad), así que el
 * cruce se hace aquí. Con este tope, una bolsa de hasta 2 000 fichas
 * activas se ordena y pagina exacto.
 *
 * 🔴 Si se pasa, la pantalla lo DICE (`truncado` en la respuesta) en vez de
 * enseñar una lista recortada que parece completa. Ese día toca promover
 * el cruce a una vista SQL, no subir el número en silencio.
 */
export const REALTY_MLS_SCAN_CAP = 2000;

// El tope de adopciones (REALTY_MLS_MAX_ADOPTIONS) vive en el CONTRATO y no
// aquí: la pantalla lo necesita para decir "3 de 24 lugares usados" y este
// archivo es server-only. Sale por el `export *` de arriba, así que quien
// importe de `@/lib/realty/mls` lo sigue viendo en el mismo sitio de antes.

const MAX_NOTES = 400;
const MAX_MESSAGE = 600;

// ═══════════════════════════════════════════════════════════════════════
// 0. Utilidades locales
// ═══════════════════════════════════════════════════════════════════════

function num(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v: Prisma.Decimal | number | null | undefined): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function iso(v: Date | null | undefined): string | null {
  return v instanceof Date ? v.toISOString() : null;
}

function clampText(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s.slice(0, max);
}

/** Amenidades: solo las llaves en true. El Json crudo NUNCA sale. */
function amenityKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([k]) => k)
    .slice(0, 30);
}

/** Los campos guardados en `exposedFields`, ya saneados contra la lista blanca. */
function fieldsOf(raw: Prisma.JsonValue | null | undefined): RealtyMlsField[] {
  return sanitizeExposedFields(raw);
}

/**
 * 🔴 EL SELECT DE LA BOLSA. Vive aquí dentro y no en una constante
 * compartida, con el mismo criterio que el feed de portales: una constante
 * que se pueda extender desde fuera es una constante que alguien va a
 * extender desde fuera.
 *
 * Lo que NO está aquí, y NO PUEDE ESTAR NUNCA:
 *   internalNotes · commissionPct · ownerId · owner · assignedUserId ·
 *   officeId · documents · exclusives · leads · visits · keys · tasks
 *
 * `accountId` sí se trae, y es a propósito: hace falta para comprobar la
 * invariante contra el dueño de la fila de bolsa. NO sale al DTO.
 */
const SELECT_BOLSA = {
  id: true,
  accountId: true,
  kind: true,
  operation: true,
  status: true,
  price: true,
  currency: true,
  rentPrice: true,
  maintenanceFee: true,
  landM2: true,
  builtM2: true,
  bedrooms: true,
  bathrooms: true,
  halfBathrooms: true,
  parking: true,
  ageYears: true,
  amenities: true,
  colonia: true,
  city: true,
  state: true,
  zip: true,
  address: true,
  lat: true,
  lng: true,
  showExactAddress: true,
  title: true,
  description: true,
  shortTermFolio: true,
  publicUrlSlug: true,
  isPublished: true,
  createdAt: true,
  photos: {
    select: { url: true, isCover: true, sortOrder: true },
    orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
    take: 12,
  },
  tours: {
    select: { kind: true, externalUrl: true, fileUrl: true },
    take: 4,
  },
} satisfies Prisma.RealtyPropertySelect;

type BolsaPropertyRow = Prisma.RealtyPropertyGetPayload<{ select: typeof SELECT_BOLSA }>;

/**
 * La cuenta que comparte, tal como la ve el colega. Campo por campo.
 *
 * 🔴 SIN `id`, y sin whatsappToken, wabaId, stripeCustomerId, licencia ni
 * cupos. El teléfono y el correo son los DEL NEGOCIO —los mismos que esa
 * cuenta ya publica en su web— y jamás los del propietario del inmueble,
 * que ni siquiera se lee de la base en este módulo.
 */
const SELECT_AGENCIA = {
  id: true,
  name: true,
  slug: true,
  city: true,
  state: true,
  logoUrl: true,
  phone: true,
  email: true,
  isActive: true,
} satisfies Prisma.RealtyAccountSelect;

type AgencyRow = Prisma.RealtyAccountGetPayload<{ select: typeof SELECT_AGENCIA }>;

function toAgencia(row: AgencyRow): RealtyMlsAgencyDTO {
  return {
    nombre: row.name,
    slug: row.slug,
    ciudad: str(row.city),
    estado: str(row.state),
    logoUrl: str(row.logoUrl),
    telefono: str(row.phone),
    correo: str(row.email),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. LA PROYECCIÓN — el único sitio por donde un inmueble cruza de cuenta
// ═══════════════════════════════════════════════════════════════════════

/**
 * Inmueble ajeno → ficha de bolsa, recortada por la lista blanca.
 *
 * Se construye campo por campo y cada uno pasa por `on(...)`, que consulta
 * la lista de campos que el DUEÑO autorizó. Un campo no autorizado sale
 * como null (o como lista vacía), nunca como el valor real.
 *
 * La dirección exacta y las coordenadas tienen DOS rejas encima: la lista
 * de campos del dueño y su `showExactAddress`. Con que una diga que no,
 * salen en null. Un pin "aproximado" con la latitud real a siete decimales
 * es la dirección exacta con otro nombre.
 */
function projectListing(input: {
  listing: {
    id: string;
    accountId: string;
    propertyId: string;
    sharedCommissionPct: Prisma.Decimal;
    acceptsCollaboration: boolean;
    requiresBuyerFromPartner: boolean;
    exposedFields: Prisma.JsonValue | null;
    notes: string | null;
    sharedAt: Date;
  };
  property: BolsaPropertyRow;
  agency: AgencyRow;
  photos: RealtyMlsPhotoDTO[];
  miAcuerdo: RealtyMlsAgreementStatus | null;
  adoptado: boolean;
}): RealtyMlsListingDTO {
  const { listing, property, agency, photos, miAcuerdo, adoptado } = input;
  const allowed = new Set(fieldsOf(listing.exposedFields));
  const on = (f: RealtyMlsField): boolean => allowed.has(f);

  const exacta = property.showExactAddress === true;

  const tours: RealtyMlsTourDTO[] = on("tours")
    ? property.tours
        .map((t) => ({
          kind: String(t.kind),
          url: str(t.externalUrl) ?? str(t.fileUrl) ?? "",
        }))
        .filter((t) => t.url !== "")
    : [];

  return {
    listingId: listing.id,
    propertyId: listing.propertyId,

    // Los términos de la colaboración. Salen SIEMPRE: son la razón de ser
    // de la bolsa y su autor los escribió para que otra cuenta los lea.
    comisionCompartida: pct(listing.sharedCommissionPct),
    aceptaColaboracion: listing.acceptsCollaboration,
    exigeClienteDelSocio: listing.requiresBuyerFromPartner,
    recado: listing.notes,
    compartidoEn: listing.sharedAt.toISOString(),
    quienComparte: toAgencia(agency),

    // El inmueble, campo por campo, cada uno tras su reja.
    titulo: on("titulo") ? property.title : "Inmueble",
    descripcion: on("descripcion") ? str(property.description) : null,
    kind: property.kind as RealtyPropertyKind,
    operation: property.operation as RealtyOperation,
    status: property.status as RealtyPropertyStatus,
    folio: on("folio") ? str(property.shortTermFolio) : null,
    precio: on("precio") ? (num(property.price) ?? 0) : 0,
    moneda: (property.currency === "USD" ? "USD" : "MXN") as RealtyCurrency,
    precioRenta: on("precioRenta") ? num(property.rentPrice) : null,
    mantenimiento: on("mantenimiento") ? num(property.maintenanceFee) : null,
    terrenoM2: on("terrenoM2") ? num(property.landM2) : null,
    construidoM2: on("construidoM2") ? num(property.builtM2) : null,
    recamaras: on("recamaras") ? property.bedrooms : null,
    banos: on("banos") ? property.bathrooms : null,
    mediosBanos: on("mediosBanos") ? property.halfBathrooms : null,
    cocheras: on("cocheras") ? property.parking : null,
    antiguedad: on("antiguedad") ? property.ageYears : null,
    amenidades: on("amenidades") ? amenityKeys(property.amenities) : [],
    colonia: on("colonia") ? str(property.colonia) : null,
    ciudad: on("ciudad") ? str(property.city) : null,
    estado: on("estado") ? str(property.state) : null,
    cp: on("cp") ? str(property.zip) : null,
    // Doble reja: el campo autorizado Y showExactAddress.
    direccion: on("direccion") && exacta ? str(property.address) : null,
    lat: on("lat") && exacta ? num(property.lat) : null,
    lng: on("lng") && exacta ? num(property.lng) : null,
    fotos: on("fotos") ? photos : [],
    tours,
    publicadoEn: on("publicadoEn")
      ? property.createdAt.toISOString()
      : new Date(0).toISOString(),

    miAcuerdo,
    adoptado,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. A — PUBLICAR EN LA BOLSA (lo mío)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Existencia + pertenencia del inmueble, sin traerse la ficha.
 *
 * Es la puerta del inquilino ANTES de cualquier escritura: el propertyId
 * llega del navegador y no se le cree nada hasta que la base confirma que
 * es de esta cuenta. `findFirst` y no `findUnique`, porque el @unique del
 * id no incluye la cuenta y `findUnique` traería el inmueble ajeno.
 */
async function assertOwnProperty(
  ctx: RealtyContext,
  propertyId: string,
): Promise<{ id: string; title: string } | null> {
  const id = (propertyId ?? "").trim();
  if (!id) return null;
  return prisma.realtyProperty.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, title: true },
  });
}

/**
 * Compartir un inmueble propio en la bolsa, o cambiar sus términos.
 *
 * Upsert por `propertyId` (único global). Volver a compartir algo que se
 * había retirado REUSA la fila y la reactiva: así el historial de acuerdos
 * que cuelga de ese listingId no se queda huérfano.
 */
export async function shareProperty(
  ctx: RealtyContext,
  input: RealtyMlsShareInput,
): Promise<{ ok: boolean; reason?: "not_found" | "bad_pct"; listingId?: string }> {
  const owned = await assertOwnProperty(ctx, input.propertyId);
  if (!owned) return { ok: false, reason: "not_found" };

  const share = normalizePct(input.sharedCommissionPct);
  if (share === null) return { ok: false, reason: "bad_pct" };

  const fields = sanitizeExposedFields(input.exposedFields);
  const notes = clampText(input.notes, MAX_NOTES);

  const row = await prisma.realtyMlsListing.upsert({
    where: { propertyId: owned.id },
    create: {
      accountId: ctx.accountId,
      propertyId: owned.id,
      sharedCommissionPct: new Prisma.Decimal(share.toFixed(2)),
      acceptsCollaboration: input.acceptsCollaboration !== false,
      requiresBuyerFromPartner: input.requiresBuyerFromPartner === true,
      exposedFields: fields,
      notes,
      active: true,
      sharedAt: new Date(),
    },
    update: {
      // accountId NO se toca en el update: si la fila existiera con otro
      // dueño (imposible hoy, pero el schema no tiene FK que lo impida),
      // reescribirlo sería regalarle el inmueble a quien lo pidió. El
      // `where` de abajo se encarga de que eso no pase.
      sharedCommissionPct: new Prisma.Decimal(share.toFixed(2)),
      acceptsCollaboration: input.acceptsCollaboration !== false,
      requiresBuyerFromPartner: input.requiresBuyerFromPartner === true,
      exposedFields: fields,
      notes,
      active: true,
    },
    select: { id: true, accountId: true },
  });

  // Cinturón: si la fila existía y era de otra cuenta, se deshace. No
  // debería poder ocurrir —el inmueble ya se comprobó nuestro— pero sin FK
  // la base no lo garantiza y esta es la única tabla donde equivocarse
  // significa publicar el inventario de alguien más.
  if (row.accountId !== ctx.accountId) {
    console.error("[realty/mls] listing con accountId ajeno", {
      listingId: row.id,
      propertyId: owned.id,
    });
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, listingId: row.id };
}

/**
 * El interruptor. `active` en false y el inmueble desaparece de la bolsa
 * de TODAS las cuentas en la siguiente consulta — no hay copia, no hay
 * caché, no hay trabajo diferido que pueda quedarse atrás.
 *
 * Los acuerdos ya ACEPTADOS NO se cancelan: un trato es un trato, y
 * borrarlo al retirar la ficha dejaría al colega trabajando sin respaldo.
 * Lo que sí se hace es dejar de pintarlo en las webs ajenas (las
 * adopciones se leen contra `active`, ver `inmueblesEnColaboracion`).
 */
export async function setListingActive(
  ctx: RealtyContext,
  listingId: string,
  active: boolean,
): Promise<boolean> {
  const res = await prisma.realtyMlsListing.updateMany({
    where: { id: (listingId ?? "").trim(), accountId: ctx.accountId },
    data: { active },
  });
  return res.count > 0;
}

/** Lo que YO comparto, con el pulso de cada ficha. */
export async function listMyShared(ctx: RealtyContext): Promise<RealtyMlsMineDTO[]> {
  const listings = await prisma.realtyMlsListing.findMany({
    where: { accountId: ctx.accountId },
    orderBy: [{ active: "desc" }, { sharedAt: "desc" }],
    take: 500,
  });
  if (listings.length === 0) return [];

  const propertyIds = listings.map((l) => l.propertyId);
  const listingIds = listings.map((l) => l.id);

  const [properties, adoptions, agreements] = await Promise.all([
    prisma.realtyProperty.findMany({
      // El accountId va aunque los ids ya sean míos: es el inmueble el que
      // manda, y si uno cambiara de cuenta quiero que desaparezca de aquí.
      where: { id: { in: propertyIds }, accountId: ctx.accountId },
      select: {
        id: true,
        title: true,
        city: true,
        colonia: true,
        price: true,
        currency: true,
        operation: true,
        status: true,
        photos: {
          select: { url: true },
          orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
          take: 1,
        },
      },
    }),
    prisma.realtyMlsAdoption.groupBy({
      by: ["listingId"],
      where: { listingId: { in: listingIds } },
      _count: { _all: true },
    }),
    prisma.realtyMlsAgreement.groupBy({
      by: ["listingId", "status"],
      where: { listingId: { in: listingIds }, listingAccountId: ctx.accountId },
      _count: { _all: true },
    }),
  ]);

  const byProperty = new Map(properties.map((p) => [p.id, p]));
  const adoptionCount = new Map(adoptions.map((a) => [a.listingId, a._count._all]));
  const pending = new Map<string, number>();
  const activeAgreements = new Map<string, number>();
  for (const row of agreements) {
    const bucket =
      row.status === "PROPUESTO" ? pending : row.status === "ACEPTADO" ? activeAgreements : null;
    if (!bucket) continue;
    bucket.set(row.listingId, (bucket.get(row.listingId) ?? 0) + row._count._all);
  }

  const covers = await signRealtyUrls(
    listings.map((l) => byProperty.get(l.propertyId)?.photos[0]?.url ?? null),
    REALTY_PHOTO_URL_TTL,
  );

  const out: RealtyMlsMineDTO[] = [];
  listings.forEach((l, i) => {
    const p = byProperty.get(l.propertyId);
    // Fila huérfana (el inmueble se borró): no se pinta. La consulta 4.c de
    // sql/realty-mls.sql las lista para barrerlas.
    if (!p) return;
    out.push({
      listingId: l.id,
      propertyId: l.propertyId,
      titulo: p.title,
      coverUrl: covers[i] ?? "",
      ciudad: str(p.city),
      colonia: str(p.colonia),
      precio: num(p.price) ?? 0,
      moneda: (p.currency === "USD" ? "USD" : "MXN") as RealtyCurrency,
      operation: p.operation as RealtyOperation,
      status: p.status as RealtyPropertyStatus,
      comisionCompartida: pct(l.sharedCommissionPct),
      aceptaColaboracion: l.acceptsCollaboration,
      exigeClienteDelSocio: l.requiresBuyerFromPartner,
      campos: fieldsOf(l.exposedFields),
      recado: l.notes,
      active: l.active,
      compartidoEn: l.sharedAt.toISOString(),
      adopciones: adoptionCount.get(l.id) ?? 0,
      acuerdosPendientes: pending.get(l.id) ?? 0,
      acuerdosActivos: activeAgreements.get(l.id) ?? 0,
    });
  });
  return out;
}

/** Los términos con que comparto UN inmueble (para pintar el interruptor). */
export async function getListingForProperty(
  ctx: RealtyContext,
  propertyId: string,
): Promise<{
  listingId: string;
  active: boolean;
  sharedCommissionPct: number;
  acceptsCollaboration: boolean;
  requiresBuyerFromPartner: boolean;
  campos: RealtyMlsField[];
  notes: string | null;
} | null> {
  const owned = await assertOwnProperty(ctx, propertyId);
  if (!owned) return null;
  const row = await prisma.realtyMlsListing.findFirst({
    where: { propertyId: owned.id, accountId: ctx.accountId },
  });
  if (!row) return null;
  return {
    listingId: row.id,
    active: row.active,
    sharedCommissionPct: pct(row.sharedCommissionPct),
    acceptsCollaboration: row.acceptsCollaboration,
    requiresBuyerFromPartner: row.requiresBuyerFromPartner,
    campos: fieldsOf(row.exposedFields),
    notes: row.notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. B — BUSCAR EN LA BOLSA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Estatus que la bolsa enseña. Un VENDIDO o un RENTADO en la bolsa es
 * ruido: el colega pierde el tiempo abriendo fichas muertas. APARTADO sí
 * sale —a veces se cae el apartado y el colega quiere ser el siguiente—
 * pero con su etiqueta puesta, sin disimular.
 */
const BOLSA_STATUSES: RealtyPropertyStatus[] = ["DISPONIBLE", "APARTADO"];

function sortRows(rows: RealtyMlsListingDTO[], sort: RealtyMlsSort): RealtyMlsListingDTO[] {
  const copy = [...rows];
  switch (sort) {
    case "comisionDesc":
      copy.sort((a, b) => b.comisionCompartida - a.comisionCompartida);
      break;
    case "precioAsc":
      copy.sort((a, b) => a.precio - b.precio);
      break;
    case "precioDesc":
      copy.sort((a, b) => b.precio - a.precio);
      break;
    default:
      copy.sort((a, b) => b.compartidoEn.localeCompare(a.compartidoEn));
  }
  return copy;
}

/**
 * El buscador de la bolsa: los filtros del inventario propio más el que de
 * verdad decide, "comparte comisión".
 *
 * ── POR QUÉ EL CRUCE SE HACE EN MEMORIA ────────────────────────────────
 * La comisión compartida vive en realty_mls_listings y el precio, las
 * recámaras y la ciudad en realty_properties. Sin FK no hay join, así que
 * se traen las dos partes y se cruzan aquí, con tope REALTY_MLS_SCAN_CAP.
 * Es honesto mientras la bolsa sea de cientos de fichas; el día que se
 * pase, la respuesta lo DICE (`truncado`) en vez de mentir con una lista
 * recortada que parece completa.
 */
export async function searchBolsa(
  ctx: RealtyContext,
  filters: RealtyMlsFilters = {},
): Promise<RealtyMlsSearchResult & { truncado: boolean }> {
  const sort: RealtyMlsSort = (REALTY_MLS_SORTS as readonly string[]).includes(
    filters.sort ?? "",
  )
    ? (filters.sort as RealtyMlsSort)
    : "recientes";
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(
    REALTY_MLS_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(filters.pageSize ?? REALTY_MLS_PAGE_SIZE)),
  );

  // ── Paso 1: las fichas de la bolsa que NO son mías ──
  // `not: ctx.accountId` sobre una columna NOT NULL: no hay nulos que se
  // pierdan por el camino (la trampa de NOT con columnas nullables).
  const listingWhere: Prisma.RealtyMlsListingWhereInput = {
    active: true,
    accountId: { not: ctx.accountId },
  };
  const comisionMin = normalizePct(filters.comisionMin);
  if (comisionMin !== null && comisionMin > 0) {
    listingWhere.sharedCommissionPct = { gte: new Prisma.Decimal(comisionMin.toFixed(2)) };
  }
  if (filters.soloColaboracion === true) {
    listingWhere.acceptsCollaboration = true;
  }

  const listings = await prisma.realtyMlsListing.findMany({
    where: listingWhere,
    orderBy: { sharedAt: "desc" },
    take: REALTY_MLS_SCAN_CAP + 1,
  });
  const truncado = listings.length > REALTY_MLS_SCAN_CAP;
  if (truncado) {
    console.warn(
      `[realty/mls] la bolsa pasó de ${REALTY_MLS_SCAN_CAP} fichas activas: ` +
        "el cruce en memoria ya no alcanza y toca promoverlo a una vista SQL.",
    );
    listings.length = REALTY_MLS_SCAN_CAP;
  }
  if (listings.length === 0) {
    return {
      rows: [],
      total: 0,
      page: 1,
      pageSize,
      pageCount: 0,
      facets: { ciudades: [], colonias: [] },
      truncado: false,
    };
  }

  // ── Paso 2: los inmuebles, con los filtros del inventario ──
  const and: Prisma.RealtyPropertyWhereInput[] = [];
  const q = (filters.q ?? "").trim().slice(0, 120);
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { colonia: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.kind) and.push({ kind: filters.kind as RealtyPropertyKind });
  if (filters.operation) and.push({ operation: filters.operation as RealtyOperation });
  if (filters.ciudad) and.push({ city: filters.ciudad });
  if (filters.colonia) and.push({ colonia: filters.colonia });
  if (typeof filters.precioMin === "number" && Number.isFinite(filters.precioMin)) {
    and.push({ price: { gte: new Prisma.Decimal(filters.precioMin) } });
  }
  if (typeof filters.precioMax === "number" && Number.isFinite(filters.precioMax)) {
    and.push({ price: { lte: new Prisma.Decimal(filters.precioMax) } });
  }
  if (typeof filters.recamarasMin === "number" && Number.isFinite(filters.recamarasMin)) {
    and.push({ bedrooms: { gte: Math.floor(filters.recamarasMin) } });
  }

  const properties = await prisma.realtyProperty.findMany({
    where: {
      id: { in: listings.map((l) => l.propertyId) },
      // 🔴 La segunda mitad del aislamiento: aunque una fila de bolsa
      // apuntara a un inmueble mío (fila corrupta, o yo compartiéndome a
      // mí mismo), aquí se cae. La bolsa enseña lo AJENO.
      accountId: { not: ctx.accountId },
      status: { in: BOLSA_STATUSES },
      ...(and.length > 0 ? { AND: and } : {}),
    },
    select: SELECT_BOLSA,
  });
  if (properties.length === 0) {
    return {
      rows: [],
      total: 0,
      page: 1,
      pageSize,
      pageCount: 0,
      facets: { ciudades: [], colonias: [] },
      truncado,
    };
  }

  const byProperty = new Map(properties.map((p) => [p.id, p]));

  // ── Paso 3: las cuentas que comparten (solo las vivas) ──
  const accountIds = Array.from(
    new Set(
      listings
        .filter((l) => byProperty.has(l.propertyId))
        .map((l) => l.accountId),
    ),
  );
  const accounts = await prisma.realtyAccount.findMany({
    where: { id: { in: accountIds }, isActive: true },
    select: SELECT_AGENCIA,
  });
  const byAccount = new Map(accounts.map((a) => [a.id, a]));

  // ── Paso 4: mi relación con cada ficha ──
  const usableListingIds = listings
    .filter((l) => byProperty.has(l.propertyId) && byAccount.has(l.accountId))
    .map((l) => l.id);
  const [misAcuerdos, misAdopciones] = await Promise.all([
    prisma.realtyMlsAgreement.findMany({
      where: { listingId: { in: usableListingIds }, partnerAccountId: ctx.accountId },
      select: { listingId: true, status: true },
    }),
    prisma.realtyMlsAdoption.findMany({
      where: { listingId: { in: usableListingIds }, accountId: ctx.accountId },
      select: { listingId: true },
    }),
  ]);
  const agreementBy = new Map(
    misAcuerdos.map((a) => [a.listingId, a.status as RealtyMlsAgreementStatus]),
  );
  const adoptedSet = new Set(misAdopciones.map((a) => a.listingId));

  // ── Paso 5: firmar portadas y proyectar ──
  const usable = listings.filter(
    (l) => byProperty.has(l.propertyId) && byAccount.has(l.accountId),
  );
  const photoJobs: Array<{ listingIdx: number; url: string; isCover: boolean }> = [];
  usable.forEach((l, idx) => {
    const p = byProperty.get(l.propertyId);
    if (!p) return;
    const allowed = new Set(fieldsOf(l.exposedFields));
    if (!allowed.has("fotos")) return;
    for (const photo of p.photos.slice(0, 6)) {
      photoJobs.push({ listingIdx: idx, url: photo.url, isCover: photo.isCover });
    }
  });
  const signed = await signRealtyUrls(
    photoJobs.map((j) => j.url),
    REALTY_PHOTO_URL_TTL,
  );
  const photosByIdx = new Map<number, RealtyMlsPhotoDTO[]>();
  photoJobs.forEach((job, i) => {
    const url = signed[i] ?? "";
    if (!url) return;
    const list = photosByIdx.get(job.listingIdx) ?? [];
    list.push({ url, isCover: job.isCover });
    photosByIdx.set(job.listingIdx, list);
  });

  const projected: RealtyMlsListingDTO[] = [];
  usable.forEach((l, idx) => {
    const property = byProperty.get(l.propertyId);
    const agency = byAccount.get(l.accountId);
    if (!property || !agency) return;
    // 🔴 LA INVARIANTE. Sin FK, la base no garantiza que el dueño de la
    // fila de bolsa sea el dueño del inmueble. Si no coinciden, la ficha
    // NO se pinta: alguien estaría compartiendo lo que no es suyo.
    if (property.accountId !== l.accountId) {
      console.error("[realty/mls] listing incoherente: el inmueble no es de quien lo comparte", {
        listingId: l.id,
        propertyId: l.propertyId,
      });
      return;
    }
    projected.push(
      projectListing({
        listing: l,
        property,
        agency,
        photos: photosByIdx.get(idx) ?? [],
        miAcuerdo: agreementBy.get(l.id) ?? null,
        adoptado: adoptedSet.has(l.id),
      }),
    );
  });

  const ordered = sortRows(projected, sort);
  const total = ordered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const rows = ordered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Las facetas salen de lo COMPARTIDO, no de mi cartera: enseñar una
  // ciudad donde la bolsa no tiene nada es un filtro que siempre devuelve
  // cero y parece que el buscador está roto.
  const ciudades = Array.from(
    new Set(projected.map((r) => r.ciudad).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b, "es"));
  const colonias = Array.from(
    new Set(projected.map((r) => r.colonia).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b, "es"));

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    pageCount,
    facets: { ciudades, colonias },
    truncado,
  };
}

/**
 * UNA ficha de la bolsa, por su listingId. Vuelve a comprobar TODO: que
 * siga activa, que el inmueble siga siendo de quien la comparte, que la
 * cuenta siga viva y que no sea mía. Es la ruta que abre el modal de la
 * ficha, así que es la que un atacante intentaría con ids al azar.
 */
export async function getBolsaListing(
  ctx: RealtyContext,
  listingId: string,
): Promise<RealtyMlsListingDTO | null> {
  const id = (listingId ?? "").trim();
  if (!id) return null;

  const listing = await prisma.realtyMlsListing.findFirst({
    where: { id, active: true, accountId: { not: ctx.accountId } },
  });
  if (!listing) return null;

  const [property, agency, miAcuerdo, adopcion] = await Promise.all([
    prisma.realtyProperty.findFirst({
      where: {
        id: listing.propertyId,
        accountId: { not: ctx.accountId },
        status: { in: BOLSA_STATUSES },
      },
      select: SELECT_BOLSA,
    }),
    prisma.realtyAccount.findFirst({
      where: { id: listing.accountId, isActive: true },
      select: SELECT_AGENCIA,
    }),
    prisma.realtyMlsAgreement.findFirst({
      where: { listingId: id, partnerAccountId: ctx.accountId },
      select: { status: true },
    }),
    prisma.realtyMlsAdoption.findFirst({
      where: { listingId: id, accountId: ctx.accountId },
      select: { id: true },
    }),
  ]);
  if (!property || !agency) return null;
  if (property.accountId !== listing.accountId) {
    console.error("[realty/mls] listing incoherente al abrir la ficha", { listingId: id });
    return null;
  }

  const allowed = new Set(fieldsOf(listing.exposedFields));
  const photos = allowed.has("fotos")
    ? await signRealtyUrls(
        property.photos.map((p) => p.url),
        REALTY_PHOTO_URL_TTL,
      ).then((urls) =>
        urls
          .map((url, i) => ({ url, isCover: property.photos[i]?.isCover === true }))
          .filter((p) => p.url !== ""),
      )
    : [];

  return projectListing({
    listing,
    property,
    agency,
    photos,
    miAcuerdo: (miAcuerdo?.status as RealtyMlsAgreementStatus | undefined) ?? null,
    adoptado: !!adopcion,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 4. C — EL ACUERDO DE COLABORACIÓN
// ═══════════════════════════════════════════════════════════════════════

/**
 * Proponer colaboración sobre una ficha ajena. Lo pide SIEMPRE quien
 * COLOCA: es el que tiene el cliente y quiere saber si le abren la puerta.
 *
 * El porcentaje de la propuesta arranca en el que ofrece la ficha, pero se
 * puede negociar: por eso viaja en el cuerpo y no se copia a ciegas.
 */
export async function proposeAgreement(
  ctx: RealtyContext,
  input: { listingId: string; agreedPct?: number; message?: string },
): Promise<{
  ok: boolean;
  reason?: "not_found" | "no_collab" | "own" | "bad_pct" | "already";
  agreementId?: string;
}> {
  const id = (input.listingId ?? "").trim();
  if (!id) return { ok: false, reason: "not_found" };

  const listing = await prisma.realtyMlsListing.findFirst({ where: { id, active: true } });
  if (!listing) return { ok: false, reason: "not_found" };
  // Proponerse un acuerdo a uno mismo no es un error del usuario: es lo
  // primero que intenta quien está probando la puerta.
  if (listing.accountId === ctx.accountId) return { ok: false, reason: "own" };
  if (!listing.acceptsCollaboration) return { ok: false, reason: "no_collab" };

  // El inmueble tiene que seguir siendo de quien comparte y seguir vivo.
  const property = await prisma.realtyProperty.findFirst({
    where: {
      id: listing.propertyId,
      accountId: listing.accountId,
      status: { in: BOLSA_STATUSES },
    },
    select: { id: true },
  });
  if (!property) return { ok: false, reason: "not_found" };

  const proposed =
    input.agreedPct === undefined || input.agreedPct === null
      ? pct(listing.sharedCommissionPct)
      : normalizePct(input.agreedPct);
  if (proposed === null) return { ok: false, reason: "bad_pct" };

  const message = clampText(input.message, MAX_MESSAGE);
  const existing = await prisma.realtyMlsAgreement.findFirst({
    where: { listingId: id, partnerAccountId: ctx.accountId },
    select: { id: true, status: true },
  });

  // Un acuerdo vivo no se re-propone: se cancela o se cierra primero.
  if (existing && (existing.status === "PROPUESTO" || existing.status === "ACEPTADO")) {
    return { ok: false, reason: "already", agreementId: existing.id };
  }
  // Uno CERRADO tampoco: reabrirlo reescribiría el pasado de una comisión
  // que quizá ya se pagó.
  if (existing && existing.status === "CERRADO") {
    return { ok: false, reason: "already", agreementId: existing.id };
  }

  const row = await prisma.realtyMlsAgreement.upsert({
    where: {
      listingId_partnerAccountId: { listingId: id, partnerAccountId: ctx.accountId },
    },
    create: {
      listingId: id,
      listingAccountId: listing.accountId,
      partnerAccountId: ctx.accountId,
      propertyId: listing.propertyId,
      agreedPct: new Prisma.Decimal(proposed.toFixed(2)),
      status: "PROPUESTO",
      message,
      proposedAt: new Date(),
    },
    // Volver a proponer tras un RECHAZADO/CANCELADO reusa la fila: así una
    // sola cuenta no puede llenar la bandeja del vecino a base de filas.
    update: {
      agreedPct: new Prisma.Decimal(proposed.toFixed(2)),
      status: "PROPUESTO",
      message,
      proposedAt: new Date(),
      respondedAt: null,
      closedAt: null,
      dealId: null,
      // listingAccountId se reescribe por si la ficha cambió de dueño
      // entre una propuesta y otra.
      listingAccountId: listing.accountId,
      propertyId: listing.propertyId,
    },
    select: { id: true },
  });

  return { ok: true, agreementId: row.id };
}

/**
 * Responder a una propuesta.
 *
 * Quién puede qué:
 *   · aceptar / rechazar → SOLO quien capta (es su inmueble).
 *   · cancelar           → cualquiera de los dos, y solo si no está cerrado.
 */
export async function respondAgreement(
  ctx: RealtyContext,
  agreementId: string,
  action: "aceptar" | "rechazar" | "cancelar",
  agreedPct?: number,
): Promise<{ ok: boolean; reason?: "not_found" | "forbidden" | "closed" | "bad_pct" }> {
  const id = (agreementId ?? "").trim();
  if (!id) return { ok: false, reason: "not_found" };

  // El OR es la puerta: solo se lee el acuerdo si mi cuenta es una de las
  // dos partes. Un id ajeno devuelve null, igual que uno inexistente.
  const row = await prisma.realtyMlsAgreement.findFirst({
    where: {
      id,
      OR: [{ listingAccountId: ctx.accountId }, { partnerAccountId: ctx.accountId }],
    },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "CERRADO") return { ok: false, reason: "closed" };

  const soyCaptador = row.listingAccountId === ctx.accountId;

  if (action === "cancelar") {
    await prisma.realtyMlsAgreement.update({
      where: { id },
      data: { status: "CANCELADO", respondedAt: new Date() },
    });
    return { ok: true };
  }

  if (!soyCaptador) return { ok: false, reason: "forbidden" };

  if (action === "rechazar") {
    await prisma.realtyMlsAgreement.update({
      where: { id },
      data: { status: "RECHAZADO", respondedAt: new Date() },
    });
    return { ok: true };
  }

  // Aceptar. El captador puede ajustar el porcentaje al aceptar: es la
  // contraoferta, y sin ella la negociación se sale del producto.
  const finalPct = agreedPct === undefined ? pct(row.agreedPct) : normalizePct(agreedPct);
  if (finalPct === null) return { ok: false, reason: "bad_pct" };

  await prisma.realtyMlsAgreement.update({
    where: { id },
    data: {
      status: "ACEPTADO",
      respondedAt: new Date(),
      agreedPct: new Prisma.Decimal(finalPct.toFixed(2)),
    },
  });
  return { ok: true };
}

/**
 * Cerrar la colaboración contra una operación: es el punto donde la bolsa
 * ALIMENTA el reparto de comisión de T8.
 *
 * 🔴 LA BOLSA NO CALCULA DINERO. El único motor de comisiones del vertical
 * es `computeSplits` (src/lib/realty/commissions.ts) y el único sitio que
 * escribe el reparto es `setDealSplits` (api/realty/deals/service.ts), que
 * borra y recrea el reparto ENTERO. Aquí no se escribe un split: se marca
 * el acuerdo como CERRADO contra un `dealId` y se devuelve la fila que le
 * toca al colega, lista para que la pantalla de comisiones la meta en el
 * reparto junto con las demás.
 *
 * El participante externo YA existe en el modelo de T8 —
 * `party: "EXTERNO"` + `externalName`— así que no se inventa nada: se usa.
 *
 * Ojo con `externalName`: T8 agrupa a los externos del recibo por el
 * nombre en minúsculas (`ext:${nombre.toLowerCase()}`) y "pagar todo" hace
 * match EXACTO. Por eso el nombre sale siempre de `RealtyAccount.name` de
 * la contraparte y nunca de un campo que el usuario teclee: dos grafías
 * del mismo colega serían dos beneficiarios distintos en el recibo.
 */
export async function closeAgreementIntoDeal(
  ctx: RealtyContext,
  agreementId: string,
  dealId: string,
): Promise<{
  ok: boolean;
  reason?: "not_found" | "forbidden" | "not_accepted" | "bad_deal";
  /** La fila que hay que añadir al reparto del deal (formato RealtySplitInput). */
  split?: {
    party: "EXTERNO";
    realtyUserId: null;
    externalName: string;
    mode: "PCT";
    pct: number;
  };
}> {
  const id = (agreementId ?? "").trim();
  const deal = (dealId ?? "").trim();
  if (!id || !deal) return { ok: false, reason: "not_found" };

  const row = await prisma.realtyMlsAgreement.findFirst({
    where: {
      id,
      OR: [{ listingAccountId: ctx.accountId }, { partnerAccountId: ctx.accountId }],
    },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "ACEPTADO") return { ok: false, reason: "not_accepted" };
  // Cierra quien CAPTA: el deal y su reparto viven en la cuenta del dueño
  // del inmueble, y es esa cuenta la que paga al colega.
  if (row.listingAccountId !== ctx.accountId) return { ok: false, reason: "forbidden" };

  // El deal tiene que ser MÍO y del MISMO inmueble. Sin esto, un dealId al
  // azar cerraría un acuerdo contra una operación que no le corresponde.
  const dealRow = await prisma.realtyDeal.findFirst({
    where: { id: deal, accountId: ctx.accountId, propertyId: row.propertyId },
    select: { id: true },
  });
  if (!dealRow) return { ok: false, reason: "bad_deal" };

  const partner = await prisma.realtyAccount.findUnique({
    where: { id: row.partnerAccountId },
    select: { name: true },
  });

  await prisma.realtyMlsAgreement.update({
    where: { id },
    data: { status: "CERRADO", closedAt: new Date(), dealId: dealRow.id },
  });

  return {
    ok: true,
    split: {
      party: "EXTERNO",
      realtyUserId: null,
      externalName: (partner?.name ?? "Asesor externo").slice(0, 80),
      mode: "PCT",
      pct: pct(row.agreedPct),
    },
  };
}

/** Los acuerdos donde mi cuenta es una de las dos partes. */
export async function listAgreements(
  ctx: RealtyContext,
  onlyStatus?: RealtyMlsAgreementStatus[],
): Promise<RealtyMlsAgreementDTO[]> {
  const rows = await prisma.realtyMlsAgreement.findMany({
    where: {
      OR: [{ listingAccountId: ctx.accountId }, { partnerAccountId: ctx.accountId }],
      ...(onlyStatus && onlyStatus.length > 0 ? { status: { in: onlyStatus } } : {}),
    },
    orderBy: { proposedAt: "desc" },
    take: 300,
  });
  if (rows.length === 0) return [];

  // La contraparte es la OTRA cuenta, sea cual sea mi papel.
  const otherIds = Array.from(
    new Set(
      rows.map((r) =>
        r.listingAccountId === ctx.accountId ? r.partnerAccountId : r.listingAccountId,
      ),
    ),
  );
  const [accounts, properties] = await Promise.all([
    prisma.realtyAccount.findMany({
      where: { id: { in: otherIds } },
      select: SELECT_AGENCIA,
    }),
    prisma.realtyProperty.findMany({
      where: { id: { in: Array.from(new Set(rows.map((r) => r.propertyId))) } },
      select: { id: true, title: true, city: true },
    }),
  ]);
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const byProperty = new Map(properties.map((p) => [p.id, p]));

  const out: RealtyMlsAgreementDTO[] = [];
  for (const r of rows) {
    const soyCaptador = r.listingAccountId === ctx.accountId;
    const otherId = soyCaptador ? r.partnerAccountId : r.listingAccountId;
    const other = byAccount.get(otherId);
    if (!other) continue;
    const property = byProperty.get(r.propertyId);
    out.push({
      id: r.id,
      listingId: r.listingId,
      propertyId: r.propertyId,
      miPapel: soyCaptador ? "CAPTO" : "COLOCO",
      contraparte: toAgencia(other),
      // El título del inmueble sale del inmueble ajeno, y es uno de los
      // campos públicos de la lista blanca. Si no se puede leer, se dice
      // "Inmueble" antes que filtrar cualquier otra cosa.
      inmuebleTitulo: property?.title ?? "Inmueble",
      inmuebleCiudad: str(property?.city),
      porcentajeAcordado: pct(r.agreedPct),
      status: r.status as RealtyMlsAgreementStatus,
      recado: r.message,
      propuestoEn: r.proposedAt.toISOString(),
      respondidoEn: iso(r.respondedAt),
      cerradoEn: iso(r.closedAt),
      dealId: r.dealId,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. D — PUBLICAR INVENTARIO AJENO EN LA WEB PROPIA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Adoptar una ficha ajena para pintarla en MI mini-web.
 *
 * Adoptar NO es un acuerdo: es escaparate. El acuerdo se firma cuando hay
 * cliente. Por eso no exige `acceptsCollaboration` — un dueño puede querer
 * que su inventario se vea sin comprometerse a trabajar con nadie todavía.
 * Lo que sí exige es que el inmueble esté PUBLICADO por su dueño: si él lo
 * tiene despublicado es porque no quiere verlo anunciado, y prestarle mi
 * web para saltarse eso sería pasar por encima de su decisión.
 */
export async function adoptListing(
  ctx: RealtyContext,
  listingId: string,
): Promise<{
  ok: boolean;
  reason?: "not_found" | "own" | "not_published" | "limit";
  adoptionId?: string;
}> {
  const id = (listingId ?? "").trim();
  if (!id) return { ok: false, reason: "not_found" };

  const listing = await prisma.realtyMlsListing.findFirst({ where: { id, active: true } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.accountId === ctx.accountId) return { ok: false, reason: "own" };

  const property = await prisma.realtyProperty.findFirst({
    where: {
      id: listing.propertyId,
      accountId: listing.accountId,
      // 🔴 La decisión del dueño manda: si no lo tiene publicado, nadie lo
      // publica por él.
      isPublished: true,
      status: "DISPONIBLE",
    },
    select: { id: true },
  });
  if (!property) return { ok: false, reason: "not_published" };

  const count = await prisma.realtyMlsAdoption.count({ where: { accountId: ctx.accountId } });
  const yaLaTengo = await prisma.realtyMlsAdoption.findFirst({
    where: { accountId: ctx.accountId, listingId: id },
    select: { id: true },
  });
  if (!yaLaTengo && count >= REALTY_MLS_MAX_ADOPTIONS) {
    return { ok: false, reason: "limit" };
  }

  const row = await prisma.realtyMlsAdoption.upsert({
    where: { accountId_listingId: { accountId: ctx.accountId, listingId: id } },
    create: {
      accountId: ctx.accountId,
      listingId: id,
      propertyId: listing.propertyId,
      showOnLanding: true,
      sortOrder: count,
    },
    update: { showOnLanding: true, propertyId: listing.propertyId },
    select: { id: true },
  });
  return { ok: true, adoptionId: row.id };
}

/** Encender/apagar una ficha adoptada en mi web, o reordenarla. */
export async function setAdoption(
  ctx: RealtyContext,
  adoptionId: string,
  data: { enLaWeb?: boolean; orden?: number },
): Promise<boolean> {
  const patch: Prisma.RealtyMlsAdoptionUpdateManyMutationInput = {};
  if (typeof data.enLaWeb === "boolean") patch.showOnLanding = data.enLaWeb;
  if (typeof data.orden === "number" && Number.isFinite(data.orden)) {
    patch.sortOrder = Math.max(0, Math.min(999, Math.floor(data.orden)));
  }
  // updateMany con `data` vacío devuelve count 0 y la pantalla lo leería
  // como "no existe". Se corta antes.
  if (Object.keys(patch).length === 0) return true;
  const res = await prisma.realtyMlsAdoption.updateMany({
    where: { id: (adoptionId ?? "").trim(), accountId: ctx.accountId },
    data: patch,
  });
  return res.count > 0;
}

/** Dejar de pintar una ficha ajena. */
export async function dropAdoption(ctx: RealtyContext, adoptionId: string): Promise<boolean> {
  const res = await prisma.realtyMlsAdoption.deleteMany({
    where: { id: (adoptionId ?? "").trim(), accountId: ctx.accountId },
  });
  return res.count > 0;
}

/** Las fichas ajenas que estoy pintando, para el tablero. */
export async function listAdoptions(ctx: RealtyContext): Promise<RealtyMlsAdoptionDTO[]> {
  const rows = await prisma.realtyMlsAdoption.findMany({
    where: { accountId: ctx.accountId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 100,
  });
  if (rows.length === 0) return [];

  const listings = await prisma.realtyMlsListing.findMany({
    where: { id: { in: rows.map((r) => r.listingId) } },
    select: {
      id: true,
      accountId: true,
      propertyId: true,
      sharedCommissionPct: true,
      exposedFields: true,
      active: true,
    },
  });
  const byListing = new Map(listings.map((l) => [l.id, l]));

  const [properties, accounts] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: { id: { in: listings.map((l) => l.propertyId) } },
      select: {
        id: true,
        accountId: true,
        title: true,
        city: true,
        price: true,
        currency: true,
        operation: true,
        photos: {
          select: { url: true },
          orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
          take: 1,
        },
      },
    }),
    prisma.realtyAccount.findMany({
      where: { id: { in: Array.from(new Set(listings.map((l) => l.accountId))) } },
      select: SELECT_AGENCIA,
    }),
  ]);
  const byProperty = new Map(properties.map((p) => [p.id, p]));
  const byAccount = new Map(accounts.map((a) => [a.id, a]));

  const covers = await signRealtyUrls(
    rows.map((r) => {
      const l = byListing.get(r.listingId);
      const p = l ? byProperty.get(l.propertyId) : null;
      return p?.photos[0]?.url ?? null;
    }),
    REALTY_PHOTO_URL_TTL,
  );

  const out: RealtyMlsAdoptionDTO[] = [];
  rows.forEach((r, i) => {
    const l = byListing.get(r.listingId);
    if (!l) return;
    const p = byProperty.get(l.propertyId);
    const a = byAccount.get(l.accountId);
    if (!p || !a) return;
    if (p.accountId !== l.accountId) return;
    const allowed = new Set(fieldsOf(l.exposedFields));
    out.push({
      id: r.id,
      listingId: l.id,
      propertyId: l.propertyId,
      titulo: allowed.has("titulo") ? p.title : "Inmueble",
      coverUrl: allowed.has("fotos") ? (covers[i] ?? "") : "",
      ciudad: allowed.has("ciudad") ? str(p.city) : null,
      precio: allowed.has("precio") ? (num(p.price) ?? 0) : 0,
      moneda: (p.currency === "USD" ? "USD" : "MXN") as RealtyCurrency,
      operation: p.operation as RealtyOperation,
      comisionCompartida: pct(l.sharedCommissionPct),
      quienComparte: toAgencia(a),
      enLaWeb: r.showOnLanding,
      orden: r.sortOrder,
      vigente: l.active,
    });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. LA COSTURA CON T5 — la web pública
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los inmuebles EN COLABORACIÓN de una cuenta, listos para el motor de la
 * mini-web. Es la única función que T5 necesita llamar.
 *
 * ── CÓMO SE ENCHUFA (una línea en cada sitio) ──────────────────────────
 * En `src/app/i/[slug]/_shared/data.ts`, dentro del Promise.all que ya
 * existe en `cargarWebRealty`:
 *
 *     inmueblesEnColaboracion(cuenta.id),
 *
 * y al armar el objeto:
 *
 *     inmuebles: [...propios.map(aInmueblePublico), ...colaboraciones],
 *     totalInmuebles: total + colaboraciones.length,
 *
 * Devuelve `RealtyWebInmuebleDTO[]` YA pasados por `aInmueblePublico`
 * (landing.ts), así que hereda gratis las dos rejas de la web pública: las
 * URLs firmadas del bucket privado se descartan y la dirección exacta solo
 * sale si el dueño la autorizó.
 *
 * ── LO QUE T5 TIENE QUE DECIDIR, Y ESTÁ DOCUMENTADO ────────────────────
 * 1. El `ref` de estas fichas es `mls:<listingId>`, con prefijo A
 *    PROPÓSITO. Dos cuentas distintas pueden tener el mismo
 *    `publicUrlSlug` (el @@unique es POR CUENTA), así que sin prefijo el
 *    `key={inm.ref}` de React colisionaría y la ficha ajena chocaría con
 *    una propia. Además el prefijo hace evidente en la URL que la ficha no
 *    es de la casa.
 * 2. `cargarFichaRealty` filtra por `accountId` de la cuenta del slug, así
 *    que la ficha de detalle de una colaboración da 404 hoy. Mientras T5
 *    no la extienda, la tarjeta debe enlazar a la ficha del DUEÑO
 *    (`/i/<slug-del-dueño>/propiedades/<ref-propio>`), que sí resuelve. El
 *    slug del dueño viaja en `colaboracionDe.slug`.
 *
 * ── LAS TRES REJAS ─────────────────────────────────────────────────────
 * La ficha solo sale si: la adopción está encendida (`showOnLanding`), el
 * dueño la sigue compartiendo (`active`) y el dueño la tiene PUBLICADA y
 * DISPONIBLE. Con que una diga que no, no se pinta.
 */
export async function inmueblesEnColaboracion(
  accountId: string,
  limite = REALTY_MLS_MAX_ADOPTIONS,
): Promise<Array<RealtyWebInmuebleDTO & { colaboracionDe: RealtyMlsAgencyDTO }>> {
  const id = (accountId ?? "").trim();
  if (!id) return [];
  const take = Math.max(1, Math.min(REALTY_MLS_MAX_ADOPTIONS, Math.floor(limite)));

  try {
    const adoptions = await prisma.realtyMlsAdoption.findMany({
      where: { accountId: id, showOnLanding: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take,
      select: { listingId: true, sortOrder: true },
    });
    if (adoptions.length === 0) return [];

    const listings = await prisma.realtyMlsListing.findMany({
      where: { id: { in: adoptions.map((a) => a.listingId) }, active: true },
      select: {
        id: true,
        accountId: true,
        propertyId: true,
        exposedFields: true,
      },
    });
    if (listings.length === 0) return [];
    const byListing = new Map(listings.map((l) => [l.id, l]));

    const [properties, accounts] = await Promise.all([
      prisma.realtyProperty.findMany({
        where: {
          id: { in: listings.map((l) => l.propertyId) },
          // La cuenta que adopta NO puede aparecer aquí: si un inmueble
          // suyo llegara a esta lista lo pintaría dos veces.
          accountId: { not: id },
          isPublished: true,
          status: "DISPONIBLE",
        },
        select: SELECT_BOLSA,
      }),
      prisma.realtyAccount.findMany({
        where: { id: { in: Array.from(new Set(listings.map((l) => l.accountId))) }, isActive: true },
        select: SELECT_AGENCIA,
      }),
    ]);
    const byProperty = new Map(properties.map((p) => [p.id, p]));
    const byAccount = new Map(accounts.map((a) => [a.id, a]));

    const out: Array<RealtyWebInmuebleDTO & { colaboracionDe: RealtyMlsAgencyDTO }> = [];
    for (const adoption of adoptions) {
      const listing = byListing.get(adoption.listingId);
      if (!listing) continue;
      const property = byProperty.get(listing.propertyId);
      const agency = byAccount.get(listing.accountId);
      if (!property || !agency) continue;
      if (property.accountId !== listing.accountId) continue;

      const allowed = new Set(fieldsOf(listing.exposedFields));

      // Se le pasa a `aInmueblePublico` una fila ARMADA a mano, campo por
      // campo y ya recortada por la lista del dueño. No se le pasa la fila
      // de Prisma: ese mapeador es de T5 y el día que le añadan un campo,
      // este módulo no puede ser la vía por la que se escape.
      const dto = aInmueblePublico({
        id: property.id,
        publicUrlSlug: null, // el ref lo ponemos nosotros, abajo
        title: allowed.has("titulo") ? property.title : "Inmueble",
        description: allowed.has("descripcion") ? property.description : null,
        kind: property.kind,
        operation: property.operation,
        status: property.status,
        price: allowed.has("precio") ? property.price : 0,
        currency: property.currency,
        rentPrice: allowed.has("precioRenta") ? property.rentPrice : null,
        maintenanceFee: allowed.has("mantenimiento") ? property.maintenanceFee : null,
        landM2: allowed.has("terrenoM2") ? property.landM2 : null,
        builtM2: allowed.has("construidoM2") ? property.builtM2 : null,
        bedrooms: allowed.has("recamaras") ? property.bedrooms : null,
        bathrooms: allowed.has("banos") ? property.bathrooms : null,
        halfBathrooms: allowed.has("mediosBanos") ? property.halfBathrooms : null,
        parking: allowed.has("cocheras") ? property.parking : null,
        ageYears: allowed.has("antiguedad") ? property.ageYears : null,
        amenities: allowed.has("amenidades") ? property.amenities : null,
        colonia: allowed.has("colonia") ? property.colonia : null,
        city: allowed.has("ciudad") ? property.city : null,
        state: allowed.has("estado") ? property.state : null,
        address: allowed.has("direccion") ? property.address : null,
        lat: allowed.has("lat") ? property.lat : null,
        lng: allowed.has("lng") ? property.lng : null,
        showExactAddress: property.showExactAddress,
        shortTermFolio: allowed.has("folio") ? property.shortTermFolio : null,
        createdAt: property.createdAt,
        photos: allowed.has("fotos") ? property.photos : [],
        tours: allowed.has("tours") ? property.tours : [],
      });

      out.push({
        ...dto,
        // Prefijo obligatorio: ver la nota 1 del docblock.
        ref: `mls:${listing.id}`,
        colaboracionDe: toAgencia(agency),
      });
    }
    return out;
  } catch (e) {
    // Igual que los cargadores de T5: la web pública nunca revienta por
    // esto. Sin bolsa, la página se pinta con el inventario propio.
    console.warn("[realty/mls] inmueblesEnColaboracion falló:", (e as Error).message);
    return [];
  }
}

/**
 * Avisar al dueño de que un prospecto entró por SU inmueble a través de la
 * web de un colega. La otra función que T5 puede llamar, desde
 * `enviarProspectoWeb` (components/realty/web/lead-action.ts):
 *
 *     if (inmuebleRef?.startsWith("mls:")) {
 *       await avisarColaboracion(accountId, inmuebleRef.slice(4), nombre);
 *     }
 *
 * El prospecto se queda en el CRM de quien HOSPEDA la web —él es quien lo
 * atiende— y al dueño le entra un PENDIENTE en su cuenta con el nombre de
 * quien lo recibió. Un pendiente y no un lead: el lead es de quien lo
 * trabaja, y duplicarlo sería que dos personas llamaran al mismo señor.
 *
 * Nunca lanza: un aviso que falla no puede tumbar la captación de nadie.
 */
export async function avisarColaboracion(
  hostAccountId: string,
  listingId: string,
  prospectoNombre: string,
): Promise<boolean> {
  try {
    const listing = await prisma.realtyMlsListing.findFirst({
      where: { id: (listingId ?? "").trim(), active: true },
      select: { accountId: true, propertyId: true },
    });
    if (!listing) return false;
    if (listing.accountId === hostAccountId) return false;

    const [host, property] = await Promise.all([
      prisma.realtyAccount.findUnique({
        where: { id: hostAccountId },
        select: { name: true },
      }),
      prisma.realtyProperty.findFirst({
        where: { id: listing.propertyId, accountId: listing.accountId },
        select: { id: true, title: true, assignedUserId: true },
      }),
    ]);
    if (!property) return false;

    // El pendiente necesita dueño (RealtyTask.userId es obligatorio). Se
    // le asigna al asesor del inmueble; si no tiene, a quien manda en esa
    // cuenta. Sin nadie a quien avisar, no se inventa una fila.
    let userId = property.assignedUserId;
    if (!userId) {
      const jefe = await prisma.realtyUser.findFirst({
        where: { accountId: listing.accountId, active: true, role: { in: ["OWNER", "MANAGER"] } },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      userId = jefe?.id ?? null;
    }
    if (!userId) return false;

    const quien = host?.name ?? "otra inmobiliaria";
    const nombre = (prospectoNombre ?? "").trim().slice(0, 60) || "Un interesado";
    await prisma.realtyTask.create({
      data: {
        accountId: listing.accountId,
        userId,
        propertyId: property.id,
        dueAt: new Date(),
        title:
          `${nombre} preguntó por "${property.title}" desde la web de ${quien} ` +
          "(en colaboración).".slice(0, 200),
      },
    });
    return true;
  } catch (e) {
    console.warn("[realty/mls] avisarColaboracion falló:", (e as Error).message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. E — MIS COLABORACIONES (el tablero)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Comisiones por cobrar de colaboraciones.
 *
 * 🔴 Los números salen de RealtyCommissionSplit (T8), no de un cálculo de
 * aquí. La bolsa aporta el CONTEXTO —qué acuerdo originó cada parte— y el
 * dinero lo pone quien lo calcula.
 *
 * Solo se leen los splits de MI cuenta: los de la contraparte viven en su
 * base y no son asunto mío. Por eso quien COLOCA ve el acuerdo y el
 * porcentaje pactado, pero el importe en pesos solo lo ve quien CAPTA, que
 * es en cuya cuenta vive el deal.
 */
async function listReceivables(
  ctx: RealtyContext,
  agreements: RealtyMlsAgreementDTO[],
): Promise<RealtyMlsReceivableDTO[]> {
  const closed = agreements.filter((a) => a.status === "CERRADO" && a.dealId);
  if (closed.length === 0) return [];

  const dealIds = Array.from(new Set(closed.map((a) => a.dealId as string)));
  const splits = await prisma.realtyCommissionSplit.findMany({
    where: { accountId: ctx.accountId, dealId: { in: dealIds }, party: "EXTERNO" },
    select: { dealId: true, externalName: true, amount: true, pct: true, paidAt: true },
  });
  if (splits.length === 0) return [];

  const out: RealtyMlsReceivableDTO[] = [];
  for (const a of closed) {
    // Se casa por dealId + nombre de la contraparte, que es exactamente la
    // llave con la que T8 agrupa a los externos en el recibo.
    const match = splits.find(
      (s) =>
        s.dealId === a.dealId &&
        (s.externalName ?? "").trim().toLowerCase() ===
          a.contraparte.nombre.trim().toLowerCase(),
    );
    if (!match) continue;
    out.push({
      agreementId: a.id,
      dealId: a.dealId as string,
      inmuebleTitulo: a.inmuebleTitulo,
      contraparte: a.contraparte.nombre,
      miPapel: a.miPapel,
      porcentaje: pct(match.pct),
      monto: num(match.amount) ?? 0,
      pagado: match.paidAt !== null,
      cerradoEn: a.cerradoEn,
    });
  }
  return out;
}

/** El tablero completo de "Mis colaboraciones". */
export async function getMlsDashboard(ctx: RealtyContext): Promise<RealtyMlsDashboard> {
  const [compartidos, adopciones, acuerdos] = await Promise.all([
    listMyShared(ctx),
    listAdoptions(ctx),
    listAgreements(ctx),
  ]);
  const porCobrar = await listReceivables(ctx, acuerdos);
  return { compartidos, adopciones, acuerdos, porCobrar };
}

/** Mi cartera, para elegir qué compartir. Solo id y título: es un selector. */
export async function listShareableProperties(
  ctx: RealtyContext,
): Promise<Array<{ id: string; title: string; city: string | null; compartido: boolean }>> {
  const [properties, listings] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId, status: { in: BOLSA_STATUSES } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, title: true, city: true },
    }),
    prisma.realtyMlsListing.findMany({
      where: { accountId: ctx.accountId, active: true },
      select: { propertyId: true },
    }),
  ]);
  const shared = new Set(listings.map((l) => l.propertyId));
  return properties.map((p) => ({
    id: p.id,
    title: p.title,
    city: str(p.city),
    compartido: shared.has(p.id),
  }));
}
