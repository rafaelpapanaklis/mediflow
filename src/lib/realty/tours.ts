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
/* ── Los identificadores, UNO POR PROVEEDOR ───────────────────────────
 *
 * 🔴 Antes había UN solo patrón (`{6,64}` alfanumérico) para los tres. Es
 * el tipo de atajo que se ve bien y no lo es: los ids de Kuula son de
 * CINCO caracteres (`7l8Rk`), así que `kuula.co/post/7l8Rk` —la liga que
 * de verdad pega la gente— no entraba en el patrón y se guardaba sin
 * reescribir. Un patrón demasiado estrecho no falla ruidosamente: falla
 * dejando la liga como estaba, que es justo lo que no se nota.
 *
 * Cada proveedor tiene el suyo y dice de dónde sale su forma.
 */
/**
 * Matterport: ONCE caracteres alfanuméricos (`SxQL3iGyoDo`). Exactamente
 * once, no "seis o más".
 *
 * 🔴 Con `{6,64}` colaba cualquier palabra: `matterport.com/es/show/precios`
 * daba id `precios` y `?m=newsletter` daba id `newsletter`. Las dos se
 * canonizaban, pasaban la puerta con `ok: true`, se guardaban… y pintaban
 * el marco roto que todo esto viene a evitar. Un patrón laxo aquí no
 * "acepta de más": acepta basura y la guarda.
 *
 * El riesgo del otro lado está asumido y es el correcto: si Matterport
 * estrenara ids de otra longitud, la liga se RECHAZA con un mensaje que
 * dice qué copiar — recuperable y ruidoso— en vez de guardarse y verse
 * gris, que es silencioso. Además el parámetro `m=` se mira ANTES que la
 * ruta, y la liga de Compartir siempre lo trae.
 */
const ID_MATTERPORT = /^[A-Za-z0-9]{11}$/;
/** Kuula: cinco o seis caracteres (`7l8Rk`). */
const ID_KUULA = /^[A-Za-z0-9]{3,32}$/;
/** Luma: un UUID con guiones. */
const ID_LUMA = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

