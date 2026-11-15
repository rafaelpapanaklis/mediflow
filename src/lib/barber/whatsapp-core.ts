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

/**
 * Estados en los que el número PUEDE contestar, o sea en los que la pantalla
 * del bot deja encenderlo. Lista CERRADA: un estado nuevo queda fuera hasta
 * que alguien decida meterlo.
 *   · CONNECTED / UNVERIFIED — UNVERIFIED es «conectado, sin verificación de
 *     negocio», que NO es un problema (antes dejaba el interruptor bloqueado).
 *   · NO_PAYMENT_METHOD — el bot contesta con texto libre dentro de la ventana
 *     de 24 h, que Meta no cobra, y el envío (replyInline) no lo frena antes
 *     de llamar a Meta: solo exige número y token.
 * Fuera: DISCONNECTED y ERROR (token vencido o rechazado: el número está
 * guardado pero no puede mandar nada). En ERROR la pantalla vuelve a «sin
 * conectar» y la de WhatsApp enseña el aviso rojo con el porqué.
 */
export const BARBER_WA_CAN_REPLY_STATES: readonly BarberWaConnectionState[] = [
  "CONNECTED",
  "UNVERIFIED",
  "NO_PAYMENT_METHOD",
];

/** ¿El número puede contestar? (ver BARBER_WA_CAN_REPLY_STATES) */
export function isBarberWaLinked(state: BarberWaConnectionState): boolean {
  return BARBER_WA_CAN_REPLY_STATES.includes(state);
}

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
  /**
   * ¿Nuestra app está suscrita a la cuenta de WhatsApp de la barbería?
   * `false` = Meta NO nos está entregando lo que escriben los clientes: ni
   * la bandeja, ni las confirmaciones, ni el bot reciben nada aunque todo se
   * vea "conectado". `null` = no se pudo comprobar (Meta no respondió).
   */
  webhookSubscribed: boolean | null;
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
  | "reminderButtons"
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
  /**
   * Botones de respuesta rápida, en orden. Texto ≤ 25 caracteres y SIN
   * emojis ni saltos (Meta rechaza la plantilla si los lleva). Al enviar,
   * cada botón viaja con un `payload` propio (ver barberReminderButtons):
   * es lo que hace que el toque diga exactamente de qué visita se trata.
   */
  buttons?: string[];
}

export const BARBER_WA_LANG = "es_MX" as const;

/** Textos de los tres botones de la plantilla del recordatorio, en orden. */
export const BARBER_REMINDER_TEMPLATE_BUTTONS = ["Confirmar", "Cambiar", "Cancelar"] as const;

export const BARBER_WA_TEMPLATES: readonly BarberWaTemplate[] = [
  {
    // EL RECORDATORIO CON BOTONES — es el que se intenta primero. El cliente
    // toca Confirmar / Cambiar / Cancelar en vez de escribir, y el toque trae
    // la visita exacta. Mismas seis variables y mismo orden que el de texto
    // de abajo, que queda como RESPALDO: si Meta rechaza o todavía no
    // aprueba éste, el recordatorio sale con el otro (ver processOutboxRow).
    kind: "reminderButtons",
    name: "dc_barber_recordatorio_cita_botones",
    category: "UTILITY",
    lang: BARBER_WA_LANG,
    body:
      "Hola {{1}}, te recordamos tu visita en {{2}}.\n\n" +
      "🗓️ {{3}}\n✂️ {{4}}\n💈 Con {{5}}\n📍 {{6}}\n\n" +
      "Toca un botón para confirmar, cambiar el horario o cancelar.",
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
    buttons: [...BARBER_REMINDER_TEMPLATE_BUTTONS],
  },
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
  for (const button of tpl.buttons ?? []) {
    if (!button.trim()) return "Un botón no puede ir vacío.";
    if (Array.from(button).length > 25) return "El texto de un botón admite 25 caracteres.";
    // Meta rechaza los botones de plantilla con emojis, saltos o formato.
    if (!/^[\p{L}\p{N} ]+$/u.test(button)) return "Un botón de plantilla solo admite letras, números y espacios.";
  }
  if ((tpl.buttons?.length ?? 0) > 3) return "Como mucho tres botones de respuesta.";
  if (new Set(tpl.buttons ?? []).size !== (tpl.buttons?.length ?? 0)) return "Dos botones no pueden decir lo mismo.";
  return null;
}

