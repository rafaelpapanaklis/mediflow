import "server-only";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { REALTY_ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/realty/plan-shared";
import type { RealtyPortalListingStatus, RealtyPropertyStatus } from "@/lib/realty/types";
import {
  adapterForDestination,
  getRealtyPortalDestination,
  realtyPortalLabel,
  REALTY_PORTAL_DESTINATIONS,
  type RealtyPortalPushResult,
  type RealtyPublisherAccount,
} from "@/lib/realty/portal-adapters";
import {
  MAX_PORTAL_ATTEMPTS,
  REALTY_SLOT_STATUSES,
  claimsSlot,
  composePortalError,
  nextAttemptFor,
  slotInfo,
  splitPortalError,
  type PortalErrorInfo,
  type RealtyPortalSlotInfo,
} from "@/lib/realty/portal-adapters/retry";
import {
  checkPublishable,
  loadQueueSnapshot,
  publicMediaUrl,
  realtyFeedTag,
  realtyFeedUrl,
  toPublishable,
  toPublisherAccount,
} from "@/lib/realty/feed";

// ═══════════════════════════════════════════════════════════════════════
// PORTALES — cupos, matriz de estado, cola con reintentos y despublicación
// automática.
//
// ── DÓNDE VIVE EL ESTADO DEL REINTENTO ────────────────────────────────
// `realty_portal_listings` no tiene columnas `attempts` / `nextAttemptAt`, y
// el schema es de la Ola 0: no se toca desde aquí. El contador y la próxima
// hora se guardan como una MARCA al final de `lastError`, que es texto:
//
//   "El portal respondió 503.\n[dc:reintento n=3 desde=2026-08-25T18:00:00.000Z]"
//
// Es el mismo recurso que ya usa barber para la cancelación suave en
// `notes`. La marca se quita SIEMPRE antes de enseñar el error: el asesor ve
// "El portal respondió 503", nunca el corchete.
//
// Si algún día se agregan columnas de verdad, lo único que cambia son
// splitPortalError/composePortalError. Nada más las lee.
//
// ── QUÉ SIGNIFICA CADA ESTADO ─────────────────────────────────────────
//   (sin fila)  no publicada  → no ocupa cupo
//   BORRADOR    pendiente     → elegida, todavía no confirmada. Ocupa cupo.
//   PUBLICADO   publicada     → viva en ese destino. Ocupa cupo.
//   ERROR       con error     → algo la detiene. Ocupa cupo A PROPÓSITO: el
//                               asesor la quiere ahí, y liberar el lugar en
//                               silencio le escondería el problema.
//   PAUSADO     retirada      → se bajó (a mano o sola). NO ocupa cupo.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Filas que LEE una pasada (leer es barato: seis columnas cortas) y filas que
 * ESCRIBE como mucho. La lectura tiene que abarcarlo todo o las filas del
 * final no se reconcilian nunca; la escritura sí se acota, porque en régimen
 * normal es cero y solo se dispara cuando algo cambió de verdad.
 */
const QUEUE_MAX_ROWS = 5000;
const QUEUE_MAX_WRITES = 400;

// La política de entrega (marca de reintento, espera creciente y cupo) vive
// en portal-adapters/retry.ts: es PURA y por eso se puede probar sin base de
// datos. Aquí se re-exporta para que nadie tenga que saber dónde está.
export {
  REALTY_SLOT_STATUSES,
  claimsSlot,
  splitPortalError,
  composePortalError,
  nextAttemptFor,
  slotInfo,
  MAX_PORTAL_ATTEMPTS,
  type PortalErrorInfo,
  type RealtyPortalSlotInfo,
};

// ── Panorama de la pantalla ────────────────────────────────────────────

export interface RealtyPortalDestinationView {
  key: string;
  label: string;
  group: string;
  help: string;
  available: boolean;
  unavailableReason: string | null;
  paidBySubscriber: boolean;
  transport: "feed" | "push";
  /** URL pública que el cliente le da de alta al portal. */
  feedUrl: string | null;
  configured: boolean;
  active: boolean;
  hasApiKey: boolean;
  externalAccountId: string | null;
  slots: RealtyPortalSlotInfo;
  counts: Record<RealtyPortalListingStatus, number>;
  lastPushedAt: string | null;
}

export interface RealtyPortalsOverview {
  accountId: string;
  /** Feed general: TODO lo publicado, sin recortar por destino. */
  generalFeedUrl: string;
  jsonFeedUrl: string;
  metaFeedUrl: string;
  publishedCount: number;
  destinations: RealtyPortalDestinationView[];
}

export async function getPortalsOverview(accountId: string): Promise<RealtyPortalsOverview> {
  const [accounts, grouped, publishedCount] = await Promise.all([
    prisma.realtyPortalAccount.findMany({
      where: { accountId },
      select: {
        portal: true,
        externalAccountId: true,
        apiKey: true,
        maxListings: true,
        active: true,
      },
    }),
    prisma.realtyPortalListing.groupBy({
      by: ["portal", "status"],
      where: { accountId },
      _count: { _all: true },
      _max: { lastPushedAt: true },
    }),
    prisma.realtyProperty.count({
      where: { accountId, isPublished: true, status: "DISPONIBLE" },
    }),
  ]);

  const byPortal = new Map(accounts.map((a) => [a.portal, a]));
  const counts = new Map<string, Record<RealtyPortalListingStatus, number>>();
  const lastPush = new Map<string, Date | null>();
  for (const g of grouped) {
    const bucket =
      counts.get(g.portal) ??
      ({ BORRADOR: 0, PUBLICADO: 0, PAUSADO: 0, ERROR: 0 } as Record<
        RealtyPortalListingStatus,
        number
      >);
    bucket[g.status as RealtyPortalListingStatus] = g._count._all;
    counts.set(g.portal, bucket);
    const prev = lastPush.get(g.portal) ?? null;
    const cur = g._max.lastPushedAt ?? null;
    if (cur && (!prev || cur > prev)) lastPush.set(g.portal, cur);
    else if (!lastPush.has(g.portal)) lastPush.set(g.portal, prev);
  }

  const destinations: RealtyPortalDestinationView[] = REALTY_PORTAL_DESTINATIONS.map((d) => {
    const row = byPortal.get(d.key) ?? null;
    const bucket =
      counts.get(d.key) ??
      ({ BORRADOR: 0, PUBLICADO: 0, PAUSADO: 0, ERROR: 0 } as Record<
        RealtyPortalListingStatus,
        number
      >);
    const used = REALTY_SLOT_STATUSES.reduce((sum, s) => sum + bucket[s], 0);
    const adapter = adapterForDestination(d.key);
    return {
      key: d.key,
      label: d.label,
      group: d.group,
      help: d.help,
      available: d.available,
      unavailableReason: d.unavailableReason ?? null,
      paidBySubscriber: d.paidBySubscriber,
      transport: adapter.transport,
      feedUrl: d.available ? realtyFeedUrl(accountId, adapter.filename, d.key) : null,
      configured: row !== null,
      active: row?.active ?? false,
      // 🔴 La apiKey JAMÁS sale al navegador: solo si está puesta o no.
      hasApiKey: Boolean(row?.apiKey),
      externalAccountId: row?.externalAccountId ?? null,
      slots: slotInfo(row?.maxListings ?? 0, used),
      counts: bucket,
      lastPushedAt: (lastPush.get(d.key) ?? null)?.toISOString() ?? null,
    };
  });

  return {
    accountId,
    generalFeedUrl: realtyFeedUrl(accountId, "propiedades.xml"),
    jsonFeedUrl: realtyFeedUrl(accountId, "propiedades.json"),
    metaFeedUrl: realtyFeedUrl(accountId, "meta.csv"),
    publishedCount,
    destinations,
  };
}

// ── La matriz: inmueble × destino ──────────────────────────────────────

export interface RealtyPortalCell {
  status: RealtyPortalListingStatus | null;
  lastPushedAt: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  externalId: string | null;
}

export interface RealtyPortalMatrixRow {
  propertyId: string;
  title: string;
  folio: string | null;
  status: RealtyPropertyStatus;
  isPublished: boolean;
  coverUrl: string | null;
  price: number;
  currency: string;
  city: string | null;
  /** Por qué NO se puede publicar (vacío = se puede). */
  blockers: string[];
  /** Se puede, pero rinde menos. */
  warnings: string[];
  cells: Record<string, RealtyPortalCell>;
}

export interface RealtyPortalMatrix {
  rows: RealtyPortalMatrixRow[];
  total: number;
  truncated: boolean;
}

export const MATRIX_PAGE_SIZE = 100;

/**
 * La matriz. Enseña TODOS los inmuebles de la cartera —incluidos los
 * despublicados y los vendidos—, no solo los publicables: la pregunta que
 * trae al asesor a esta pantalla suele ser "¿por qué ESE no aparece?", y un
 * inmueble que no sale de la consulta no tiene respuesta.
 */
export async function getPortalMatrix(
  accountId: string,
  options: { q?: string; limit?: number } = {},
): Promise<RealtyPortalMatrix> {
  const limit = Math.min(Math.max(1, options.limit ?? MATRIX_PAGE_SIZE), 300);
  const q = (options.q ?? "").trim();

  const where = {
    accountId,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { shortTermFolio: { contains: q, mode: "insensitive" as const } },
            { colonia: { contains: q, mode: "insensitive" as const } },
            { city: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.realtyProperty.count({ where }),
    prisma.realtyProperty.findMany({
      where,
      select: {
        id: true,
        kind: true,
        operation: true,
        status: true,
        isPublished: true,
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
        portalListings: {
          select: {
            portal: true,
            status: true,
            lastPushedAt: true,
            lastError: true,
            externalId: true,
          },
        },
      },
      orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
      take: limit,
    }),
  ]);

  const account = await prisma.realtyAccount.findUnique({
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
  });
  const matrixPublisher: RealtyPublisherAccount = account
    ? toPublisherAccount(account)
    : {
        id: accountId,
        name: "",
        slug: "",
        phone: null,
        email: null,
        city: null,
        state: null,
        logoUrl: null,
        webUrl: "",
      };

  const out: RealtyPortalMatrixRow[] = rows.map((row) => {
    // Se valida sobre el modelo YA saneado: es lo que de verdad recibiría el
    // portal, no lo que hay en la base.
    const pub = toPublishable(row, matrixPublisher);
    const check = checkPublishable(pub);
    const blockers = [...check.blockers];
    if (!row.isPublished) {
      blockers.unshift("Está despublicado: enciéndelo en la ficha del inmueble.");
    }
    if (row.status !== "DISPONIBLE") {
      blockers.unshift(`Está marcado como ${row.status.toLowerCase()}; solo sale lo disponible.`);
    }

    const cells: Record<string, RealtyPortalCell> = {};
    for (const l of row.portalListings) {
      const info = splitPortalError(l.lastError);
      cells[l.portal] = {
        status: l.status,
        lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
        error: info.message,
        attempts: info.attempts,
        nextAttemptAt: info.nextAttemptAt?.toISOString() ?? null,
        externalId: l.externalId,
      };
    }

    return {
      propertyId: row.id,
      title: row.title,
      folio: row.shortTermFolio,
      status: row.status,
      isPublished: row.isPublished,
      coverUrl: publicMediaUrl(row.photos.find((f) => f.isCover)?.url ?? row.photos[0]?.url ?? null),
      price: pub.price,
      currency: row.currency,
      city: row.city,
      blockers,
      warnings: check.warnings,
      cells,
    };
  });

  return { rows: out, total, truncated: total > out.length };
}

// ── Configurar un destino ──────────────────────────────────────────────

export interface ConfigureDestinationInput {
  portal: string;
  active?: boolean;
  maxListings?: number;
  externalAccountId?: string | null;
}

export async function configureDestination(
  accountId: string,
  input: ConfigureDestinationInput,
): Promise<{ ok: boolean; error?: string }> {
  const dest = getRealtyPortalDestination(input.portal);
  if (!dest) return { ok: false, error: "Ese destino no existe." };
  if (!dest.available && input.active) {
    return { ok: false, error: dest.unavailableReason ?? "Ese destino todavía no está disponible." };
  }
  const max = Number.isFinite(input.maxListings) ? Math.max(0, Math.trunc(Number(input.maxListings))) : 0;

  await prisma.realtyPortalAccount.upsert({
    where: { accountId_portal: { accountId, portal: input.portal } },
    create: {
      accountId,
      portal: input.portal,
      active: input.active ?? false,
      maxListings: max,
      externalAccountId: input.externalAccountId ?? null,
    },
    update: {
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.maxListings === undefined ? {} : { maxListings: max }),
      ...(input.externalAccountId === undefined
        ? {}
        : { externalAccountId: input.externalAccountId }),
    },
  });
  bustFeedCache(accountId);
  return { ok: true };
}