export function normalizeRealtyTourUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  // El acortador de YouTube se reescribe venga en http o en https: la
  // reescritura NO asciende nada, construye una URL de youtube.com que ya
  // es https de origen. Va ANTES de la guarda de protocolo a propósito —
  // ponerla después rompía `http://youtu.be/<id>`, que llevaba funcionando
  // desde la Ola 1 y es lo que llega reenviado por WhatsApp o por correo.
  if (normalizeHost(parsed.host) === "youtu.be") {
    const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }

  // 🔴 PARA EL RESTO, NORMALIZAR NO ES ASCENDER DE PROTOCOLO. Las
  // reescrituras de abajo arman una URL `https://…` a partir del MISMO
  // host que trajo la entrada, así que aplicarlas a un `http://` lo subiría
  // a https en silencio — y una liga que la puerta debía rechazar
  // (contenido mixto: el navegador la bloquea dentro de una página https,
  // marco en blanco y sin error) pasaría de largo.
  if (parsed.protocol !== "https:") return raw;

  const provider = REALTY_TOUR_PROVIDERS.find((p) =>
    p.domains.some((d) => hostMatchesDomain(parsed.host, d)),
  );

  // Matterport: la ÚNICA forma que se deja embeber es la liga de Compartir.
  //
  // 🔴 SE CONSERVAN LOS PARÁMETROS. Tirarlos parecía "canonizar" y era una
  // regresión sobre filas que HOY se ven bien: `lang=es` devuelve el visor
  // al español, `brand=0` quita la marca de Matterport del recorrido del
  // cliente, y `sr`/`ss` son la vista inicial que el asesor eligió al
  // compartir. Lo único que se canoniza es `m`, que es lo que decide QUÉ
  // espacio se abre; lo demás es cómo se ve, y eso lo eligió una persona.
  if (provider?.key === "matterport") {
    const id = matterportSpaceId(parsed);
    if (!id) return raw; // sin identificador no hay nada que canonizar; lo rechaza checkRealtyTourUrl
    const params = new URLSearchParams(parsed.search);
    params.set("m", id);
    return `https://my.matterport.com/show/?${params.toString()}`;
  }

  // Kuula: /post/<id> es la página del visor; /share/<id> es la que Kuula
  // entrega en su propio botón de Insertar. Una colección
  // (/share/collection/<id>) NO se toca: ya viene en forma de compartir.
  if (provider?.key === "kuula") {
    const partes = parsed.pathname.split("/").filter(Boolean);
    // `partes.length === 2` NO sobra: sin esa condición, un
    // `kuula.co/post/collection/7lXYZ` se convertía en
    // `kuula.co/share/collection` —una liga SIN identificador— y como esta
    // rama no verifica su propio resultado, se guardaba con 201 y se veía
    // rota. Reescribir solo la forma que se sabe leer; el resto, tal cual.
    if (partes.length === 2 && partes[0] === "post" && ID_KUULA.test(partes[1])) {
      return `https://kuula.co/share/${partes[1]}${parsed.search}`;
    }
    return raw;
  }

  // Luma: /capture/<uuid> es la página; /embed/<uuid> es el visor incrustable.
  if (provider?.key === "lumalabs") {
    const partes = parsed.pathname.split("/").filter(Boolean);
    // Misma cautela que en Kuula, y los parámetros se conservan.
    if (partes.length === 2 && partes[0] === "capture" && ID_LUMA.test(partes[1])) {
      return `https://lumalabs.ai/embed/${partes[1]}${parsed.search}`;
    }
    return raw;
  }

  // CloudPano, EyeSpy360, GoIGuide y Scaniverse se dejan TAL CUAL a
  // propósito.
  //
  // 🔴 LA REGLA QUE SE APRENDIÓ AQUÍ: reescribir una liga que ya funciona
  // es peor que no reescribir la que no funciona. De Matterport consta —
  // Rafael lo vio— que solo embebe la de Compartir; de Kuula y Luma consta
  // que su propio botón de Insertar entrega /share/ y /embed/. De los otros
  // cuatro NO consta nada, y adivinar su forma "de compartir" rompería las
  // ligas buenas de quien ya las tenía guardadas. Para esos cuatro la red
  // es la de RUNTIME: si el marco no carga, RealtyTourEmbed lo dice en
  // pantalla y ofrece abrirlo aparte (nunca un gris mudo). Cuando alguno
  // dé problema de verdad, su rama va AQUÍ, con el caso que la justifique.
  return raw;
}

/**
 * El identificador del espacio de Matterport, o null si la liga no lo trae.
 *
 * 🔴 POR QUÉ IMPORTA. `matterport.com` entero está en la allowlist, así que
 * CUALQUIER liga del dominio pasa la validación… pero Matterport solo deja
 * embeber la de COMPARTIR (`/show/?m=<id>`). Una liga de `/discover/space/…`,
 * de la app o de un espacio privado pasa el filtro de dominio y luego el
 * iframe se queda EN GRIS, que es justo el síntoma que no se diagnostica.
 *
 * Se busca el id en este orden:
 *   1. el parámetro `m=` (es el que trae la liga de Compartir y el embed)
 *   2. el segmento que sigue a /show/ o /models/ en la ruta
 * Un `/discover/space/<nombre-de-la-casa>` NO tiene identificador: ahí se
 * devuelve null a propósito, para poder rechazar la liga al pegarla en vez
 * de guardar algo que se verá roto.
 */
