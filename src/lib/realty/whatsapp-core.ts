// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — NÚCLEO PURO de WhatsApp.
//
// Sin Prisma, sin `server-only`, sin `fetch`: TODO lo que hay aquí se puede
// importar desde el navegador y probar sin base de datos. El mismo corte que
// plan-shared.ts / plans.ts y que barber/whatsapp-core.ts.
//
// Lo que vive aquí:
//   · el catálogo de PLANTILLAS de Meta (nombres, categoría, variables);
//   · la ventana de servicio de 24 h;
//   · el cupo de mensajes del plan;
//   · la máquina de estados de entrega (la que impide pintar "entregado"
//     encima de un RECHAZADO — el bug del dental que no se repite);
//   · la clasificación de respuestas (confirmar / cancelar / reagendar /
//     baja);
//   · el cruce PURO de un inmueble contra un perfil de búsqueda (match).
//
// Lo que NO vive aquí: mandar, guardar, resolver credenciales. Eso es
// src/lib/realty/whatsapp.ts.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyMessageStatus } from "@prisma/client";

// ── Categorías y costo ──────────────────────────────────────────────────

export type RealtyWaCategory = "UTILITY" | "AUTHENTICATION" | "MARKETING";

/**
 * Precio POR CONVERSACIÓN en USD (México, tarifa de Meta 2025). Está aquí
 * para que la pantalla enseñe el costo REAL antes de mandar una campaña, no
 * para cobrar: DaleControl no factura este vertical.
 *
 * ⚠️ Meta cambia estos números. Es una ESTIMACIÓN y la UI tiene que decirlo.
 */
export const REALTY_WA_PRICE_USD: Record<RealtyWaCategory, number> = {
  UTILITY: 0.008,
  AUTHENTICATION: 0.0177,
  MARKETING: 0.0324,
};

// ── Estado de la conexión ───────────────────────────────────────────────

export type RealtyWaConnectionState =
  | "DISCONNECTED"
  | "CONNECTED"
  | "UNVERIFIED"
  | "PLAN_LOCKED"
  | "ERROR";

export interface RealtyWaConnectionDTO {
  state: RealtyWaConnectionState;
  senderMode: "PLATFORM" | "OWN_WABA";
  displayPhone: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  verifiedAt: string | null;
  /** Frase en español que explica qué falta. null = todo bien. */
  problem: string | null;
  canConnect: boolean;
}

// ── Cupo de mensajes ────────────────────────────────────────────────────

export const REALTY_WA_UNLIMITED = -1;

export interface RealtyWaQuotaDTO {
  limit: number;
  used: number;
  remaining: number;
  periodStart: string | null;
  nearLimit: boolean;
  exhausted: boolean;
}

export function isRealtyWaUnlimited(limit: number): boolean {
  return limit === REALTY_WA_UNLIMITED;
}

export function realtyWaRemaining(limit: number, used: number): number {
  if (isRealtyWaUnlimited(limit)) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Math.max(0, used));
}

/** ¿Caben `adding` mensajes más? Un cupo de 0 NUNCA deja mandar. */
export function realtyWaFits(limit: number, used: number, adding = 1): boolean {
  if (isRealtyWaUnlimited(limit)) return true;
  if (limit <= 0) return false;
  return Math.max(0, used) + adding <= limit;
}

export function buildRealtyWaQuota(args: {
  limit: number;
  used: number;
  periodStart: Date | null;
}): RealtyWaQuotaDTO {
  const limit = args.limit;
  const used = Math.max(0, args.used);
  const unlimited = isRealtyWaUnlimited(limit);
  const remaining = unlimited ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining: unlimited ? REALTY_WA_UNLIMITED : remaining,
    periodStart: args.periodStart ? args.periodStart.toISOString() : null,
    nearLimit: !unlimited && limit > 0 && used >= limit * 0.8,
    exhausted: !unlimited && (limit <= 0 || used >= limit),
  };
}

/**
 * Tope DIARIO de avisos de coincidencia por cuenta. El match automático es
 * lo único que le escribe a alguien que no preguntó, así que tiene freno
 * propio: sin esto, cargar 40 inmuebles de golpe le manda 40 WhatsApps al
 * mismo prospecto y la cuenta acaba bloqueada por Meta.
 */
