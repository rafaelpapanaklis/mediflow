// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — WhatsApp: NÚCLEO PURO (client-safe).
//
// Aquí vive todo lo que NO toca red ni base de datos: el catálogo de
// plantillas propias del vertical, la clasificación de la respuesta del
// cliente, la codificación de adjuntos, la matemática de la cuota y los
// tipos que cruzan servidor ↔ navegador.
//
// Espejo del par plan-shared.ts / plans.ts y booking-core.ts / booking.ts:
// este archivo lo importan los componentes "use client"; el que habla con
// Meta y con Prisma es src/lib/barber/whatsapp.ts (server-only).
//
// ── POR QUÉ TODO SALE COMO `utility` ───────────────────────────────────
// Desde julio de 2025 Meta cobra POR MENSAJE ENTREGADO. En México una
// plantilla de `utility` cuesta 0.0080 USD y una de `marketing` ≈ 4x, y
// además exige consentimiento previo. Una barbería con 300 citas al mes
// gasta ~2.40 USD en recordatorios. Por eso TODO lo transaccional
// (recordatorio, confirmación de reserva, turno de la fila) es `utility`,
// y `marketing` queda SOLO para promoción real (cumpleaños, "te
// extrañamos"), que nunca se manda sola: la barbería la dispara a mano
// viendo el costo estimado.
//
// Además: las plantillas de utilidad entregadas DENTRO de una ventana de
// servicio abierta (el cliente escribió en las últimas 24 h) son gratis.
// Por eso el emisor prefiere texto libre cuando la ventana está abierta.
//
// TERMINOLOGÍA: cliente / barbero / barbería / servicio / visita.
// ═══════════════════════════════════════════════════════════════════════

import type { BarberMessageDirection, BarberMessageStatus } from "@/lib/barber/types";

// ── Categorías de Meta ──────────────────────────────────────────────────

export type BarberWaCategory = "UTILITY" | "AUTHENTICATION" | "MARKETING";

/**
 * Costo por mensaje ENTREGADO en México (USD), verificado en agosto de 2026.
 * Vive aquí para poder enseñarle a la barbería lo que va a gastar ANTES de
 * mandar una campaña. No es un cobro nuestro: es lo que Meta le cobra a su
 * propia cuenta.
 */
export const BARBER_WA_PRICE_USD: Record<BarberWaCategory, number> = {
  UTILITY: 0.008,
  AUTHENTICATION: 0.0177,
  MARKETING: 0.0324,
};

// ── Estados de la conexión ──────────────────────────────────────────────

/**
 * En qué estado está el WhatsApp de la barbería. `UNVERIFIED` NO es un
 * error: sin verificación de negocio, Meta permite escribirle a 250
 * clientes únicos cada 24 h — de sobra para cualquier barbería. Por eso el
 * onboarding no exige verificación: la explica y sigue.
 */
export type BarberWaConnectionState =
  | "DISCONNECTED"
  | "CONNECTED"
  | "UNVERIFIED"
  | "NO_PAYMENT_METHOD"
  | "ERROR";

export interface BarberWaConnectionDTO {
  state: BarberWaConnectionState;
  /** Modo de envío guardado en la barbería. */
  senderMode: "PLATFORM" | "OWN_WABA";
  /** Número visible que devolvió Meta al conectar (nunca el token). */
  displayPhone: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  verifiedAt: string | null;
  /** Motivo legible cuando `state` es ERROR o NO_PAYMENT_METHOD. */
  problem: string | null;
  /** ¿Está disponible el Embedded Signup en este despliegue? */
  canConnect: boolean;
}

// ── Cuota de mensajes del plan ──────────────────────────────────────────

export interface BarberWaQuotaDTO {
  /** -1 = ilimitado (BARBER_UNLIMITED). */
  limit: number;
  used: number;
  remaining: number;
  /** Inicio del periodo en curso (ISO) o null si nunca se ha usado. */
  periodStart: string | null;
  /** ≥ 0.8 del cupo: la pantalla avisa, pero NO se corta nada todavía. */
  nearLimit: boolean;
  exhausted: boolean;
}

