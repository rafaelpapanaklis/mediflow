/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — la tarjeta de estrellas llega SOLA tras el cobro
 * (ws6-t1, 16-nov-2026; Rafael: «muy fácil de acceder y usar»).
 *
 * Parte PURA (sin base, sin Next): el texto del mensaje, sus variables para
 * la plantilla, la marca que lo hace «una vez por ticket» y la decisión de
 * si sale solo o se queda el botón manual en Caja.
 *
 *   «Hola Luis, gracias por tu visita. ⭐ Llevas 4 de 6 estrellas en tu
 *    tarjeta. Ve tu tarjeta aquí: <enlace>»
 *
 * Reglas:
 *   · solo si la barbería tiene WhatsApp conectado y el interruptor de
 *     Configuración está encendido (por defecto, sí);
 *   · solo si el ticket tiene cliente con la tarjeta de estrellas encendida
 *     y un celular de 10 dígitos; nunca a quien pidió la baja;
 *   · UNA vez por ticket: la fila de la cola lleva la marca
 *     `auto:tarjeta:<ticket>` y no se encola otra con la misma;
 *   · con la ventana de 24 h abierta sale como texto; fuera de ella, con la
 *     plantilla UTILITY `dc_barber_tarjeta_estrellas` (whatsapp-core). Sin
 *     plantilla aprobada no sale nada y Caja ofrece «Mandar su tarjeta».
 * ═══════════════════════════════════════════════════════════════════════
 */
import { mxTenDigits } from "@/lib/phone-mx";
import { barberWaMeHref } from "@/lib/barber/wa-chat-core";
import { BARBER_STARS_CARD_TTL_MS } from "@/lib/barber/whatsapp-core";

/** Prefijo de la marca en barber_messages.templateName (no empieza por `sys:`: SÍ es un mensaje). */
export const STARS_CARD_MARK_PREFIX = "auto:tarjeta:" as const;

/** Nombre EXACTO de la plantilla en Meta (vive en el catálogo de whatsapp-core). */
export const STARS_CARD_TEMPLATE_NAME = "dc_barber_tarjeta_estrellas" as const;

/** Por defecto el envío está ENCENDIDO (decisión de Rafael, 16-nov). */
export const STARS_CARD_AFTER_CHARGE_DEFAULT = true;

/**
 * Pasado esto, una fila que no salió ya no se manda: «llevas 4 de 6» de un
 * corte de anteayer confunde más de lo que ayuda.
 */
export const STARS_CARD_TTL_MS = BARBER_STARS_CARD_TTL_MS;

export const SQL_TARJETA_COBRO = "sql/barber_tarjeta_cobro.sql";

export function starsCardMark(saleId: string): string {
  return `${STARS_CARD_MARK_PREFIX}${saleId}`;
}

export function isStarsCardRow(templateName: string | null | undefined): boolean {
  return typeof templateName === "string" && templateName.startsWith(STARS_CARD_MARK_PREFIX);
}

/** El ticket de la marca, o null si no es una fila de la tarjeta. */
export function saleIdOfStarsCardRow(templateName: string | null | undefined): string | null {
  if (!isStarsCardRow(templateName)) return null;
  const id = String(templateName).slice(STARS_CARD_MARK_PREFIX.length).trim();
  return id || null;
}

export interface StarsCardMessage {
  firstName: string;
  stars: number;
  /** Estrellas del siguiente bono (si ya no hay meta, las que lleva). */
  total: number;
  /** Enlace ABSOLUTO a /b/<slug>/tarjeta/<token> (el slug ya dice de qué barbería es). */
  url: string;
}

/** ¿Este cobro movió la tarjeta? (ganó una estrella o usó un bono). */
export function starsCardChargeMoves(o: { gained: number; used: unknown } | null | undefined): boolean {
  return !!o && (o.gained > 0 || !!o.used);
}

/** «de cuántas»: las del siguiente bono; sin bono pendiente, las que lleva. */
export function starsCardTotal(stars: number, next: { cost: number } | null | undefined): number {
  const s = Math.max(0, Math.trunc(stars) || 0);
  const goal = next && Number.isFinite(next.cost) ? Math.trunc(next.cost) : 0;
  return goal > 0 ? goal : Math.max(s, 1);
}

