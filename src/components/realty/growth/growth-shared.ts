/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — CONTRATO PURO del área de CRECIMIENTO.
   (campañas · reseñas · investigación de inquilino · socios)

   Aquí NO se importa prisma ni "server-only": lo cargan las pantallas
   "use client" del área y las pruebas lo ejecutan sin base de datos. Mismo
   reparto que whatsapp-core.ts / plan-shared.ts del vertical.

   ⚠️ POR QUÉ VIVE BAJO components/ Y NO EN src/lib/realty/growth-shared.ts:
   la allowlist de esta terminal en src/lib/realty/ son tres ARCHIVOS
   (campaigns.ts, affiliates.ts, screening.ts) y una carpeta (bot/); no
   incluye un cuarto archivo suelto. Este módulo no importa React ni nada
   de servidor, así que mudarlo a src/lib/realty/growth-shared.ts el día que
   alguien lo quiera ahí es cambiar la ruta del import y nada más.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyCreditKind, RealtyLeadStage, RealtyOperation } from "@/lib/realty/types";

/* ═══════════════════════════════════════════════════════════════════════
   1. CAMPAÑAS
   ═══════════════════════════════════════════════════════════════════════ */

export type RealtyCampaignKind = "MANUAL" | "REACTIVACION" | "BAJADA_PRECIO" | "RESENA";

export type RealtyCampaignStatus =
  | "BORRADOR"
  | "PROGRAMADA"
  | "ENVIANDO"
  | "ENVIADA"
  | "CANCELADA";

export const REALTY_CAMPAIGN_KINDS: RealtyCampaignKind[] = [
  "MANUAL",
  "REACTIVACION",
  "BAJADA_PRECIO",
  "RESENA",
];

export const REALTY_CAMPAIGN_KIND_LABELS: Record<RealtyCampaignKind, string> = {
  MANUAL: "Lista que armas tú",
  REACTIVACION: "Prospectos fríos",
  BAJADA_PRECIO: "Bajó de precio la casa que viste",
  RESENA: "Pedir reseña en Google",
};

export const REALTY_CAMPAIGN_KIND_HELP: Record<RealtyCampaignKind, string> = {
  MANUAL: "Tú eliges a quién, con los filtros del CRM.",
  REACTIVACION:
    "Prospectos que no se han movido en más de N días. Es la lista más grande y la que más fácil molesta: manda poco y con algo que valga la pena.",
  BAJADA_PRECIO:
    "Sale sola cuando un inmueble baja de precio y le avisa SOLO a quien lo visitó. Es la reactivación que más cierra, porque no es publicidad: es una noticia que esa persona pidió.",
  RESENA:
    "Después de una operación cerrada, con la liga directa a tu perfil de Google. Es el cuello de autoridad: sin reseñas nuevas, el mapa te deja de enseñar.",
};

export const REALTY_CAMPAIGN_STATUS_LABELS: Record<RealtyCampaignStatus, string> = {
  BORRADOR: "Borrador",
  PROGRAMADA: "Programada",
  ENVIANDO: "Enviando",
  ENVIADA: "Enviada",
  CANCELADA: "Cancelada",
};

/** Por qué NO se le mandó a alguien que estaba en la lista. */
export type RealtyRecipientSkipReason =
  | "optOut"
  | "sinTelefono"
  | "topeDiario"
  | "cupoPlan"
  | "duplicado"
  | "ventanaCerrada";

export const REALTY_SKIP_LABELS: Record<RealtyRecipientSkipReason, string> = {
  optOut: "Pidió no recibir mensajes",
  sinTelefono: "Sin teléfono válido",
  topeDiario: "Se alcanzó el tope de mensajes del día",
  cupoPlan: "Se acabó el cupo de mensajes del plan",
  duplicado: "Ya estaba en la lista",
  ventanaCerrada: "Fuera de la ventana de 24 h y sin plantilla",
};

/**
 * El criterio con el que se armó la lista. Se guarda EN CRUDO junto a la
 * campaña (columna `segment`): dentro de seis meses hay que poder contestar
 * "¿a quién le mandaste esto y por qué?" sin adivinar.
 */