export const REALTY_MATCH_DAILY_CAP = 50;

/**
 * Cuántas veces se reintenta un aviso automático que Meta rechazó. 3 y no
 * infinito: un 500 pasajero merece otra oportunidad, pero una plantilla
 * rechazada no merece que le peguemos a Meta cada 15 minutos para siempre.
 */
export const REALTY_MAX_SEND_ATTEMPTS = 3;

/** Tope de avisos de coincidencia por PERSONA y por día. */
export const REALTY_MATCH_PER_CONTACT_DAILY_CAP = 2;

// ── Adjuntos entrantes ──────────────────────────────────────────────────
//
// RealtyMessage NO tiene columna de adjuntos: tiene `mediaUrl String?`. Un
// archivo que llega por WhatsApp NO se descarga ni se guarda en Storage (el
// dental ya decidió eso y es lo correcto: son fotos de terceros y el bucket
// no es un basurero). Lo único que hace falta guardar es el ID de Meta para
// poder pedirlo después por el proxy.
//
// Convención de `mediaUrl`:
//   · empieza con "wa:"  → JSON con el id de Meta; se sirve por
//                          /api/realty/whatsapp/media/[messageId]
//   · cualquier otra cosa → URL real (una foto NUESTRA que sí mandamos)
// Así una columna sirve para los dos casos sin tocar el schema.

export const REALTY_WA_MEDIA_PREFIX = "wa:";

export type RealtyWaMediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface RealtyWaMedia {
  kind: RealtyWaMediaKind;
  mediaId: string;
  mime?: string;
  filename?: string;
}

export function encodeRealtyWaMedia(media: RealtyWaMedia): string {
  return REALTY_WA_MEDIA_PREFIX + JSON.stringify(media);
}

export function parseRealtyWaMedia(mediaUrl: string | null | undefined): RealtyWaMedia | null {
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith(REALTY_WA_MEDIA_PREFIX)) return null;
  try {
    const raw = JSON.parse(mediaUrl.slice(REALTY_WA_MEDIA_PREFIX.length));
    if (!raw || typeof raw.mediaId !== "string" || !raw.mediaId) return null;
    const kind: RealtyWaMediaKind =
      raw.kind === "video" ||
      raw.kind === "audio" ||
      raw.kind === "document" ||
      raw.kind === "sticker"
        ? raw.kind
        : "image";
    return {
      kind,
      mediaId: raw.mediaId,
      mime: typeof raw.mime === "string" ? raw.mime : undefined,
      filename: typeof raw.filename === "string" ? raw.filename : undefined,
    };
  } catch {
    return null;
  }
}

/** ¿Este mensaje trae un archivo alojado en Meta (hay que ir por el proxy)? */
export function isRealtyWaMetaMedia(mediaUrl: string | null | undefined): boolean {
  return parseRealtyWaMedia(mediaUrl) !== null;
}

// ── Plantillas ──────────────────────────────────────────────────────────

export type RealtyWaKind =
  | "portalCode"
  | "leadAck"
  | "propertyCard"
  | "visitReminder"
  | "rentUpcoming"
  | "rentOverdue"
  | "matchAlert";

export interface RealtyWaTemplate {
  kind: RealtyWaKind;
  /** Nombre EXACTO en Meta. Prefijo del vertical para no chocar con dental. */
  name: string;
  category: RealtyWaCategory;
  lang: string;
  body: string;
  /** Nombre de cada {{n}}, en orden. Su largo ES el número de variables. */
  variables: string[];
  /** Ejemplo que Meta pide al dar de alta la plantilla. */
  sample: string[];
  /** true = la cuenta puede vivir sin ella (MARKETING). */
  optional: boolean;
}

export const REALTY_WA_LANG = "es_MX";