// ── Elegir qué inmueble va a qué destino (aquí muerde el cupo) ─────────

export interface SetDestinationResult {
  ok: boolean;
  error?: string;
  slots?: RealtyPortalSlotInfo;
}

export async function setPropertyDestination(
  accountId: string,
  input: { propertyId: string; portal: string; selected: boolean },
): Promise<SetDestinationResult> {
  const dest = getRealtyPortalDestination(input.portal);
  if (!dest) return { ok: false, error: "Ese destino no existe." };

  // 🔴 El inmueble TIENE que ser de esta cuenta. Sin este check, mandar un
  // propertyId ajeno crearía una fila que apunta a la cartera de otro.
  const property = await prisma.realtyProperty.findFirst({
    where: { id: input.propertyId, accountId },
    select: { id: true },
  });
  if (!property) return { ok: false, error: "Ese inmueble no es de tu cuenta." };

  if (!input.selected) {
    // Retirar = PAUSADO, no borrar: se conserva el historial de que estuvo
    // publicado y por qué se bajó. Y libera el cupo.
    await prisma.realtyPortalListing.updateMany({
      where: { accountId, propertyId: input.propertyId, portal: input.portal },
      data: { status: "PAUSADO", lastError: null, lastPushedAt: new Date() },
    });
    bustFeedCache(accountId);
    return { ok: true, slots: await currentSlots(accountId, input.portal) };
  }

  if (!dest.available) {
    return { ok: false, error: dest.unavailableReason ?? "Ese destino todavía no está disponible." };
  }

  // ⚠️ Las dos escrituras de aquí abajo van por el único compuesto
  // `propertyId_portal`, que NO lleva columna de tenant. Son seguras SOLO
  // porque el findFirst de arriba ya comprobó que el inmueble es de esta
  // cuenta. Si alguien mueve o borra ese check, esto se convierte en
  // escritura entre cuentas sin que ningún `where` lo delate.
  const existing = await prisma.realtyPortalListing.findUnique({
    where: { propertyId_portal: { propertyId: input.propertyId, portal: input.portal } },
    select: { id: true, status: true },
  });

  // Si ya ocupaba lugar, re-seleccionarlo no consume otro.
  const alreadyClaiming = existing !== null && claimsSlot(existing.status);

  if (!alreadyClaiming) {
    const slots = await currentSlots(accountId, input.portal);
    if (slots.full) {
      return {
        ok: false,
        slots,
        error: `Ya usaste los ${slots.max} anuncios que tienes contratados en ${realtyPortalLabel(
          input.portal,
        )}. Quita uno de la lista para meter este, o contrata más anuncios con el portal.`,
      };
    }
  }

  await prisma.realtyPortalListing.upsert({
    where: { propertyId_portal: { propertyId: input.propertyId, portal: input.portal } },
    create: { accountId, propertyId: input.propertyId, portal: input.portal, status: "BORRADOR" },
    // accountId también en el update: si una fila vieja quedó con el tenant
    // equivocado, esta escritura la corrige en vez de conservarlo.
    update: { accountId, status: "BORRADOR", lastError: null },
  });
  bustFeedCache(accountId);
  return { ok: true, slots: await currentSlots(accountId, input.portal) };
}