// ── Cambios de última hora ──────────────────────────────────────────────

/**
 * Con cuánta anticipación se puede cancelar o mover una visita por
 * WhatsApp (palabra, botón o bot). La MISMA regla que «mi cuenta»
 * (BARBER_CANCEL_WINDOW_HOURS en portal-core.ts; no se importa de allí
 * porque aquel módulo usa `crypto` de Node y éste lo carga el navegador —
 * una prueba vigila que los dos números sigan iguales).
 */
export const BARBER_WA_CHANGE_NOTICE_HOURS = 2;

/** ¿Ya es demasiado tarde para cancelar o mover esta visita por WhatsApp? */
export function barberTooLateToChange(startAt: Date, now: Date = new Date()): boolean {
  return startAt.getTime() - now.getTime() < BARBER_WA_CHANGE_NOTICE_HOURS * 60 * 60 * 1000;
}

/** Lo que se le contesta dentro de esas horas, con el teléfono de la barbería. */
export function barberLateChangeReply(shopPhone: string | null | undefined): string {
  const phone = String(shopPhone ?? "").trim();
  return (
    `⏰ Faltan menos de ${BARBER_WA_CHANGE_NOTICE_HOURS} horas para tu visita. ` +
    `Para cambios de última hora llama a la barbería${phone ? `: ${phone}` : ""}.`
  );
}

// ── Parámetros de una plantilla ─────────────────────────────────────────

/** Tope de Meta para el texto de UN parámetro del cuerpo. */
export const BARBER_WA_PARAM_MAX = 1024;

/**
 * Deja un parámetro tal como Meta lo acepta.
 *
 * 🔴 Meta rechaza el mensaje ENTERO con 132018 si un parámetro trae un salto
 * de línea, una tabulación o más de cuatro espacios seguidos, y con 131008
 * si llega vacío. Una dirección capturada en dos renglones en la
 * configuración bastaba para que NINGÚN recordatorio de esa barbería
 * saliera. Aquí todo se colapsa a espacios simples y lo vacío se cambia por
 * `fallback`.
 */
export function sanitizeBarberWaParam(value: unknown, fallback = "—"): string {
  const clean = String(value ?? "")
    // Saltos de línea, tabulaciones y los separadores Unicode de línea y de
    // párrafo (U+2028 / U+2029), escritos por código para que ningún editor
    // los convierta en un salto real dentro de la expresión.
    .replace(new RegExp("[\\r\\n\\t\\u2028\\u2029]+", "g"), " ")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!clean) return fallback;
  const chars = Array.from(clean);
  return chars.length > BARBER_WA_PARAM_MAX
    ? `${chars.slice(0, BARBER_WA_PARAM_MAX - 1).join("")}…`
    : clean;
}

// ── El bot: UN turno por conversación ───────────────────────────────────
//
// 🔴 G4 de la revisión. La gente escribe en varios mensajes seguidos:
// «hola» / «quiero corte mañana» / «a las 5». Son tres webhooks, y sin esto
// eran tres turnos del bot A LA VEZ: cada uno contestaba a todo sin ver la
// respuesta del otro (dos o tres respuestas que se pisan, cada una con su
// gasto de IA y su mensaje del cupo, y el tope diario leído tres veces antes
// de que nadie sumara nada).
//
// No hay tabla de conversaciones y el schema no se toca, así que el turno se
// anota en el `errorMessage` del propio mensaje ENTRANTE (un entrante nunca
// lo usa para otra cosa) con una de tres marcas, y quién corre se decide
// dentro de un candado corto de Postgres por (barbería, teléfono):
//   [bot:atendiendo] <hasta>  → el turno de ESE mensaje está corriendo;
//   [bot:espera] <hasta>      → ese mensaje espera su turno;
//   [bot:listo] <visto hasta> → un turno terminó y contestó viendo todos
//                               los mensajes llegados hasta esa hora.
// La decisión es pura (decideBarberBotTurn) y se prueba sin base.