/**
 * Las SEIS plantillas del vertical.
 *
 * Categorías: cinco UTILITY y una MARKETING. No es un capricho — es lo
 * correcto Y lo barato: una conversación de utilidad cuesta ~4× menos que
 * una de marketing (ver REALTY_WA_PRICE_USD). Un recordatorio de pago, un
 * acuse de un prospecto que ACABA de preguntar y un recordatorio de visita
 * son transacciones que la persona pidió; sólo el aviso de coincidencia le
 * llega a alguien que no pidió nada HOY, y por eso es MARKETING, es
 * opcional, exige `notifyByWhatsapp` y lleva la línea de baja que Meta pide.
 *
 * Los cuatro avisos de cobro (5 días antes, el día, 3 después, 8 después)
 * se cubren con DOS plantillas y no con cuatro: la fecha y los días son
 * variables, así que "vence el {{4}}" sirve para el aviso previo y para el
 * del día. Menos plantillas = menos cosas que se pueden quedar sin aprobar.
 */
export const REALTY_WA_TEMPLATES: readonly RealtyWaTemplate[] = [
  {
    // Código de acceso del portal del cliente (inquilino/propietario).
    // 🔴 El cuerpo va VACÍO a propósito: en una plantilla AUTHENTICATION el
    // texto lo redacta Meta y llega con botón de "copiar código". Escribir
    // uno propio es justo lo que hace que la rechacen.
    kind: "portalCode",
    name: "dc_inmuebles_codigo_acceso",
    category: "AUTHENTICATION",
    lang: REALTY_WA_LANG,
    body: "",
    variables: ["codigo"],
    sample: ["482913"],
    optional: false,
  },
  {
    kind: "leadAck",
    name: "dc_inmuebles_lead_nuevo",
    category: "UTILITY",
    lang: REALTY_WA_LANG,
    body:
      "Hola {{1}}, gracias por tu interés en {{2}}. Soy {{3}}, de {{4}}, y te " +
      "atiendo por aquí mismo. ¿Qué te gustaría saber?",
    variables: ["nombre", "inmueble", "asesor", "inmobiliaria"],
    sample: ["María", "Casa en Providencia", "Jorge Ruiz", "Inmobiliaria del Valle"],
    optional: false,
  },
  {
    kind: "propertyCard",
    name: "dc_inmuebles_ficha",
    category: "UTILITY",
    lang: REALTY_WA_LANG,
    body:
      "Hola {{1}}, te comparto la información de {{2}}. Precio: {{3}}. " +
      "Puedes ver fotos y detalles aquí: {{4}}",
    variables: ["nombre", "inmueble", "precio", "liga"],
    sample: [
      "María",
      "Casa en Providencia",
      "$4,850,000 MXN",
      "https://www.dalecontrol.com/i/valle/casa-providencia",
    ],
    optional: false,
  },
  {
    kind: "visitReminder",
    name: "dc_inmuebles_visita",
    category: "UTILITY",
    lang: REALTY_WA_LANG,
    body:
      "Hola {{1}}, te recordamos tu visita a {{2}} el {{3}} a las {{4}}. " +
      "Responde CONFIRMAR, CANCELAR o CAMBIAR.",
    variables: ["nombre", "inmueble", "fecha", "hora"],
    sample: ["María", "Casa en Providencia", "martes 26 de agosto", "11:00"],
    optional: false,
  },
  {
    kind: "rentUpcoming",
    name: "dc_inmuebles_renta_proxima",
    category: "UTILITY",
    lang: REALTY_WA_LANG,
    body:
      "Hola {{1}}, tu renta de {{2}} por {{3}} vence el {{4}}. " +
      "Si ya pagaste, mándanos el comprobante por aquí.",
    variables: ["nombre", "mes", "monto", "fecha"],
    sample: ["María", "agosto", "$12,500 MXN", "1 de septiembre"],
    optional: false,
  },
  {
    kind: "rentOverdue",
    name: "dc_inmuebles_renta_vencida",
    category: "UTILITY",
    lang: REALTY_WA_LANG,
    body:
      "Hola {{1}}, tu renta de {{2}} por {{3}} venció el {{4}} y llevamos " +
      "{{5}} días sin registrar el pago. Si ya pagaste, mándanos el " +
      "comprobante por aquí.",
    variables: ["nombre", "mes", "monto", "fecha", "dias"],
    sample: ["María", "agosto", "$12,500 MXN", "1 de agosto", "8"],
    optional: false,
  },
  {
    kind: "matchAlert",
    name: "dc_inmuebles_coincidencia",
    category: "MARKETING",
    lang: REALTY_WA_LANG,
    body:
      "Hola {{1}}, entró algo que encaja con lo que buscas: {{2}} en {{3}} " +
      "por {{4}}. Míralo aquí: {{5}}\n\nResponde BAJA si no quieres más avisos.",
    variables: ["nombre", "inmueble", "zona", "precio", "liga"],
    sample: [
      "María",
      "Casa de 3 recámaras",
      "Providencia",
      "$4,850,000 MXN",
      "https://www.dalecontrol.com/i/valle/casa-providencia",
    ],
    optional: true,
  },
];

