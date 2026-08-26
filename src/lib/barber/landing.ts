/* ═══════════════════════════════════════════════════════════════════════
   LA PÁGINA WEB DE LA BARBERÍA — núcleo PURO.

   Todo lo que se puede decidir sin base de datos y sin navegador vive
   aquí: la forma de `BarberLandingConfig.config`, cómo se normaliza lo
   que venga guardado, qué acepta el PATCH, y —lo importante— cómo se
   FUSIONAN dos ediciones simultáneas sin devolver un 409 falso.

   Sin "use client" y sin prisma: lo importan el editor (navegador), las
   plantillas (servidor) y la API (servidor). Un import de prisma aquí
   arrastraría el cliente de Prisma al bundle público.

   ── DÓNDE VIVE CADA COSA ──────────────────────────────────────────
   La tabla `barber_landing_configs` tiene CUATRO columnas de contenido:
     template     · qué plantilla se pinta
     config       · Json con TODO lo demás (esta forma)
     version      · entero que sube en cada guardado (bloqueo optimista)
     publishedAt  · cuándo se publicó por última vez

   Nada más se guarda en otro sitio. Los servicios salen de
   BarberService, los barberos de Barber y el nombre/dirección/teléfono
   de Barbershop: son datos del negocio, no de la web.

   ── POR QUÉ EL CONTENIDO SE GUARDA POR CLAVE SEMÁNTICA ────────────
   `copia["portada.cta"]`, `fotos["portada"]`, `secciones["servicios"]`.
   Las claves NO llevan el id de la plantilla dentro, así que cambiar de
   plantilla conserva todo lo que ambas comparten sin copiar nada: la
   plantilla nueva simplemente lee las mismas claves. Lo único que sí es
   por plantilla es el ORDEN de las secciones (`orden[plantilla]`), que
   es disposición, no contenido.
   ═══════════════════════════════════════════════════════════════════════ */

import { BARBER_WEB_MANIFESTS } from "@/components/barber/templates/manifest";

/* ══════════════════════════════════════════════════════════════
   1 · Las doce plantillas
   ══════════════════════════════════════════════════════════════ */

export const BARBER_WEB_TEMPLATE_IDS = [
  "clasica",
  "equipo",
  "portafolio",
  "minimal",
  "premium",
  "urbana",
  "vintage",
  "precios",
  "estudio",
  "carta",
  "nocturna",
  "club",
] as const;

export type BarberWebTemplateId = (typeof BARBER_WEB_TEMPLATE_IDS)[number];

/** La de arranque. Es la que ve una barbería que nunca abrió el editor. */
export const BARBER_WEB_TEMPLATE_DEFAULT: BarberWebTemplateId = "clasica";

export function esPlantillaBarberWeb(v: unknown): v is BarberWebTemplateId {
  return typeof v === "string" && (BARBER_WEB_TEMPLATE_IDS as readonly string[]).includes(v);
}

/* ══════════════════════════════════════════════════════════════
   2 · Tipos del manifiesto

   Viven AQUÍ (son el contrato del motor) aunque los datos los
   escriba cada plantilla en components/barber/templates/manifest.ts.
   Ese archivo importa estos tipos con `import type`, así que no hay
   ciclo en tiempo de ejecución: el grafo real es landing → manifest.
   ══════════════════════════════════════════════════════════════ */

/** De dónde saca datos una sección. Sin datos, la sección no se pinta. */
export type BarberWebFuente =
  | "servicios"
  | "barberos"
  | "galeria"
  | "resenas"
  | "horario"
  | "contacto";

export interface BarberWebManifestTexto {
  campo: "titulo" | "subtitulo";
  etiqueta: string;
  porDefecto: string;
}

export interface BarberWebManifestFoto {
  id: string;
  nombre: string;
  /** Como se lo decimos a la barbería: "16:9 apaisada", "cuadrada". */
  proporcion: string;
  ayuda?: string;
}

export interface BarberWebManifestCopia {
  /** Clave SEMÁNTICA y compartida entre plantillas: "portada.cta". */
  clave: string;
  etiqueta: string;
  /**
   * El literal REAL que pinta ESTA plantilla si la barbería no escribe nada.
   * Si no es el literal real, el editor miente en el placeholder.
   */
  porDefecto: string;
  maxLen?: number;
}

export interface BarberWebManifestSeccion {
  id: string;
  /** Nombre visible en el editor, en español. */
  nombre: string;
  /** No se puede ocultar ni mover. */
  obligatoria?: boolean;
  consume: BarberWebFuente[];
  textos?: BarberWebManifestTexto[];
  fotos?: BarberWebManifestFoto[];
  copia?: BarberWebManifestCopia[];
}