export const BARBER_WA_TURN_PREFIX = "[bot:" as const;
export type BarberBotTurnMark = "atendiendo" | "espera" | "listo";

export function barberBotTurnMark(kind: BarberBotTurnMark, at: Date): string {
  return `${BARBER_WA_TURN_PREFIX}${kind}] ${at.toISOString()}`;
}

export function parseBarberBotTurnMark(
  errorMessage: string | null | undefined,
): { kind: BarberBotTurnMark; at: Date } | null {
  if (typeof errorMessage !== "string" || !errorMessage.startsWith(BARBER_WA_TURN_PREFIX)) return null;
  const m = /^\[bot:(atendiendo|espera|listo)\] (.+)$/.exec(errorMessage);
  if (!m) return null;
  const at = new Date(m[2]);
  if (Number.isNaN(at.getTime())) return null;
  return { kind: m[1] as BarberBotTurnMark, at };
}

export function isBarberBotTurnMark(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === "string" && errorMessage.startsWith(BARBER_WA_TURN_PREFIX);
}

export interface BarberBotTurnRow {
  id: string;
  createdAt: Date;
  errorMessage: string | null;
}

/** ¿`a` llegó después que `b`? (Con la misma hora desempata el id.) */
function arrivedAfter(a: { id: string; createdAt: Date }, b: { id: string; createdAt: Date }): boolean {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff > 0 || (diff === 0 && a.id > b.id);
}

/**
 * ¿Qué hace el turno de ESTE mensaje, viendo las marcas de los demás
 * entrantes de la misma conversación?
 *
 *   · `yield` (ceder, sin contestar) si OTRO turno ya contestó habiendo
 *     visto este mensaje (marca «listo» con hora ≥ la de llegada de éste), o
 *     si hay un mensaje MÁS NUEVO esperando turno: ése contestará por todos.
 *   · `wait`  si otro turno está corriendo ahora.
 *   · `run`   en otro caso.
 *
 * Las marcas «atendiendo» y «espera» llevan hasta cuándo valen: una caducada
 * es de un proceso que murió y no cuenta (no puede dejar muda la conversación).
 */
export function decideBarberBotTurn(
  me: { id: string; createdAt: Date },
  others: BarberBotTurnRow[],
  now: Date,
): "run" | "wait" | "yield" {
  let running = false;
  let newerWaiting = false;
  for (const row of others) {
    if (row.id === me.id) continue;
    const mark = parseBarberBotTurnMark(row.errorMessage);
    if (!mark) continue;
    if (mark.kind === "listo") {
      if (mark.at.getTime() >= me.createdAt.getTime()) return "yield";
      continue;
    }
    if (mark.at.getTime() <= now.getTime()) continue; // caducada
    if (mark.kind === "atendiendo") running = true;
    else if (arrivedAfter(row, me)) newerWaiting = true;
  }
  if (running) return "wait";
  if (newerWaiting) return "yield";
  return "run";
}

/**
 * El turno terminó y tiene una respuesta lista. ¿Hay un mensaje que llegó
 * DESPUÉS de lo que este turno alcanzó a ver, y que sigue esperando su
 * turno? Entonces esta respuesta ya nació vieja: no se manda, y el turno de
 * ese mensaje contesta por los dos.
 */
export function barberBotReplyIsStale(
  seenUpTo: Date,
  others: BarberBotTurnRow[],
  now: Date,
): boolean {
  return others.some((row) => {
    const mark = parseBarberBotTurnMark(row.errorMessage);
    return (
      mark?.kind === "espera" &&
      mark.at.getTime() > now.getTime() &&
      row.createdAt.getTime() > seenUpTo.getTime()
    );
  });
}

