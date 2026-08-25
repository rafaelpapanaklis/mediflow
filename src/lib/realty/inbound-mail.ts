// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — CAPTURA DE PROSPECTOS DESDE EL CORREO DE LOS
// PORTALES (Inmuebles24, Lamudi, Vivanuncios, Mercado Libre, Casas y
// Terrenos, Propiedades.com) + parser genérico de respaldo.
//
// EL PROBLEMA QUE RESUELVE: hoy el aviso del portal cae en un Gmail que
// alguien revisa "cuando puede". Pasados 10 minutos la probabilidad de
// contactar al prospecto cae ~80%, así que ese correo sin leer ES la fuga.
//
// CÓMO FUNCIONA: cada cuenta tiene un buzón único
//   leads+<accountId>@<REALTY_INBOUND_MAIL_DOMAIN>
// que el cliente pone como correo de contacto en su cuenta del portal (o le
// arma una regla de reenvío). El correo entra por este endpoint, se parsea,
// se crea el prospecto, se asigna solo y se deja preparado el saludo por
// WhatsApp que implementará T6.
//
// 🔴 EL CORREO CRUDO SE GUARDA SIEMPRE. Los portales cambian su plantilla
// sin avisar: sin el original no hay forma de arreglar un parser que se
// rompió, y el cliente solo ve que "dejaron de entrar prospectos".
//
// ── DÓNDE SE GUARDA (deuda técnica declarada) ──────────────────────────
// El schema de la Ola 0 no tiene tabla de correos entrantes y esta terminal
// no puede tocar prisma/schema.prisma. El crudo + la llave de idempotencia
// viven en `realty_admin_actions` con action = REALTY_INBOUND_ACTION (la
// única tabla del vertical con accountId + Json libre). Ver la cabecera de
// src/lib/realty/leads.ts: misma decisión, mismas salvaguardas.
//
// ⚠️ IDEMPOTENCIA SIN ÍNDICE ÚNICO: se consulta por payload.messageId antes
// de crear. Eso cubre el caso real (el portal o Postmark reintentan segundos
// o minutos después) pero NO una entrega simultánea exacta. Cuando la tabla
// propia entre al schema, el único va sobre (accountId, messageId).
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  assertAccountId,
  autoAssignLead,
  createLeadWithContact,
  getLeadRoutingConfig,
  logLeadActivity,
  REALTY_RESERVED_ACTIONS,
} from "@/lib/realty/leads";

export const REALTY_INBOUND_ACTION = REALTY_RESERVED_ACTIONS.inboundMail;

// ── El buzón de cada cuenta ─────────────────────────────────────────────

/** Parte antes del "+". Se puede mover por env si el dominio ya la usa. */
export const REALTY_INBOUND_LOCALPART = process.env.REALTY_INBOUND_MAIL_LOCALPART || "leads";
export const REALTY_INBOUND_DOMAIN = process.env.REALTY_INBOUND_MAIL_DOMAIN || "dalecontrol.com";

/** leads+<accountId>@dalecontrol.com — lo que el cliente copia al portal. */
export function realtyInboundAddress(accountId: string): string {
  return `${REALTY_INBOUND_LOCALPART}+${accountId}@${REALTY_INBOUND_DOMAIN}`;
}

/**
 * Saca el accountId del destinatario. Acepta las tres formas en las que
 * llega en la vida real:
 *   · leads+abc123@dalecontrol.com          (sub-dirección estándar)
 *   · "Ventas" <leads+abc123@dominio.com>   (con nombre para mostrar)
 *   · MailboxHash = "abc123"                (lo que manda Postmark ya parseado)
 *
 * 🔴 Cuando el cliente pone una REGLA DE REENVÍO, el To original es el suyo
 * y el buzón aparece en Delivered-To / X-Forwarded-To. Por eso se acepta
 * una lista de destinatarios y se toma el PRIMERO que cuadre.
 */