export interface BarberWebManifest {
  id: BarberWebTemplateId;
  nombre: string;
  /** Una línea: para quién es esta plantilla. */
  para: string;
  /** Qué la hace distinta en ESTRUCTURA (lo lee el selector del editor). */
  estructura: string;
  /** Acento sugerido al elegirla por primera vez. */
  acentoSugerido: BarberWebAccentId;
  /** Fondo oscuro: el editor pinta la vista previa sobre negro. */
  oscura?: boolean;
  secciones: BarberWebManifestSeccion[];
}

/* ══════════════════════════════════════════════════════════════
   3 · Paleta

   La barbería NO elige un color libre: elige un acento del catálogo.
   Un #00FF00 en una plantilla caramelo/negro rompe la marca y, peor,
   rompe el contraste — el texto blanco de los botones deja de leerse.

   ♿ Los seis `fuerte` pasan AA (≥4.5:1) con texto BLANCO encima.
   `base` es para acentos, bordes e iconos; `fuerte` para todo lo que
   lleve texto blanco. Es la misma regla del tema del panel.
   ══════════════════════════════════════════════════════════════ */

export type BarberWebAccentId =
  | "caramelo"
  | "whisky"
  | "cobre"
  | "tabaco"
  | "vino"
  | "acero";

export interface BarberWebAccent {
  id: BarberWebAccentId;
  nombre: string;
  /** Acentos, bordes, iconos, texto GRANDE. */
  base: string;
  /** Botones y píldoras con texto blanco (AA comprobado). */
  fuerte: string;
  /** Fondos suaves de sección. */
  suave: string;
  /** Versión clara para fondos oscuros (texto OSCURO encima). */
  claro: string;
}

export const BARBER_WEB_ACCENTS: BarberWebAccent[] = [
  { id: "caramelo", nombre: "Caramelo", base: "#BE7A3C", fuerte: "#A2612F", suave: "#F6EADC", claro: "#DDB587" },
  { id: "whisky", nombre: "Whisky", base: "#CD9459", fuerte: "#9B6A34", suave: "#F8EEE0", claro: "#E5BE8C" },
  { id: "cobre", nombre: "Cobre", base: "#B25E33", fuerte: "#8A4B2A", suave: "#F7E8DE", claro: "#D89268" },
  { id: "tabaco", nombre: "Tabaco", base: "#8A5A2E", fuerte: "#6E4423", suave: "#F1E7DA", claro: "#C08D53" },
  { id: "vino", nombre: "Vino", base: "#9A3B3B", fuerte: "#7A2E2E", suave: "#F6E4E2", claro: "#C97070" },
  { id: "acero", nombre: "Acero", base: "#516069", fuerte: "#3E4A52", suave: "#EAEEF0", claro: "#8FA3AD" },
];

export const BARBER_WEB_ACCENT_DEFAULT: BarberWebAccentId = "caramelo";

export function acentoBarberWeb(id: string | null | undefined): BarberWebAccent {
  return (
    BARBER_WEB_ACCENTS.find((a) => a.id === id) ??
    BARBER_WEB_ACCENTS.find((a) => a.id === BARBER_WEB_ACCENT_DEFAULT)!
  );
}

/* ══════════════════════════════════════════════════════════════
   4 · La forma de `config`
   ══════════════════════════════════════════════════════════════ */

export interface BarberWebSeccionEstado {
  visible: boolean;
  titulo: string | null;
  subtitulo: string | null;
}

export interface BarberWebResena {
  nombre: string;
  texto: string;
  /** 1..5. */
  estrellas: number;
}

/**
 * Un día del horario de PUERTA de la barbería.
 *
 * Convención: `dia` 0 = lunes … 6 = domingo.
 *
 * Ojo: NO se lee de `BarberSchedule`. Esa tabla es el horario de cada
 * BARBERO (para la agenda de T1), no el de la puerta, y su convención de
 * `dayOfWeek` la fija la ola de agenda — deducirla desde aquí sería
 * adivinar. El horario que se publica lo escribe la barbería en el editor
 * y es la única fuente de esta página.
 */
export interface BarberWebDia {
  dia: number;
  abierto: boolean;
  /** "HH:MM" en 24 h. */
  desde: string;
  hasta: string;
}

export interface BarberWebConfig {
  /** Versión de la FORMA (no del contenido: eso es la columna `version`). */
  v: number;
  acento: BarberWebAccentId;
  /** Estado por sección, por id semántico. Compartido entre plantillas. */
  secciones: Record<string, BarberWebSeccionEstado>;
  /** Orden de las secciones POR plantilla: disposición, no contenido. */
  orden: Record<string, string[]>;
  /** { idDeRanura: url }. */
  fotos: Record<string, string>;
  /** { claveDelManifiesto: texto } — solo lo que la barbería reescribió. */
  copia: Record<string, string>;
  /** El portafolio de cortes. */
  galeria: string[];
  resenas: BarberWebResena[];
  horario: BarberWebDia[];
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  /** URL de Google Maps para incrustar. Vacío = se arma con la dirección. */
  mapaEmbed: string | null;
  seoTitulo: string | null;
  seoDescripcion: string | null;
  ogImagen: string | null;
  /** true = la barbería apagó su web a propósito. */
  oculta: boolean;
}