/** -1 = ilimitado, igual que BARBER_UNLIMITED en plan-shared. */
export function isBarberWaUnlimited(limit: number): boolean {
  return limit < 0;
}

export function barberWaRemaining(limit: number, used: number): number {
  if (isBarberWaUnlimited(limit)) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - used);
}

/**
 * ¿Cabe un mensaje más en el periodo? El cupo es un guardarraíl contra el
 * abuso, no una palanca de venta: la pantalla avisa desde el 80 % para que
 * nadie se entere de que se quedó sin mensajes por un silencio.
 */
export function barberWaFits(limit: number, used: number, adding = 1): boolean {
  if (isBarberWaUnlimited(limit)) return true;
  return used + adding <= limit;
}

export function buildBarberWaQuota(args: {
  limit: number;
  used: number;
  periodStart: Date | null;
}): BarberWaQuotaDTO {
  const { limit, used } = args;
  const unlimited = isBarberWaUnlimited(limit);
  const remaining = unlimited ? -1 : Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    periodStart: args.periodStart ? args.periodStart.toISOString() : null,
    nearLimit: !unlimited && limit > 0 && used >= Math.floor(limit * 0.8),
    exhausted: !unlimited && used >= limit,
  };
}

// ── Marcas dentro de `templateName` ─────────────────────────────────────
//
// BarberMessage NO tiene columna para adjuntos ni para archivar un hilo, y
// el schema NO se toca en esta ola (contrato de la Ola 0). `templateName`
// es un texto libre que hoy solo usan las filas OUTBOUND de plantilla, así
// que las filas de SISTEMA lo reutilizan con un prefijo inconfundible.
//
// Nada más del vertical consulta `templateName` salvo el dedupe de la fila
// virtual (OUTBOUND + PENDING + "walkin_casi_es_tu_turno", igualdad
// exacta), así que estos prefijos no chocan con nadie.

/** Prefijo de las filas que NO son un mensaje: marcas de estado del hilo. */
export const BARBER_WA_SYS_PREFIX = "sys:" as const;
/** Marca "este hilo se archivó" (append-only: archivar nunca borra nada). */
export const BARBER_WA_ARCHIVE_MARK = "sys:archive" as const;
/** Marca "este hilo se sacó del archivo". */
export const BARBER_WA_UNARCHIVE_MARK = "sys:unarchive" as const;
/** Prefijo de un adjunto entrante: `attach:{json}`. */
export const BARBER_WA_ATTACH_PREFIX = "attach:" as const;

export type BarberWaAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker";

export interface BarberWaAttachment {
  kind: BarberWaAttachmentKind;
  /** Media id de Meta. El binario se pide con él; NUNCA se guarda el archivo. */
  mediaId: string;
  mime?: string;
  filename?: string;
}

/** ¿Esta fila es una marca de sistema y no un mensaje que enseñar? */
export function isBarberWaSysRow(templateName: string | null | undefined): boolean {
  return typeof templateName === "string" && templateName.startsWith(BARBER_WA_SYS_PREFIX);
}

export function encodeBarberWaAttachment(att: BarberWaAttachment): string {
  return `${BARBER_WA_ATTACH_PREFIX}${JSON.stringify(att)}`;
}

/**
 * Devuelve el adjunto guardado en `templateName`, o null si esa fila no
 * lleva ninguno. Tolera JSON corrupto: un adjunto ilegible es "no hay
 * adjunto", nunca una excepción que tumbe el hilo entero.
 */
export function parseBarberWaAttachment(
  templateName: string | null | undefined,
): BarberWaAttachment | null {
  if (typeof templateName !== "string" || !templateName.startsWith(BARBER_WA_ATTACH_PREFIX)) {
    return null;
  }
  try {
    const raw = JSON.parse(templateName.slice(BARBER_WA_ATTACH_PREFIX.length)) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    const kind = rec.kind;
    const mediaId = rec.mediaId;
    if (typeof mediaId !== "string" || mediaId.length === 0) return null;
    const kinds: BarberWaAttachmentKind[] = ["image", "video", "audio", "document", "sticker"];
    if (typeof kind !== "string" || !kinds.includes(kind as BarberWaAttachmentKind)) return null;
    const att: BarberWaAttachment = { kind: kind as BarberWaAttachmentKind, mediaId };
    if (typeof rec.mime === "string" && rec.mime) att.mime = rec.mime;
    if (typeof rec.filename === "string" && rec.filename) att.filename = rec.filename;
    return att;
  } catch {
    return null;
  }
}