export function parseRealtyMailbox(
  recipients: (string | null | undefined)[],
  mailboxHash?: string | null,
): string | null {
  const hash = mailboxHash?.trim();
  if (hash && /^[A-Za-z0-9_-]{6,64}$/.test(hash)) return hash;

  const re = new RegExp(
    `${REALTY_INBOUND_LOCALPART}\\+([A-Za-z0-9_-]{6,64})@`,
    "i",
  );
  for (const raw of recipients) {
    if (!raw) continue;
    for (const piece of String(raw).split(/[,;]/)) {
      const m = piece.match(re);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

// ── Forma del correo que recibe el endpoint ─────────────────────────────

/**
 * Correo entrante ya normalizado. Es un SUPERCONJUNTO deliberado del
 * payload de Postmark Inbound (que es el proveedor que el repo ya usa para
 * el dental) para poder apuntarle un stream nuevo sin escribir un adaptador.
 */
export interface RealtyInboundMail {
  messageId: string;
  from: string;
  fromName?: string | null;
  /** Todos los destinatarios conocidos (To, Cc, Delivered-To…). */
  recipients: string[];
  mailboxHash?: string | null;
  subject: string;
  textBody: string;
  htmlBody?: string | null;
  receivedAt?: string | null;
}

// ── Utilidades de texto ─────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => ENTITIES[name] ?? m);
}

/**
 * HTML → texto plano con los saltos de línea en su lugar. No es un parser
 * de HTML: es lo justo para que "Nombre:</td><td>Ana" no quede pegado como
 * "Nombre:Ana" y el regex de la etiqueta siga funcionando.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<\/(td|th)>/gi, "\t")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** El cuerpo legible del correo: texto si viene, si no el HTML aplanado. */
export function mailBody(mail: RealtyInboundMail): string {
  const text = (mail.textBody || "").trim();
  if (text.length > 40) return text.replace(/\r/g, "");
  if (mail.htmlBody) return htmlToText(mail.htmlBody);
  return text;
}

/** Dominio del remitente, en minúsculas. */
export function senderDomain(from: string): string {
  const m = String(from).match(/@([A-Za-z0-9.-]+)/);
  return (m?.[1] ?? "").toLowerCase();
}

/**
 * Valor de un campo etiquetado ("Teléfono: 33 1234 5678"). Acepta el valor
 * en la MISMA línea o en la SIGUIENTE, porque las plantillas de tabla de
 * los portales parten la etiqueta y el dato en dos celdas (htmlToText deja
 * un tabulador entre ellas).
 *
 * DOS DETALLES QUE PARECEN MENUDENCIAS Y NO LO SON:
 *
 * 1. Las etiquetas se ordenan de MÁS LARGA A MÁS CORTA. La alternancia de
 *    un regex se queda con la PRIMERA que cuadra, así que con "Código"
 *    antes que "Código del aviso", la línea "Código del aviso: INM-7K3Q"
 *    devolvía "del aviso: INM-7K3Q" — basura que además rompía el ligado
 *    con el inmueble.
 *
 * 2. El separador (":" o tabulador) es OBLIGATORIO y el valor puede venir
 *    VACÍO. Con el separador opcional, la línea "Nombre:" hacía que `(.+)`
 *    se comiera los propios dos puntos y el prospecto se llamaba ":" en vez
 *    de caer a la línea siguiente, que es donde estaba el nombre.
 */
export function labeledValue(body: string, labels: string[]): string | null {
  const lines = body.split("\n");
  const alt = Array.from(new Set(labels))
    .sort((a, b) => b.length - a.length)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const inline = new RegExp(`(?:^|\\s)(?:${alt})\\s*(?:[:：]|\\t)\\s*(.*)$`, "i");
  const startsWithLabel = new RegExp(`^(?:${alt})\\s*(?:[:：]|\\t)`, "i");

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(inline);
    if (!m) continue;
    const value = m[1].replace(/\t+/g, " ").trim();
    if (value) return value;
    // Etiqueta sola: el dato viene en la línea siguiente, salvo que esa
    // línea sea OTRA etiqueta (una tabla con la columna de datos vacía).
    const next = lines[i + 1]?.trim();
    if (next && !startsWithLabel.test(next)) return next;
  }
  return null;
}

const PHONE_RE = /(?:\+?52[\s-]?1?[\s-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Primer teléfono mexicano válido (10 dígitos ya normalizados). */
export function findPhone(body: string): string | null {
  const matches = body.match(PHONE_RE) ?? [];
  for (const raw of matches) {
    const ten = mxTenDigits(raw);
    if (ten) return ten;
  }
  return null;
}

/**
 * Primer correo que NO sea del propio portal ni una dirección de sistema.
 * Sin este filtro el "correo del prospecto" acaba siendo
 * noreply@inmuebles24.com en todos los leads.
 */
export function findEmail(body: string, excludeDomains: string[]): string | null {
  const matches = body.match(EMAIL_RE) ?? [];
  const banned = ["noreply", "no-reply", "notificaciones", "notification", "mailer", "postmaster"];
  for (const raw of matches) {
    const email = raw.toLowerCase();
    const domain = email.split("@")[1] ?? "";
    const local = email.split("@")[0] ?? "";
    if (excludeDomains.some((d) => domain.endsWith(d))) continue;
    if (banned.some((b) => local.includes(b))) continue;
    if (domain.endsWith(REALTY_INBOUND_DOMAIN)) continue;
    return email;
  }
  return null;
}

// ── Parsers por portal ──────────────────────────────────────────────────

export interface RealtyParsedLead {
  /** Slug del portal ("inmuebles24") o "generico". */
  portal: string;
  portalLabel: string;
  name: string | null;
  /** 10 dígitos ya normalizados (mxTenDigits). */
  phone: string | null;
  email: string | null;
  message: string | null;
  /** Clave/folio del anuncio EN EL PORTAL, tal cual lo manda. */
  propertyRef: string | null;
  /** Título del anuncio, si el correo lo trae. */
  propertyTitle: string | null;
  /** Qué tan seguro está el parser de lo que sacó. */
  confidence: "ALTA" | "MEDIA" | "BAJA";
  /** Campos que SÍ salieron, para depurar un parser que se rompió. */
  fields: string[];
}

interface PortalParser {
  slug: string;
  label: string;
  domains: string[];
  /** Pistas en asunto/cuerpo cuando el correo viene reenviado y el
   *  remitente ya no es el del portal. */
  hints: RegExp[];
  nameLabels: string[];
  phoneLabels: string[];
  emailLabels: string[];
  messageLabels: string[];
  refLabels: string[];
  titleLabels: string[];
}

const COMMON_NAME = ["Nombre", "Nombre completo", "Nombre del interesado", "Interesado", "Contacto"];
const COMMON_PHONE = ["Tel", "Tel.", "Teléfono", "Telefono", "Celular", "WhatsApp", "Whatsapp", "Móvil", "Movil"];
const COMMON_EMAIL = ["Correo", "Correo electrónico", "Correo electronico", "E-mail", "Email", "Mail"];
const COMMON_MESSAGE = ["Mensaje", "Consulta", "Comentario", "Comentarios", "Pregunta", "Solicitud"];
const COMMON_REF = [
  "Clave",
  "Clave del inmueble",
  "Código",
  "Codigo",
  "ID",
  "ID del aviso",
  "ID de la publicación",
  "Folio",
  "Referencia",
  "Número de publicación",
  "Numero de publicacion",
];
const COMMON_TITLE = ["Propiedad", "Inmueble", "Aviso", "Publicación", "Publicacion", "Anuncio", "Título", "Titulo"];

/**
 * Los seis portales mexicanos que concentran el tráfico. Las etiquetas de
 * cada uno se agregan a las comunes: cuando un portal cambia su plantilla,
 * el parser común lo sigue sosteniendo y el crudo guardado permite ajustar
 * la etiqueta específica sin adivinar.
 */
export const REALTY_PORTAL_PARSERS: PortalParser[] = [
  {
    slug: "inmuebles24",
    label: "Inmuebles24",
    domains: ["inmuebles24.com", "navent.com", "mail.inmuebles24.com"],
    hints: [/inmuebles\s*24/i],
    nameLabels: [...COMMON_NAME, "Nombre y apellido"],
    phoneLabels: [...COMMON_PHONE],
    emailLabels: [...COMMON_EMAIL],
    messageLabels: [...COMMON_MESSAGE, "Consulta del usuario"],
    refLabels: [...COMMON_REF, "Código del aviso", "Codigo del aviso"],
    titleLabels: [...COMMON_TITLE, "Aviso consultado"],
  },
  {
    slug: "lamudi",
    label: "Lamudi",
    domains: ["lamudi.com.mx", "lamudi.com", "lamudi.mx"],
    hints: [/lamudi/i],
    nameLabels: [...COMMON_NAME],
    phoneLabels: [...COMMON_PHONE],
    emailLabels: [...COMMON_EMAIL],
    messageLabels: [...COMMON_MESSAGE],
    refLabels: [...COMMON_REF, "Referencia de la propiedad"],
    titleLabels: [...COMMON_TITLE],
  },
  {
    slug: "vivanuncios",
    label: "Vivanuncios",
    domains: ["vivanuncios.com.mx", "vivanuncios.com", "ebayclassifiedsgroup.com"],
    hints: [/vivanuncios/i],
    nameLabels: [...COMMON_NAME],
    phoneLabels: [...COMMON_PHONE],
    emailLabels: [...COMMON_EMAIL],
    messageLabels: [...COMMON_MESSAGE],
    refLabels: [...COMMON_REF, "Id del anuncio"],
    titleLabels: [...COMMON_TITLE],
  },
  {
    slug: "mercadolibre",
    label: "Mercado Libre",
    domains: ["mercadolibre.com.mx", "mercadolibre.com", "mercadolibre.cl"],
    hints: [/mercado\s*libre/i],
    nameLabels: [...COMMON_NAME, "Comprador"],
    phoneLabels: [...COMMON_PHONE],
    emailLabels: [...COMMON_EMAIL],
    messageLabels: [...COMMON_MESSAGE, "Preguntó"],
    refLabels: [...COMMON_REF, "MLM", "Publicación"],
    titleLabels: [...COMMON_TITLE, "Producto"],
  },
  {
    slug: "casasyterrenos",
    label: "Casas y Terrenos",
    domains: ["casasyterrenos.com", "casasyterrenos.com.mx"],
    hints: [/casas\s*y\s*terrenos/i],
    nameLabels: [...COMMON_NAME],
    phoneLabels: [...COMMON_PHONE],
    emailLabels: [...COMMON_EMAIL],
    messageLabels: [...COMMON_MESSAGE],
    refLabels: [...COMMON_REF, "Clave CyT"],
    titleLabels: [...COMMON_TITLE],
  },
  {
    slug: "propiedades",
    label: "Propiedades.com",
    domains: ["propiedades.com", "propiedades.com.mx"],
    hints: [/propiedades\.com/i],
    nameLabels: [...COMMON_NAME],
    phoneLabels: [...COMMON_PHONE],
    emailLabels: [...COMMON_EMAIL],
    messageLabels: [...COMMON_MESSAGE],
    refLabels: [...COMMON_REF],
    titleLabels: [...COMMON_TITLE],
  },
];

const GENERIC_PARSER: PortalParser = {
  slug: "generico",
  label: "Otro portal o formulario",
  domains: [],
  hints: [],
  nameLabels: COMMON_NAME,
  phoneLabels: COMMON_PHONE,
  emailLabels: COMMON_EMAIL,
  messageLabels: COMMON_MESSAGE,
  refLabels: COMMON_REF,
  titleLabels: COMMON_TITLE,
};

/** Portales que la pantalla de configuración le enseña al cliente. */
export const REALTY_PORTAL_CATALOG = REALTY_PORTAL_PARSERS.map((p) => ({
  slug: p.slug,
  label: p.label,
  domain: p.domains[0],
}));

/** Qué portal mandó el correo. Primero el dominio; si viene reenviado, las
 *  pistas del asunto/cuerpo. */
export function detectPortal(mail: RealtyInboundMail, body: string): PortalParser {
  const domain = senderDomain(mail.from);
  if (domain) {
    const byDomain = REALTY_PORTAL_PARSERS.find((p) => p.domains.some((d) => domain.endsWith(d)));
    if (byDomain) return byDomain;
  }
  const haystack = `${mail.subject}\n${body.slice(0, 2000)}`;
  const byHint = REALTY_PORTAL_PARSERS.find((p) => p.hints.some((re) => re.test(haystack)));
  return byHint ?? GENERIC_PARSER;
}

/** Limpia lo que un valor etiquetado suele arrastrar (etiqueta siguiente,
 *  guiones de tabla, "haz clic aquí"). */
function cleanValue(v: string | null): string | null {
  if (!v) return null;
  const out = v
    .replace(/\s*\|\s*.*$/, "")
    .replace(/^[-–—:\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!out || out.length > 300) return out ? out.slice(0, 300) : null;
  if (/^(ver|haz clic|click|responder|contestar)\b/i.test(out)) return null;
  return out;
}

/**
 * Parsea un correo entrante a prospecto.
 *
 * NUNCA devuelve null: el respaldo genérico saca al menos nombre, teléfono
 * y el texto. Un correo que no se pudo leer entra igual como prospecto con
 * el cuerpo en la bitácora — es preferible un prospecto incompleto que
 * alguien revisa a un correo perdido que nadie ve.
 */
export function parseInboundLead(mail: RealtyInboundMail): RealtyParsedLead {
  const body = mailBody(mail);
  const parser = detectPortal(mail, body);
  const fields: string[] = [];

  let name = cleanValue(labeledValue(body, parser.nameLabels));
  if (name) fields.push("name");
  else if (mail.fromName && !/portal|noreply|no-reply|notifica/i.test(mail.fromName)) {
    name = mail.fromName.trim();
    if (name) fields.push("name:from");
  }

  const phoneRaw = labeledValue(body, parser.phoneLabels);
  let phone = mxTenDigits(phoneRaw ?? "");
  if (phone) fields.push("phone");
  else {
    phone = findPhone(body);
    if (phone) fields.push("phone:scan");
  }

  const emailRaw = cleanValue(labeledValue(body, parser.emailLabels));
  const excluded = [...parser.domains, senderDomain(mail.from)].filter(Boolean);
  // Un solo .match() y nada de .test(): EMAIL_RE es global, y un .test()
  // deja `lastIndex` avanzado, así que la siguiente comprobación arrancaría
  // a media cadena y fallaría sin razón. `String.match` con /g no arrastra
  // ese estado.
  let email = emailRaw ? (emailRaw.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null) : null;
  if (email) fields.push("email");
  else {
    email = findEmail(body, excluded);
    if (email) fields.push("email:scan");
  }

  const message = cleanValue(labeledValue(body, parser.messageLabels));
  if (message) fields.push("message");

  const propertyRef = cleanValue(labeledValue(body, parser.refLabels));
  if (propertyRef) fields.push("ref");

  const propertyTitle = cleanValue(labeledValue(body, parser.titleLabels));
  if (propertyTitle) fields.push("title");

  const strong = [name, phone].filter(Boolean).length;
  const confidence: RealtyParsedLead["confidence"] =
    parser.slug !== "generico" && strong === 2 ? "ALTA" : strong >= 1 ? "MEDIA" : "BAJA";

  return {
    portal: parser.slug,
    portalLabel: parser.label,
    name,
    phone,
    email,
    // Si no hubo etiqueta de mensaje, se guarda el cuerpo recortado: es lo
    // que el asesor va a leer antes de marcar.
    message: message ?? (body ? body.slice(0, 1500) : null),
    propertyRef,
    propertyTitle,
    confidence,
    fields,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STUB DE WHATSAPP — LO IMPLEMENTA T6
// ═══════════════════════════════════════════════════════════════════════

/**
 * Todo lo que T6 necesita para mandar el saludo automático. Se pasa COMPLETO
 * a propósito: así el emisor no tiene que volver a consultar la base para
 * armar la plantilla.
 */
export interface RealtyLeadWhatsappTrigger {
  accountId: string;
  leadId: string;
  contactId: string;
  /** 10 dígitos ya normalizados. null = el prospecto llegó sin teléfono. */
  phone: string | null;
  contactName: string;
  /** "portal:inmuebles24" | "web" | "match" … */
  source: string;
  propertyId: string | null;
  propertyTitle: string | null;
  /** Qué disparó el envío. */
  reason: "INBOUND_LEAD" | "MATCH_NUEVA_PROPIEDAD";
  /** Asesor asignado al momento del disparo (la plantilla lo nombra). */
  assignedUserId: string | null;
  assignedUserName: string | null;
}

export interface RealtyLeadWhatsappResult {
  sent: boolean;
  /** Por qué NO se mandó. Se escribe en la bitácora tal cual. */
  skippedReason?:
    | "NO_IMPLEMENTADO"
    | "SIN_TELEFONO"
    | "SIN_WHATSAPP"
    | "SIN_CUPO"
    | "OPT_OUT"
    | "ERROR";
  /** wamid de Meta cuando sí salió. */
  externalId?: string;
}

/** Firma EXACTA que T6 tiene que cumplir. */
export type RealtyLeadWhatsappNotifier = (
  trigger: RealtyLeadWhatsappTrigger,
) => Promise<RealtyLeadWhatsappResult>;

let notifierOverride: RealtyLeadWhatsappNotifier | null = null;

/**
 * PUNTO DE ENTRADA PARA T6 — dos formas, las dos válidas:
 *
 *   a) Registrar el emisor desde el módulo de WhatsApp del vertical:
 *        setRealtyLeadWhatsappNotifier(sendRealtyLeadWhatsapp)
 *      (hay que llamarlo en cada arranque del runtime; en serverless eso
 *      significa hacerlo al importar el módulo que usa el webhook).
 *
 *   b) Reemplazar el cuerpo de notifyLeadByWhatsapp más abajo por la llamada
 *      real. Es un cambio de tres líneas DENTRO de este archivo.
 *
 * En los dos casos la firma es RealtyLeadWhatsappNotifier y NO hay que tocar
 * nada más del CRM: quien dispara ya deja la bitácora y el resultado.
 */
export function setRealtyLeadWhatsappNotifier(fn: RealtyLeadWhatsappNotifier | null): void {
  notifierOverride = fn;
}

/**
 * Dispara el saludo automático. HOY es un stub honesto: devuelve
 * NO_IMPLEMENTADO y no inventa que mandó nada.
 *
 * 🔴 No lanza NUNCA. Un fallo del aviso no puede tumbar la creación del
 * prospecto: perder el mensaje es malo, perder el prospecto es peor.
 */
export async function notifyLeadByWhatsapp(
  trigger: RealtyLeadWhatsappTrigger,
): Promise<RealtyLeadWhatsappResult> {
  if (!trigger.phone) return { sent: false, skippedReason: "SIN_TELEFONO" };
  try {
    // Un emisor registrado a mano (pruebas) manda sobre el de serie.
    if (notifierOverride) return await notifierOverride(trigger);
    // ── T6: CONECTADO (opción (b) de las dos que dejó escritas T3) ────
    // Se eligió ésta y no setRealtyLeadWhatsappNotifier porque en serverless
    // la opción (a) depende de que ALGUIEN haya importado el módulo de
    // WhatsApp antes de crear el prospecto — y la ruta que da de alta un
    // lead no tiene por qué haberlo hecho. Ahí el saludo se perdía en
    // silencio. El import es DINÁMICO para no crear un ciclo con leads.ts.
    const { sendRealtyLeadWhatsapp } = await import("@/lib/realty/whatsapp");
    return await sendRealtyLeadWhatsapp(trigger);
  } catch {
    return { sent: false, skippedReason: "ERROR" };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// INGESTA
// ═══════════════════════════════════════════════════════════════════════

export type RealtyIngestStatus =
  | "CREADO"
  | "DUPLICADO"
  | "CUENTA_NO_ENCONTRADA"
  | "BUZON_INVALIDO"
  | "CUENTA_INACTIVA";

export interface RealtyIngestResult {
  status: RealtyIngestStatus;
  accountId: string | null;
  leadId: string | null;
  contactId: string | null;
  portal: string | null;
  assignedUserId: string | null;
  propertyId: string | null;
  /** true = se reconoció el anuncio y quedó ligado al inmueble. */
  propertyLinked: boolean;
  whatsapp: RealtyLeadWhatsappResult | null;
  parsed: RealtyParsedLead | null;
}

/** Tope del crudo que se guarda. Un correo de portal ronda los 20-60 KB de
 *  HTML; con esto alcanza para depurar sin inflar la tabla. */
const RAW_CAP = 12_000;

function rawSnapshot(mail: RealtyInboundMail) {
  return {
    from: mail.from.slice(0, 320),
    fromName: mail.fromName?.slice(0, 200) ?? null,
    recipients: mail.recipients.slice(0, 10).map((r) => r.slice(0, 320)),
    subject: mail.subject.slice(0, 500),
    receivedAt: mail.receivedAt ?? null,
    textBody: (mail.textBody || "").slice(0, RAW_CAP),
    htmlBody: mail.htmlBody ? mail.htmlBody.slice(0, RAW_CAP) : null,
    truncated:
      (mail.textBody || "").length > RAW_CAP || (mail.htmlBody?.length ?? 0) > RAW_CAP,
  };
}

/**
 * ¿Ya se procesó este correo? Consulta por payload.messageId (filtro Json
 * nativo de Postgres). Ver la advertencia de la cabecera sobre la carrera.
 */
export async function findProcessedMail(
  accountId: string,
  messageId: string,
): Promise<{ id: string; payload: Prisma.JsonValue } | null> {
  assertAccountId(accountId);
  const row = await prisma.realtyAdminAction.findFirst({
    where: {
      accountId,
      action: REALTY_INBOUND_ACTION,
      payload: { path: ["messageId"], equals: messageId },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true },
  });
  return row;
}

/**
 * Intenta reconocer el inmueble del que hablaba el anuncio.
 *
 * Se prueba en orden de CERTEZA y nunca por parecido vago: ligar el
 * prospecto al inmueble equivocado es peor que dejarlo pendiente de ligar,
 * porque el asesor le habla de una casa que no es.
 *   1. folio corto del vertical (INM-7K3Q) — exacto
 *   2. id o slug público — exacto
 *   3. título idéntico (sin distinguir mayúsculas) — exacto
 * Un `contains` suelto sobre el título queda FUERA a propósito.
 */
export async function linkProperty(
  accountId: string,
  parsed: RealtyParsedLead,
): Promise<string | null> {
  assertAccountId(accountId);
  const ref = parsed.propertyRef?.trim();
  if (ref) {
    const byFolio = await prisma.realtyProperty.findFirst({
      where: {
        accountId,
        OR: [
          { shortTermFolio: { equals: ref, mode: "insensitive" } },
          { publicUrlSlug: { equals: ref, mode: "insensitive" } },
          { id: ref },
        ],
      },
      select: { id: true },
    });
    if (byFolio) return byFolio.id;
  }
  const title = parsed.propertyTitle?.trim();
  if (title && title.length >= 8) {
    const byTitle = await prisma.realtyProperty.findFirst({
      where: { accountId, title: { equals: title, mode: "insensitive" } },
      select: { id: true },
    });
    if (byTitle) return byTitle.id;
  }
  return null;
}

/**
 * Procesa un correo entrante de punta a punta. Idempotente por messageId.
 *
 * ORDEN A PROPÓSITO: el crudo se guarda ANTES de crear nada. Si el alta
 * revienta a la mitad, el correo YA está guardado y se puede reprocesar; al
 * revés, se perdería sin dejar rastro.
 */
export async function ingestInboundMail(mail: RealtyInboundMail): Promise<RealtyIngestResult> {
  const empty: RealtyIngestResult = {
    status: "BUZON_INVALIDO",
    accountId: null,
    leadId: null,
    contactId: null,
    portal: null,
    assignedUserId: null,
    propertyId: null,
    propertyLinked: false,
    whatsapp: null,
    parsed: null,
  };

  const accountId = parseRealtyMailbox(mail.recipients, mail.mailboxHash);
  if (!accountId) return empty;

  const account = await prisma.realtyAccount.findUnique({
    where: { id: accountId },
    select: { id: true, isActive: true, timezone: true },
  });
  if (!account) return { ...empty, status: "CUENTA_NO_ENCONTRADA", accountId };
  if (!account.isActive) return { ...empty, status: "CUENTA_INACTIVA", accountId };

  // ── Idempotencia ──
  const already = await findProcessedMail(account.id, mail.messageId);
  if (already) {
    const p = (already.payload ?? {}) as Record<string, unknown>;
    return {
      status: "DUPLICADO",
      accountId: account.id,
      leadId: typeof p.leadId === "string" ? p.leadId : null,
      contactId: typeof p.contactId === "string" ? p.contactId : null,
      portal: typeof p.portal === "string" ? p.portal : null,
      assignedUserId: null,
      propertyId: typeof p.propertyId === "string" ? p.propertyId : null,
      propertyLinked: Boolean(p.propertyId),
      whatsapp: null,
      parsed: null,
    };
  }

  const parsed = parseInboundLead(mail);

  // ── El crudo, PRIMERO ──
  const record = await prisma.realtyAdminAction.create({
    data: {
      accountId: account.id,
      adminUserId: null,
      action: REALTY_INBOUND_ACTION,
      payload: {
        messageId: mail.messageId,
        status: "RECIBIDO",
        portal: parsed.portal,
        confidence: parsed.confidence,
        fields: parsed.fields,
        raw: rawSnapshot(mail),
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  const propertyId = await linkProperty(account.id, parsed);

  const { leadId, contactId } = await createLeadWithContact(
    account.id,
    {
      name: parsed.name ?? "Prospecto de portal",
      phone: parsed.phone,
      email: parsed.email,
      source: `portal:${parsed.portal}`,
      portal: parsed.portal,
      propertyId,
      note: [
        `Entró por ${parsed.portalLabel}.`,
        parsed.propertyRef ? `Anuncio: ${parsed.propertyRef}` : null,
        !propertyId && (parsed.propertyRef || parsed.propertyTitle)
          ? "⚠️ No se pudo ligar al inmueble: revísalo a mano."
          : null,
        parsed.message ? `\n${parsed.message}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
    null,
  );

  // ── Asignación automática ──
  const config = await getLeadRoutingConfig(account.id);
  const property = propertyId
    ? await prisma.realtyProperty.findFirst({
        where: { id: propertyId, accountId: account.id },
        select: { title: true, colonia: true, city: true },
      })
    : null;
  const pick = await autoAssignLead(
    account.id,
    leadId,
    { zones: [property?.colonia ?? "", property?.city ?? ""].filter(Boolean) },
    { timeZone: account.timezone, config },
  );

  // ── Saludo por WhatsApp (lo implementa T6) ──
  const assignedName = pick.userId
    ? await prisma.realtyUser
        .findUnique({ where: { id: pick.userId }, select: { firstName: true, lastName: true } })
        .then((u) => (u ? `${u.firstName} ${u.lastName}`.trim() : null))
    : null;

  const whatsapp = await notifyLeadByWhatsapp({
    accountId: account.id,
    leadId,
    contactId,
    phone: parsed.phone,
    contactName: parsed.name ?? "Prospecto de portal",
    source: `portal:${parsed.portal}`,
    propertyId,
    propertyTitle: property?.title ?? parsed.propertyTitle,
    reason: "INBOUND_LEAD",
    assignedUserId: pick.userId,
    assignedUserName: assignedName,
  });
  if (whatsapp.sent) {
    await logLeadActivity(account.id, leadId, "WHATSAPP", "Saludo automático enviado", null);
  }

  await prisma.realtyAdminAction.update({
    where: { id: record.id },
    data: {
      payload: {
        messageId: mail.messageId,
        status: "CREADO",
        portal: parsed.portal,
        confidence: parsed.confidence,
        fields: parsed.fields,
        leadId,
        contactId,
        propertyId,
        assignedUserId: pick.userId,
        whatsapp: whatsapp.sent ? "SENT" : (whatsapp.skippedReason ?? "SKIPPED"),
        raw: rawSnapshot(mail),
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    status: "CREADO",
    accountId: account.id,
    leadId,
    contactId,
    portal: parsed.portal,
    assignedUserId: pick.userId,
    propertyId,
    propertyLinked: Boolean(propertyId),
    whatsapp,
    parsed,
  };
}

/** Últimos correos recibidos, para la pantalla de configuración (depuración
 *  de un parser que falló). */
export async function listInboundMailLog(
  accountId: string,
  limit = 20,
): Promise<
  {
    id: string;
    receivedAt: string;
    subject: string;
    from: string;
    portal: string | null;
    status: string;
    confidence: string | null;
    leadId: string | null;
    truncated: boolean;
  }[]
> {
  // El guard NO es decorativo aquí: esta consulta devuelve el CRUDO de los
  // correos —nombre, teléfono y correo de los prospectos— y un accountId
  // vacío borraría el filtro y los serviría de todas las cuentas.
  assertAccountId(accountId);
  const rows = await prisma.realtyAdminAction.findMany({
    where: { accountId, action: REALTY_INBOUND_ACTION },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, createdAt: true, payload: true },
  });
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const raw = (p.raw ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      receivedAt: r.createdAt.toISOString(),
      subject: typeof raw.subject === "string" ? raw.subject : "(sin asunto)",
      from: typeof raw.from === "string" ? raw.from : "",
      portal: typeof p.portal === "string" ? p.portal : null,
      status: typeof p.status === "string" ? p.status : "RECIBIDO",
      confidence: typeof p.confidence === "string" ? p.confidence : null,
      leadId: typeof p.leadId === "string" ? p.leadId : null,
      truncated: raw.truncated === true,
    };
  });
}

// ── Verificación del webhook ────────────────────────────────────────────

/**
 * Secret compartido del endpoint. Cascadea REALTY_INBOUND_SECRET →
 * POSTMARK_INBOUND_SECRET para poder reutilizar el stream que el repo ya
 * tiene configurado, sin obligar a dar de alta una variable nueva.
 */
export function inboundSecret(): string | null {
  return process.env.REALTY_INBOUND_SECRET || process.env.POSTMARK_INBOUND_SECRET || null;
}

/**
 * Compara el header Authorization contra el secret.
 *
 * SIN secret configurado: en desarrollo pasa (para poder probar con curl),
 * en PRODUCCIÓN no — el endpoint responde 503 y lo dice. Un webhook abierto
 * deja que cualquiera inyecte prospectos falsos en la cuenta que quiera.
 */
export function verifyInboundSecret(authHeader: string | null): boolean {
  const expected = inboundSecret();
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+|^Basic\s+/i, "").trim();
  if (token.length !== expected.length) return false;
  // Comparación de tiempo constante a mano: son dos cadenas cortas y no
  // vale la pena arrastrar node:crypto a un módulo que también se importa
  // desde la ruta de configuración.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
