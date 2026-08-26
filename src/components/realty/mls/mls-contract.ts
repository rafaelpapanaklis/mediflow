/**
 * ═══════════════════════════════════════════════════════════════════════
 * BOLSA INMOBILIARIA (MLS interna) — EL CONTRATO.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin next. Lo
 * importan por igual el motor (src/lib/realty/mls.ts), las rutas de API y
 * los componentes "use client". Misma pareja que properties-shared.ts /
 * properties.ts: si una constante de aquí viviera en el motor, un
 * componente cliente que la importara arrastraría prisma al navegador y el
 * build se caería.
 *
 * ── 🔴 LO QUE DE VERDAD IMPORTA DE ESTE ARCHIVO ────────────────────────
 * La bolsa es la ÚNICA parte del producto donde una cuenta ve datos de
 * otra. Aquí vive la LISTA BLANCA: el conjunto cerrado de campos que un
 * inmueble puede enseñarle a una cuenta ajena. Es lista blanca y no lista
 * negra a propósito — con una negra, la columna que alguien agregue el mes
 * que viene sale publicada por omisión y nadie se entera.
 *
 * La regla, en una línea: **solo se comparte lo que su dueño marcó
 * explícitamente como compartido, y SOLO los campos de esta lista.**
 *
 * Jamás, bajo ninguna combinación de parámetros: notas internas,
 * documentos, datos del propietario, su teléfono, el porcentaje que la
 * inmobiliaria le cobra al dueño, ni a qué asesor u oficina está asignado.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  type RealtyCurrency,
  type RealtyMode,
  type RealtyOperation,
  type RealtyPropertyKind,
  type RealtyPropertyStatus,
} from "@/lib/realty/types";

/**
 * Los modos de cuenta que TIENEN bolsa.
 *
 * Mismo criterio que Prospectos y Comisiones (BROKER_MODES en types.ts,
 * que es privado de ese archivo): un rentista en modo OWNER administra lo
 * suyo y no comercializa para terceros, así que compartir inventario con
 * otras inmobiliarias no le aplica. Se declara aquí y no se importa de
 * types.ts porque allí la constante no está exportada, y este módulo NO
 * toca types.ts.
 */
export const BROKER_MODES_MLS: RealtyMode[] = ["AGENCY", "AGENT"];

/**
 * Los catálogos de tipo y operación, derivados de los mapas de etiquetas
 * de types.ts — que es la única fuente de verdad y NO se toca. Es el mismo
 * `Object.keys(...)` que hace el listado de la cartera
 * (properties-screen.tsx:69): si mañana entra un tipo nuevo al enum, la
 * bolsa lo acepta sola y nadie tiene que acordarse de esta lista.
 */
export const REALTY_MLS_KINDS = Object.keys(
  REALTY_PROPERTY_KIND_LABELS,
) as RealtyPropertyKind[];

export const REALTY_MLS_OPERATIONS = Object.keys(
  REALTY_OPERATION_LABELS,
) as RealtyOperation[];

// ═══════════════════════════════════════════════════════════════════════
// 1. LA LISTA BLANCA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los campos del inmueble que la bolsa PUEDE enseñar entre cuentas.
 *
 * Es exactamente el corte del feed público de portales (feed.ts →
 * `toPublishable`) y ni un campo más: si algo no se le enseña a un
 * desconocido en internet, tampoco se le enseña a un colega. La bolsa
 * añade UNA cosa que la web pública no tiene —`sharedCommissionPct`— y esa
 * no sale del inmueble sino de realty_mls_listings, es decir de lo que su
 * dueño tecleó sabiendo que lo iban a leer otras cuentas.
 *
 * `direccion`, `lat` y `lng` están en la lista pero son CONDICIONALES:
 * salen solo si el inmueble tiene `showExactAddress` en true. Esa reja la
 * aplica el motor, no esta constante.
 */
export const REALTY_MLS_PUBLIC_FIELDS = [
  // Identidad y clasificación
  "titulo",
  "descripcion",
  "kind",
  "operation",
  "status",
  "folio",
  // Dinero del inmueble (el precio de venta o renta, no la comisión)
  "precio",
  "moneda",
  "precioRenta",
  "mantenimiento",
  // Medidas y distribución
  "terrenoM2",
  "construidoM2",
  "recamaras",
  "banos",
  "mediosBanos",
  "cocheras",
  "antiguedad",
  "amenidades",
  // Ubicación (las tres exactas van tras la reja de showExactAddress)
  "colonia",
  "ciudad",
  "estado",
  "cp",
  "direccion",
  "lat",
  "lng",
  // Multimedia
  "fotos",
  "tours",
  // Antigüedad del anuncio
  "publicadoEn",
] as const;