// ── Catálogo de plantillas PROPIAS del vertical ─────────────────────────
//
// PREFIJO PROPIO `dc_barber_`: las plantillas del dental viven en la WABA
// de cada clínica y NO se tocan aquí ni por nombre ni por redacción.
//
// Reglas de Meta que cumple cada cuerpo: no empieza ni termina con
// variable, y no lleva dos variables seguidas. El test las verifica sobre
// el catálogo entero para que nadie las rompa al cambiar una redacción.
//
// EL ORDEN DE LAS VARIABLES ES CONTRATO: Meta las sustituye por POSICIÓN.
// Cambiar el orden aquí sin cambiar el array del emisor entrega el mensaje
// con los datos cambiados de sitio (y Meta lo rechaza con 132000 si además
// cambia la cantidad).

/** Tipos de mensaje que manda el vertical. */
export type BarberWaKind =
  | "reminder"
  | "portalCode"
  | "walkinTurn"
  | "bookingConfirmed"
  | "birthday"
  | "winback";

export interface BarberWaTemplate {
  kind: BarberWaKind;
  /** Nombre EXACTO con el que se da de alta en Meta ([a-z0-9_]). */
  name: string;
  category: BarberWaCategory;
  lang: string;
  /** Cuerpo con {{1}}…{{n}}. Vacío en las de AUTHENTICATION (Meta lo genera). */
  body: string;
  /** Qué es cada {{n}}, en orden. Para la pantalla y para el emisor. */
  variables: string[];
  /** Ejemplo por variable: Meta EXIGE uno o rechaza la plantilla. */
  sample: string[];
  /**
   * `true` = no se da de alta sola. Solo las de MARKETING: cuestan ~4x y
   * exigen consentimiento, así que la barbería las activa a mano.
   */
  optional: boolean;
}

export const BARBER_WA_LANG = "es_MX" as const;