export function realtyWaTemplate(kind: RealtyWaKind): RealtyWaTemplate {
  const tpl = REALTY_WA_TEMPLATES.find((t) => t.kind === kind);
  if (!tpl) throw new Error(`Plantilla de inmuebles desconocida: ${kind}`);
  return tpl;
}

export function realtyWaTemplateByName(name: string): RealtyWaTemplate | null {
  return REALTY_WA_TEMPLATES.find((t) => t.name === name) ?? null;
}

/** Cuántos {{n}} DISTINTOS trae un cuerpo. */
export function countRealtyWaVariables(body: string): number {
  const seen = new Set<string>();
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) seen.add(m[1]);
  return seen.size;
}

/**
 * Revisa una plantilla del catálogo. Devuelve el problema en español o null.
 * Lo usa la prueba del catálogo: una plantilla con 4 nombres de variable y
 * 5 {{n}} en el cuerpo se aprueba en Meta y REVIENTA al mandarse.
 */
export function checkRealtyWaTemplate(tpl: RealtyWaTemplate): string | null {
  if (!/^[a-z0-9_]+$/.test(tpl.name)) {
    return `El nombre "${tpl.name}" no es válido en Meta (solo minúsculas, números y _).`;
  }
  if (!tpl.name.startsWith("dc_inmuebles_")) {
    return `La plantilla "${tpl.name}" no lleva el prefijo del vertical.`;
  }
  // AUTHENTICATION es la excepción: Meta redacta el cuerpo, así que aquí
  // tiene que estar vacío y la única variable es el código.
  if (tpl.category === "AUTHENTICATION") {
    if (tpl.body !== "") return `"${tpl.name}": una plantilla AUTHENTICATION lleva el cuerpo VACÍO (lo redacta Meta).`;
    if (tpl.variables.length !== 1) return `"${tpl.name}": una plantilla AUTHENTICATION lleva exactamente una variable (el código).`;
    if (tpl.sample.length !== 1) return `"${tpl.name}": falta el ejemplo del código.`;
    return null;
  }

  const inBody = countRealtyWaVariables(tpl.body);
  if (inBody !== tpl.variables.length) {
    return `"${tpl.name}": el cuerpo tiene ${inBody} variables y se declararon ${tpl.variables.length}.`;
  }
  if (tpl.sample.length !== tpl.variables.length) {
    return `"${tpl.name}": el ejemplo tiene ${tpl.sample.length} valores y hacen falta ${tpl.variables.length}.`;
  }
  // Meta exige que la numeración sea 1..n sin huecos.
  for (let i = 1; i <= tpl.variables.length; i++) {
    if (!tpl.body.includes(`{{${i}}}`)) {
      return `"${tpl.name}": falta {{${i}}} en el cuerpo (la numeración va de 1 a n sin huecos).`;
    }
  }
  return null;
}

/** Pinta el cuerpo con sus parámetros — para la vista previa del panel. */
export function renderRealtyWaTemplate(tpl: RealtyWaTemplate, params: string[]): string {
  let out = tpl.body;
  for (let i = 0; i < tpl.variables.length; i++) {
    out = out.split(`{{${i + 1}}}`).join(params[i] ?? `{{${i + 1}}}`);
  }
  return out;
}

