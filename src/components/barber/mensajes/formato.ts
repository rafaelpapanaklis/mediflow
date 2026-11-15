// ═══════════════════════════════════════════════════════════════════════
// Mensajes — piezas PURAS (sin React, sin red): teléfono, horas, días, el
// cuerpo de cada mensaje, quién atiende un chat, filtros y próxima cita.
//
// Todo sale de lo que ya devuelven las APIs de WhatsApp, del bot y de la
// agenda de barber; aquí no se inventa ningún dato. Probado en
// src/lib/barber/__tests__/mensajes.test.ts.
// ═══════════════════════════════════════════════════════════════════════

import {
  BARBER_WA_VOICE_BODY_PREFIXES,
  type BarberWaAttachmentKind,
  type BarberWaThreadDTO,
} from "@/lib/barber/whatsapp-core";

// ── Teléfono ─────────────────────────────────────────────────────────────

// Cómo se ESCRIBE un teléfono: formatBarberPhone (@/lib/barber/phone-format),
// el formateador único del vertical. Aquí solo la clave para comparar.

/** Los 10 dígitos con los que se compara un teléfono (o todos si son menos). */
export function telefonoClave(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/** Dos iniciales del nombre («Juan Pérez» → «JP»); null sin nombre. */
export function iniciales(nombre: string | null | undefined): string | null {
  const partes = String(nombre ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => /\p{L}/u.test(p));
  if (partes.length === 0) return null;
  const a = partes[0].match(/\p{L}/u)?.[0] ?? "";
  const b = partes.length > 1 ? (partes[partes.length - 1].match(/\p{L}/u)?.[0] ?? "") : "";
  return (a + b).toUpperCase();
}

// ── Horas y días, en la zona de la barbería ──────────────────────────────

const intlLocale = (locale: string) => (locale === "en" ? "en-US" : "es-MX");

/** «2026-11-15» del instante, en la zona dada. */
export function diaClave(iso: string | Date, tz?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** «3:05 p. m.» / «3:05 PM». */
export function horaCorta(iso: string, tz: string | undefined, locale: string): string {
  try {
    const txt = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
    // es-MX escribe «p.m.» o «p. m.» según el motor: siempre «p. m.».
    return locale === "en" ? txt : txt.replace(/\s?([ap])\.\s?m\./i, (_, l: string) => ` ${l.toLowerCase()}. m.`);
  } catch {
    return iso.slice(11, 16);
  }
}

export interface TextosTiempo {
  ahora: string;
  ayer: string;
}

/**
 * La hora de la lista, como la de WhatsApp: «Ahora», «hace 12 min», la hora
 * si es de hoy, «Ayer», el día de la semana si fue esta semana y la fecha
 * si es más vieja.
 */
export function cuandoLista(
  iso: string,
  ahora: Date,
  tz: string | undefined,
  locale: string,
  tx: TextosTiempo,
): string {
  const t = new Date(iso);
  const min = Math.floor((ahora.getTime() - t.getTime()) / 60_000);
  if (min >= 0 && min < 1) return tx.ahora;
  if (min >= 1 && min < 60) {
    try {
      return new Intl.RelativeTimeFormat(intlLocale(locale), { style: "short" }).format(-min, "minute");
    } catch {
      return `${min} min`;
    }
  }
  const dias = diasEntre(diaClave(t, tz), diaClave(ahora, tz));
  if (dias <= 0) return horaCorta(iso, tz, locale);
  if (dias === 1) return tx.ayer;
  try {
    if (dias < 7) {
      return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, weekday: "short" })
        .format(t)
        .replace(/\.$/, "");
    }
    const mismoAnio = diaClave(t, tz).slice(0, 4) === diaClave(ahora, tz).slice(0, 4);
    return new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: tz,
      day: "numeric",
      month: "short",
      ...(mismoAnio ? {} : { year: "2-digit" }),
    })
      .format(t)
      .replace(/\./g, "");
  } catch {
    return iso.slice(0, 10);
  }
}