// ── La cola: reclamar una fila antes de mandarla ────────────────────────
//
// BarberMessage no tiene un estado "enviando" y el schema no se toca. Sin
// reclamo, dos pasadas del despacho que se encimen (el cron cada pocos
// minutos + el botón del panel) leen la MISMA fila PENDING y el cliente
// recibe el recordatorio dos veces. El reclamo es una marca en
// `errorMessage` puesta con un updateMany condicionado: solo UNA pasada la
// consigue.

/** Prefijo de la marca "esta fila la está mandando alguien ahora mismo". */
export const BARBER_WA_CLAIM_MARK = "[enviando]" as const;

/**
 * Pasado este tiempo, un reclamo es de un proceso que murió a mitad del
 * envío. NO se reintenta (no se sabe si Meta ya lo aceptó, y no-duplicar
 * pesa más que no-perder): la fila pasa a FAILED con el motivo.
 */
export const BARBER_WA_CLAIM_STALE_MS = 10 * 60 * 1000;

export function barberWaClaimMark(now: Date = new Date()): string {
  return `${BARBER_WA_CLAIM_MARK} ${now.toISOString()}`;
}

/** Cuándo se reclamó la fila, o null si `errorMessage` no es un reclamo. */
export function parseBarberWaClaim(errorMessage: string | null | undefined): Date | null {
  if (typeof errorMessage !== "string" || !errorMessage.startsWith(BARBER_WA_CLAIM_MARK)) {
    return null;
  }
  const at = new Date(errorMessage.slice(BARBER_WA_CLAIM_MARK.length).trim());
  // Marca ilegible = reclamo de fecha desconocida: se trata como viejísimo
  // para que no deje una fila atorada para siempre.
  return Number.isNaN(at.getTime()) ? new Date(0) : at;
}

export function isBarberWaClaim(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === "string" && errorMessage.startsWith(BARBER_WA_CLAIM_MARK);
}

export const BARBER_WA_CLAIM_LOST_MESSAGE =
  "El envío se interrumpió a la mitad y no se pudo confirmar si salió. " +
  "No se reintenta solo para no mandarlo dos veces.";

// ── La cola: lo que ya no tiene sentido mandar ──────────────────────────

/** Un "casi es tu turno" de hace más de esto ya no ayuda a nadie. */
export const BARBER_WALKIN_NOTICE_TTL_MS = 30 * 60 * 1000;

export type BarberOutboxKind = "reminder" | "bookingConfirmed" | "walkinTurn" | "other";

/**
 * ¿Esta fila de la cola YA NO debe salir? Devuelve el motivo, o null si se
 * manda.
 *
 * 🔴 La cola puede tardar: el cron se retrasa, el cupo se agota y vuelve con
 * el periodo nuevo, la barbería conecta su número días después. Sin esta
 * regla, lo primero que hace una barbería al conectar es recordarle a sus
 * clientes una cita de la semana pasada.
 *   · recordatorio / confirmación → la visita tiene que seguir viva
 *     (PENDING o CONFIRMED) y no haber empezado;
 *   · aviso de la fila → caduca a los 30 minutos;
 *   · lo demás (texto suelto que alguien encoló) → se manda.
 */
export function barberOutboxStaleReason(args: {
  kind: BarberOutboxKind;
  createdAt: Date;
  now: Date;
  /** null = la visita ya no existe (o la fila nunca tuvo una). */
  appointment: { status: string; startAt: Date } | null;
}): string | null {
  if (args.kind === "walkinTurn") {
    return args.now.getTime() - args.createdAt.getTime() > BARBER_WALKIN_NOTICE_TTL_MS
      ? "el aviso de la fila caducó antes de poder enviarse"
      : null;
  }
  if (args.kind === "reminder" || args.kind === "bookingConfirmed") {
    if (!args.appointment) return "la visita ya no existe";
    const alive = args.appointment.status === "PENDING" || args.appointment.status === "CONFIRMED";
    if (!alive) return "la visita ya no está vigente";
    if (args.appointment.startAt.getTime() <= args.now.getTime()) {
      return "la visita ya empezó o ya pasó";
    }
  }
  return null;
}

