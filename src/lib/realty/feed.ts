import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/seo";
import {
  REALTY_AMENITY_KEYS,
  REALTY_PUBLIC_BASE,
  type RealtyCurrency,
  type RealtyOperation,
  type RealtyPropertyKind,
  type RealtyPropertyStatus,
  type RealtyTourKind,
} from "@/lib/realty/types";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { getRealtyPlan } from "@/lib/realty/plans";
import { detectRealtyTourProvider } from "@/lib/realty/tours";
import {
  REALTY_FEED_FILES,
  adapterForDestination,
  getRealtyPortalDestination,
  type RealtyPublishablePhoto,
  type RealtyPublishableProperty,
  type RealtyPublishableTour,
  type RealtyPublisherAccount,
  type RealtyPublishCheck,
  checkPublishable,
  resolveFeedPrice,
} from "@/lib/realty/portal-adapters";

// ═══════════════════════════════════════════════════════════════════════
// EL FEED PÚBLICO — /feeds/realty/<accountId>/<archivo>
//
// 🔴 ESTO SALE A INTERNET SIN SESIÓN. Cualquiera con la URL lo lee. Todo lo
// que decide QUÉ se publica y QUÉ se le quita a cada inmueble vive aquí, en
// un solo archivo, para que se pueda revisar de una sentada.
//
// TRES REJAS, en este orden:
//   1. El `select` de Prisma enumera las columnas seguras UNA POR UNA. Las
//      notas internas, el % de comisión, el propietario, el asesor asignado
//      y los documentos NI SIQUIERA SE LEEN de la base.
//   2. toPublishable() arma un RealtyPublishableProperty, que es un tipo sin
//      un solo campo donde quepa un dato privado.
//   3. Los adaptadores solo ven ese tipo.
//
// La dirección exacta y las coordenadas se borran cuando showExactAddress
// está apagado. No se "difuminan": se quitan. Unas coordenadas con siete
// decimales SON la dirección exacta.
//
// NUNCA 500: cualquier fallo devuelve un feed vacío y bien formado. Un
// portal que recibe un error marca la fuente como rota; uno que recibe un
// documento vacío simplemente no encuentra nada nuevo ese día.
// ═══════════════════════════════════════════════════════════════════════

/** Tope duro de inmuebles por feed. Una cartera mayor se corta y se avisa. */
export const REALTY_FEED_MAX_PROPERTIES = 2000;
/** Fotos por inmueble que se escriben en el feed. */
export const REALTY_FEED_MAX_PHOTOS = 20;
/** Segundos que vive el feed en caché. Los portales lo jalan cada hora. */
export const REALTY_FEED_TTL_SECONDS = 3600;

/** Feature de plan que exige cada adaptador. */
const FEATURE_FOR_ADAPTER: Record<string, string> = {
  "generic-xml": "portalsFeed",
  "meta-catalog": "portalsFeed",
  // El marcado de la web propia no es un portal: va con la web pública, que
  // está en los tres planes.
  "google-listing": "publicWeb",
};

// ── Utilidades de saneado ──────────────────────────────────────────────

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * URL de archivo utilizable en un feed PÚBLICO.
 *
 * 🔴 Descarta las URLs FIRMADAS de Supabase Storage. `realty-files` es un
 * bucket privado (ahí viven escrituras y prediales), así que sus enlaces
 * llevan token y caducan en minutos. Publicar uno en un feed que el portal
 * lee mañana es publicar una liga muerta: la foto sale rota en el anuncio y
 * el diagnóstico ("las fotos no cargan") no apunta a la causa.
 */