// ── externalId: wamid Y llave de reclamo en la MISMA columna ────────────
//
// RealtyMessage tiene UNA sola columna de identidad externa y hay que
// resolver DOS problemas con ella:
//
//   1. ENTREGA — Meta manda el estado con el `wamid` a secas. La búsqueda
//      tiene que caer en @@index([externalId]) o cada palomita recorre la
//      tabla entera de mensajes (el `endsWith` que el dental documenta como
//      error).
//   2. IDEMPOTENCIA — el cron corre cada 15 min y NO puede mandar dos veces
//      el mismo recordatorio.
//
// Formato de los envíos AUTOMÁTICOS:  "<wamid|pending>|<llave>"
// Formato de los envíos a mano y de lo que ENTRA:  "<wamid>"
//
// Así:
//   · el estado de entrega busca `= wamid` O `startsWith wamid + "|"` — las
//     dos anclan por la IZQUIERDA y usan el índice;
//   · la idempotencia busca `endsWith "|" + llave` PERO SIEMPRE acotada a un
//     hilo, así que recorre los pocos mensajes de esa conversación por
//     @@index([accountId, threadId, createdAt]), no la tabla.
//
// 🔴 La llave de un recordatorio de visita LLEVA DENTRO la hora programada.
// Es el arreglo del bug M-22 del dental por construcción: si la visita se
// reagenda, la llave cambia, el aviso viejo queda como historia y el nuevo
// sale con la hora nueva. No hay forma de que salgan los dos con la misma
// hora ni de que el viejo bloquee al nuevo.

const CLAIM_SEP = "|";
export const REALTY_WA_PENDING_MARK = "pending";

/** Llave estable de un envío automático. Sin `|` dentro: es el separador. */
export function buildRealtyClaimKey(kind: RealtyWaKind, ...parts: (string | number)[]): string {
  const clean = parts.map((p) => String(p).split(CLAIM_SEP).join("-"));
  return [kind, ...clean].join(":");
}

/** Llave de un recordatorio de visita: LLEVA la hora, y por eso M-22 no pasa. */
export function realtyVisitClaimKey(visitId: string, scheduledAt: Date): string {
  return buildRealtyClaimKey("visitReminder", visitId, Math.floor(scheduledAt.getTime() / 60_000));
}

/** Llave de un aviso de coincidencia: inmueble + perfil de búsqueda. */
export function realtyMatchClaimKey(propertyId: string, profileId: string): string {
  return buildRealtyClaimKey("matchAlert", propertyId, profileId);
}

/** externalId de una fila recién reclamada, antes de que Meta conteste. */
export function claimedExternalId(claimKey: string): string {
  return `${REALTY_WA_PENDING_MARK}${CLAIM_SEP}${claimKey}`;
}

/** externalId definitivo de un envío automático que Meta ya aceptó. */
export function sentExternalId(wamid: string, claimKey: string): string {
  return `${wamid}${CLAIM_SEP}${claimKey}`;
}

/** El wamid que hay dentro de un externalId, o null si todavía no hay. */
export function wamidFromExternalId(externalId: string | null | undefined): string | null {
  if (typeof externalId !== "string" || !externalId) return null;
  const head = externalId.split(CLAIM_SEP)[0];
  if (!head || head === REALTY_WA_PENDING_MARK) return null;
  return head;
}

/** La llave de reclamo que hay dentro de un externalId, o null. */
export function claimFromExternalId(externalId: string | null | undefined): string | null {
  if (typeof externalId !== "string") return null;
  const idx = externalId.indexOf(CLAIM_SEP);
  return idx < 0 ? null : externalId.slice(idx + 1) || null;
}

/** Sufijo con el que se busca un reclamo dentro de un hilo. */
export function claimSuffix(claimKey: string): string {
  return `${CLAIM_SEP}${claimKey}`;
}

// ── Ventana de servicio de 24 h ─────────────────────────────────────────

export const REALTY_WA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Se puede mandar texto libre? Solo si la persona escribió en las últimas
 * 24 h. Fuera de esa ventana Meta responde 131047 y hace falta plantilla.
 */
export function realtyWaWindowOpen(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < REALTY_WA_WINDOW_MS;
}

// ── Máquina de estados de entrega ───────────────────────────────────────

const STATUS_RANK: Record<RealtyMessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