/**
 * Variables de la plantilla, en el orden del catálogo:
 * [cliente, estrellas, total, enlace] (las cuatro que pidió Rafael).
 */
export function starsCardParams(m: StarsCardMessage): string[] {
  return [
    m.firstName.trim() || "cliente",
    String(Math.max(0, Math.trunc(m.stars) || 0)),
    String(Math.max(1, Math.trunc(m.total) || 1)),
    m.url,
  ];
}

/** El texto (ventana abierta y botón manual). Mismas palabras que la plantilla. */
export function renderStarsCardText(params: string[]): string {
  const [nombre, estrellas, total, url] = params;
  return (
    `Hola ${nombre}, gracias por tu visita. ⭐ Llevas ${estrellas} de ${total} estrellas ` +
    `en tu tarjeta.\n\nVe tu tarjeta aquí: ${url}\n\nGuárdala para ver tus premios.`
  );
}

/** El origen (https://dominio) del primer enlace del texto, o null. */
export function originOfFirstLink(text: string | null | undefined): string | null {
  const m = /https?:\/\/[^\s]+/.exec(String(text ?? ""));
  if (!m) return null;
  try {
    return new URL(m[0]).origin;
  } catch {
    return null;
  }
}

/** El enlace absoluto de la tarjeta. */
export function absoluteCardUrl(origin: string, cardPath: string): string {
  return `${origin.replace(/\/+$/, "")}${cardPath.startsWith("/") ? "" : "/"}${cardPath}`;
}

// ── ¿Sale solo, o se queda el botón manual? ─────────────────────────────

export type StarsCardSkip =
  | "off" // el interruptor de Configuración está apagado
  | "noStars" // el ticket no tiene cliente o la tarjeta de estrellas está apagada
  | "noPhone" // el cliente no tiene un celular de 10 dígitos
  | "optedOut" // el cliente pidió que no le escribieran
  | "notConnected" // la barbería no tiene WhatsApp conectado
  | "already"; // este ticket ya mandó (o encoló) su tarjeta

export interface StarsCardDecisionInput {
  enabled: boolean;
  hasStars: boolean;
  phone: string | null | undefined;
  optedOut: boolean;
  connected: boolean;
  alreadyQueued: boolean;
}

export function decideStarsCardSend(i: StarsCardDecisionInput): { send: true; phone: string } | { send: false; skip: StarsCardSkip } {
  if (!i.hasStars) return { send: false, skip: "noStars" };
  if (!i.enabled) return { send: false, skip: "off" };
  const phone = mxTenDigits(i.phone ?? "");
  if (!phone) return { send: false, skip: "noPhone" };
  if (i.optedOut) return { send: false, skip: "optedOut" };
  if (!i.connected) return { send: false, skip: "notConnected" };
  if (i.alreadyQueued) return { send: false, skip: "already" };
  return { send: true, phone };
}

/**
 * Lo que Caja enseña al terminar de cobrar.
 *   sent    → «Le llegó su tarjeta por WhatsApp».
 *   queued  → se está mandando (la cola lo termina).
 *   manual  → no salió sola: botón «Mandar su tarjeta» (wa.me con el texto).
 *   none    → no hay tarjeta que mandar (sin cliente o estrellas apagadas).
 */
export interface StarsCardChargeResult {
  status: "sent" | "queued" | "manual" | "none";
  /** wa.me con el texto ya escrito. Solo en "manual" y con celular. */
  manualHref: string | null;
  /** Por qué no salió sola (para la pista de la pantalla). */
  reason: StarsCardSkip | "templatePending" | "sendFailed" | "quota" | null;
}

export function manualStarsCardResult(
  phone: string | null | undefined,
  text: string,
  reason: StarsCardChargeResult["reason"],
): StarsCardChargeResult {
  const diez = mxTenDigits(phone ?? "");
  return { status: "manual", manualHref: diez ? barberWaMeHref(diez, text) : null, reason };
}