export function publicMediaUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith("/")) return `${SITE_URL}${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  // Supabase (el único firmante del repo hoy) + las firmas de S3/GCS y
  // cualquier `?expires=`, por si mañana entra otro proveedor de archivos.
  // Es una lista de RECHAZO y no de permiso a propósito: una allowlist de
  // dominios dejaría fuera al cliente que sube sus fotos a su propio CDN.
  if (value.includes("/object/sign/")) return null;
  if (/[?&](token|signature|expires|x-amz-signature|x-goog-signature)=/i.test(value)) return null;
  return value;
}

/** Amenidades: solo llaves del catálogo. El Json crudo NUNCA sale. */
function safeAmenities(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (on === true && REALTY_AMENITY_KEYS.includes(key)) out.push(key);
  }
  return out;
}

// ── Fila cruda que devuelve el select (columnas SEGURAS únicamente) ────
//
// 🔴 EL SELECT VIVE DENTRO DEL findMany, no en una constante compartida: así
// nadie lo reutiliza "para otra pantalla" y le agrega una columna que
// termina saliendo por aquí. Lo que NO está en él, y no debe estar NUNCA:
//    internalNotes · commissionPct · ownerId · assignedUserId · officeId ·
//    documents · exclusives · leads · visits · keys.

export type RealtyFeedPropertyRow = {
  id: string;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  price: unknown;
  currency: RealtyCurrency;
  rentPrice: unknown;
  maintenanceFee: unknown;
  landM2: unknown;
  builtM2: unknown;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBathrooms: number | null;
  parking: number | null;
  ageYears: number | null;
  amenities: unknown;
  address: string | null;
  colonia: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: unknown;
  lng: unknown;
  showExactAddress: boolean;
  title: string;
  description: string | null;
  publicUrlSlug: string | null;
  shortTermFolio: string | null;
  createdAt: Date;
  updatedAt: Date;
  photos: Array<{
    url: string;
    isCover: boolean;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }>;
  tours: Array<{
    kind: RealtyTourKind;
    provider: string;
    externalUrl: string | null;
    fileUrl: string | null;
    sortOrder: number;
  }>;
};

type AccountRow = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  isActive: boolean;
  subscriptionStatus: string;
  plan: string;
};

// ── Conversión a modelo canónico ───────────────────────────────────────

export function toPublisherAccount(row: AccountRow): RealtyPublisherAccount {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    // Teléfono y correo DEL NEGOCIO — el contacto del anuncio, el mismo que
    // ya enseña su web pública. El del propietario del inmueble no está en
    // este objeto ni puede estarlo.
    phone: row.phone,
    email: row.email,
    city: row.city,
    state: row.state,
    logoUrl: publicMediaUrl(row.logoUrl),
    webUrl: `${SITE_URL}${REALTY_PUBLIC_BASE}/${row.slug}`,
  };
}

export function toPublishable(
  row: RealtyFeedPropertyRow,
  account: RealtyPublisherAccount,
): RealtyPublishableProperty {
  const salePrice = num(row.price);
  const rentPrice = num(row.rentPrice);

  // La regla vive en portal-adapters/types.ts: es PURA, es la más peligrosa
  // del módulo (publicar un precio de venta como renta mensual) y por eso
  // tiene que poder probarse sin base de datos.
  const { operation, price } = resolveFeedPrice(row.operation, salePrice, rentPrice);

  const photos: RealtyPublishablePhoto[] = [];
  for (const f of row.photos) {
    const url = publicMediaUrl(f.url);
    if (!url) continue;
    photos.push({ url, isCover: f.isCover, width: f.width, height: f.height });
  }

  const tours: RealtyPublishableTour[] = [];
  for (const t of row.tours) {
    // El enlace del proveedor manda y se vuelve a validar contra la MISMA
    // allowlist que arma el frame-src de la CSP: lo que no se puede embeber
    // tampoco se manda a un portal.
    const external = (t.externalUrl ?? "").trim();
    const url = external && detectRealtyTourProvider(external) ? external : publicMediaUrl(t.fileUrl);
    if (!url) continue;
    tours.push({ kind: t.kind, provider: t.provider, url });
  }

  // 🔴 LA REJA DE LA DIRECCIÓN. Con showExactAddress apagado no sale la
  // calle NI las coordenadas: unas coordenadas con siete decimales apuntan
  // a la puerta de la casa, que es justo lo que el propietario pidió que no
  // se publicara.
  const exact = row.showExactAddress === true;

  return {
    id: row.id,
    folio: row.shortTermFolio,
    kind: row.kind,
    // La operación EFECTIVA (ver el bloque del precio), no la cruda.
    operation,
    status: row.status,
    price,
    currency: row.currency,
    salePrice,
    rentPrice,
    maintenanceFee: num(row.maintenanceFee),
    landM2: num(row.landM2),
    builtM2: num(row.builtM2),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    halfBathrooms: row.halfBathrooms,
    parking: row.parking,
    ageYears: row.ageYears,
    amenities: safeAmenities(row.amenities),
    title: row.title,
    description: row.description,
    address: exact ? row.address : null,
    colonia: row.colonia,
    city: row.city,
    state: row.state,
    zip: row.zip,
    lat: exact ? num(row.lat) : null,
    lng: exact ? num(row.lng) : null,
    showExactAddress: exact,
    photos,
    tours,
    url: `${account.webUrl}/${row.publicUrlSlug ?? row.id}`,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// La validación vive en portal-adapters/types.ts: es PURA (solo mira el
// modelo canónico) y así se puede probar sin base de datos. Se re-exporta
// aquí para que quien lea el feed no tenga que buscarla.
export { checkPublishable };
export type { RealtyPublishCheck };

// ── Carga ──────────────────────────────────────────────────────────────

export interface RealtyFeedData {
  account: RealtyPublisherAccount;
  properties: RealtyPublishableProperty[];
  /** true si la cartera publicada excede REALTY_FEED_MAX_PROPERTIES. */
  truncated: boolean;
  /** Feature del plan que exige el archivo pedido. */
  planAllows: boolean;
}

/**
 * Ids elegidos para un destino con cupo. Devuelve `null` cuando el destino
 * no recorta nada (feed general): así se distingue "todos" de "ninguno" —
 * un [] querría decir feed vacío y son cosas distintas.
 */
export interface RealtyDestinationSelection {
  /** Ids en ORDEN DE ANTIGÜEDAD (quien llegó primero se queda con su lugar). */
  ids: string[];
  /** Anuncios contratados. 0 = sin límite declarado. */
  max: number;
}

export async function selectedPropertyIdsFor(
  accountId: string,
  destination: string,
): Promise<RealtyDestinationSelection | null> {
  const dest = getRealtyPortalDestination(destination);
  // El marcado de la web propia lleva TODA la cartera publicada: no hay
  // portal que cobre por anuncio, así que no hay a quién recortarle.
  if (dest?.adapter === "google-listing") return null;
  // Destino que todavía no se puede usar (los que piden convenio): su URL no
  // sirve nada. `setPropertyDestination` ya impide elegirlos, pero si un
  // destino deja de estar disponible después, sus filas viejas no pueden
  // seguir saliendo por aquí.
  if (dest && !dest.available) return { ids: [], max: 0 };

  const [config, rows] = await Promise.all([
    prisma.realtyPortalAccount.findUnique({
      where: { accountId_portal: { accountId, portal: destination } },
      select: { maxListings: true, active: true },
    }),
    prisma.realtyPortalListing.findMany({
      // PAUSADO queda fuera a propósito: es lo que se retiró (a mano o por
      // la despublicación automática) y no debe volver al feed.
      where: { accountId, portal: destination, status: { in: ["BORRADOR", "PUBLICADO", "ERROR"] } },
      select: { propertyId: true },
      // `id` de desempate: dos filas creadas en el mismo milisegundo con solo
      // `createdAt` podrían ordenarse distinto aquí y en la cola, y entonces
      // el feed serviría un subconjunto distinto del que la matriz marca.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  // Destino apagado en la configuración → no se sirve nada por esa URL.
  if (config && !config.active) return { ids: [], max: 0 };

  return { ids: rows.map((r) => r.propertyId), max: config?.maxListings ?? 0 };
}

/**
 * Carga la cuenta y sus inmuebles publicables. `null` = la cuenta no existe,
 * está desactivada o no está al corriente de pago (y entonces el feed sale
 * vacío: no se distingue de una cuenta sin inmuebles, a propósito).
 */
export async function loadRealtyFeedData(
  accountId: string,
  options: { adapter?: string; destination?: string | null } = {},
): Promise<RealtyFeedData | null> {
  const account = (await prisma.realtyAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      city: true,
      state: true,
      logoUrl: true,
      isActive: true,
      subscriptionStatus: true,
      plan: true,
    },
  })) as AccountRow | null;

  if (!account) return null;
  if (!account.isActive) return null;
  // Suscripción impaga → el feed deja de servir. Es lo mismo que hace el
  // panel: no hay producto sin pago.
  if (!isRealtySubscriptionActive(account)) return null;

  const plan = await getRealtyPlan(account.plan);
  const feature = FEATURE_FOR_ADAPTER[options.adapter ?? "generic-xml"] ?? "portalsFeed";
  const planAllows = realtyPlanHasFeature(plan, feature);

  const publisher = toPublisherAccount(account);
  if (!planAllows) {
    return { account: publisher, properties: [], truncated: false, planAllows: false };
  }

  let selection: RealtyDestinationSelection | null = null;
  if (options.destination) {
    selection = await selectedPropertyIdsFor(accountId, options.destination);
    // Destino elegido sin un solo inmueble seleccionado → feed vacío. No es
    // un error: es "todavía no has elegido cuáles publicar ahí".
    if (selection !== null && selection.ids.length === 0) {
      return { account: publisher, properties: [], truncated: false, planAllows: true };
    }
  }
  const ids = selection?.ids ?? null;

  const rows = (await prisma.realtyProperty.findMany({
    where: {
      // 🔴 accountId SIEMPRE presente. Un undefined aquí borraría el filtro
      // y publicaría la cartera de TODAS las inmobiliarias en una sola URL.
      accountId,
      isPublished: true,
      status: "DISPONIBLE",
      ...(ids !== null ? { id: { in: ids } } : {}),
    },
    select: {
      id: true,
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
      address: true,
      colonia: true,
      city: true,
      state: true,
      zip: true,
      lat: true,
      lng: true,
      showExactAddress: true,
      title: true,
      description: true,
      publicUrlSlug: true,
      shortTermFolio: true,
      createdAt: true,
      updatedAt: true,
      photos: {
        select: { url: true, isCover: true, width: true, height: true, sortOrder: true },
        orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
        take: 40,
      },
      tours: {
        select: { kind: true, provider: true, externalUrl: true, fileUrl: true, sortOrder: true },
        orderBy: { sortOrder: "asc" },
        take: 5,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: REALTY_FEED_MAX_PROPERTIES + 1,
  })) as unknown as RealtyFeedPropertyRow[];

  const truncated = rows.length > REALTY_FEED_MAX_PROPERTIES;
  let properties = rows
    .slice(0, REALTY_FEED_MAX_PROPERTIES)
    .map((row) => toPublishable(row, publisher))
    // Lo que un portal rechazaría no se manda: una fuente con anuncios
    // inválidos baja la reputación de TODO el feed, no solo de ese anuncio.
    .filter((p) => checkPublishable(p).blockers.length === 0);

  // 🔴 EL CUPO SE APLICA AL FINAL, sobre lo que DE VERDAD va a salir.
  //
  // Recortar antes (sobre las filas elegidas) desperdiciaba lugares: una fila
  // que apunta a un inmueble ya vendido, o al que le falta el precio, se
  // llevaba uno de los 10 anuncios contratados y el portal recibía 9. Aquí
  // cuentan solo los que pasan, y el orden es el de ANTIGÜEDAD de la
  // elección: quien llegó primero conserva su lugar aunque alguien baje el
  // cupo después. Los que quedan fuera se marcan con error en la matriz
  // (processPortalQueueForAccount) para que el asesor lo vea.
  if (selection && selection.max > 0) {
    const rank = new Map(selection.ids.map((id, i) => [id, i]));
    properties = properties
      .slice()
      .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      .slice(0, selection.max);
  }

  return { account: publisher, properties, truncated, planAllows: true };
}

// ── Lo que necesita LA COLA (que no es lo mismo que el feed) ───────────

export interface RealtyQueueCandidate {
  property: RealtyPublishableProperty;
  check: RealtyPublishCheck;
}

export interface RealtyQueueSnapshot {
  account: RealtyPublisherAccount | null;
  /** La cuenta existe, está activa y al corriente de pago. */
  accountUsable: boolean;
  /** El plan incluye `portalsFeed`. */
  planAllows: boolean;
  /**
   * Inmuebles DISPONIBLES y publicados, **con bloqueos y todo**. La cola
   * necesita distinguir "ya no es publicable" (se baja) de "le falta un dato"
   * (se marca con error y se conserva el lugar); el feed solo necesita lo
   * primero.
   */
  byId: Map<string, RealtyQueueCandidate>;
}

/**
 * 🔴 POR QUÉ NO REUTILIZA loadRealtyFeedData.
 *
 * Aquella devuelve lo que SALE al feed, o sea ya sin los inmuebles que tienen
 * bloqueos. Si la cola se apoyara en esa lista, un inmueble al que solo le
 * falta el precio "desaparecería" y la cola lo trataría como retirado: le
 * borraría la elección al asesor y liberaría su lugar del cupo, cuando lo
 * correcto es marcarlo CON ERROR y conservarle el lugar hasta que lo arregle.
 *
 * Por eso la cola tiene su propia foto: los mismos inmuebles, sin filtrar por
 * bloqueos, con el diagnóstico de cada uno al lado.
 */
export async function loadQueueSnapshot(
  accountId: string,
  propertyIds: string[],
): Promise<RealtyQueueSnapshot> {
  const empty: RealtyQueueSnapshot = {
    account: null,
    accountUsable: false,
    planAllows: false,
    byId: new Map(),
  };
  if (!accountId || propertyIds.length === 0) return empty;

  const account = (await prisma.realtyAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      city: true,
      state: true,
      logoUrl: true,
      isActive: true,
      subscriptionStatus: true,
      plan: true,
    },
  })) as AccountRow | null;
  if (!account) return empty;

  const publisher = toPublisherAccount(account);
  const accountUsable = account.isActive && isRealtySubscriptionActive(account);
  const plan = await getRealtyPlan(account.plan);
  const planAllows = realtyPlanHasFeature(plan, "portalsFeed");

  const rows = (await prisma.realtyProperty.findMany({
    where: { accountId, id: { in: propertyIds }, isPublished: true, status: "DISPONIBLE" },
    select: {
      id: true,
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
      address: true,
      colonia: true,
      city: true,
      state: true,
      zip: true,
      lat: true,
      lng: true,
      showExactAddress: true,
      title: true,
      description: true,
      publicUrlSlug: true,
      shortTermFolio: true,
      createdAt: true,
      updatedAt: true,
      photos: {
        select: { url: true, isCover: true, width: true, height: true, sortOrder: true },
        orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
        take: 40,
      },
      tours: {
        select: { kind: true, provider: true, externalUrl: true, fileUrl: true, sortOrder: true },
        orderBy: { sortOrder: "asc" },
        take: 5,
      },
    },
  })) as unknown as RealtyFeedPropertyRow[];

  const byId = new Map<string, RealtyQueueCandidate>();
  for (const row of rows) {
    const property = toPublishable(row, publisher);
    byId.set(row.id, { property, check: checkPublishable(property) });
  }
  return { account: publisher, accountUsable, planAllows, byId };
}

// ── Construcción del archivo ───────────────────────────────────────────

export interface RealtyFeedResponse {
  body: string;
  contentType: string;
  count: number;
}

/** Cuenta de mentira para el feed vacío: no revela nada de nadie. */
function emptyAccount(accountId: string): RealtyPublisherAccount {
  return {
    id: accountId,
    name: "",
    slug: "",
    phone: null,
    email: null,
    city: null,
    state: null,
    logoUrl: null,
    webUrl: SITE_URL,
  };
}

async function buildUncached(
  accountId: string,
  file: string,
  destination: string | null,
  generatedAt: string,
): Promise<RealtyFeedResponse> {
  const adapter = REALTY_FEED_FILES[file];
  if (!adapter) return { body: "", contentType: "text/plain; charset=utf-8", count: 0 };

  const options = { maxPhotos: REALTY_FEED_MAX_PHOTOS, generatedAt, destination: destination ?? undefined };

  try {
    const data = await loadRealtyFeedData(accountId, {
      adapter: adapter.key,
      destination,
    });
    if (!data) {
      return {
        body: adapter.build([], emptyAccount(accountId), options),
        contentType: adapter.contentType,
        count: 0,
      };
    }
    return {
      body: adapter.build(data.properties, data.account, options),
      contentType: adapter.contentType,
      count: data.properties.length,
    };
  } catch (err) {
    // 🔴 NUNCA se propaga. Un feed roto le dice al portal "esta fuente
    // falla"; un feed vacío le dice "hoy no hay nada". La segunda es
    // recuperable, la primera a veces no.
    console.error("[realty/feed] falló al construir", accountId, file, err);
    return {
      body: adapter.build([], emptyAccount(accountId), options),
      contentType: adapter.contentType,
      count: 0,
    };
  }
}

/** Etiqueta de caché de una cuenta. La invalida portals.ts al cambiar algo. */
export function realtyFeedTag(accountId: string): string {
  return `realty-feed-${accountId}`;
}

/**
 * El feed, CACHEADO. Un portal lo jala cada hora y no puede costar una
 * consulta a Postgres por visita: si además alguien apunta un monitor a la
 * URL, la cartera entera se lee cada minuto.
 *
 * `generatedAt` se redondea a la hora: la función envuelta no recibe
 * argumentos, así que el instante exacto tampoco crearía claves distintas —
 * el redondeo solo evita que el sello del documento parezca preciso al
 * segundo cuando en realidad puede venir de la copia cacheada de hace 59
 * minutos.
 */
export async function buildRealtyFeed(
  accountId: string,
  file: string,
  destination: string | null,
): Promise<RealtyFeedResponse> {
  const hourBucket = new Date(
    Math.floor(Date.now() / (REALTY_FEED_TTL_SECONDS * 1000)) * REALTY_FEED_TTL_SECONDS * 1000,
  ).toISOString();

  const cached = unstable_cache(
    () => buildUncached(accountId, file, destination, hourBucket),
    ["realty-feed", accountId, file, destination ?? "-"],
    { revalidate: REALTY_FEED_TTL_SECONDS, tags: [realtyFeedTag(accountId)] },
  );
  return cached();
}

/**
 * Modelo canónico en JSON, para DEPURAR ("¿qué está saliendo de aquí?").
 * Pasa por la MISMA reja: es la misma lista que reciben los adaptadores, sin
 * un solo campo de más. Si algo se ve aquí, se está publicando.
 */
export async function buildRealtyFeedJson(
  accountId: string,
  destination: string | null,
): Promise<{ body: string; contentType: string; count: number }> {
  const generatedAt = new Date().toISOString();
  try {
    const data = await loadRealtyFeedData(accountId, {
      // 🔴 SIEMPRE "generic-xml", nunca el adaptador del destino. Este JSON
      // es la herramienta de depuración DE PORTALES, así que se cobra como
      // portales (feature `portalsFeed`). Derivarlo del destino abría un
      // atajo: `?destino=web-propia` resuelve a google-listing, cuya feature
      // (`publicWeb`) está en los TRES planes, y una cuenta en PROPIETARIO
      // —que no paga portales— se llevaba la cartera entera por esta URL.
      adapter: "generic-xml",
      destination,
    });
    const payload = {
      generatedAt,
      destination,
      account: data?.account ?? emptyAccount(accountId),
      count: data?.properties.length ?? 0,
      truncated: data?.truncated ?? false,
      properties: data?.properties ?? [],
    };
    return {
      body: `${JSON.stringify(payload, null, 2)}\n`,
      contentType: "application/json; charset=utf-8",
      count: payload.count,
    };
  } catch (err) {
    console.error("[realty/feed] json falló", accountId, err);
    return {
      body: `${JSON.stringify({ generatedAt, destination, count: 0, properties: [] }, null, 2)}\n`,
      contentType: "application/json; charset=utf-8",
      count: 0,
    };
  }
}

/** URL pública del feed de una cuenta (la que se copia en la pantalla). */
export function realtyFeedUrl(
  accountId: string,
  file = "propiedades.xml",
  destination?: string | null,
): string {
  const base = `${SITE_URL}/feeds/realty/${accountId}/${file}`;
  return destination ? `${base}?destino=${encodeURIComponent(destination)}` : base;
}