export interface RealtyCampaignSegment {
  /** Prospectos sin movimiento desde hace N días. */
  colderThanDays?: number | null;
  /** Etapas del embudo que entran. Vacío = todas menos CIERRE y PERDIDO. */
  stages?: RealtyLeadStage[];
  /** Zonas (colonia o ciudad) que buscaba el prospecto. */
  zones?: string[];
  operation?: RealtyOperation | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  creditKind?: RealtyCreditKind | null;
  /** Solo quienes VISITARON este inmueble (BAJADA_PRECIO lo usa). */
  visitedPropertyId?: string | null;
  /** Solo operaciones cerradas en los últimos N días (RESENA lo usa). */
  closedWithinDays?: number | null;
  /** Contactos elegidos a mano. Si viene, RECORTA — nunca amplía. */
  contactIds?: string[];
}

/**
 * 🔴 TOPE DIARIO DE MENSAJES DE CAMPAÑA POR CUENTA.
 *
 * Es independiente del cupo del plan (que es mensual). Existe porque lo que
 * tumba un número de WhatsApp no es mandar mucho en un mes: es mandar mucho
 * en una tarde y que veinte personas lo reporten. Y el número es del
 * cliente, no de DaleControl.
 */
export const REALTY_CAMPAIGN_DAILY_CAP_DEFAULT = 100;
export const REALTY_CAMPAIGN_DAILY_CAP_MIN = 0;
export const REALTY_CAMPAIGN_DAILY_CAP_MAX = 500;

/** Cuántos destinatarios como máximo procesa UNA llamada al envío. */
export const REALTY_CAMPAIGN_BATCH_MAX = 60;

/** Días mínimos entre dos campañas al MISMO teléfono. */
export const REALTY_CAMPAIGN_COOLDOWN_DAYS = 21;

export interface RealtyCampaignDTO {
  id: string;
  name: string;
  kind: RealtyCampaignKind;
  status: RealtyCampaignStatus;
  templateKind: string | null;
  body: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  segment: RealtyCampaignSegment;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  counts: { total: number; pendiente: number; enviado: number; fallido: number; omitido: number };
}

export interface RealtyCampaignRecipientDTO {
  id: string;
  contactId: string | null;
  name: string | null;
  phone: string;
  status: "PENDIENTE" | "ENVIADO" | "FALLIDO" | "OMITIDO";
  skipReason: RealtyRecipientSkipReason | null;
  error: string | null;
  sentAt: string | null;
}