export const BARBER_WEB_CONFIG_V = 1;

export function configBarberWebVacia(): BarberWebConfig {
  return {
    v: BARBER_WEB_CONFIG_V,
    acento: BARBER_WEB_ACCENT_DEFAULT,
    secciones: {},
    orden: {},
    fotos: {},
    copia: {},
    galeria: [],
    resenas: [],
    horario: [],
    whatsapp: null,
    instagram: null,
    facebook: null,
    tiktok: null,
    mapaEmbed: null,
    seoTitulo: null,
    seoDescripcion: null,
    ogImagen: null,
    oculta: false,
  };
}

/* ── Vocabulario válido: la UNIÓN de las ocho plantillas ─────────────
   Se valida contra la unión y NO contra la plantilla activa. Es lo que
   permite que cambiar de plantilla no borre nada: el texto que solo pinta
   `vintage` se sigue guardando mientras la barbería usa `minimal`, y
   reaparece intacto si vuelve. */

let _cacheVocabulario: {
  secciones: Set<string>;
  fotos: Set<string>;
  copia: Map<string, number>;
} | null = null;

function vocabulario() {
  if (_cacheVocabulario) return _cacheVocabulario;
  const secciones = new Set<string>();
  const fotos = new Set<string>();
  const copia = new Map<string, number>();
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const m = BARBER_WEB_MANIFESTS[id];
    if (!m) continue;
    for (const s of m.secciones) {
      secciones.add(s.id);
      for (const f of s.fotos ?? []) fotos.add(f.id);
      for (const c of s.copia ?? []) {
        // El tope de una clave compartida es el MAYOR de las plantillas que
        // la pintan: guardar según la activa haría que cambiar de plantilla
        // recortara texto ya escrito, en silencio.
        const tope = c.maxLen ?? 160;
        copia.set(c.clave, Math.max(copia.get(c.clave) ?? 0, tope));
      }
    }
  }
  _cacheVocabulario = { secciones, fotos, copia };
  return _cacheVocabulario;
}

export function idsDeSeccionBarberWeb(): string[] {
  return Array.from(vocabulario().secciones).sort();
}

export function idsDeFotoBarberWeb(): string[] {
  return Array.from(vocabulario().fotos).sort();
}

export function esRanuraDeFotoBarberWeb(id: string): boolean {
  return vocabulario().fotos.has(id);
}

export function clavesDeCopiaBarberWeb(): string[] {
  return Array.from(vocabulario().copia.keys()).sort();
}

/* ══════════════════════════════════════════════════════════════
   5 · Normalizar lo guardado

   `config` es Json libre: puede venir vacío, a medias, de una versión
   anterior o directamente corrupto. Las plantillas NUNCA lo tocan crudo;
   pasan por aquí una sola vez y reciben una forma completa.
   ══════════════════════════════════════════════════════════════ */

const MAX_GALERIA = 40;
const MAX_RESENAS = 24;