/** Separador de día del chat: «Hoy», «Ayer», «lunes 10 de noviembre». */
export function etiquetaDia(
  iso: string,
  ahora: Date,
  tz: string | undefined,
  locale: string,
  tx: { hoy: string; ayer: string },
): string {
  const t = new Date(iso);
  const dias = diasEntre(diaClave(t, tz), diaClave(ahora, tz));
  if (dias <= 0) return tx.hoy;
  if (dias === 1) return tx.ayer;
  const mismoAnio = diaClave(t, tz).slice(0, 4) === diaClave(ahora, tz).slice(0, 4);
  try {
    const txt = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(mismoAnio ? {} : { year: "numeric" }),
    }).format(t);
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  } catch {
    return iso.slice(0, 10);
  }
}

/** «sáb 16 nov, 11:30 a. m.» para la próxima cita. */
export function fechaCita(iso: string, tz: string | undefined, locale: string): string {
  try {
    const dia = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
    })
      .format(new Date(iso))
      .replace(/\./g, "");
    return `${dia}, ${horaCorta(iso, tz, locale)}`;
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

// ── El cuerpo de un mensaje ──────────────────────────────────────────────

/** La línea con la que el servidor deja escrito qué opciones se ofrecieron. */
const OPCIONES = "🔘 Opciones:";

/** Lo que el webhook escribe cuando llega multimedia (whatsapp.ts). */
const AVISO_MULTIMEDIA =
  /^(?:📷 Te mandaron una foto|🎥 Te mandaron un video|🎤 Te mandaron una nota de voz|🎵 Te mandaron un audio|📄 Te mandaron el archivo .*?|Te mandaron una calcomanía)(?: — ([\s\S]*))?$/;

export interface CuerpoDesarmado {
  /** Texto que se enseña (sin la línea de opciones ni el aviso de multimedia). */
  texto: string | null;
  /** Opciones con botones que se le ofrecieron al cliente (mensajes automáticos). */
  opciones: string[];
  /** Transcripción de una nota de voz, si el bot la transcribió. */
  transcripcion: string | null;
}

export function desarmarCuerpo(
  body: string | null | undefined,
  adjunto: BarberWaAttachmentKind | null,
): CuerpoDesarmado {
  let texto = String(body ?? "");
  let opciones: string[] = [];
  let transcripcion: string | null = null;

  const lineas = texto.split("\n");
  const ultima = lineas[lineas.length - 1] ?? "";
  if (ultima.startsWith(OPCIONES)) {
    opciones = ultima
      .slice(OPCIONES.length)
      .split(" · ")
      .map((o) => o.trim())
      .filter(Boolean);
    texto = lineas.slice(0, -1).join("\n");
  }

  for (const prefijo of BARBER_WA_VOICE_BODY_PREFIXES) {
    if (texto.startsWith(prefijo)) {
      transcripcion = texto.slice(prefijo.length).trim() || null;
      texto = "";
      break;
    }
  }

  if (adjunto && texto) {
    const m = AVISO_MULTIMEDIA.exec(texto);
    if (m) texto = (m[1] ?? "").trim();
  }

  texto = texto.trim();
  return { texto: texto || null, opciones, transcripcion };
}

/** El renglón de vista previa de la lista: una línea, sin la de opciones. */
export function vistaPrevia(body: string | null | undefined): string {
  const lineas = String(body ?? "")
    .split("\n")
    .filter((l) => !l.startsWith(OPCIONES));
  return lineas.join(" ").replace(/\s+/g, " ").trim();
}

/** ¿Lo mandó el sistema solo (con botones de opciones) y no una persona? */
export function esAutomatico(body: string | null | undefined): boolean {
  return String(body ?? "")
    .split("\n")
    .some((l) => l.startsWith(OPCIONES));
}

/** Corta un texto en trozos de texto y enlaces http(s) para pintarlos. */
export function trozosConEnlaces(texto: string): Array<{ enlace: boolean; valor: string }> {
  const out: Array<{ enlace: boolean; valor: string }> = [];
  const re = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;
  let desde = 0;
  for (const m of Array.from(texto.matchAll(re))) {
    const i = m.index ?? 0;
    if (i > desde) out.push({ enlace: false, valor: texto.slice(desde, i) });
    out.push({ enlace: true, valor: m[0] });
    desde = i + m[0].length;
  }
  if (desde < texto.length) out.push({ enlace: false, valor: texto.slice(desde) });
  return out;
}