/**
 * Siguiente estado, o null si el webhook no aporta nada nuevo.
 *
 * Reglas, y las tres importan:
 *   · solo AVANZA (Meta manda los estados fuera de orden: un "sent" que
 *     llega tarde no puede borrar un "read");
 *   · FAILED gana siempre y NUNCA se pisa con un "entregado" posterior —
 *     esta es exactamente la línea que faltaba en el dental, donde un
 *     mensaje RECHAZADO por Meta se seguía pintando como entregado;
 *   · un estado que no conocemos no toca nada.
 */
export function nextRealtyWaStatus(
  current: RealtyMessageStatus,
  incoming: string,
): RealtyMessageStatus | null {
  const raw = String(incoming ?? "").toUpperCase();
  if (raw === "FAILED") return current === "FAILED" ? null : "FAILED";
  if (current === "FAILED") return null;
  const next: RealtyMessageStatus | null =
    raw === "SENT" ? "SENT" : raw === "DELIVERED" ? "DELIVERED" : raw === "READ" ? "READ" : null;
  if (!next) return null;
  if ((STATUS_RANK[next] ?? 0) <= (STATUS_RANK[current] ?? 0)) return null;
  return next;
}

/**
 * Etiqueta y tono del estado. Existe para que NINGUNA pantalla traduzca a
 * mano: en el dental un recordatorio rechazado se pintaba "entregado" y la
 * clínica creía que el paciente lo había recibido.
 *
 * Las etiquetas salen de REALTY_MESSAGE_STATUS_LABELS (el contrato); aquí
 * solo se les añade el tono visual.
 */
export const REALTY_WA_STATUS_TONE: Record<
  RealtyMessageStatus,
  "neutral" | "info" | "success" | "danger"
> = {
  PENDING: "neutral",
  SENT: "info",
  DELIVERED: "info",
  READ: "success",
  FAILED: "danger",
};

// ── Clasificación de respuestas ─────────────────────────────────────────

/**
 * Qué quiso decir quien respondió. `baja` es obligatoria: la plantilla de
 * coincidencias es MARKETING y Meta exige que se pueda salir. Sin esto la
 * cuenta se gana un bloqueo con toda la razón.
 */
export type RealtyWaReply = "confirm" | "cancel" | "reschedule" | "optOut" | "unclear";

// 🔴 RAÍCES y no conjugaciones. Enumerar formas del verbo es una lista que
// siempre está incompleta: "cancélala" no estaba y una cancelación se leía
// como una CONFIRMACIÓN, porque el "sí" de la misma frase sí aparecía. Con
// la raíz `cancel`, cancelar / cancela / cancelo / cancélala / cancelarla /
// cancelándola caen todas del mismo lado.
const OPT_OUT_PHRASES = ["darme de baja", "no me escriban", "cancelar suscripcion", "ya no me escriban"];
const OPT_OUT_WORDS = ["baja", "stop", "unsubscribe"];

const CANCEL_STEMS = ["cancel"];
const CANCEL_PHRASES = ["no puedo", "no podre", "no voy", "no ire", "no asistire", "ya no"];

const RESCHEDULE_STEMS = ["reagend", "agend", "cambi", "mover", "muev", "recorr"];
const RESCHEDULE_PHRASES = [
  "otro dia",
  "otra hora",
  "otro horario",
  "mas tarde",
  "mas temprano",
  "otra fecha",
];

const CONFIRM_STEMS = ["confirm"];
const CONFIRM_WORDS = ["si", "sip", "ok", "okay", "va", "vale", "claro", "perfecto", "sale"];
const CONFIRM_PHRASES = ["ahi estare", "de acuerdo", "ahi nos vemos"];

/** Sin acentos y en minúsculas, para comparar sin sorpresas. */
function fold(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas de acento combinantes
    .toLowerCase()
    .trim();
}

/** ¿Aparece la frase como PALABRA COMPLETA? "sino" no lleva un "si" dentro. */
function hasWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

/**
 * ¿Aparece una palabra que EMPIEZA por esta raíz? Sirve para los verbos, que
 * en español se conjugan de mil formas. Sigue anclado por la izquierda, así
 * que "descancelar" no cuenta y "encambio" tampoco.
 */