async function currentSlots(accountId: string, portal: string): Promise<RealtyPortalSlotInfo> {
  const [acc, used] = await Promise.all([
    prisma.realtyPortalAccount.findUnique({
      where: { accountId_portal: { accountId, portal } },
      select: { maxListings: true },
    }),
    prisma.realtyPortalListing.count({
      where: { accountId, portal, status: { in: [...REALTY_SLOT_STATUSES] } },
    }),
  ]);
  return slotInfo(acc?.maxListings ?? 0, used);
}

// ── La cola ────────────────────────────────────────────────────────────

export interface PortalQueueSummary {
  accounts: number;
  published: number;
  /** Se bajaron solos porque el inmueble dejó de ser publicable. */
  unpublished: number;
  failed: number;
  /** Esperando su turno de reintento. */
  waiting: number;
  overQuota: number;
  /** Cambios que no cupieron en esta pasada (se aplican en la siguiente). */
  pendingWrites: number;
  errors: Array<{ propertyId: string; portal: string; reason: string }>;
}

function emptySummary(): PortalQueueSummary {
  return {
    accounts: 0,
    published: 0,
    unpublished: 0,
    failed: 0,
    waiting: 0,
    overQuota: 0,
    pendingWrites: 0,
    errors: [],
  };
}

/**
 * Una pasada de la cola sobre UNA cuenta.
 *
 * Hace tres cosas, en este orden:
 *   1. RECONCILIA. Compara cada fila contra la realidad del inmueble. De
 *      aquí sale la DESPUBLICACIÓN AUTOMÁTICA: en cuanto un inmueble se
 *      marca VENDIDO o RENTADO deja de cumplir la condición y se baja de
 *      todos los destinos, sin que nadie se acuerde de hacerlo. Que un
 *      anuncio se quede colgado es la queja número uno de los portales, y
 *      así no depende de la disciplina de nadie.
 *   2. VALIDA. Lo que un portal rechazaría se marca ERROR con el motivo en
 *      español. Se re-evalúa en cada pasada (no cuesta una llamada externa),
 *      así se arregla solo en cuanto el asesor sube la foto que faltaba.
 *   3. EMPUJA, solo para destinos con API (`transport: "push"`), con espera
 *      creciente. Hoy no hay ninguno: los tres grandes de México no tienen
 *      conexión abierta.
 */