export type RealtyMlsField = (typeof REALTY_MLS_PUBLIC_FIELDS)[number];

/**
 * Los campos que el dueño NO puede quitar de su ficha en la bolsa por más
 * que recorte `exposedFields`. Sin ellos el resultado no es una ficha, es
 * una fila en blanco que ensucia el buscador de todos.
 */
export const REALTY_MLS_REQUIRED_FIELDS: RealtyMlsField[] = [
  "titulo",
  "kind",
  "operation",
  "status",
  "precio",
  "moneda",
  "ciudad",
];

/**
 * 🔴 LA LISTA NEGRA, y está aquí SOLO como red de seguridad.
 *
 * La reja real es la lista blanca de arriba: nada que no esté en ella
 * llega al DTO. Esta constante existe para que la prueba del revisor tenga
 * un objetivo explícito que buscar, y para que el día que alguien intente
 * "solo añadir un campito" a la lista blanca se tope con este nombre.
 *
 * Ninguna de estas llaves —ni la columna de Prisma ni su nombre en el
 * DTO— puede aparecer JAMÁS en un objeto que cruce de una cuenta a otra.
 */
export const REALTY_MLS_NEVER_EXPOSED = [
  // Identificadores internos del inquilino
  "accountId",
  "officeId",
  "assignedUserId",
  "assignedUserName",
  "ownerId",
  "ownerName",
  // El dueño del inmueble, entero
  "owner",
  "ownerPhone",
  "ownerEmail",
  "ownerRfc",
  "ownerNotes",
  // Lo que la inmobiliaria le cobra a SU cliente. No es asunto del colega:
  // lo que el colega ve es sharedCommissionPct, que es otra cosa y sale de
  // otra tabla.
  "commissionPct",
  // Papeles y notas
  "internalNotes",
  "documents",
  "documentos",
  "exclusives",
  "exclusiva",
  // Actividad comercial del dueño del inmueble
  "leads",
  "visits",
  "keys",
  "tasks",
  "deals",
  "portalListings",
  // Gobierno interno de la publicación
  "isPublished",
] as const;

/**
 * ¿Es una llave que la bolsa puede enseñar? Lo usa el motor al sanear el
 * `exposedFields` que llega del navegador: cualquier cosa que no esté en
 * la lista blanca se descarta en silencio, sin error, porque un error aquí
 * le diría al atacante que la llave existe.
 */
export function isRealtyMlsField(key: unknown): key is RealtyMlsField {
  return (
    typeof key === "string" && (REALTY_MLS_PUBLIC_FIELDS as readonly string[]).includes(key)
  );
}

/**
 * Sanea la lista de campos que un dueño quiere enseñar.
 *
 * - `null`/`undefined`/vacía → todos los públicos (el comportamiento por
 *   omisión, que es el que el 99 % va a usar).
 * - Con contenido → la INTERSECCIÓN con la lista blanca, más los
 *   obligatorios. Nunca puede AMPLIAR: recortar sí, abrir no.
 */
export function sanitizeExposedFields(raw: unknown): RealtyMlsField[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...REALTY_MLS_PUBLIC_FIELDS];
  }
  const picked = new Set<RealtyMlsField>(REALTY_MLS_REQUIRED_FIELDS);
  for (const item of raw) {
    if (isRealtyMlsField(item)) picked.add(item);
  }
  // Se devuelve en el orden de la lista blanca y no en el que llegó: así
  // dos cuentas con los mismos campos producen el mismo JSON.
  return REALTY_MLS_PUBLIC_FIELDS.filter((f) => picked.has(f));
}

// ═══════════════════════════════════════════════════════════════════════
// 2. LOS DTO QUE CRUZAN DE UNA CUENTA A OTRA
// ═══════════════════════════════════════════════════════════════════════

/** Una foto, tal como sale a la bolsa. Sin bytes, sin marca de agua. */
export interface RealtyMlsPhotoDTO {
  url: string;
  isCover: boolean;
}

/** Un recorrido virtual. La liga, y nada más. */
export interface RealtyMlsTourDTO {
  kind: string;
  url: string;
}

/**
 * La AGENCIA que comparte, tal como la ve el colega.
 *
 * 🔴 SIN `id`. El navegador nunca recibe el accountId de otra cuenta: para
 * proponer un acuerdo manda el `listingId` y el servidor deriva a quién
 * pertenece. Un id que no viaja es un id que no se puede falsificar.
 *
 * El teléfono y el correo son los DEL NEGOCIO —los mismos que esa cuenta
 * ya publica en su web y en el feed de portales— y jamás los del
 * propietario del inmueble.
 */