function hasStem(haystack: string, stem: string): boolean {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}[a-z0-9]*([^a-z0-9]|$)`).test(haystack);
}

/**
 * Clasifica la respuesta. PURA y probada sin BD.
 *
 * El ORDEN es deliberado (mismo criterio que barber y el dental):
 *   1. BAJA     — es una obligación legal y de política de Meta; gana a todo.
 *   2. cancelar — ante una frase ambigua ("mejor no, sí cancélala") gana la
 *                 salida más destructiva, que es la que la persona quiso.
 *   3. cambiar  — antes que confirmar, porque "sí, pero otro día" lleva un
 *                 "sí" dentro y NO es una confirmación.
 *   4. confirmar.
 * Los dígitos 1/2/3 SOLO por igualdad exacta: un "3" dentro de "somos 3" no
 * puede cancelarle la visita a nadie.
 */
export function classifyRealtyReply(text: string): RealtyWaReply {
  const raw = String(text ?? "").trim();
  if (!raw) return "unclear";
  const t = fold(raw);

  if (t === "1") return "confirm";
  if (t === "2") return "cancel";
  if (t === "3") return "reschedule";

  // "cancelar suscripción" es una BAJA, no la cancelación de una visita: por
  // eso las frases de baja se miran antes que la raíz `cancel`.
  if (OPT_OUT_PHRASES.some((w) => t.includes(w))) return "optOut";
  if (OPT_OUT_WORDS.some((w) => hasWord(t, w))) return "optOut";

  if (CANCEL_STEMS.some((s) => hasStem(t, s))) return "cancel";
  if (CANCEL_PHRASES.some((w) => t.includes(w))) return "cancel";

  if (RESCHEDULE_STEMS.some((s) => hasStem(t, s))) return "reschedule";
  if (RESCHEDULE_PHRASES.some((w) => t.includes(w))) return "reschedule";

  if (CONFIRM_STEMS.some((s) => hasStem(t, s))) return "confirm";
  if (CONFIRM_PHRASES.some((w) => t.includes(w))) return "confirm";
  if (CONFIRM_WORDS.some((w) => hasWord(t, w))) return "confirm";
  return "unclear";
}

// ── Avisos de cobro ─────────────────────────────────────────────────────
//
// AQUÍ NO ESTÁ LA ESCALERA, Y ES A PROPÓSITO. Los cuatro pasos (5 días
// antes, el día, 3 y 8 después) los define T4 en
// `REALTY_REMINDER_STEPS` (src/lib/realty/rent-charges.ts) y la cola la arma
// `buildRentNoticeQueue` (leases.ts), que además sabe el saldo en CENTAVOS y
// si el cargo va PARCIAL. Esta terminal tenía su propia copia con los mismos
// cuatro offsets y su propia llave de idempotencia: eran dos colas para el
// mismo cobro, o sea dos WhatsApps al mismo inquilino. Se borró la de aquí.
// El envío vive en `sendRentNoticeWhatsapp` (whatsapp.ts) y usa la llave de
// T4 (`notice.key`).

// ── Match ───────────────────────────────────────────────────────────────
//
// AQUÍ NO HAY MATCH, Y ES A PROPÓSITO. El cruce inmueble ↔ prospecto vive en
// `src/lib/realty/matching.ts` (puntaje con pesos, tolerancia de presupuesto,
// puntaje mínimo) y se carga desde la BD con `findSeekersForProperty`
// (`src/lib/realty/leads.ts`). Esta terminal escribió su propia versión
// booleana antes de que ese módulo existiera; tener dos criterios de encaje
// en el mismo producto es peor que no tener ninguno, así que se borró.
// `notifyRealtyMatches` (whatsapp.ts) llama al de verdad.

// ── Formato ─────────────────────────────────────────────────────────────

/** Precio para el cuerpo de una plantilla: "$4,850,000 MXN". */
export function formatRealtyWaPrice(amount: number, currency = "MXN"): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `$${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })} ${currency}`;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * 🔴 TODAS las fechas se leen EN LA ZONA HORARIA DE LA CUENTA, nunca en la
 * del servidor.
 *
 * En Vercel el servidor corre en UTC. Con `d.getHours()` a secas, una visita
 * de las 11:00 en Guadalajara se le anunciaba al prospecto como las 17:00 —
 * y el recordatorio de una visita de las 20:00 salía fechado al día
 * siguiente. RealtyAccount.timezone existe justo para esto y hay que usarlo.
 *
 * Devuelve las partes civiles (lo que marca un reloj de pared ahí).
 */
function civilPartsInTz(
  d: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
  } catch {
    // Una zona horaria inválida guardada en la cuenta no puede tumbar un
    // envío: se cae a la de México, que es la que trae el schema por default.
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // El día de la semana se saca del día civil ya resuelto, no de la fecha
  // cruda: getUTCDay sobre Date.UTC(y, m-1, d) da el correcto sin volver a
  // pelear con la zona.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour: get("hour"), minute: get("minute"), weekday };
}

/** "26 de agosto" en la zona de la cuenta — sin año, que en un WhatsApp sobra. */
export function formatRealtyWaDate(d: Date, timeZone: string): string {
  const p = civilPartsInTz(d, timeZone);
  return `${p.day} de ${MESES[p.month - 1] ?? ""}`;
}

/** "martes 26 de agosto" — para el recordatorio de visita. */
export function formatRealtyWaLongDate(d: Date, timeZone: string): string {
  const p = civilPartsInTz(d, timeZone);
  return `${DIAS[p.weekday] ?? ""} ${formatRealtyWaDate(d, timeZone)}`;
}

/** "11:00" en la zona de la cuenta. */
export function formatRealtyWaTime(d: Date, timeZone: string): string {
  const p = civilPartsInTz(d, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Medianoche civil de HOY en la zona de la cuenta, como instante UTC. */
export function startOfDayInTz(now: Date, timeZone: string): Date {
  const p = civilPartsInTz(now, timeZone);
  const offsetMs =
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
    new Date(Math.floor(now.getTime() / 60_000) * 60_000).getTime();
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offsetMs);
}

// ── DTOs del panel ──────────────────────────────────────────────────────

/**
 * Fila de la lista de hilos. Extiende el RealtyThreadDTO del contrato con
 * lo que la lista necesita para pintarse sin una segunda consulta.
 *
 * 🔴 lastStatus y lastError vienen del MENSAJE, no del hilo: sin ellos la
 * lista pinta una palomita a un mensaje que Meta RECHAZÓ.
 */
export interface RealtyWaThreadRowDTO {
  id: string;
  contactId: string | null;
  contactName: string | null;
  phone: string;
  lastMessageAt: string;
  unread: number;
  archived: boolean;
  lastBody: string | null;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  lastStatus: RealtyMessageStatus | null;
  /** Texto en español del error de Meta. null = no falló. */
  lastError: string | null;
  windowOpen: boolean;
}

/** Resultado de un envío manual desde el Inbox. */
export interface RealtyWaSendOk {
  ok: true;
  messageId: string;
}

/**
 * Por qué no se mandó. Es un CÓDIGO y no el texto en español a propósito:
 * quien decide con esto (el cron, para saber si "ya estaba mandado" cuenta
 * como saltado y no como fallo) no puede depender de una redacción que
 * cualquiera puede mejorar. Mismo criterio que errorCode frente a errorTitle.
 */
export type RealtyWaSendReason =
  | "duplicate"
  | "quota"
  | "window"
  | "plan"
  | "not_connected"
  | "phone"
  | "params"
  | "not_found"
  | "retries"
  | "meta";

export interface RealtyWaSendErr {
  ok: false;
  /** Frase en español, lista para pintarse. */
  error: string;
  reason: RealtyWaSendReason;
  /** Código de Meta cuando lo hay. El texto lo cambian; el número no. */
  code?: number;
}
export type RealtyWaSendResult = RealtyWaSendOk | RealtyWaSendErr;

/**
 * 🔴 Guardas de tipo EXPLÍCITAS y no `if (result.ok)`. El repo compila con
 * `strict: false`, y ahí TypeScript NO estrecha una unión por un booleano
 * discriminante: sin esto, `result.error` no compila en la rama del error.
 * (Mismo motivo por el que barber tiene isManualSendError.)
 */
export function isRealtyWaSendOk(result: RealtyWaSendResult): result is RealtyWaSendOk {
  return result.ok === true;
}
export function isRealtyWaSendErr(result: RealtyWaSendResult): result is RealtyWaSendErr {
  return result.ok === false;
}