function cadena(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function esUrlWeb(v: unknown, max = 2048): boolean {
  if (typeof v !== "string" || !v || v.length > max) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** "9:5" → "09:05"; cualquier basura → null. */
function hora(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export function normalizarConfigBarberWeb(raw: unknown): BarberWebConfig {
  const out = configBarberWebVacia();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  const voc = vocabulario();

  if (typeof o.acento === "string" && BARBER_WEB_ACCENTS.some((a) => a.id === o.acento)) {
    out.acento = o.acento as BarberWebAccentId;
  }

  if (o.secciones && typeof o.secciones === "object" && !Array.isArray(o.secciones)) {
    for (const [id, v] of Object.entries(o.secciones as Record<string, unknown>)) {
      if (!voc.secciones.has(id)) continue;
      const s = (v ?? {}) as Record<string, unknown>;
      out.secciones[id] = {
        visible: s.visible !== false,
        titulo: cadena(s.titulo, 120),
        subtitulo: cadena(s.subtitulo, 300),
      };
    }
  }

  if (o.orden && typeof o.orden === "object" && !Array.isArray(o.orden)) {
    for (const [tpl, v] of Object.entries(o.orden as Record<string, unknown>)) {
      if (!esPlantillaBarberWeb(tpl) || !Array.isArray(v)) continue;
      const ids: string[] = [];
      for (const x of v) {
        if (typeof x === "string" && voc.secciones.has(x) && !ids.includes(x)) ids.push(x);
      }
      if (ids.length) out.orden[tpl] = ids;
    }
  }

  if (o.fotos && typeof o.fotos === "object" && !Array.isArray(o.fotos)) {
    for (const [slot, v] of Object.entries(o.fotos as Record<string, unknown>)) {
      if (voc.fotos.has(slot) && esUrlWeb(v)) out.fotos[slot] = (v as string).trim();
    }
  }

  if (o.copia && typeof o.copia === "object" && !Array.isArray(o.copia)) {
    for (const [clave, v] of Object.entries(o.copia as Record<string, unknown>)) {
      const tope = voc.copia.get(clave);
      if (tope === undefined) continue;
      const t = cadena(v, tope);
      if (t) out.copia[clave] = t;
    }
  }

  if (Array.isArray(o.galeria)) {
    for (const v of o.galeria) {
      if (out.galeria.length >= MAX_GALERIA) break;
      if (esUrlWeb(v)) out.galeria.push((v as string).trim());
    }
  }

  if (Array.isArray(o.resenas)) {
    for (const v of o.resenas) {
      if (out.resenas.length >= MAX_RESENAS) break;
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const texto = cadena(r.texto, 600);
      if (!texto) continue;
      const e = Number(r.estrellas);
      out.resenas.push({
        nombre: cadena(r.nombre, 80) ?? "Cliente",
        texto,
        estrellas: Number.isFinite(e) && e >= 1 && e <= 5 ? Math.round(e) : 5,
      });
    }
  }

  if (Array.isArray(o.horario)) {
    const vistos = new Set<number>();
    for (const v of o.horario) {
      if (!v || typeof v !== "object") continue;
      const d = v as Record<string, unknown>;
      const dia = Number(d.dia);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6 || vistos.has(dia)) continue;
      const desde = hora(d.desde) ?? "09:00";
      const hasta = hora(d.hasta) ?? "20:00";
      vistos.add(dia);
      out.horario.push({ dia, abierto: d.abierto !== false, desde, hasta });
    }
    out.horario.sort((a, b) => a.dia - b.dia);
  }

  out.whatsapp = normalizarTelefono(o.whatsapp);
  out.instagram = cadena(o.instagram, 80)?.replace(/^@/, "") ?? null;
  out.facebook = cadena(o.facebook, 120) ?? null;
  out.tiktok = cadena(o.tiktok, 80)?.replace(/^@/, "") ?? null;
  out.mapaEmbed = esUrlDeMapa(o.mapaEmbed) ? (o.mapaEmbed as string).trim() : null;
  out.seoTitulo = cadena(o.seoTitulo, 70);
  out.seoDescripcion = cadena(o.seoDescripcion, 180);
  out.ogImagen = esUrlWeb(o.ogImagen) ? (o.ogImagen as string).trim() : null;
  out.oculta = o.oculta === true;

  return out;
}

/**
 * Teléfono a solo dígitos (con lada). El WhatsApp se pinta en un
 * `https://wa.me/<numero>`: dejar pasar texto libre ahí es una URL rota o,
 * peor, una inyección en el href.
 */
export function normalizarTelefono(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D+/g, "");
  if (d.length < 10 || d.length > 15) return null;
  // 10 dígitos sin lada = México, que es el 100% del mercado del vertical.
  return d.length === 10 ? `52${d}` : d;
}

/**
 * Una URL de mapa aceptable. `mapaEmbed` termina en `<iframe src>` de una
 * página PÚBLICA cacheada: solo google.com/maps, y nada de `javascript:`.
 * La CSP (frame-src) ya lo acota, pero esto no depende de que la CSP siga
 * igual mañana.
 */
export function esUrlDeMapa(v: unknown): boolean {
  if (!esUrlWeb(v)) return false;
  try {
    const u = new URL(v as string);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "www.google.com" ||
      host === "google.com" ||
      host === "maps.google.com" ||
      host.endsWith(".google.com")
    );
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   6 · Leer el config al pintar
   ══════════════════════════════════════════════════════════════ */

/** Lo que escribió la barbería para esa clave, o null (→ el default de la plantilla). */
export function copiaBarberWeb(c: BarberWebConfig, clave: string): string | null {
  const v = c.copia[clave];
  return typeof v === "string" && v.trim() ? v : null;
}

/** El texto ya resuelto, para donde hace falta una cadena (un `alt`, un `title`). */
export function textoBarberWeb(c: BarberWebConfig, clave: string, porDefecto: string): string {
  return copiaBarberWeb(c, clave) ?? porDefecto;
}

export function fotoBarberWeb(c: BarberWebConfig, slot: string): string | null {
  const u = c.fotos[slot];
  return typeof u === "string" && u.trim() ? u : null;
}

/** El título que puso la barbería, o el de la plantilla. */
export function tituloSeccion(c: BarberWebConfig, id: string, porDefecto: string): string {
  return c.secciones[id]?.titulo || porDefecto;
}

export function subtituloSeccion(c: BarberWebConfig, id: string, porDefecto?: string): string | null {
  return c.secciones[id]?.subtitulo || porDefecto || null;
}

/**
 * Las secciones de una plantilla, en el orden y con la visibilidad reales.
 *
 * Dos condiciones mandan sobre `visible`, y las dos por el mismo motivo —que
 * la página se vea TERMINADA aunque falten datos:
 *   · la barbería no la apagó, y
 *   · hay algo que enseñar (`hayDatos`).
 * Una sección encendida y vacía deja un título con un hueco debajo.
 */
export function seccionesVisibles(
  manifest: BarberWebManifest,
  config: BarberWebConfig,
  hayDatos: (fuente: BarberWebFuente) => boolean,
): BarberWebManifestSeccion[] {
  const orden = ordenDeSecciones(manifest, config);
  const porId = new Map(manifest.secciones.map((s) => [s.id, s]));
  const out: BarberWebManifestSeccion[] = [];
  for (const id of orden) {
    const s = porId.get(id);
    if (!s) continue;
    if (!s.obligatoria && config.secciones[id]?.visible === false) continue;
    if (s.consume.length > 0 && !s.consume.some((f) => hayDatos(f))) continue;
    out.push(s);
  }
  return out;
}

/**
 * El orden guardado para esta plantilla, saneado.
 *
 * Una sección que la plantilla ya no tiene se cae; una que el orden guardado
 * no menciona (porque la plantilla es nueva, o porque se agregó después) entra
 * en su posición del manifiesto. Así el orden nunca "pierde" una sección ni
 * arrastra fantasmas de otra plantilla.
 */
export function ordenDeSecciones(
  manifest: BarberWebManifest,
  config: BarberWebConfig,
): string[] {
  const disponibles = manifest.secciones.map((s) => s.id);
  const guardado = (config.orden[manifest.id] ?? []).filter((id) => disponibles.includes(id));
  if (guardado.length === 0) return disponibles;
  const out = [...guardado];
  disponibles.forEach((id, i) => {
    if (!out.includes(id)) out.splice(Math.min(i, out.length), 0, id);
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════
   7 · Formato para pintar
   ══════════════════════════════════════════════════════════════ */

const MXN_CON_CENTAVOS = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});
const MXN_REDONDO = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/** $250 · $250.50. Los centavos solo salen si los hay. */
export function precioBarberWeb(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Math.round(n * 100) % 100 === 0 ? MXN_REDONDO.format(n) : MXN_CON_CENTAVOS.format(n);
}

/** 30 → "30 min"; 60 → "1 h"; 75 → "1 h 15 min". */
export function duracionBarberWeb(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/**
 * "09:00" → "9:00 am" (como lo lee un cliente, no como lo guarda la base).
 *
 * El tipo dice `string` y `normalizarConfigBarberWeb` lo garantiza, pero
 * esto se pinta DENTRO de la página pública de la barbería y de la vista
 * previa del editor: si algún día llega un número (alguien escribió el
 * Json a mano, una migración a medias), `t.split` reventaría el render
 * entero. Una hora fea es un renglón feo; nunca una pantalla en blanco.
 */
export function horaBarberWeb(t: string): string {
  const crudo = typeof t === "string" ? t : t == null ? "" : String(t);
  const [h, m] = crudo.split(":").map(Number);
  if (!Number.isFinite(h)) return crudo;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${ampm}`;
}

export const BARBER_WEB_DIAS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

export const BARBER_WEB_DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

export interface BarberWebFilaHorario {
  dia: number;
  etiqueta: string;
  etiquetaCorta: string;
  abierto: boolean;
  rango: string | null;
}

/**
 * El horario listo para pintar, siempre con los siete días.
 *
 * NO marca "hoy": esta página se sirve por ISR y el HTML cacheado no sabe qué
 * día es cuando alguien lo abre. Un "hoy" calculado en el servidor se congela
 * con la caché y acaba señalando el día equivocado.
 */
export function horarioBarberWeb(config: BarberWebConfig): BarberWebFilaHorario[] {
  const porDia = new Map<number, BarberWebDia>();
  for (const d of diasCrudos(config)) porDia.set(Number(d.dia), d);
  return BARBER_WEB_DIAS.map((etiqueta, i) => {
    const d = porDia.get(i);
    const abierto = !!d?.abierto;
    return {
      dia: i,
      etiqueta,
      etiquetaCorta: BARBER_WEB_DIAS_CORTOS[i],
      abierto,
      rango: abierto && d ? `${horaBarberWeb(d.desde)} – ${horaBarberWeb(d.hasta)}` : null,
    };
  });
}

/**
 * Los días que hay, saltándose lo que no sea un día.
 *
 * Segundo cinturón, igual que en `horaBarberWeb`: el primero es
 * `normalizarConfigBarberWeb`, que ya deja `horario` como una lista de
 * objetos con los cuatro campos. Esto existe porque un `config.horario`
 * que no fuera una lista —o con un `null` dentro— reventaba aquí, y este
 * `.map` se ejecuta pintando la página pública de la barbería: el fallo
 * no sería un horario raro, sería la página entera caída.
 */
function diasCrudos(config: BarberWebConfig): BarberWebDia[] {
  const lista = config?.horario;
  if (!Array.isArray(lista)) return [];
  return lista.filter((d): d is BarberWebDia => !!d && typeof d === "object");
}

/** ¿Hay al menos un día abierto? Si no, la sección de horario no se pinta. */
export function tieneHorario(config: BarberWebConfig): boolean {
  return diasCrudos(config).some((d) => d.abierto);
}

/** Horario agrupado: "Lun – Vie 9:00 am – 8:00 pm". Para las plantillas compactas. */
export function horarioAgrupado(config: BarberWebConfig): string[] {
  const filas = horarioBarberWeb(config);
  const out: string[] = [];
  let i = 0;
  while (i < filas.length) {
    const f = filas[i];
    let j = i;
    while (
      j + 1 < filas.length &&
      filas[j + 1].abierto === f.abierto &&
      filas[j + 1].rango === f.rango
    ) {
      j++;
    }
    const rango =
      i === j ? f.etiquetaCorta : `${f.etiquetaCorta} – ${filas[j].etiquetaCorta}`;
    out.push(`${rango}: ${f.rango ?? "Cerrado"}`);
    i = j + 1;
  }
  return out;
}

/* ── Enlaces ─────────────────────────────────────────────────── */

export function urlWhatsApp(numero: string | null, texto?: string): string | null {
  if (!numero) return null;
  const q = texto ? `?text=${encodeURIComponent(texto)}` : "";
  return `https://wa.me/${numero}${q}`;
}

export function urlInstagram(u: string | null): string | null {
  return u ? `https://instagram.com/${u.replace(/^@/, "")}` : null;
}

export function urlTiktok(u: string | null): string | null {
  return u ? `https://tiktok.com/@${u.replace(/^@/, "")}` : null;
}

export function urlFacebook(u: string | null): string | null {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://facebook.com/${u.replace(/^\/+/, "")}`;
}

/** La dirección completa en una línea, para el mapa y el JSON-LD. */
export function direccionCompleta(shop: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const partes = [shop.address, shop.city, shop.state].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return partes.length ? partes.join(", ") : null;
}

export function urlComoLlegar(direccion: string | null): string | null {
  if (!direccion) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

/**
 * El `src` del iframe del mapa.
 *
 * O el que pegó la barbería (validado a google.com), o uno armado con la
 * dirección — `output=embed` no pide llave de API. Sin dirección, no hay mapa.
 */
export function urlMapaEmbed(config: BarberWebConfig, direccion: string | null): string | null {
  if (config.mapaEmbed) return config.mapaEmbed;
  if (!direccion) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(direccion)}&output=embed`;
}

/* ══════════════════════════════════════════════════════════════
   8 · Validar lo que llega del navegador

   Lista LITERAL. Nada de copiar `body[campo]` ni de recorrer el objeto:
   ese patrón es el que dejó una fila entera de Clinic viajando al
   navegador en el dental. Lo que no está escrito aquí, no se guarda.
   ══════════════════════════════════════════════════════════════ */

/** Tope del Json ya serializado. 96 KB ≈ 40 fotos + 24 reseñas + toda la copia. */
export const MAX_CONFIG_BYTES = 96 * 1024;

export interface ValidacionConfig {
  config: BarberWebConfig | null;
  /** Nombres, en español, de lo que venía mal. Vacío = todo bien. */
  invalidos: string[];
}

/**
 * Valida y normaliza en un solo paso.
 *
 * `normalizarConfigBarberWeb` ya descarta lo que no encaja, así que aquí se
 * comprueba lo que la normalización NO puede arreglar sola y que la barbería
 * SÍ debe enterarse de que no entró: una URL rota, un número imposible, un
 * mapa que no es de Google. Lo demás (una clave de copia que no existe) es
 * ruido de otra versión y se descarta en silencio.
 */
export function validarConfigBarberWeb(raw: unknown): ValidacionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, invalidos: ["la configuración"] };
  }
  const o = raw as Record<string, unknown>;
  const invalidos: string[] = [];

  try {
    if (JSON.stringify(o).length > MAX_CONFIG_BYTES) {
      return { config: null, invalidos: ["el tamaño de la configuración"] };
    }
  } catch {
    return { config: null, invalidos: ["la configuración"] };
  }

  const urlCampo = (k: string, etiqueta: string) => {
    const v = o[k];
    if (v === null || v === undefined || v === "") return;
    if (!esUrlWeb(v)) invalidos.push(etiqueta);
  };
  urlCampo("ogImagen", "la imagen para redes");

  if (o.mapaEmbed !== null && o.mapaEmbed !== undefined && o.mapaEmbed !== "") {
    if (!esUrlDeMapa(o.mapaEmbed)) invalidos.push("la liga del mapa (tiene que ser de Google Maps)");
  }

  if (o.whatsapp !== null && o.whatsapp !== undefined && o.whatsapp !== "") {
    if (!normalizarTelefono(o.whatsapp)) invalidos.push("el WhatsApp (10 dígitos con lada)");
  }

  if (Array.isArray(o.galeria)) {
    if (o.galeria.length > MAX_GALERIA) invalidos.push(`la galería (máximo ${MAX_GALERIA} fotos)`);
    else if (o.galeria.some((u: unknown) => !esUrlWeb(u))) invalidos.push("alguna foto de la galería");
  }

  if (o.fotos && typeof o.fotos === "object" && !Array.isArray(o.fotos)) {
    for (const [slot, v] of Object.entries(o.fotos as Record<string, unknown>)) {
      if (v === null || v === "") continue;
      if (!esUrlWeb(v)) {
        invalidos.push(`la foto «${slot}»`);
        break;
      }
    }
  }

  if (invalidos.length > 0) return { config: null, invalidos };
  return { config: normalizarConfigBarberWeb(o), invalidos: [] };
}

/* ══════════════════════════════════════════════════════════════
   9 · DOS PESTAÑAS A LA VEZ, SIN 409 FALSO

   El editor del dental devolvía 409 el 100% de las veces porque usaba
   `updatedAt` como marca: una columna con MICROsegundos que un `Date` de
   JavaScript no puede escribir, y que además bumpean veinte procesos que
   no tienen nada que ver con la mini-web.

   Aquí la marca es la columna `version` (entero) de BarberLandingConfig,
   que SOLO sube este endpoint. Eso quita el problema de la precisión y el
   de los bumpeos ajenos de un plumazo. Queda el caso de verdad: dos
   pestañas editando a la vez.

   Y ahí un 409 tampoco sirve de nada: "recarga y pierde lo que
   escribiste" no es una salida. Lo que se hace es FUSIONAR:

     base     · el config que ESTA pestaña tenía cuando empezó a editar
     mio      · lo que quiere guardar ahora
     servidor · lo que hay en la base ahora mismo

   Campo por campo (y clave por clave dentro de los mapas):
     · No lo toqué (mio == base)      → gana el servidor. Punto.
     · Lo toqué y el servidor no      → gana lo mío.
     · Lo tocamos los dos IGUAL       → no hay nada que decidir.
     · Lo tocamos los dos DISTINTO    → conflicto REAL de ese campo.

   Solo el último caso es un 409, y dice EXACTAMENTE qué campo. Guardar
   dos veces seguido desde la misma pestaña, o tocar secciones distintas
   desde dos pestañas, se resuelve solo y nadie pierde nada.
   ══════════════════════════════════════════════════════════════ */

/** Serialización estable: el ORDEN de las claves no es una diferencia. */
export function canonico(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  const claves = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
}

export function mismoValor(a: unknown, b: unknown): boolean {
  return canonico(a) === canonico(b);
}

export interface Fusion {
  config: BarberWebConfig;
  /** Nombres humanos de lo que cambiaron los DOS de forma distinta. */
  conflictos: string[];
}

/** Resuelve un valor suelto con la regla de tres vías. */
function resolver<T>(
  base: T,
  mio: T,
  servidor: T,
  etiqueta: string,
  conflictos: string[],
): T {
  const yoCambie = !mismoValor(base, mio);
  const elCambio = !mismoValor(base, servidor);
  if (!yoCambie) return servidor;
  if (!elCambio) return mio;
  if (mismoValor(mio, servidor)) return mio;
  conflictos.push(etiqueta);
  return servidor;
}

/** Fusiona un mapa clave→valor con la misma regla, clave por clave. */
function resolverMapa<T>(
  base: Record<string, T>,
  mio: Record<string, T>,
  servidor: Record<string, T>,
  etiqueta: (k: string) => string,
  conflictos: string[],
): Record<string, T> {
  const claves = new Set<string>();
  for (const k of Object.keys(base)) claves.add(k);
  for (const k of Object.keys(mio)) claves.add(k);
  for (const k of Object.keys(servidor)) claves.add(k);

  const out: Record<string, T> = {};
  Array.from(claves).forEach((k) => {
    const v = resolver(base[k], mio[k], servidor[k], etiqueta(k), conflictos);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

/**
 * Fusiona tres versiones del config. Devuelve el resultado y, si los hay,
 * los campos que chocaron de verdad.
 *
 * Las listas (galería, reseñas, horario, orden de secciones) se tratan como
 * un valor entero a propósito: fusionar dos reordenamientos elemento a
 * elemento produce órdenes que nadie pidió. Como valor entero, o gana quien
 * la tocó, o —si la tocaron los dos— sale un conflicto que se puede explicar.
 */
export function fusionarConfigBarberWeb(
  base: BarberWebConfig,
  mio: BarberWebConfig,
  servidor: BarberWebConfig,
): Fusion {
  const conflictos: string[] = [];
  const out = configBarberWebVacia();

  out.v = BARBER_WEB_CONFIG_V;
  out.acento = resolver(base.acento, mio.acento, servidor.acento, "el color de acento", conflictos);

  out.secciones = resolverMapa(
    base.secciones,
    mio.secciones,
    servidor.secciones,
    (k) => `la sección «${k}»`,
    conflictos,
  ) as Record<string, BarberWebSeccionEstado>;

  out.orden = resolverMapa(
    base.orden,
    mio.orden,
    servidor.orden,
    () => "el orden de las secciones",
    conflictos,
  ) as Record<string, string[]>;

  out.fotos = resolverMapa(base.fotos, mio.fotos, servidor.fotos, (k) => `la foto «${k}»`, conflictos);
  out.copia = resolverMapa(base.copia, mio.copia, servidor.copia, (k) => `el texto «${k}»`, conflictos);

  out.galeria = resolver(base.galeria, mio.galeria, servidor.galeria, "la galería", conflictos);
  out.resenas = resolver(base.resenas, mio.resenas, servidor.resenas, "las reseñas", conflictos);
  out.horario = resolver(base.horario, mio.horario, servidor.horario, "el horario", conflictos);

  out.whatsapp = resolver(base.whatsapp, mio.whatsapp, servidor.whatsapp, "el WhatsApp", conflictos);
  out.instagram = resolver(base.instagram, mio.instagram, servidor.instagram, "Instagram", conflictos);
  out.facebook = resolver(base.facebook, mio.facebook, servidor.facebook, "Facebook", conflictos);
  out.tiktok = resolver(base.tiktok, mio.tiktok, servidor.tiktok, "TikTok", conflictos);
  out.mapaEmbed = resolver(base.mapaEmbed, mio.mapaEmbed, servidor.mapaEmbed, "el mapa", conflictos);
  out.seoTitulo = resolver(base.seoTitulo, mio.seoTitulo, servidor.seoTitulo, "el título para Google", conflictos);
  out.seoDescripcion = resolver(
    base.seoDescripcion,
    mio.seoDescripcion,
    servidor.seoDescripcion,
    "la descripción para Google",
    conflictos,
  );
  out.ogImagen = resolver(base.ogImagen, mio.ogImagen, servidor.ogImagen, "la imagen para redes", conflictos);
  out.oculta = resolver(base.oculta, mio.oculta, servidor.oculta, "si la página está publicada", conflictos);

  // Sin duplicados: dos claves de copia en conflicto no son dos avisos.
  return { config: out, conflictos: Array.from(new Set(conflictos)) };
}

/** La plantilla, con la misma regla de tres vías. */
export function fusionarPlantilla(
  base: string,
  mio: string,
  servidor: string,
): { template: string; conflicto: boolean } {
  const conflictos: string[] = [];
  const template = resolver(base, mio, servidor, "la plantilla", conflictos);
  return { template, conflicto: conflictos.length > 0 };
}

/* ══════════════════════════════════════════════════════════════
   10 · La URL pública
   ══════════════════════════════════════════════════════════════ */

/** La ruta de la página de una barbería. Sin dominio: sirve en server y cliente. */
export function rutaWebBarberia(slug: string): string {
  return `/b/${slug}`;
}

/** La ruta del embudo de reserva (la construye T5; aquí solo se apunta). */
export function rutaReservaBarberia(slug: string, barberoId?: string | null): string {
  const base = `/b/${slug}/reservar`;
  return barberoId ? `${base}?barbero=${encodeURIComponent(barberoId)}` : base;
}

/** La ruta del portal del cliente (T5). */
export function rutaCuentaBarberia(slug: string): string {
  return `/b/${slug}/mi-cuenta`;
}
