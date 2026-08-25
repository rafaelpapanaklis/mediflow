/**
 * DaleControl INMUEBLES — proveedores de recorrido 3D / 360° / video.
 *
 * 🔴 POR QUÉ ESTE ARCHIVO EXISTE: un iframe cuyo dominio no está en la
 * directiva `frame-src` de la CSP sale EN BLANCO, sin un solo error en la
 * consola de la página. Se diagnostica mal siempre ("el tour no jala",
 * "Matterport está caído") porque no hay síntoma que apunte a la causa.
 *
 * Por eso la allowlist vive en UN SOLO lugar y sirve para las tres cosas:
 *   (a) VALIDAR la URL que pega el usuario   → isRealtyTourUrl()
 *   (b) ARMAR el frame-src de la CSP         → realtyTourFrameSrc()
 *   (c) DETECTAR el proveedor y su tipo      → detectRealtyTourProvider()
 * Un proveedor nuevo se agrega en src/lib/realty/tour-hosts.json y nada más.
 *
 * La lista cruda está en un .json y no aquí porque la consumen DOS mundos:
 * este módulo (TypeScript, panel y web pública) y next.config.mjs (Node, sin
 * TypeScript). Si estuviera en un .ts, la CSP tendría que repetir los
 * dominios a mano — y ahí es exactamente donde se desincronizan.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only".
 *
 * DEFENSA EN PROFUNDIDAD: validamos el hostname AUNQUE la CSP ya acote. La
 * CSP protege al navegador de hoy; la validación protege de que mañana
 * alguien afloje la CSP y de guardar basura en la base (mismo criterio que
 * esUrlDeMapa en src/lib/barber/landing.ts).
 */
import type { RealtyTourKind } from "@/lib/realty/types";
import tourHosts from "@/lib/realty/tour-hosts.json";

export interface RealtyTourProvider {
  key: string;
  label: string;
  kind: RealtyTourKind;
  /** Dominios registrables permitidos. Los subdominios entran también. */
  domains: string[];
}

/** Catálogo de proveedores permitidos (el .json, ya tipado). */
export const REALTY_TOUR_PROVIDERS: RealtyTourProvider[] = (
  tourHosts.providers as Array<{
    key: string;
    label: string;
    kind: string;
    domains: string[];
  }>
).map((p) => ({
  key: p.key,
  label: p.label,
  kind: p.kind as RealtyTourKind,
  domains: p.domains,
}));

export const REALTY_TOUR_PROVIDER_KEYS: string[] = REALTY_TOUR_PROVIDERS.map((p) => p.key);

/** Todos los dominios permitidos, aplanados. */
export const REALTY_TOUR_DOMAINS: string[] = REALTY_TOUR_PROVIDERS.flatMap((p) => p.domains);

/** "matterport" → "Matterport". Cae al propio key si no lo conoce. */
export function realtyTourProviderLabel(key: string): string {
  return REALTY_TOUR_PROVIDERS.find((p) => p.key === key)?.label ?? key;
}

/**
 * Tokens de `frame-src` para la CSP: por cada dominio, el dominio pelado y
 * su comodín de subdominios (my.matterport.com, www.youtube.com…).
 *
 * next.config.mjs NO llama a esta función (no puede importar TypeScript):
 * arma la misma lista leyendo el .json. Esta versión existe para las
 * pruebas y para cualquier código de servidor que necesite la allowlist.
 */
export function realtyTourFrameSrc(): string[] {
  const out: string[] = [];
  for (const domain of REALTY_TOUR_DOMAINS) {
    out.push(`https://${domain}`);
    out.push(`https://*.${domain}`);
  }
  return out;
}