/** Teléfono a 10 dígitos, enmascarado para la pantalla: "33 •••• 5678". */
export function maskRealtyPhone(phone: string): string {
  const p = String(phone ?? "").replace(/\D/g, "");
  if (p.length < 10) return p || "—";
  return `${p.slice(0, 2)} •••• ${p.slice(-4)}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   2. CONSENTIMIENTO / BAJA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * MARKETING = no quiere campañas (sigue recibiendo el aviso de SU visita y
 *             el recibo de SU renta: eso no es publicidad, es el servicio).
 * ALL       = no quiere nada automático.
 */
export type RealtyOptOutScope = "MARKETING" | "ALL";

export type RealtyOptOutSource = "REPLY" | "MANUAL" | "IMPORT";

export interface RealtyOptOutDTO {
  id: string;
  contactId: string | null;
  contactName: string | null;
  phone: string;
  scope: RealtyOptOutScope;
  source: RealtyOptOutSource;
  note: string | null;
  createdAt: string;
}

/**
 * La línea de baja que va al final de TODA campaña. Meta la exige en las
 * plantillas de marketing, y aunque no la exigiera: si no hay salida fácil,
 * la salida que la gente encuentra es el botón de "reportar spam".
 */
export const REALTY_OPT_OUT_LINE = "Responde BAJA si no quieres más avisos.";

/** Sin acentos y en minúsculas, para comparar sin sorpresas. */
function fold(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** ¿El cuerpo de la campaña ya trae la salida? */
export function hasRealtyOptOutLine(body: string): boolean {
  const t = fold(body);
  return /\bbaja\b/.test(t) || /\bstop\b/.test(t) || t.includes("no quieres mas avisos");
}

/* ═══════════════════════════════════════════════════════════════════════
   3. INVESTIGACIÓN DE INQUILINO
   ═══════════════════════════════════════════════════════════════════════ */

export type RealtyScreeningTier = "BASICA" | "COMPLETA";

export type RealtyScreeningRequestStatus =
  | "PENDIENTE_CONSENTIMIENTO"
  | "SOLICITADA"
  | "EN_PROCESO"
  | "LISTA"
  | "CANCELADA";

export type RealtyScreeningRecommendation =
  | "APROBADO"
  | "APROBADO_CON_AVAL"
  | "RECHAZADO"
  | "SIN_DICTAMEN";

export type RealtyScreeningRiskLevel = "BAJO" | "MEDIO" | "ALTO" | "SIN_DATO";

export const REALTY_SCREENING_TIER_LABELS: Record<RealtyScreeningTier, string> = {
  BASICA: "Básica",
  COMPLETA: "Completa",
};

/**
 * QUÉ INCLUYE CADA NIVEL. Es lo que se le enseña al propietario ANTES de
 * cobrarle, y es también la lista que el investigado autoriza que se
 * consulte: el consentimiento tiene que decir QUÉ se va a consultar.
 *
 * 🔴 SIN PRECIOS AQUÍ. El precio de cada nivel lo pone la cuenta (o lo
 * traerá el proveedor cuando haya convenio) y viaja en `priceCents` de la
 * solicitud. El rango de mercado va en la ficha de ORQUESTA.md, no en el
 * código: un número escrito aquí se queda viejo y nadie lo nota.
 */
export const REALTY_SCREENING_INCLUDES: Record<RealtyScreeningTier, string[]> = {
  BASICA: [
    "Validación de identidad (INE contra el padrón)",
    "Historial crediticio (buró)",
    "Una referencia laboral",
  ],
  COMPLETA: [
    "Todo lo de la básica",
    "Ingresos documentados (recibos de nómina o estados de cuenta)",
    "Referencias laborales y personales",
    "Historial de arrendamiento",
    "Análisis de riesgo con recomendación",
  ],
};

export const REALTY_SCREENING_STATUS_LABELS: Record<RealtyScreeningRequestStatus, string> = {
  PENDIENTE_CONSENTIMIENTO: "Falta que autorice",
  SOLICITADA: "Solicitada",
  EN_PROCESO: "En proceso",
  LISTA: "Lista",
  CANCELADA: "Cancelada",
};

export const REALTY_SCREENING_RECOMMENDATION_LABELS: Record<
  RealtyScreeningRecommendation,
  string
> = {
  APROBADO: "Aprobado",
  APROBADO_CON_AVAL: "Aprobado con aval",
  RECHAZADO: "Rechazado",
  SIN_DICTAMEN: "Sin dictamen",
};

/**
 * 🔴 EL TEXTO QUE FIRMA EL INVESTIGADO. No es un adorno legal: consultar
 * el buró de crédito de alguien sin su autorización EXPRESA es ilegal en
 * México (Ley para Regular las Sociedades de Información Crediticia, art.
 * 28, y LFPDPPP art. 8 para los datos personales). Se guarda el texto
 * completo que aceptó, con fecha, nombre e IP — dentro de dos años hay que
 * poder enseñar QUÉ autorizó, no solo que "dijo que sí".
 *
 * `{tier}` se sustituye por la lista de lo que incluye el nivel contratado
 * y `{cuenta}` por el nombre de la inmobiliaria.
 */
export const REALTY_SCREENING_CONSENT_TEMPLATE =
  "Autorizo a {cuenta} y a la empresa que designe para realizar mi investigación como " +
  "candidato a arrendatario, incluyendo: {tier}. " +
  "Entiendo que esto implica la consulta de mi historial crediticio en una sociedad de " +
  "información crediticia (buró de crédito) y que dicha consulta quedará registrada. " +
  "Esta autorización es expresa, se otorga por única vez para este trámite, y puedo " +
  "revocarla escribiendo a {cuenta}. Confirmo que los datos que proporcioné son míos y " +
  "son verdaderos.";

export function buildRealtyScreeningConsentText(
  tier: RealtyScreeningTier,
  accountName: string,
): string {
  const incluye = REALTY_SCREENING_INCLUDES[tier].join("; ").toLowerCase();
  return REALTY_SCREENING_CONSENT_TEMPLATE.replace(/\{tier\}/g, incluye).replace(
    /\{cuenta\}/g,
    accountName || "la inmobiliaria",
  );
}

/** Datos del investigado que viajan al proveedor. */
export interface RealtyScreeningApplicant {
  fullName: string;
  phone: string | null;
  email: string | null;
  /** CURP o RFC — el proveedor pide uno de los dos para el buró. */
  curp: string | null;
  rfc: string | null;
  birthDate: string | null;
  /** Ingreso mensual DECLARADO, en pesos. El proveedor lo verifica. */
  declaredIncomeMxn: number | null;
  employer: string | null;
  jobTitle: string | null;
  /** Referencias: nombre y teléfono, nada más. */
  references: { name: string; phone: string; relation: string | null }[];
  notes: string | null;
}

export function emptyRealtyScreeningApplicant(): RealtyScreeningApplicant {
  return {
    fullName: "",
    phone: null,
    email: null,
    curp: null,
    rfc: null,
    birthDate: null,
    declaredIncomeMxn: null,
    employer: null,
    jobTitle: null,
    references: [],
    notes: null,
  };
}

export interface RealtyScreeningDTO {
  id: string;
  contactId: string;
  contactName: string;
  leaseId: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  tier: RealtyScreeningTier;
  provider: string;
  providerRef: string | null;
  status: RealtyScreeningRequestStatus;
  consentAt: string | null;
  consentName: string | null;
  applicant: RealtyScreeningApplicant;
  priceMxn: number | null;
  resultUrl: string | null;
  resultSummary: string | null;
  riskLevel: RealtyScreeningRiskLevel | null;
  recommendation: RealtyScreeningRecommendation | null;
  requestedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/* ── ⭐ EL ADAPTADOR DE PROVEEDOR ──────────────────────────────────────
 *
 * Hoy solo existe el proveedor "MANUAL": la solicitud se guarda, alguien de
 * DaleControl la tramita por fuera y sube el resultado. NO hay integración
 * con Liv, Moradauno, Multiburó ni Inquilino Seguro porque todavía no hay
 * convenio con ninguno.
 *
 * Cuando lo haya, enchufarlo es escribir UN objeto que cumpla esta interfaz
 * y registrarlo en REALTY_SCREENING_PROVIDERS (screening.ts). Nada del
 * panel, de las rutas ni de la base cambia: `provider` ya es una columna de
 * texto y `providerRef` ya guarda el folio del proveedor.
 */
export interface RealtyScreeningSubmitInput {
  requestId: string;
  tier: RealtyScreeningTier;
  applicant: RealtyScreeningApplicant;
  /** Evidencia del consentimiento. El proveedor la exige por contrato. */
  consent: { text: string; at: string; name: string; ip: string | null };
  /** Para que el proveedor sepa a nombre de quién se investiga. */
  account: { id: string; name: string; email: string | null };
  /** Renta mensual del inmueble, si ya se sabe: cambia el dictamen. */
  monthlyRentMxn: number | null;
}

export interface RealtyScreeningSubmitResult {
  ok: boolean;
  /** Folio del proveedor. Se guarda en `providerRef`. */
  providerRef: string | null;
  /** Estado en el que queda la solicitud tras enviarla. */
  status: RealtyScreeningRequestStatus;
  /** Precio real que cobró el proveedor, en centavos. null = el de la cuenta. */
  priceCents: number | null;
  error: string | null;
}

export interface RealtyScreeningFetchResult {
  ok: boolean;
  status: RealtyScreeningRequestStatus;
  resultUrl: string | null;
  resultSummary: string | null;
  riskLevel: RealtyScreeningRiskLevel | null;
  recommendation: RealtyScreeningRecommendation | null;
  error: string | null;
}

/**
 * ⭐ LA INTERFAZ QUE HAY QUE IMPLEMENTAR PARA ENCHUFAR UN PROVEEDOR.
 *
 * Reglas que el adaptador NO puede romper:
 *   1. `submit` JAMÁS se llama sin `consent.at`. La base lo repite con un
 *      CHECK; el adaptador puede confiar en que llegó.
 *   2. `submit` no lanza: devuelve `{ ok:false, error }` en español.
 *   3. `fetch` es idempotente y se puede llamar N veces (lo hará el
 *      barrido). Si todavía no hay resultado, devuelve el estado actual.
 *   4. El adaptador NO escribe en la base. Devuelve datos; quien persiste
 *      es screening.ts. Así un proveedor nuevo no puede corromper el
 *      expediente.
 */
export interface RealtyScreeningProvider {
  /** Id que se guarda en la columna `provider`. */
  id: string;
  label: string;
  /** false = la tramita una persona; no hay API que consultar. */
  automated: boolean;
  /** Niveles que ofrece este proveedor. */
  tiers: RealtyScreeningTier[];
  submit(input: RealtyScreeningSubmitInput): Promise<RealtyScreeningSubmitResult>;
  /** Consulta el estado. `providerRef` es lo que devolvió `submit`. */
  fetch(providerRef: string): Promise<RealtyScreeningFetchResult>;
}

/* ═══════════════════════════════════════════════════════════════════════
   4. PROGRAMA DE SOCIOS (AFILIADOS)
   ═══════════════════════════════════════════════════════════════════════ */

export type RealtyCommissionStatus = "PENDIENTE" | "APROBADA" | "PAGADA" | "CANCELADA";

export const REALTY_COMMISSION_STATUS_LABELS: Record<RealtyCommissionStatus, string> = {
  PENDIENTE: "Por liberar",
  APROBADA: "Disponible",
  PAGADA: "Pagada",
  CANCELADA: "Cancelada",
};

export interface RealtyAffiliateConfigDTO {
  enabled: boolean;
  commissionPct: number;
  /** -1 = mientras la referida siga pagando. */
  commissionMonths: number;
  cookieDays: number;
  payoutMinMxn: number;
  terms: string | null;
}

export interface RealtyAffiliateReferralDTO {
  id: string;
  accountName: string;
  planName: string | null;
  status: "REGISTRADA" | "PAGANDO" | "SE_FUE";
  attributedAt: string;
  firstPaidAt: string | null;
  earnedMxn: number;
}

export interface RealtyAffiliateCommissionDTO {
  id: string;
  referredAccountName: string;
  amountMxn: number;
  baseMxn: number;
  commissionPct: number;
  periodMonth: string;
  status: RealtyCommissionStatus;
  paidAt: string | null;
  createdAt: string;
}

export interface RealtyAffiliateSummaryDTO {
  /** null = la cuenta todavía no es socia (no ha generado su código). */
  code: string | null;
  link: string | null;
  status: "ACTIVO" | "SUSPENDIDO" | null;
  config: RealtyAffiliateConfigDTO;
  storageReady: boolean;
  funnel: { clicks: number; referrals: number; paying: number };
  earnings: {
    pendingMxn: number;
    availableMxn: number;
    paidMxn: number;
    totalMxn: number;
  };
  referrals: RealtyAffiliateReferralDTO[];
  commissions: RealtyAffiliateCommissionDTO[];
  payoutInfo: string | null;
}

/**
 * Código de socio: 8 caracteres del alfabeto SIN ambigüedades visuales
 * (sin I, O, 0, 1) — mismo criterio que barber. El socio lo dicta por
 * teléfono y lo escribe en una tarjeta; una O que se lee como 0 es una
 * comisión que se pierde.
 */
export const REALTY_AFFILIATE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REALTY_AFFILIATE_CODE_LEN = 8;

export function isRealtyAffiliateCode(v: unknown): boolean {
  return (
    typeof v === "string" &&
    new RegExp(`^[A-HJ-NP-Z2-9]{${REALTY_AFFILIATE_CODE_LEN}}$`).test(v)
  );
}

/** Nombres de cookie PROPIOS del vertical: conviven con dc_aff y dcb_aff. */
export const REALTY_AFF_COOKIE = "dci_aff";
export const REALTY_VID_COOKIE = "dci_vid";

/* ═══════════════════════════════════════════════════════════════════════
   5. RESEÑAS EN GOOGLE
   ═══════════════════════════════════════════════════════════════════════ */

export interface RealtyGrowthSettingsDTO {
  googleReviewUrl: string | null;
  reviewsEnabled: boolean;
  campaignDailyCap: number;
  priceDropEnabled: boolean;
}

export const DEFAULT_REALTY_GROWTH_SETTINGS: RealtyGrowthSettingsDTO = {
  googleReviewUrl: null,
  reviewsEnabled: false,
  campaignDailyCap: REALTY_CAMPAIGN_DAILY_CAP_DEFAULT,
  priceDropEnabled: false,
};

/**
 * ¿Esta liga sirve para pedir una reseña?
 *
 * Se aceptan las formas que Google reparte y NADA más. Un dominio ajeno
 * aquí es una liga que la inmobiliaria manda a sus clientes desde SU número
 * de WhatsApp: si alguien pega una liga de phishing, el que responde es el
 * cliente. Por eso es lista blanca y no "que empiece con https".
 */
export function isRealtyGoogleReviewUrl(url: string): boolean {
  const raw = String(url ?? "").trim();
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  // g.page/r/<id>/review · search.google.com/local/writereview?placeid=…
  // · www.google.com/maps/…  · maps.app.goo.gl/<id>
  if (host === "g.page") return true;
  if (host === "maps.app.goo.gl" || host === "goo.gl") return true;
  if (host === "search.google.com") return parsed.pathname.startsWith("/local/writereview");
  if (host === "www.google.com" || host === "google.com") {
    return parsed.pathname.startsWith("/maps/");
  }
  return false;
}