// ── Quién atiende cada chat ──────────────────────────────────────────────

export type Atiende = "bot" | "persona" | "nadie";

export interface EstadoBot {
  /** El plan trae bot (whatsappBot). */
  disponible: boolean;
  /** Está encendido en la pantalla del bot. */
  encendido: boolean;
  /** Hay WhatsApp conectado (sin número el bot no contesta). */
  conectado: boolean;
}

export interface PausaBot {
  phone: string;
  reason: string | null;
  pausedAt: string;
}

/**
 * bot     → el bot contesta este chat.
 * persona → el bot está en pausa en este chat: lo atiende alguien de la barbería.
 * nadie   → no hay bot que conteste (apagado, sin plan o sin conexión):
 *           el chat espera a una persona.
 */
export function quienAtiende(phone: string, bot: EstadoBot, pausas: ReadonlyArray<PausaBot>): Atiende {
  const clave = telefonoClave(phone);
  if (pausas.some((p) => telefonoClave(p.phone) === clave)) return "persona";
  if (bot.disponible && bot.encendido && bot.conectado) return "bot";
  return "nadie";
}

// ── Filtros y búsqueda de la lista ───────────────────────────────────────

export type Filtro = "todos" | "sinLeer" | "bot" | "pausados" | "archivados";

export function filtrarChats(
  threads: ReadonlyArray<BarberWaThreadDTO>,
  filtro: Filtro,
  busqueda: string,
  atiende: (phone: string) => Atiende,
): BarberWaThreadDTO[] {
  const q = busqueda.trim().toLowerCase();
  const qDigitos = q.replace(/\D/g, "");
  return threads.filter((th) => {
    if (filtro === "sinLeer" && th.unread <= 0) return false;
    if (filtro === "bot" && atiende(th.phone) !== "bot") return false;
    if (filtro === "pausados" && atiende(th.phone) !== "persona") return false;
    if (!q) return true;
    if ((th.clientName ?? "").toLowerCase().includes(q)) return true;
    if (qDigitos.length >= 3 && th.phone.replace(/\D/g, "").includes(qDigitos)) return true;
    return vistaPrevia(th.lastBody).toLowerCase().includes(q);
  });
}

// ── Próxima cita ─────────────────────────────────────────────────────────

export interface CitaMin {
  clientId: string | null;
  clientPhone: string | null;
  startAt: string;
  status: string;
  barberName: string | null;
  services: Array<{ serviceName: string }>;
}

const CITA_VIVA = new Set(["PENDING", "CONFIRMED", "IN_PROGRESS"]);

/** La próxima cita viva (pendiente, confirmada o en silla) de ese cliente o teléfono. */
export function proximaCita<T extends CitaMin>(
  citas: ReadonlyArray<T>,
  phone: string,
  clientId: string | null,
  ahora: Date,
): T | null {
  const clave = telefonoClave(phone);
  let mejor: T | null = null;
  for (const c of citas) {
    if (!CITA_VIVA.has(c.status)) continue;
    const esSuya = (clientId && c.clientId === clientId) || (clave && telefonoClave(c.clientPhone) === clave);
    if (!esSuya) continue;
    // En silla cuenta aunque ya haya empezado; las demás, solo las que vienen.
    if (c.status !== "IN_PROGRESS" && Date.parse(c.startAt) < ahora.getTime()) continue;
    if (!mejor || Date.parse(c.startAt) < Date.parse(mejor.startAt)) mejor = c;
  }
  return mejor;
}

// ── La ventana de 24 h ───────────────────────────────────────────────────

const VENTANA_MS = 24 * 60 * 60 * 1000;

/** Milisegundos que quedan para escribir texto libre (0 si ya se cerró). */
export function ventanaRestante(
  mensajes: ReadonlyArray<{ direction: string; createdAt: string }>,
  ahora: Date,
): number {
  let ultimo = 0;
  for (const m of mensajes) {
    if (m.direction !== "INBOUND") continue;
    const t = Date.parse(m.createdAt);
    if (t > ultimo) ultimo = t;
  }
  if (!ultimo) return 0;
  return Math.max(0, ultimo + VENTANA_MS - ahora.getTime());
}