/** Hostname en minúsculas y sin el "www." de cortesía. */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** ¿`host` es el dominio o un subdominio suyo? */
function hostMatchesDomain(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Proveedor de una URL de recorrido, o null si no está en la allowlist.
 * Exige https: — un http: en un iframe de una página https lo bloquea el
 * navegador por contenido mixto, y ahí también sale el marco en blanco.
 */
export function detectRealtyTourProvider(url: string): RealtyTourProvider | null {
  if (typeof url !== "string" || !url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return (
    REALTY_TOUR_PROVIDERS.find((p) => p.domains.some((d) => hostMatchesDomain(parsed.host, d))) ??
    null
  );
}

/** ¿La URL que pegó el usuario se puede embeber? (allowlist + https). */
export function isRealtyTourUrl(url: string): boolean {
  return detectRealtyTourProvider(url) !== null;
}

/**
 * Tipo de recorrido que corresponde a la URL (TOUR_3D / TOUR_360 / VIDEO),
 * o null si la URL no es de un proveedor permitido. La ola de inmuebles la
 * usa para pre-seleccionar el `kind` en vez de preguntárselo al asesor.
 */
export function realtyTourKindFor(url: string): RealtyTourKind | null {
  return detectRealtyTourProvider(url)?.kind ?? null;
}

/**
 * Mensaje de error para el formulario cuando la URL no pasa. Se escribe
 * aquí para que las diez terminales digan exactamente lo mismo.
 */
export const REALTY_TOUR_URL_ERROR =
  "Esa liga no se puede mostrar. Aceptamos recorridos de " +
  REALTY_TOUR_PROVIDERS.map((p) => p.label).join(", ") +
  " y la liga tiene que empezar con https.";

// ═══════════════════════════════════════════════════════════════════════
// AÑADIDO POR LA OLA 1 (T1 — inmuebles). La allowlist de arriba NO se toca:
// lo que sigue solo NORMALIZA lo que pega el asesor y arma la URL que va
// dentro del iframe. Todo cae dentro de los mismos dominios de siempre.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Deja la URL en la forma canónica que la allowlist SÍ reconoce, antes de
 * validarla.
 *
 * Hoy hace una sola cosa, y es la que más se pega en la vida real: el
 * acortador `youtu.be/ID` que da el botón «Compartir» de YouTube. Ese
 * dominio NO está en tour-hosts.json —y agregarlo sería tocar la fuente
 * única, que además alimenta la CSP—, así que en vez de rechazar al asesor
 * por copiar el botón que le ofrece YouTube, la reescribimos a
 * `https://www.youtube.com/watch?v=ID`, que es el MISMO video y sí está en
 * la allowlist y en el frame-src.
 *
 * Normalizar la entrada no afloja nada: lo que se guarda y lo que se
 * embebe sigue siendo un dominio de la lista.
 */
export function normalizeRealtyTourUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (normalizeHost(parsed.host) === "youtu.be") {
    const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  return raw;
}

/** Id del video de una URL de YouTube (watch?v=…, /embed/…, /shorts/…). */
function youtubeVideoId(parsed: URL): string | null {
  const v = parsed.searchParams.get("v");
  if (v) return v;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const marker = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "v");
  if (marker >= 0 && parts[marker + 1]) return parts[marker + 1];
  return null;
}

/**
 * URL que va en el `src` del iframe.
 *
 * La liga que copia el asesor casi nunca es la de embeber: YouTube da
 * /watch y Vimeo da la página del video, y las dos se niegan a cargarse
 * dentro de un marco. Aquí se traducen a su forma incrustable — SIEMPRE
 * dentro del mismo dominio registrable, así que la CSP las sigue
 * aceptando (player.vimeo.com entra por `https://*.vimeo.com`).
 *
 * Devuelve null si la URL no es de un proveedor permitido: el que llama
 * NO debe pintar un iframe en ese caso.
 */
export function realtyTourEmbedUrl(url: string): string | null {
  const normalized = normalizeRealtyTourUrl(url);
  const provider = detectRealtyTourProvider(normalized);
  if (!provider) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  if (provider.key === "youtube") {
    const id = youtubeVideoId(parsed);
    if (!id) return null;
    // youtube-nocookie: no deja cookies de seguimiento en el visitante de
    // la ficha, y está en la allowlist igual que youtube.com.
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`;
  }

  if (provider.key === "vimeo") {
    // Ya es el reproductor: se respeta tal cual (trae hash de video privado).
    if (normalizeHost(parsed.host) === "player.vimeo.com") return normalized;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = parts.find((p) => /^\d+$/.test(p));
    if (!id) return null;
    // Un video "sin listar" trae un hash extra en la ruta que el reproductor
    // necesita como ?h= — sin él contesta 404 dentro del marco.
    const hash = parts[parts.indexOf(id) + 1];
    const query = hash && /^[a-z0-9]+$/i.test(hash) ? `?h=${encodeURIComponent(hash)}` : "";
    return `https://player.vimeo.com/video/${id}${query}`;
  }

  // Matterport, Kuula, CloudPano, EyeSpy360, GoIGuide, Luma y Scaniverse
  // entregan directamente una liga que se puede embeber.
  return normalized;
}

/**
 * `allow` del iframe. Sin `fullscreen` el botón de pantalla completa del
 * recorrido no hace nada, y en un recorrido 3D eso es media experiencia.
 */
export const REALTY_TOUR_IFRAME_ALLOW =
  "accelerometer; gyroscope; fullscreen; xr-spatial-tracking; picture-in-picture; encrypted-media";

/**
 * `sandbox` del iframe: lo mínimo para que un recorrido funcione.
 *
 * allow-scripts + allow-same-origin es lo que necesita cualquier visor 3D
 * (WebGL y sus peticiones al propio proveedor). NO se dan
 * allow-top-navigation ni allow-popups: un iframe de tercero no tiene por
 * qué poder sacar al usuario de la ficha del inmueble.
 */
export const REALTY_TOUR_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-forms";
