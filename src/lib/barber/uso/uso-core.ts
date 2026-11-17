// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — USO DEL PANEL: lo que comparten navegador y servidor
// (ws6-t4, 16-nov-2026). PURO: sin React, sin Prisma, sin red.
//
// Qué se registra de cada usuario de una barbería en /barber:
//   S = entró (sesión de pestaña) · V = abrió una pantalla · C = tocó algo.
// Qué NO se registra nunca: lo que se escribe en un campo, teléfonos, correos,
// nombres de clientes, la consulta de la URL (?q=…), ids. Ver sql/barber_usage_events.sql.
// ═══════════════════════════════════════════════════════════════════════

/** Endpoint del registrador (mismo origen). */
export const USO_ENDPOINT = "/api/barber/uso";

/** Envío en lote: cada 30 s y al salir de la pestaña. */
export const USO_FLUSH_MS = 30_000;
/** Una sesión nueva tras 30 min sin tocar nada (como la analítica del dental). */
export const USO_SESION_INACTIVA_MS = 30 * 60 * 1000;
/** Máximo de eventos por envío (cliente y validación del servidor). */
export const USO_MAX_LOTE = 50;
/**
 * TOPES por minuto. El del navegador frena a una pestaña desbocada antes de
 * salir; el del servidor es el que manda (por USUARIO, todas sus pestañas).
 * Una persona trabajando de verdad no pasa de 20–30 toques por minuto.
 */
export const USO_TOPE_CLIENTE_MIN = 60;
export const USO_TOPE_SERVIDOR_MIN = 120;

/**
 * Marca de «Ver como barbería»: mientras exista esta cookie en el navegador,
 * no se registra NADA (ni en el navegador ni en el servidor). La pone quien
 * implemente la inspección del admin (ws6-t1). Aparte, el servidor tampoco
 * registra si la petición trae una sesión válida de admin de DaleControl.
 */
export const BARBER_VER_COMO_COOKIE = "dcb_ver_como";

export type UsoTipo = "SESSION" | "VIEW" | "CLICK";

/** Lo que viaja del navegador al servidor (claves cortas: van muchas). */
export interface UsoEventoCliente {
  /** S | V | C */
  k: "S" | "V" | "C";
  /** pathname de la pantalla (el servidor lo vuelve a normalizar). */
  p: string;
  /** data-accion del botón, si tiene. */
  a?: string;
  /** texto del botón, YA limpio (sin dígitos, sin correos, ≤ 60). */
  l?: string;
  /** a dónde lleva un enlace: pathname interno o "externo". */
  h?: string;
  /** cuándo pasó (ms epoch, reloj del navegador). */
  t?: number;
}

export interface UsoLoteCliente {
  sid: string;
  events: UsoEventoCliente[];
}

export const USO_TIPO_POR_CLAVE: Record<UsoEventoCliente["k"], UsoTipo> = {
  S: "SESSION",
  V: "VIEW",
  C: "CLICK",
};

// ── Pantallas ──────────────────────────────────────────────────────────

/** Un segmento que es un id (cuid, uuid, número, token) y no un nombre de pantalla. */
function esId(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  // cuid / cuid2 / tokens: largos y con dígitos mezclados.
  if (seg.length >= 16 && /\d/.test(seg) && /^[a-z0-9_-]+$/i.test(seg)) return true;
  // Cualquier cosa larguísima (tokens de enlaces) tampoco es una pantalla.
  if (seg.length > 40) return true;
  return false;
}

/**
 * La pantalla, sin datos: «/barber/clientes/cmwj…?q=juan#x» → «/barber/clientes/[id]».
 * Solo rutas del panel (/barber…); cualquier otra cosa → null.
 */