/**
 * El aviso de la fila tal como entra en {{2}} de `dc_barber_turno_fila`.
 *
 * El cuerpo que redacta walkInNotifyBody() (agenda.ts) ya nombra a la
 * barbería y a veces cierra con "Te esperamos en la silla." — y la plantilla
 * dice las dos cosas por su cuenta. Mandarlo tal cual entregaba «Aviso de tu
 * turno en El Corte: Luis, ya es tu turno en El Corte. Te esperamos en la
 * silla. Te esperamos en la silla.» Aquí se quita lo repetido; el texto
 * libre (ventana abierta) sigue saliendo completo.
 */
export function walkInTemplateNotice(shopName: string, body: string): string {
  let text = String(body ?? "").replace(/\s+/g, " ").trim();
  const name = String(shopName ?? "").trim();
  if (name) text = text.split(` en ${name}`).join("");
  text = text.replace(/\s*Te esperamos en la silla\.?\s*$/i, "").trim();
  return text || "Ya casi es tu turno.";
}

// ── Notas de voz ────────────────────────────────────────────────────────

/** Lo que se le dice al cliente cuando su audio no se pudo escuchar. */
export const BARBER_WA_VOICE_FAILED_REPLY = "No pude escuchar tu audio, ¿me lo escribes? 🙏";

/** …y cuando es demasiado largo para transcribirlo. */
export const BARBER_WA_VOICE_TOO_LONG_REPLY =
  "Tu audio es un poco largo para mí 🙏. ¿Me lo escribes o me mandas uno de menos de 3 minutos?";

/** Pista de vocabulario para el transcriptor: lo que se le dice a una barbería. */
export const BARBER_WA_VOICE_HINT =
  "Mensaje de voz de un cliente a su barbería en México: cita, agendar, " +
  "reagendar, confirmar, cancelar, mañana, el sábado, corte, barba, fade, " +
  "degradado, delineado, ¿cuánto cuesta?, ¿a qué hora abren?";

/** Prefijos con los que queda en la bandeja un audio YA transcrito. */
export const BARBER_WA_VOICE_BODY_PREFIXES = ["🎤 Nota de voz:", "🎵 Audio:"] as const;

// ── Opciones que se le ofrecen al cliente con botones o lista ───────────

/**
 * Lo que sale por TEXTO cuando Meta rechaza el mensaje con botones: el
 * mismo mensaje con las opciones numeradas, para que el cliente pueda
 * elegir escribiendo.
 */
export function barberWaOptionsAsText(
  body: string,
  options: { title: string; description?: string }[],
): string {
  const lines = options.map(
    (o, i) => `${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ""}`,
  );
  return `${body.trim()}\n\n${lines.join("\n")}`;
}

// ── Baja de promociones ─────────────────────────────────────────────────

/**
 * Llave reservada en BarberClient.preferences con la baja de campañas. Vive
 * aquí (y campaigns.ts la reexporta) porque el EMISOR también tiene que
 * respetarla: la baja se comprueba donde sale el mensaje, no solo donde se
 * arma la lista.
 */
export const BARBER_WA_OPT_OUT_KEY = "__optout" as const;

/** ¿Este cliente pidió no recibir promociones? */
export function barberClientOptedOut(preferences: unknown): boolean {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return false;
  const node = (preferences as Record<string, unknown>)[BARBER_WA_OPT_OUT_KEY];
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const at = (node as Record<string, unknown>).at;
  return typeof at === "string" && at.length > 0;
}

const OPT_OUT_EXACT = ["baja", "stop", "unsubscribe", "darme de baja", "dar de baja", "dame de baja"];
const OPT_OUT_PHRASES = [
  "no quiero promociones",
  "no quiero publicidad",
  "no me manden promociones",
  "no me manden publicidad",
  "no mas promociones",
  "no mas publicidad",
  "ya no me manden mensajes",
  "ya no me escriban",
  "dejen de escribirme",
  "quiero darme de baja",
];

/**
 * ¿El cliente está pidiendo que ya no le manden promociones?
 *
 * Las palabras sueltas ("baja", "stop") solo por igualdad EXACTA: un "me
 * doy de baja de la fila" o un "stop, mejor el jueves" no pueden dar de
 * baja a nadie.
 */