export async function processPortalQueueForAccount(
  accountId: string,
  now: Date = new Date(),
): Promise<PortalQueueSummary> {
  const summary = emptySummary();
  summary.accounts = 1;
  if (!accountId) return summary;

  // 🔴 SE LEEN TODAS LAS FILAS, no un lote de 200.
  //
  // Con un `take` a secas y sin cursor, las filas más allá del tope no se
  // reconciliaban NUNCA: siempre se procesaban las mismas primeras y el resto
  // se quedaba en "pendiente" para siempre — incluidas las de un inmueble ya
  // vendido, que entonces no se despublicaba jamás. 40 inmuebles × 6 destinos
  // ya son 240 filas.
  //
  // Leerlas todas es barato (son seis columnas cortas). Lo que se acota es la
  // ESCRITURA: abajo solo se escribe donde el estado deseado difiere del real,
  // que en régimen normal es cero, y con un tope duro por pasada.
  const listings = await prisma.realtyPortalListing.findMany({
    where: { accountId },
    select: {
      id: true,
      propertyId: true,
      portal: true,
      status: true,
      lastError: true,
      externalId: true,
      createdAt: true,
    },
    // El MISMO orden que usa el feed para repartir el cupo (feed.ts), con
    // `id` de desempate: sin él, dos filas del mismo milisegundo podrían
    // ordenarse distinto aquí y allá, y la matriz contradiría al feed.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: QUEUE_MAX_ROWS,
  });
  if (listings.length === 0) return summary;
  if (listings.length >= QUEUE_MAX_ROWS) {
    // Un tope que no se anuncia se lee como "lo revisé todo" sin haberlo hecho.
    console.warn(
      `[realty/portals] la cuenta ${accountId} tiene ${QUEUE_MAX_ROWS}+ filas de portal: ` +
        "esta pasada solo reconcilió las más antiguas.",
    );
  }

  // Una sola foto de los inmuebles implicados, CON sus bloqueos: la cola
  // necesita distinguir "ya no es publicable" de "le falta un dato".
  const ids = Array.from(new Set(listings.map((l) => l.propertyId)));
  const snapshot = await loadQueueSnapshot(accountId, ids);

  // Por qué NO es publicable: hace falta para escribir un motivo útil en vez
  // de un "no se pudo".
  const raw = await prisma.realtyProperty.findMany({
    where: { accountId, id: { in: ids } },
    select: { id: true, status: true, isPublished: true },
  });
  const byId = new Map(raw.map((r) => [r.id, r]));

  const quotas = await prisma.realtyPortalAccount.findMany({
    where: { accountId },
    select: { portal: true, maxListings: true, active: true },
  });
  const quotaBy = new Map(quotas.map((q) => [q.portal, q]));
  const claimed = new Map<string, number>();

  // Cambios pendientes de escribir. Se acumulan y se aplican al final para
  // poder acotarlos: una cuenta enorme no puede lanzar miles de UPDATE.
  const writes: Array<{ id: string; data: Record<string, unknown>; bucket: keyof PortalQueueSummary }> = [];
  const push = (
    l: { id: string; status: RealtyPortalListingStatus; lastError: string | null },
    status: RealtyPortalListingStatus,
    lastError: string | null,
    bucket: keyof PortalQueueSummary,
    touchPushedAt = true,
  ): void => {
    // Nada que hacer si ya está así: en régimen normal la cola no escribe.
    if (l.status === status && splitPortalError(l.lastError).message === splitPortalError(lastError).message) {
      return;
    }
    writes.push({
      id: l.id,
      data: { status, lastError, ...(touchPushedAt ? { lastPushedAt: now } : {}) },
      bucket,
    });
  };

  // 🔴 CUENTA IMPAGA O PLAN SIN PORTALES: no se borra nada.
  //
  // El feed ya deja de servir solo. Marcar las filas como "retiradas" aquí
  // destruiría la elección del asesor (PAUSADO no resucita) por una causa
  // REVERSIBLE — y con un motivo mentiroso, porque el inmueble está perfecto.
  // Vuelven a PENDIENTE con la verdad escrita y, al pagar o subir de plan, la
  // siguiente pasada las publica sin que tenga que volver a escoger nada.
  if (!snapshot.accountUsable || !snapshot.planAllows) {
    const reason = !snapshot.accountUsable
      ? "Tu suscripción a DaleControl no está al corriente, así que dejamos de publicar."
      : "Tu plan ya no incluye la publicación en portales.";
    for (const l of listings) {
      if (l.status === "PAUSADO") continue;
      push(l, "BORRADOR", reason, "waiting", false);
    }
    await applyWrites(writes, summary);
    if (writes.length > 0) bustFeedCache(accountId);
    return summary;
  }

  for (const l of listings) {
    const dest = getRealtyPortalDestination(l.portal);
    const property = byId.get(l.propertyId) ?? null;
    const candidate = snapshot.byId.get(l.propertyId) ?? null;
    const info = splitPortalError(l.lastError);

    // ── 1. ¿Dejó de ser publicable? Se baja SOLO. ──────────────────────
    // OJO: aquí solo entra lo que de verdad SALIÓ de la cartera publicable
    // (vendido, rentado, despublicado, borrado). Un inmueble al que solo le
    // falta un dato SÍ está en el snapshot y cae en el paso 3.
    if (!candidate) {
      const reason = !property
        ? "El inmueble ya no está en la cartera."
        : property.status !== "DISPONIBLE"
          ? `Se retiró solo: el inmueble está marcado como ${property.status.toLowerCase()}.`
          : "Se retiró solo: el inmueble está despublicado.";
      if (l.status !== "PAUSADO") push(l, "PAUSADO", reason, "unpublished");
      continue;
    }

    // Una fila PAUSADA la bajó alguien a propósito (o esta misma cola). No
    // se resucita sola: el asesor la vuelve a elegir cuando quiera.
    if (l.status === "PAUSADO") continue;

    // ── 2. ¿Cabe en el cupo? ──────────────────────────────────────────
    const quota = quotaBy.get(l.portal) ?? null;
    const max = quota?.maxListings ?? 0;
    const used = claimed.get(l.portal) ?? 0;
    if (max > 0 && used >= max) {
      const reason = `Se llenó el cupo: tienes ${max} anuncios contratados en ${realtyPortalLabel(
        l.portal,
      )} y este quedó fuera.`;
      push(l, "ERROR", reason, "overQuota");
      summary.errors.push({ propertyId: l.propertyId, portal: l.portal, reason });
      continue;
    }
    claimed.set(l.portal, used + 1);

    // ── 3. Validación de contenido ────────────────────────────────────
    // ERROR, no PAUSADO: conserva el lugar del cupo y la elección, y se
    // re-evalúa en cada pasada, así que se arregla solo en cuanto el asesor
    // captura lo que faltaba.
    if (candidate.check.blockers.length > 0) {
      const reason = candidate.check.blockers.join(" ");
      push(l, "ERROR", reason, "failed");
      summary.errors.push({ propertyId: l.propertyId, portal: l.portal, reason });
      continue;
    }

    const adapter = adapterForDestination(l.portal);
    // Misma condición, literal, que selectedPropertyIdsFor en feed.ts: un
    // destino fuera del catálogo (dest === null) NO cuenta como apagado —
    // ahí `adapterForDestination` cae al XML genérico y el feed lo sirve.
    const apagado =
      (dest !== null && !dest.available) || (quotaBy.has(l.portal) && !quota?.active);

    // ── 4a. Destino de FEED: publicar es estar en el feed. ─────────────
    if (adapter.transport === "feed" || typeof adapter.push !== "function") {
      // 🔴 Un destino APAGADO no sirve nada por su URL, así que marcarlo
      // "publicada" sería mentirle al asesor: vería la palomita y el portal
      // no recibiría nada. Vuelve a PENDIENTE con el motivo — y NO a PAUSADO,
      // que le borraría la elección.
      if (apagado) {
        push(
          l,
          "BORRADOR",
          dest && !dest.available
            ? (dest.unavailableReason ?? "Este destino todavía no está disponible.")
            : "El destino está apagado. Enciéndelo para que salga en el feed.",
          "waiting",
          false,
        );
        continue;
      }
      push(l, "PUBLICADO", null, "published");
      continue;
    }

    // ── 4b. Destino con API: empujar con espera creciente. ─────────────
    if (apagado) {
      push(l, "BORRADOR", "El destino está apagado. Enciéndelo para publicar ahí.", "waiting", false);
      continue;
    }
    if (info.nextAttemptAt && info.nextAttemptAt > now) {
      summary.waiting++;
      continue;
    }
    if (info.attempts >= MAX_PORTAL_ATTEMPTS) {
      summary.waiting++;
      continue;
    }
    if (!snapshot.account) continue;

    const credentials = await prisma.realtyPortalAccount.findUnique({
      where: { accountId_portal: { accountId, portal: l.portal } },
      select: { externalAccountId: true, apiKey: true },
    });

    let result: RealtyPortalPushResult;
    try {
      result = await adapter.push(candidate.property, snapshot.account, {
        externalAccountId: credentials?.externalAccountId ?? null,
        apiKey: credentials?.apiKey ?? null,
      });
    } catch (e) {
      // El contrato dice que push() no lanza, pero un adaptador nuevo puede
      // equivocarse y una excepción aquí tumbaría la cola de TODA la cuenta.
      result = {
        ok: false,
        error: e instanceof Error ? e.message : "error inesperado del adaptador",
        retryable: true,
      };
    }

    if (result.ok) {
      writes.push({
        id: l.id,
        data: {
          status: "PUBLICADO",
          lastError: null,
          lastPushedAt: now,
          ...(result.externalId ? { externalId: result.externalId } : {}),
        },
        bucket: "published",
      });
      continue;
    }

    const attempts = info.attempts + 1;
    const retryable = result.retryable !== false;
    const next = retryable ? nextAttemptFor(attempts, now) : null;
    const reason = result.error || "El portal rechazó el anuncio.";
    writes.push({
      id: l.id,
      data: {
        status: "ERROR",
        lastError: composePortalError(reason, retryable ? attempts : MAX_PORTAL_ATTEMPTS, next),
        lastPushedAt: now,
      },
      bucket: "failed",
    });
    summary.errors.push({ propertyId: l.propertyId, portal: l.portal, reason });
  }

  await applyWrites(writes, summary);
  // 🔴 Solo si algo cambió de verdad. La pantalla reconcilia en CADA carga:
  // invalidar aquí sin condición dejaría la caché del feed en nada — cada
  // visita al panel obligaría al siguiente portal a reconstruirla entera.
  if (writes.length > 0) bustFeedCache(accountId);
  return summary;
}