export const BARBER_WA_TEMPLATES: readonly BarberWaTemplate[] = [
  {
    kind: "reminder",
    name: "dc_barber_recordatorio_cita",
    category: "UTILITY",
    lang: BARBER_WA_LANG,
    body:
      "Hola {{1}}, te recordamos tu visita en {{2}}.\n\n" +
      "🗓️ {{3}}\n✂️ {{4}}\n💈 Con {{5}}\n📍 {{6}}\n\n" +
      "Responde *CONFIRMAR* para confirmar, *CANCELAR* si no podrás venir " +
      "o *CAMBIAR* si quieres otro horario.",
    variables: ["cliente", "barbería", "fecha y hora", "servicio", "barbero", "dirección"],
    sample: [
      "Luis",
      "Barbería El Corte",
      "martes 26 de agosto a las 17:00",
      "Corte + barba",
      "Memo",
      "Av. Juárez 120, Centro",
    ],
    optional: false,
  },
  {
    // DOS variables, no tres, a propósito: el aviso ya viene REDACTADO por
    // walkInNotifyBody() de T1 (src/lib/barber/agenda.ts) y entra completo
    // como {{2}}. Partirlo aquí obligaría a re-parsear una frase en español.
    // El emisor pasa exactamente [nombre de la barbería, cuerpo de la fila].
    kind: "walkinTurn",
    name: "dc_barber_turno_fila",
    category: "UTILITY",
    lang: BARBER_WA_LANG,
    body: "💈 Aviso de tu turno en {{1}}: {{2}} Te esperamos en la silla.",
    variables: ["barbería", "aviso del turno"],
    sample: [
      "Barbería El Corte",
      "Luis, faltan 2 personas para tu turno. Vente en unos 20 min.",
    ],
    optional: false,
  },
  {
    kind: "bookingConfirmed",
    name: "dc_barber_reserva_confirmada",
    category: "UTILITY",
    lang: BARBER_WA_LANG,
    body:
      "¡Listo {{1}}! Tu visita en {{2}} quedó agendada.\n\n" +
      "🗓️ {{3}}\n📍 {{4}}\n\n" +
      "Si necesitas moverla, respóndenos por aquí.",
    variables: ["cliente", "barbería", "fecha y hora", "dirección"],
    sample: [
      "Luis",
      "Barbería El Corte",
      "martes 26 de agosto a las 17:00",
      "Av. Juárez 120, Centro",
    ],
    optional: false,
  },
  {
    // AUTHENTICATION: el cuerpo lo genera Meta (no se manda `body` al
    // crearla) y lleva botón de copiar código. Es la única categoría que no
    // es `utility` y no es negociable: un código de acceso mandado como
    // utilidad se rechaza.
    kind: "portalCode",
    name: "dc_barber_codigo_acceso",
    category: "AUTHENTICATION",
    lang: BARBER_WA_LANG,
    body: "",
    variables: ["código"],
    sample: ["123456"],
    optional: false,
  },
  {
    kind: "birthday",
    name: "dc_barber_cumpleanos",
    category: "MARKETING",
    lang: BARBER_WA_LANG,
    body:
      "¡Feliz cumpleaños, {{1}}! 🎉 En {{2}} queremos dejarte impecable: {{3}} " +
      "Pásate cuando gustes.",
    variables: ["cliente", "barbería", "promoción"],
    sample: ["Luis", "Barbería El Corte", "este mes tu corte lleva barba de cortesía."],
    optional: true,
  },
  {
    kind: "winback",
    name: "dc_barber_te_extranamos",
    category: "MARKETING",
    lang: BARBER_WA_LANG,
    body: "Hola {{1}}, hace rato que no te vemos en {{2}}. {{3}} Aquí te esperamos.",
    variables: ["cliente", "barbería", "promoción"],
    sample: ["Luis", "Barbería El Corte", "Aparta tu lugar cuando gustes."],
    optional: true,
  },
] as const;

export function barberWaTemplate(kind: BarberWaKind): BarberWaTemplate {
  const found = BARBER_WA_TEMPLATES.find((t) => t.kind === kind);
  // El catálogo es una constante del módulo: si esto faltara sería un bug de
  // programación, no un dato de la barbería.
  if (!found) throw new Error(`Plantilla barber desconocida: ${kind}`);
  return found;
}

export function barberWaTemplateByName(name: string): BarberWaTemplate | null {
  return BARBER_WA_TEMPLATES.find((t) => t.name === name) ?? null;
}

/** Cuántos {{n}} distintos tiene un cuerpo (para validar contra `sample`). */
export function countBarberWaVariables(body: string): number {
  const found = new Set<number>();
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(Number(m[1]));
  return found.size;
}

/**
 * Comprueba las reglas de Meta sobre el cuerpo. Devuelve el motivo en
 * español, o null si está bien. Lo usa la prueba del catálogo.
 */
export function checkBarberWaTemplate(tpl: BarberWaTemplate): string | null {
  if (!/^[a-z0-9_]+$/.test(tpl.name)) return "El nombre solo admite [a-z0-9_].";
  if (tpl.category === "AUTHENTICATION") {
    // Meta redacta el cuerpo de las de autenticación; mandarle uno la rechaza.
    return tpl.body === "" ? null : "Una plantilla de autenticación no lleva cuerpo propio.";
  }
  const body = tpl.body.trim();
  if (!body) return "El cuerpo no puede ir vacío.";
  if (/^\{\{\d+\}\}/.test(body)) return "El cuerpo no puede empezar con una variable.";
  if (/\{\{\d+\}\}$/.test(body)) return "El cuerpo no puede terminar con una variable.";
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) return "No puede haber dos variables seguidas.";
  const count = countBarberWaVariables(body);
  if (count !== tpl.variables.length) {
    return `El cuerpo tiene ${count} variables y el catálogo describe ${tpl.variables.length}.`;
  }
  if (tpl.sample.length < count) return "Falta un ejemplo por variable (Meta lo exige).";
  return null;
}