export function isBarberOptOutText(text: string): boolean {
  const t = fold(String(text ?? "")).replace(/[.!¡]+$/g, "").trim();
  if (!t) return false;
  if (OPT_OUT_EXACT.includes(t)) return true;
  return OPT_OUT_PHRASES.some((p) => t.includes(p));
}

/** Lo que se le contesta al cliente que pidió la baja. */
export const BARBER_WA_OPT_OUT_REPLY =
  "Listo, ya no te mandaremos promociones. Los avisos de tus citas te seguirán llegando. 👌";

// ── Respuesta del cliente al recordatorio ───────────────────────────────

/**
 * Qué quiso decir el cliente. `reschedule` existe porque el recordatorio le
 * ofrece las TRES salidas: confirmar, cancelar o cambiar de horario. Sin la
 * tercera, el que quiere moverla escribe "el jueves mejor" y nadie lo lee.
 */
export type BarberWaReply = "confirm" | "cancel" | "reschedule" | "unclear";

// 🔴 SOLO POR IGUALDAD. Hasta la ronda 2 estas listas se buscaban por
// «contiene» («no puedo», «no voy», «cancelar»…), y una frase normal
// cancelaba la cita: «Sí confirmo, no voy a faltar» → CANCELADA («no voy»);
// «voy a llegar 10 min tarde, no puedo salir antes» → CANCELADA;
// «¿puedo cancelar si llueve?» → CANCELADA; «no confirmo todavía» →
// CONFIRMADA. Es el mismo fallo que hizo al dental dejar de leer frases
// («un "no" escrito dentro de una frase ya canceló citas»,
// src/lib/whatsapp/interactivo.ts). Aquí el mensaje tiene que SER una de
// estas respuestas; cualquier otra cosa no decide nada y sigue al bot o a
// la bandeja.
const CONFIRM_EXACT = [
  "1",
  "si",
  "sip",
  "ok",
  "okay",
  "va",
  "vale",
  "claro",
  "de acuerdo",
  "confirmar",
  "confirmo",
  "confirmado",
  "confirmada",
  "confirma",
  "si confirmo",
];
const CANCEL_EXACT = ["2", "cancelar", "cancela", "cancelo", "cancelala", "cancelalo", "cancelarla"];
const RESCHEDULE_EXACT = [
  "3",
  "cambiar",
  "cambio",
  "cambiala",
  "cambiar hora",
  "cambiar horario",
  "reagendar",
  "reagenda",
  "mover",
  "muevela",
];
/** «Sí» a la pregunta «¿Cancelo tu visita…?». */
const YES_EXACT = [
  "si",
  "sip",
  "ok",
  "okay",
  "va",
  "vale",
  "claro",
  "de acuerdo",
  "si cancelar",
  "si cancela",
  "si cancelala",
];
/** «No» a esa misma pregunta. */
const NO_EXACT = ["no", "nel", "nop", "mejor no", "no gracias", "no la canceles", "no cancelar"];

/** Quita acentos y baja a minúsculas para comparar sin sorpresas. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Deja un mensaje listo para compararlo por IGUALDAD: sin acentos, sin
 * mayúsculas y sin signos ni emojis («¡CONFIRMAR!» → «confirmar»,
 * «Sí 👍» → «si»). No quita PALABRAS: «sí confirmo, no voy a faltar» sigue
 * siendo esa frase entera, que no es igual a nada.
 */