export function normalizarPantalla(path: unknown): string | null {
  if (typeof path !== "string") return null;
  let p = path.split(/[?#]/)[0].trim();
  if (!p.startsWith("/")) {
    try {
      p = new URL(p).pathname;
    } catch {
      return null;
    }
  }
  p = "/" + p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p !== "/barber" && !p.startsWith("/barber/")) return null;
  let segs: string[];
  try {
    segs = p.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    segs = p.split("/").filter(Boolean);
  }
  const limpio = "/" + segs.map((s) => (esId(s) ? "[id]" : s.toLowerCase())).join("/");
  return limpio.slice(0, 120);
}

/**
 * A dónde lleva un enlace. Interno del panel → su pantalla sin ids; cualquier
 * otra cosa (wa.me, tel:, mailto:, otra web, la página pública) → "externo".
 * Nunca la URL: un wa.me o un tel: llevan el teléfono del cliente.
 */
export function destinoDeEnlace(href: unknown, origen: string): string | null {
  if (typeof href !== "string" || !href.trim()) return null;
  const h = href.trim();
  if (h.startsWith("#") || h.toLowerCase().startsWith("javascript:")) return null;
  let url: URL;
  try {
    url = new URL(h, origen);
  } catch {
    return "externo";
  }
  if (url.origin !== new URL(origen).origin) return "externo";
  return normalizarPantalla(url.pathname) ?? "externo";
}

// ── Etiquetas de los botones ───────────────────────────────────────────

/** data-accion: clave de programador, solo [a-z0-9._:-]. */
export function limpiarAccion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9._:-]/g, "").slice(0, 60);
  return s || null;
}

/**
 * El texto de un botón tal como puede salir del navegador: espacios juntos,
 * TODOS los dígitos cambiados por 0 (un teléfono o un monto no salen) y nada
 * que parezca un correo. El servidor solo lo GUARDA si coincide con un texto
 * del panel (ver etiquetas.ts); si no, lo tira.
 */
export function limpiarEtiqueta(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s.includes("@")) return null;
  const sinDigitos = s.replace(/\d/g, "0");
  return sinDigitos.slice(0, 60) || null;
}

// ── Validación del lote (servidor) ─────────────────────────────────────

export interface UsoEventoValido {
  type: UsoTipo;
  screen: string;
  accion: string | null;
  etiqueta: string | null;
  target: string | null;
  at: number | null;
}

/**
 * Valida y limpia un lote. Lo que no se entiende se tira (no rompe el resto).
 * El servidor NUNCA toma de aquí la barbería ni el usuario: salen de la sesión.
 */
export function validarLote(body: unknown): { sid: string; eventos: UsoEventoValido[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sid = typeof b.sid === "string" ? b.sid.trim() : "";
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(sid)) return null;
  if (!Array.isArray(b.events)) return null;
  const eventos: UsoEventoValido[] = [];
  for (const raw of b.events.slice(0, USO_MAX_LOTE)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const k = e.k;
    if (k !== "S" && k !== "V" && k !== "C") continue;
    const screen = normalizarPantalla(e.p);
    if (!screen) continue;
    const t = typeof e.t === "number" && Number.isFinite(e.t) ? e.t : null;
    const h = typeof e.h === "string" ? (e.h === "externo" ? "externo" : normalizarPantalla(e.h)) : null;
    eventos.push({
      type: USO_TIPO_POR_CLAVE[k],
      screen,
      accion: k === "C" ? limpiarAccion(e.a) : null,
      etiqueta: k === "C" ? limpiarEtiqueta(e.l) : null,
      target: k === "C" ? h : null,
      at: t,
    });
  }
  return { sid, eventos };
}

/**
 * La hora que se guarda: la del navegador si es creíble (hasta 10 min atrás y
 * 1 min adelante, por el lote de 30 s y relojes torcidos); si no, la del servidor.
 */
export function horaDelEvento(at: number | null, ahora: number): Date {
  if (at !== null && at <= ahora + 60_000 && at >= ahora - 10 * 60_000) return new Date(at);
  return new Date(ahora);
}

/** Cuántos eventos del lote caben, dado lo que el usuario ya mandó en el último minuto. */
export function cuantosCaben(yaEnElMinuto: number, enLote: number, tope = USO_TOPE_SERVIDOR_MIN): number {
  return Math.max(0, Math.min(enLote, tope - Math.max(0, yaEnElMinuto)));
}

/** La cookie de «Ver como barbería» en una cadena document.cookie / encabezado Cookie. */
export function hayVerComo(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((c) => {
    const [k, ...v] = c.trim().split("=");
    return k === BARBER_VER_COMO_COOKIE && v.join("=").trim() !== "" && v.join("=").trim() !== "0";
  });
}