// ── Respuesta del cliente al recordatorio ───────────────────────────────

/**
 * Qué quiso decir el cliente. `reschedule` existe porque el recordatorio le
 * ofrece las TRES salidas: confirmar, cancelar o cambiar de horario. Sin la
 * tercera, el que quiere moverla escribe "el jueves mejor" y nadie lo lee.
 */
export type BarberWaReply = "confirm" | "cancel" | "reschedule" | "unclear";

const CANCEL_WORDS = [
  "cancelar",
  "cancela",
  "cancelo",
  "cancelalo",
  "cancélalo",
  "cancelarla",
  "no puedo",
  "no podre",
  "no podré",
  "no voy",
  "no ire",
  "no iré",
  "no asistire",
  "no asistiré",
];
const RESCHEDULE_WORDS = [
  "cambiar",
  "cambio",
  "cambiar hora",
  "reagendar",
  "reagenda",
  "mover",
  "muevela",
  "muévela",
  "otro dia",
  "otro día",
  "otra hora",
  "otro horario",
];
const CONFIRM_WORDS = [
  "confirmar",
  "confirmo",
  "confirmado",
  "confirma",
  "si",
  "sí",
  "sip",
  "ok",
  "okay",
  "va",
  "vale",
  "ahi estare",
  "ahi estaré",
  "ahí estaré",
  "claro",
  "de acuerdo",
];

/** Quita acentos y baja a minúsculas para comparar sin sorpresas. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Clasifica la respuesta. PURO y probado sin BD.
 *
 * El ORDEN importa y es deliberado, con el mismo criterio que el dental:
 *   1. cancelar — para frases ambiguas ("mejor no, sí cancélala") gana la
 *      salida más destructiva, que es la que el cliente quiso decir;
 *   2. cambiar  — antes que confirmar, porque "sí, pero otro día" lleva un
 *      "sí" dentro y NO es una confirmación;
 *   3. confirmar.
 * Los dígitos "1"/"2"/"3" solo por igualdad EXACTA: un "3" suelto dentro de
 * "somos 3" no puede cancelar la cita de nadie.
 */
export function classifyBarberReply(text: string): BarberWaReply {
  const raw = String(text ?? "").trim();
  if (!raw) return "unclear";
  const t = fold(raw);

  if (t === "1") return "confirm";
  if (t === "2") return "cancel";
  if (t === "3") return "reschedule";

  const has = (words: string[]) => words.some((w) => t.includes(fold(w)));

  if (has(CANCEL_WORDS)) return "cancel";
  if (has(RESCHEDULE_WORDS)) return "reschedule";
  // Las palabras cortas de confirmación ("si", "ok", "va") solo valen si el
  // mensaje ES esa palabra: un "no si voy" no confirma nada.
  if (CONFIRM_WORDS.some((w) => fold(w) === t)) return "confirm";
  if (has(["confirmar", "confirmo", "confirmado", "ahi estare", "ahí estaré"])) return "confirm";

  return "unclear";
}

// ── Programar recordatorios: la decisión, sin BD ────────────────────────

/**
 * ¿Esta visita YA tiene recordatorio y no hay que volver a programarlo?
 *
 * 🔴 AQUÍ VIVE EL ARREGLO DEL BUG M-22 DEL DENTAL. Cuando T1 mueve o cancela
 * una cita, marca sus recordatorios pendientes como FAILED con
 * BARBER_REMINDER_INVALIDATED_MARK. La regla es:
 *
 *   · cualquier fila que NO sea FAILED (PENDING/SENT/DELIVERED/READ)
 *       → ya está atendida, no se programa otra;
 *   · FAILED por un error REAL de Meta (número inexistente, sin saldo)
 *       → tampoco: reintentarla cada 15 min sería spam de fallos;
 *   · FAILED **con la marca de invalidación**
 *       → la puerta queda ABIERTA: se programa uno nuevo, que al enviarse
 *         recalcula la hora y sale con la NUEVA.
 *
 * `isInvalidated` se inyecta (es isInvalidatedReminder de agenda.ts, de T1)
 * para que este módulo siga siendo puro y no cuelgue de aquel.
 */