/**
 * Aplica los cambios acumulados, con tope. En régimen normal `writes` viene
 * casi vacío (solo se apunta lo que de verdad cambia), así que abrir la
 * pantalla no cuesta ni un UPDATE.
 */
async function applyWrites(
  writes: Array<{ id: string; data: Record<string, unknown>; bucket: keyof PortalQueueSummary }>,
  summary: PortalQueueSummary,
): Promise<void> {
  const lote = writes.slice(0, QUEUE_MAX_WRITES);
  for (const w of lote) {
    try {
      await prisma.realtyPortalListing.update({ where: { id: w.id }, data: w.data });
      const bucket = summary[w.bucket];
      if (typeof bucket === "number") (summary[w.bucket] as number) = bucket + 1;
    } catch (e) {
      // Una fila borrada entre la lectura y la escritura no puede tumbar el
      // resto de la pasada.
      console.error("[realty/portals] no se pudo actualizar la fila", w.id, e);
    }
  }
  if (writes.length > lote.length) {
    summary.pendingWrites = writes.length - lote.length;
  }
}

/**
 * La cola de TODAS las cuentas. La llama el endpoint que un cron dispara.
 * Cada cuenta va en su propio try: una cuenta con datos raros no puede
 * dejar sin procesar a las demás.
 */