export interface RealtyMlsAgencyDTO {
  nombre: string;
  slug: string;
  ciudad: string | null;
  estado: string | null;
  logoUrl: string | null;
  telefono: string | null;
  correo: string | null;
}

/**
 * Un inmueble de OTRA cuenta, visto desde la bolsa. Todo lo que hay aquí
 * pasó por la lista blanca.
 */
export interface RealtyMlsListingDTO {
  /** Id de la FILA de bolsa, no del inmueble. Es lo único que el navegador
   *  necesita para pedir un acuerdo o adoptarlo. */
  listingId: string;
  /** Id del inmueble. Sirve para deduplicar en la pantalla; no abre nada:
   *  toda ruta vuelve a comprobar la bolsa antes de leer. */
  propertyId: string;

  // ── Los términos de la colaboración (de realty_mls_listings) ──
  comisionCompartida: number;
  aceptaColaboracion: boolean;
  exigeClienteDelSocio: boolean;
  recado: string | null;
  compartidoEn: string;

  quienComparte: RealtyMlsAgencyDTO;

  // ── El inmueble, ya recortado por la lista blanca ──
  titulo: string;
  descripcion: string | null;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  folio: string | null;
  precio: number;
  moneda: RealtyCurrency;
  precioRenta: number | null;
  mantenimiento: number | null;
  terrenoM2: number | null;
  construidoM2: number | null;
  recamaras: number | null;
  banos: number | null;
  mediosBanos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  amenidades: string[];
  colonia: string | null;
  ciudad: string | null;
  estado: string | null;
  cp: string | null;
  /** Calle y número SOLO si el dueño marcó showExactAddress. Si no, null. */
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  fotos: RealtyMlsPhotoDTO[];
  tours: RealtyMlsTourDTO[];
  publicadoEn: string;

  // ── Estado de MI relación con esta ficha ──
  /** Estado del acuerdo entre mi cuenta y esta ficha. null = ninguno. */
  miAcuerdo: RealtyMlsAgreementStatus | null;
  /** ¿Ya lo estoy pintando en mi mini-web? */
  adoptado: boolean;
}

/**
 * Lo que YO comparto, visto desde mi propio panel. Aquí sí puedo ver mis
 * datos internos porque el inmueble es mío: esto NUNCA sale de mi cuenta.
 */
export interface RealtyMlsMineDTO {
  listingId: string;
  propertyId: string;
  titulo: string;
  coverUrl: string;
  ciudad: string | null;
  colonia: string | null;
  precio: number;
  moneda: RealtyCurrency;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  comisionCompartida: number;
  aceptaColaboracion: boolean;
  exigeClienteDelSocio: boolean;
  campos: RealtyMlsField[];
  recado: string | null;
  active: boolean;
  compartidoEn: string;
  /** Cuántas cuentas la tienen en su web y cuántas propusieron colaborar. */
  adopciones: number;
  acuerdosPendientes: number;
  acuerdosActivos: number;
}

export type RealtyMlsAgreementStatus =
  | "PROPUESTO"
  | "ACEPTADO"
  | "RECHAZADO"
  | "CANCELADO"
  | "CERRADO";

export const REALTY_MLS_AGREEMENT_STATUSES: RealtyMlsAgreementStatus[] = [
  "PROPUESTO",
  "ACEPTADO",
  "RECHAZADO",
  "CANCELADO",
  "CERRADO",
];

/** Mi papel en un acuerdo. Lo calcula el servidor comparando con mi cuenta. */
export type RealtyMlsRole = "CAPTO" | "COLOCO";

/**
 * Un acuerdo de colaboración, visto por CUALQUIERA de las dos partes.
 *
 * `contraparte` es la OTRA cuenta, sea cual sea mi papel: la pantalla no
 * tiene que saber si soy el captador o el colocador para pintar con quién
 * estoy trabajando.
 */
export interface RealtyMlsAgreementDTO {
  id: string;
  listingId: string;
  propertyId: string;
  /** CAPTO = el inmueble es mío. COLOCO = yo traigo al cliente. */
  miPapel: RealtyMlsRole;
  contraparte: RealtyMlsAgencyDTO;
  inmuebleTitulo: string;
  inmuebleCiudad: string | null;
  /** Porcentaje de la comisión para QUIEN COLOCA. Siempre 0–100. */
  porcentajeAcordado: number;
  status: RealtyMlsAgreementStatus;
  recado: string | null;
  propuestoEn: string;
  respondidoEn: string | null;
  cerradoEn: string | null;
  dealId: string | null;
}