export function reminderAlreadyHandled(
  rows: { status: BarberMessageStatus; errorMessage: string | null }[],
  isInvalidated: (message: string | null | undefined) => boolean,
): boolean {
  return rows.some((row) => row.status !== "FAILED" || !isInvalidated(row.errorMessage));
}

// ── Estados de entrega: la decisión, sin BD ─────────────────────────────

const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

/**
 * Siguiente estado de un mensaje según lo que dijo Meta, o null si NO hay que
 * escribir nada.
 *
 * 🔴 EN EL DENTAL UN RECORDATORIO RECHAZADO SE VEÍA COMO ENTREGADO (M-06 /
 * M-10). Reglas, en este orden:
 *   · Meta manda estos avisos repetidos y FUERA DE ORDEN → el estado nunca
 *     retrocede (READ no vuelve a DELIVERED) y un repetido no escribe nada;
 *   · FAILED gana siempre y NUNCA se sobrescribe con un "entregado" que
 *     llegue tarde: es la única verdad que hay que contarle a la barbería;
 *   · un estado desconocido no toca nada (lado seguro).
 */
export function nextBarberWaStatus(
  current: BarberMessageStatus,
  incoming: string,
): BarberMessageStatus | null {
  const raw = String(incoming ?? "").toUpperCase();
  if (raw === "FAILED") return current === "FAILED" ? null : "FAILED";
  // Un FAILED ya escrito no se pisa con nada.
  if (current === "FAILED") return null;
  const next =
    raw === "SENT" ? "SENT" : raw === "DELIVERED" ? "DELIVERED" : raw === "READ" ? "READ" : null;
  if (!next) return null;
  if ((STATUS_RANK[next] ?? 0) <= (STATUS_RANK[current] ?? 0)) return null;
  return next as BarberMessageStatus;
}

// ── Ventana de servicio de 24 h ─────────────────────────────────────────

export const BARBER_WA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Se puede mandar texto libre? Solo si el cliente escribió en las últimas
 * 24 h. Fuera de esa ventana Meta lo rechaza con 131047 y hace falta una
 * plantilla aprobada.
 */
export function barberWaWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < BARBER_WA_WINDOW_MS;
}

// ── DTOs del Inbox ──────────────────────────────────────────────────────

export interface BarberWaMessageDTO {
  id: string;
  direction: BarberMessageDirection;
  status: BarberMessageStatus;
  body: string | null;
  /** Motivo REAL cuando falló. Nunca se pinta "entregado" a un rechazo. */
  error: string | null;
  templateName: string | null;
  attachment: BarberWaAttachment | null;
  createdAt: string;
  appointmentId: string | null;
}

export interface BarberWaThreadDTO {
  phone: string;
  clientId: string | null;
  clientName: string | null;
  lastBody: string | null;
  lastAt: string;
  lastDirection: BarberMessageDirection;
  lastStatus: BarberMessageStatus;
  unread: number;
  archived: boolean;
  /** ¿Se puede mandar texto libre ahora mismo? (ventana de 24 h abierta) */
  windowOpen: boolean;
}

/**
 * Etiqueta es-MX del estado de entrega. Existe para que la UI NUNCA
 * traduzca a mano: en el dental un recordatorio RECHAZADO se pintaba como
 * "entregado" y la clínica creía que el paciente lo había recibido.
 */
export const BARBER_WA_STATUS_UI: Record<
  BarberMessageStatus,
  { label: string; tone: "neutral" | "info" | "success" | "danger" }
> = {
  PENDING: { label: "En cola", tone: "neutral" },
  SENT: { label: "Enviado", tone: "info" },
  DELIVERED: { label: "Entregado", tone: "info" },
  READ: { label: "Leído", tone: "success" },
  FAILED: { label: "No se entregó", tone: "danger" },
};