export async function processPortalQueue(
  options: { limit?: number } = {},
): Promise<PortalQueueSummary> {
  const total = emptySummary();
  const accounts = await prisma.realtyAccount.findMany({
    // Del contrato, no repetida a mano: mantener dos listas de estados de
    // suscripción es garantía de que un día se separen.
    where: {
      isActive: true,
      subscriptionStatus: { in: Array.from(REALTY_ACTIVE_SUBSCRIPTION_STATUSES) },
    },
    select: { id: true },
    take: Math.min(Math.max(1, options.limit ?? 100), 500),
  });

  const now = new Date();
  for (const a of accounts) {
    try {
      const s = await processPortalQueueForAccount(a.id, now);
      total.accounts++;
      total.published += s.published;
      total.unpublished += s.unpublished;
      total.failed += s.failed;
      total.waiting += s.waiting;
      total.overQuota += s.overQuota;
      total.pendingWrites += s.pendingWrites;
      total.errors.push(...s.errors.slice(0, 5));
    } catch (e) {
      console.error("[realty/portals] cuenta falló", a.id, e);
    }
  }
  return total;
}

/**
 * GANCHO PARA LAS OTRAS PANTALLAS: llámalo al cambiar el estatus de un
 * inmueble o al despublicarlo, y la despublicación es inmediata en vez de
 * esperar a la siguiente pasada de la cola.
 *
 * NO es obligatorio: la cola reconcilia sola. Esto solo acelera. Un vertical
 * cuya limpieza dependa de que diez pantallas se acuerden de llamar a un
 * gancho ya perdió; esto es el atajo, no el mecanismo.
 */