export function matterportSpaceId(url: URL | string): string | null {
  let parsed: URL;
  if (typeof url === "string") {
    try {
      parsed = new URL(url.trim());
    } catch {
      return null;
    }
  } else {
    parsed = url;
  }

  const m = parsed.searchParams.get("m");
  if (m && ID_MATTERPORT.test(m)) return m;

  const partes = parsed.pathname.split("/").filter(Boolean);
  for (const marca of ["show", "models"]) {
    const i = partes.indexOf(marca);
    if (i >= 0 && partes[i + 1] && ID_MATTERPORT.test(partes[i + 1])) return partes[i + 1];
  }
  return null;
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

  if (provider.key === "matterport") {
    // normalizeRealtyTourUrl ya la dejó en /show/?m=<id> si tenía id. Si no
    // lo tenía, NO se pinta iframe: una liga de /discover/space/… es del
    // mismo dominio pero Matterport se niega a mostrarla dentro de un marco,
    // y el resultado sería el recuadro gris de siempre.
    return matterportSpaceId(parsed) ? normalized : null;
  }

  // Kuula, CloudPano, EyeSpy360, GoIGuide, Luma y Scaniverse entregan
  // directamente una liga que se puede embeber (Kuula y Luma ya vienen
  // reescritas a su forma de compartir por normalizeRealtyTourUrl).
  return normalized;
}

/* ═══════════════════════════════════════════════════════════════════════
 * LA PUERTA DE ENTRADA: una sola respuesta para "¿puedo guardar esta liga?"
 * ═══════════════════════════════════════════════════════════════════════ */

/** Veredicto de una liga pegada por el asesor. */
export interface RealtyTourCheck {
  ok: boolean;
  provider: RealtyTourProvider | null;
  /** La liga YA canonizada, que es la que se guarda. null si no pasa. */
  url: string | null;
  /** La que va en el `src` del iframe. null si no pasa. */
  embedUrl: string | null;
  /** Qué decirle al asesor cuando no pasa. null si pasa. */
  error: string | null;
}

/** Lo que hay que copiar de Matterport, dicho con sus propias palabras. */
export const REALTY_TOUR_MATTERPORT_ERROR =
  "De Matterport necesitamos la liga de Compartir, la que se ve así: " +
  "https://my.matterport.com/show/?m=XXXXXXXX. La que pegaste no se puede " +
  "mostrar dentro de la ficha.";

/**
 * ¿Esta liga se puede guardar Y se va a poder ver?
 *
 * 🔴 Son DOS preguntas distintas y antes solo se hacía la primera. Estar en
 * la allowlist (`detectRealtyTourProvider`) dice que el dominio es de un
 * proveedor conocido y que la CSP lo va a dejar pasar. NO dice que el
 * proveedor acepte que ESA liga en concreto se meta en un iframe.
 *
 * Matterport es el caso que lo destapó: `matterport.com` entero está
 * permitido, así que una liga de `/discover/space/…` pasaba la validación,
 * se guardaba, y en la ficha salía el marco gris con el icono de recurso
 * roto. Vale más rechazarla al pegarla —y enseñar qué copiar— que guardar
 * algo que se va a ver roto.
 *
 * La usan la UI (para deshabilitar el botón y explicar) y el route handler
 * (que es el que manda). Mismo criterio en los dos lados.
 */
export function checkRealtyTourUrl(raw: string): RealtyTourCheck {
  const limpio = (raw ?? "").trim();
  if (!limpio) {
    return { ok: false, provider: null, url: null, embedUrl: null, error: "Pega la liga del recorrido." };
  }

  const url = normalizeRealtyTourUrl(limpio);
  const provider = detectRealtyTourProvider(url);
  if (!provider) {
    return { ok: false, provider: null, url: null, embedUrl: null, error: REALTY_TOUR_URL_ERROR };
  }

  const embedUrl = realtyTourEmbedUrl(url);
  if (!embedUrl) {
    // Único caso hoy: dominio permitido pero la liga no es la de compartir.
    const error =
      provider.key === "matterport"
        ? REALTY_TOUR_MATTERPORT_ERROR
        : `Esa liga de ${provider.label} no se puede mostrar dentro de la ficha. ` +
          "Busca la opción de Compartir o Insertar en su sitio y pega esa.";
    return { ok: false, provider, url: null, embedUrl: null, error };
  }

  return { ok: true, provider, url, embedUrl, error: null };
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