/** Una ficha ajena que estoy pintando en MI mini-web. */
export interface RealtyMlsAdoptionDTO {
  id: string;
  listingId: string;
  propertyId: string;
  titulo: string;
  coverUrl: string;
  ciudad: string | null;
  precio: number;
  moneda: RealtyCurrency;
  operation: RealtyOperation;
  comisionCompartida: number;
  quienComparte: RealtyMlsAgencyDTO;
  enLaWeb: boolean;
  orden: number;
  /** false = el dueño la retiró de la bolsa. Sigue en mi lista para que yo
   *  entienda por qué desapareció de mi web, pero ya no se pinta. */
  vigente: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 3. BÚSQUEDA
// ═══════════════════════════════════════════════════════════════════════

export const REALTY_MLS_SORTS = [
  "recientes",
  "comisionDesc",
  "precioAsc",
  "precioDesc",
] as const;

export type RealtyMlsSort = (typeof REALTY_MLS_SORTS)[number];

export const REALTY_MLS_PAGE_SIZE = 24;
export const REALTY_MLS_MAX_PAGE_SIZE = 48;

/**
 * Tope de fichas AJENAS que una cuenta puede pintar en su mini-web.
 *
 * Vive aquí y no en el motor porque la pantalla lo necesita para decir
 * "3 de 24 lugares usados" — y el motor es `server-only`, así que
 * importarlo desde un componente "use client" arrastraría prisma al
 * navegador y tumbaría el build. El motor lo importa DE AQUÍ, así que el
 * número es uno solo: no hay forma de que la reja del servidor y el
 * contador de la pantalla se separen.
 */
export const REALTY_MLS_MAX_ADOPTIONS = 24;

/**
 * Los filtros de la bolsa: los MISMOS del inventario propio, más el que de
 * verdad usa un asesor cuando busca inventario ajeno — "comparte
 * comisión". Ese es el filtro que decide si abre la ficha o pasa de largo.
 */
export interface RealtyMlsFilters {
  q?: string;
  kind?: string;
  operation?: string;
  ciudad?: string;
  colonia?: string;
  precioMin?: number;
  precioMax?: number;
  recamarasMin?: number;
  /** Comisión compartida MÍNIMA. 0 o ausente = no filtra. */
  comisionMin?: number;
  /** true = solo fichas cuyo dueño acepta trabajar con otro asesor. */
  soloColaboracion?: boolean;
  sort?: RealtyMlsSort;
  page?: number;
  pageSize?: number;
}

export interface RealtyMlsSearchResult {
  rows: RealtyMlsListingDTO[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Ciudades y colonias que HAY hoy en la bolsa, para poblar los selects.
   *  Se calculan sobre lo compartido, no sobre mi cartera. */
  facets: { ciudades: string[]; colonias: string[] };
}

/** El tablero de "Mis colaboraciones". */
export interface RealtyMlsDashboard {
  compartidos: RealtyMlsMineDTO[];
  adopciones: RealtyMlsAdoptionDTO[];
  acuerdos: RealtyMlsAgreementDTO[];
  /** Comisiones por cobrar de colaboraciones: los splits EXTERNO que
   *  nacieron de un acuerdo y todavía no tienen paidAt. */
  porCobrar: RealtyMlsReceivableDTO[];
}

/**
 * Una comisión por cobrar de una colaboración.
 *
 * 🔴 Sale del motor de T8 (RealtyCommissionSplit), no de un reparto
 * paralelo: la bolsa no calcula dinero, solo lo lee y lo enseña junto al
 * acuerdo que lo originó.
 */
export interface RealtyMlsReceivableDTO {
  agreementId: string;
  dealId: string;
  inmuebleTitulo: string;
  contraparte: string;
  miPapel: RealtyMlsRole;
  porcentaje: number;
  monto: number;
  pagado: boolean;
  cerradoEn: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. ENTRADAS DE ESCRITURA
// ═══════════════════════════════════════════════════════════════════════

/** Lo que manda la pantalla al compartir o editar los términos. */
export interface RealtyMlsShareInput {
  propertyId: string;
  sharedCommissionPct: number;
  acceptsCollaboration: boolean;
  requiresBuyerFromPartner: boolean;
  exposedFields?: string[] | null;
  notes?: string | null;
}

/** Porcentaje 0–100 con dos decimales, o null si no es un número válido. */
export function normalizePct(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}