export async function syncPortalListingsForProperty(
  accountId: string,
  propertyId: string,
): Promise<void> {
  // 🔴 Puerta de entrada de OTRAS pantallas, así que se defiende sola. Un
  // accountId undefined BORRA el filtro de Prisma y el updateMany de abajo
  // pausaría filas de otra cuenta. Aquí no hay sesión que lo garantice: lo
  // garantiza este renglón.
  if (!accountId || !propertyId) return;
  try {
    const property = await prisma.realtyProperty.findFirst({
      where: { id: propertyId, accountId },
      select: { status: true, isPublished: true },
    });
    if (!property) return;
    const gone = property.status !== "DISPONIBLE" || !property.isPublished;
    if (!gone) return;

    await prisma.realtyPortalListing.updateMany({
      where: { accountId, propertyId, status: { in: [...REALTY_SLOT_STATUSES] } },
      data: {
        status: "PAUSADO",
        lastPushedAt: new Date(),
        lastError:
          property.status !== "DISPONIBLE"
            ? `Se retiró solo: el inmueble está marcado como ${property.status.toLowerCase()}.`
            : "Se retiró solo: el inmueble está despublicado.",
      },
    });
    bustFeedCache(accountId);
  } catch (e) {
    // Nunca tumbar la pantalla que guarda el inmueble por esto: la cola
    // reconcilia igual en su siguiente pasada.
    console.error("[realty/portals] sync de despublicación falló", propertyId, e);
  }
}

/** Invalida el feed cacheado de la cuenta tras un cambio. */
export function bustFeedCache(accountId: string): void {
  try {
    revalidateTag(realtyFeedTag(accountId));
  } catch {
    // Fuera de un route handler / server action revalidateTag lanza. No es
    // motivo para fallar: el TTL de una hora recoge el cambio igual.
  }
}