export function normalizeBarberReply(text: string): string {
  return fold(String(text ?? ""))
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clasifica la respuesta al recordatorio. PURO y probado sin BD.
 *
 * Devuelve algo distinto de `unclear` SOLO cuando el mensaje ES una de las
 * respuestas que el recordatorio pide (CONFIRMAR / CANCELAR / CAMBIAR, 1 / 2
 * / 3, o un «sí» / «ok» suelto). Que además el recordatorio haya sido lo
 * último que se le dijo lo decide decideBarberReminderReply.
 */
export function classifyBarberReply(text: string): BarberWaReply {
  const t = normalizeBarberReply(text);
  if (!t) return "unclear";
  if (CONFIRM_EXACT.includes(t)) return "confirm";
  if (CANCEL_EXACT.includes(t)) return "cancel";
  if (RESCHEDULE_EXACT.includes(t)) return "reschedule";
  return "unclear";
}

/** ¿El mensaje ES un «sí»? (respuesta a «¿Cancelo tu visita…? Responde SÍ»). */
export function isBarberYesReply(text: string): boolean {
  return YES_EXACT.includes(normalizeBarberReply(text));
}

/** ¿El mensaje ES un «no»? */
export function isBarberNoReply(text: string): boolean {
  return NO_EXACT.includes(normalizeBarberReply(text));
}

// ── Botones del recordatorio y pregunta antes de cancelar ───────────────
//
// Con la ventana de 24 h abierta el recordatorio sale con TRES botones, y
// la pregunta «¿Cancelo tu visita…?» con dos. El id de cada botón lleva la
// acción Y la visita (`rec.cancelar:<id de la visita>`): el toque dice
// exactamente qué hacer y sobre cuál, sin leer texto y sin adivinar cuando
// el teléfono lo comparten dos personas con cita. Los prefijos de los tres
// primeros son los mismos del dental (REC_BOTON en interactivo.ts).

export type BarberReminderAction = "confirm" | "ask-cancel" | "reschedule" | "do-cancel" | "keep";

const REMINDER_BUTTON_PREFIX: Record<BarberReminderAction, string> = {
  confirm: "rec.confirmar",
  reschedule: "rec.reagendar",
  "ask-cancel": "rec.cancelar",
  "do-cancel": "rec.si-cancelar",
  keep: "rec.no-cancelar",
};

export interface BarberWaButton {
  id: string;
  title: string;
}

/** Los tres botones del recordatorio de UNA visita. Títulos ≤ 20 caracteres. */
export function barberReminderButtons(appointmentId: string): BarberWaButton[] {
  return [
    { id: `${REMINDER_BUTTON_PREFIX.confirm}:${appointmentId}`, title: "✅ Confirmar" },
    { id: `${REMINDER_BUTTON_PREFIX.reschedule}:${appointmentId}`, title: "🔁 Cambiar" },
    { id: `${REMINDER_BUTTON_PREFIX["ask-cancel"]}:${appointmentId}`, title: "❌ Cancelar" },
  ];
}

/** Los dos botones de «¿Cancelo tu visita…?». */
export function barberCancelAskButtons(appointmentId: string): BarberWaButton[] {
  return [
    { id: `${REMINDER_BUTTON_PREFIX["do-cancel"]}:${appointmentId}`, title: "Sí, cancelar" },
    { id: `${REMINDER_BUTTON_PREFIX.keep}:${appointmentId}`, title: "No, la conservo" },
  ];
}

/**
 * Qué pide el toque de un botón del recordatorio y sobre qué visita. null si
 * el id no es de estos (un botón del bot, un botón viejo de otra cosa).
 */
export function parseBarberReminderButton(
  id: unknown,
): { action: BarberReminderAction; appointmentId: string } | null {
  if (typeof id !== "string") return null;
  const cut = id.indexOf(":");
  if (cut <= 0 || cut === id.length - 1) return null;
  const prefix = id.slice(0, cut);
  const appointmentId = id.slice(cut + 1);
  for (const action of Object.keys(REMINDER_BUTTON_PREFIX) as BarberReminderAction[]) {
    if (REMINDER_BUTTON_PREFIX[action] === prefix) return { action, appointmentId };
  }
  return null;
}

/**
 * Marca (en `templateName`) de la fila con la pregunta «¿Cancelo tu
 * visita…?». La fila lleva además el `appointmentId` de la visita por la
 * que se preguntó: cuando el cliente contesta «sí», se cancela ESA y no «la
 * primera que tenga recordatorio». No es una plantilla de Meta ni una marca
 * de sistema: es un mensaje real que se ve en la bandeja.
 */
export const BARBER_WA_CANCEL_ASK = "ask:cancelar" as const;

/** ¿`templateName` es una marca interna de conversación y no una plantilla? */
export function isBarberWaAskRow(templateName: string | null | undefined): boolean {
  return typeof templateName === "string" && templateName.startsWith("ask:");
}

/**
 * ¿Qué hacer con una respuesta ESCRITA, según lo último que se le dijo?
 *
 *   · lo último fue la pregunta «¿Cancelo…?»  → «sí» cancela, «no» conserva;
 *   · lo último fue el recordatorio           → la palabra exacta decide
 *     (y CANCELAR no cancela: pregunta);
 *   · lo último fue cualquier otra cosa (el bot preguntó algo, alguien de
 *     la barbería escribió) → null: esta respuesta no es para el
 *     recordatorio, aunque sea un «sí» o un «cancelar».
 */
export function decideBarberReminderReply(
  text: string,
  lastWord: { templateName: string | null } | null,
  reminderTemplate: string,
): BarberReminderAction | null {
  if (!lastWord) return null;
  if (lastWord.templateName === BARBER_WA_CANCEL_ASK) {
    if (isBarberYesReply(text)) return "do-cancel";
    if (isBarberNoReply(text)) return "keep";
    return null;
  }
  if (lastWord.templateName !== reminderTemplate) return null;
  const reply = classifyBarberReply(text);
  if (reply === "confirm") return "confirm";
  if (reply === "cancel") return "ask-cancel";
  if (reply === "reschedule") return "reschedule";
  return null;
}

// ── Solicitudes que la barbería todavía no acepta ───────────────────────

/**
 * Orígenes cuya cita PENDIENTE es una SOLICITUD que la barbería tiene que
 * aceptar o rechazar (pantalla Solicitudes), no una visita por confirmar.
 * La reserva en línea (PUBLIC) y la que agenda el bot (WHATSAPP): con la
 * política manual las dos nacen PENDIENTES y el bot le dice al cliente
 * «falta que la barbería la confirme». Es el ÚNICO criterio: lo usan
 * listBookingRequests() y resolveBookingRequest() en booking.ts, los
 * recordatorios y el «CONFIRMAR» del cliente. Con la automática nacen
 * CONFIRMED y no son solicitudes.
 *
 * Ojo: el tope diario de teléfonos nuevos y la validación de nombre y
 * teléfono son SOLO de la web (`fromWeb` en createPublicBooking); esto no
 * los extiende al bot.
 */
export const BARBER_REQUEST_SOURCES: readonly ("PUBLIC" | "WHATSAPP")[] = ["PUBLIC", "WHATSAPP"];

/**
 * ¿Esta cita es una solicitud que la barbería aún no acepta?
 *
 * 🔴 Con la política por defecto («manual») la reserva en línea nace
 * PENDIENTE hasta que alguien la acepta. A una solicitud así NO se le manda
 * «quedó agendada», NO se le recuerda, y un «CONFIRMAR» del cliente NO la
 * confirma: confirmarla es decisión de la barbería.
 */
export function isBarberUnacceptedRequest(appt: { status: string; source: string }): boolean {
  return appt.status === "PENDING" && (BARBER_REQUEST_SOURCES as readonly string[]).includes(appt.source);
}

/**
 * Lo que se le dice al cliente cuando la barbería RECHAZA su solicitud. Solo
 * sale como texto libre, si el cliente escribió en las últimas 24 h: no hay
 * plantilla para esto (decisión de Rafael, ronda 2).
 */
export function barberBookingRejectedText(args: {
  clientName: string | null | undefined;
  when: string;
  shopName: string;
}): string {
  const first = String(args.clientName ?? "").trim().split(/\s+/)[0];
  return (
    `${first ? `Hola ${first}. ` : ""}` +
    `${args.shopName} no pudo tomar tu solicitud del ${args.when}, así que ese horario NO quedó apartado. ` +
    "Si quieres, dinos qué otro día u hora te queda y lo vemos."
  );
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
