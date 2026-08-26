/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — MOTOR DE LA WEB PÚBLICA (/i/[slug]).

   Módulo PURO y client-safe: sin prisma, sin "server-only", sin JSX. Lo
   importan el editor (navegador), las rutas públicas (servidor) y las
   pruebas. Espejo de src/lib/barber/landing.ts, con UNA dimensión más que
   no existe en barber ni en el dental:

   ── EL MODO CAMBIA EL SUJETO DE LA PÁGINA ─────────────────────────
   No es cosmética. Cambia de QUIÉN habla la página:
     · AGENT  → el sujeto es LA PERSONA. Los inmuebles son la prueba de
                su trabajo. (El 70% de los compradores mira la reputación
                del asesor antes de decidir; el 90% investiga en línea.)
     · AGENCY → el sujeto es LA EMPRESA. Los inmuebles son el catálogo, y
                cada asesor tiene su propio subdirectorio (anti-canibalización).
     · OWNER  → el sujeto es EL INMUEBLE. El dueño no quiere ser famoso:
                quiere rentar. "Trato directo con el dueño, sin comisión"
                es el gancho, porque el inquilino se ahorra el mes que
                cobra la inmobiliaria.
   Por eso cada PLANTILLA y cada BLOQUE declaran `modos`, y el editor solo
   ofrece lo que aplica al modo de la cuenta.

   ── POR QUÉ EL CONTENIDO SE GUARDA POR CLAVE SEMÁNTICA ────────────
   `copia["portada.cta"]`, `fotos["portada"]`, `bloques["inmuebles"]`. Las
   claves NO llevan dentro el id de la plantilla, así que cambiar de
   plantilla conserva todo lo que las dos comparten sin copiar nada: la
   plantilla nueva lee las mismas claves. Y lo que la nueva NO pinta se
   queda guardado esperando, porque la validación se hace contra la UNIÓN
   de las quince plantillas y no contra la activa.
   Lo único que sí va POR plantilla es el ORDEN de los bloques
   (`orden[plantilla]`), que es disposición y no contenido.

   ── LOS DOS BUGS DEL DENTAL, ARREGLADOS DE NACIMIENTO ─────────────
   1. El 409 al guardar. El dental usaba `updatedAt` como marca: un
      timestamp con MICROsegundos que un Date de JavaScript no puede
      escribir, y encima compartido con veinte procesos ajenos. Aquí la
      marca es la columna `version` (entera, solo la sube el endpoint de
      la web) y ANTES de rendirse se FUSIONA a tres bandas: solo hay 409
      cuando dos pestañas cambiaron EL MISMO campo a valores DISTINTOS, y
      se dice cuál. Ver fusionarConfigRealtyWeb.
   2. Los cinco minutos. `/i/[slug]` es ISR; sin revalidatePath explícito
      al guardar, la inmobiliaria cambia un texto, entra a su página, no
      lo ve y da por perdido lo que escribió. El endpoint revalida.

   ── LA WEB ES PÚBLICA ─────────────────────────────────────────────
   🔴 Cualquier cosa que este módulo deje pasar se sirve a un desconocido
   y se lee entera con "ver código fuente". Por eso los DTOs públicos se
   arman AQUÍ con lista blanca (aInmueblePublico / aAgentePublico /
   aCuentaPublica) y hay una prueba que les mete una fila con TODO lo
   sensible dentro y falla si algo sale. Nunca sale: notas internas,
   comisiones, documentos, datos del propietario, tokens de WhatsApp,
   ids de Stripe, correos del equipo, ni el accountId.

   Ciclo de imports: este archivo importa los MANIFIESTOS (valor) y el
   manifiesto importa de aquí solo TIPOS (`import type`, que se borra al
   compilar). En runtime el grafo es landing → manifest y no hay ciclo.
   ═══════════════════════════════════════════════════════════════════════ */

import { REALTY_WEB_BLOQUES, REALTY_WEB_MANIFESTS } from "@/lib/realty/templates/manifest";
import {
  REALTY_PUBLIC_BASE,
  type RealtyMode,
  type RealtyOperation,
  type RealtyPropertyKind,
  type RealtyPropertyStatus,
  type RealtyTourKind,
} from "@/lib/realty/types";

/* ═══════════════════════════════════════════════════════════════════
   1 · RUTAS
   ═══════════════════════════════════════════════════════════════════ */

/** La portada de la cuenta: /i/mi-inmobiliaria */
export function rutaWebInmobiliaria(slug: string): string {
  return `${REALTY_PUBLIC_BASE}/${slug}`;
}

/** El buscador con filtros: /i/mi-inmobiliaria/propiedades */
export function rutaPropiedadesWeb(slug: string): string {
  return `${REALTY_PUBLIC_BASE}/${slug}/propiedades`;
}

/**
 * La ficha del inmueble: /i/mi-inmobiliaria/propiedades/casa-en-chapalita
 *
 * `inmueble` es publicUrlSlug si lo hay, y si no el id. Los dos son únicos
 * por cuenta y la ficha resuelve por cualquiera de los dos: así una liga
 * impresa en un letrero sigue funcionando aunque después se le ponga slug.
 */
export function rutaInmuebleWeb(slug: string, inmueble: string): string {
  return `${REALTY_PUBLIC_BASE}/${slug}/propiedades/${inmueble}`;
}

/**
 * La página propia de un asesor: /i/mi-inmobiliaria/agentes/ana-lopez
 *
 * 🔴 NO es un capricho de organización: es ANTI-CANIBALIZACIÓN. Si los
 * doce asesores de una inmobiliaria hablan de las mismas colonias desde la
 * MISMA página, compiten entre sí y Google resuelve no rankeando a
 * ninguno. Cada asesor con su subdirectorio, sus zonas, su historial y su
 * WhatsApp con la atribución del prospecto.
 */
export function rutaAgenteWeb(slug: string, agente: string): string {
  return `${REALTY_PUBLIC_BASE}/${slug}/agentes/${agente}`;
}

/** El formulario de contacto: /i/mi-inmobiliaria/contacto */
export function rutaContactoWeb(slug: string): string {
  return `${REALTY_PUBLIC_BASE}/${slug}/contacto`;
}

/* ═══════════════════════════════════════════════════════════════════
   2 · LAS QUINCE PLANTILLAS — cinco por modo

   Las nueve primeras son las de la ola 1 (tres por modo). Las seis con
   la marca "premium" llegaron después con un encargo distinto: no "seis
   más", sino seis que se vean CARAS — portada a sangre, tipografía
   editorial, aire entre secciones, el listado como revista. Comparten
   motor, bloques y editor con las nueve; lo que cambia es el maquetado
   (`variante`) y la piel.
   ═══════════════════════════════════════════════════════════════════ */

export const REALTY_WEB_TEMPLATE_IDS = [
  // AGENT — el sujeto es la persona
  "asesor",
  "minimal",
  "historia",
  "editorial", // premium: el asesor como reportaje
  "tarjeta", // premium: vertical, para la bio de Instagram
  // AGENCY — el sujeto es la empresa
  "clasica",
  "corporativa",
  "boutique",
  "galeria", // premium: portada de cine, inventario como revista
  "torre", // premium: UN desarrollo manda, casi una landing de producto
  // OWNER — el sujeto es el inmueble
  "mis-rentas",
  "una-propiedad",
  "catalogo",
  "disponibilidad", // premium: tablero de lo libre, sin comisión arriba
  "vitrina", // premium: pocas propiedades, cada una con su espacio
] as const;

export type RealtyWebTemplateId = (typeof REALTY_WEB_TEMPLATE_IDS)[number];

/**
 * Qué modo usa cada plantilla. Una plantilla pertenece a UN modo: no hay
 * "sirve para todos" porque el sujeto de la página no puede ser la persona
 * y el inmueble a la vez. El editor ofrece únicamente las cinco del modo.
 */
export const REALTY_WEB_TEMPLATE_MODE: Record<RealtyWebTemplateId, RealtyMode> = {
  asesor: "AGENT",
  minimal: "AGENT",
  historia: "AGENT",
  editorial: "AGENT",
  tarjeta: "AGENT",
  clasica: "AGENCY",
  corporativa: "AGENCY",
  boutique: "AGENCY",
  galeria: "AGENCY",
  torre: "AGENCY",
  "mis-rentas": "OWNER",
  "una-propiedad": "OWNER",
  catalogo: "OWNER",
  disponibilidad: "OWNER",
  vitrina: "OWNER",
};

/**
 * La plantilla que trae cada modo de fábrica.
 *
 * El default de la COLUMNA es "clasica" (schema.prisma), que es la de
 * AGENCY. Una cuenta AGENT u OWNER sin fila de configuración caería en una
 * plantilla de otro modo, así que la resolución SIEMPRE pasa por aquí y
 * nunca por el default de la base.
 */
export const REALTY_WEB_TEMPLATE_DEFAULT: Record<RealtyMode, RealtyWebTemplateId> = {
  AGENCY: "clasica",
  AGENT: "asesor",
  OWNER: "mis-rentas",
};

export function plantillasDeModo(mode: RealtyMode): RealtyWebTemplateId[] {
  return REALTY_WEB_TEMPLATE_IDS.filter((id) => REALTY_WEB_TEMPLATE_MODE[id] === mode);
}

export function esPlantillaRealtyWeb(v: unknown): v is RealtyWebTemplateId {
  return typeof v === "string" && (REALTY_WEB_TEMPLATE_IDS as readonly string[]).includes(v);
}

/**
 * La plantilla EFECTIVA de una cuenta.
 *
 * Si la guardada no existe o es de otro modo (la cuenta cambió de AGENT a
 * AGENCY después de elegirla), cae a la del modo en vez de pintar una
 * página que habla de la persona equivocada.
 */
export function plantillaEfectiva(guardada: unknown, mode: RealtyMode): RealtyWebTemplateId {
  if (esPlantillaRealtyWeb(guardada) && REALTY_WEB_TEMPLATE_MODE[guardada] === mode) {
    return guardada;
  }
  return REALTY_WEB_TEMPLATE_DEFAULT[mode];
}

/** El manifiesto de una plantilla, cayendo al de su modo si el id no existe. */
export function manifiestoRealtyWeb(
  id: string | null | undefined,
  mode: RealtyMode = "AGENCY",
): RealtyWebManifest {
  return REALTY_WEB_MANIFESTS[plantillaEfectiva(id, mode)];
}

/** Las plantillas de un modo, para el selector del editor. */
export function manifiestosDeModo(mode: RealtyMode): RealtyWebManifest[] {
  return plantillasDeModo(mode).map((id) => REALTY_WEB_MANIFESTS[id]);
}

/* ═══════════════════════════════════════════════════════════════════
   3 · LOS BLOQUES
   ═══════════════════════════════════════════════════════════════════ */

export const REALTY_WEB_BLOQUE_IDS = [
  // Comunes a los tres modos
  "portada",
  "buscador",
  "inmuebles",
  "mapa",
  "contacto",
  // AGENT — el sujeto es la persona
  "sobre-mi",
  "credenciales",
  "zonas",
  "testimonios",
  // AGENCY — el sujeto es la empresa
  "equipo",
  "sucursales",
  "numeros",
  // OWNER — el sujeto es el inmueble
  "disponibilidad-ahora",
  "requisitos-para-rentar",
  "trato-directo",
] as const;

export type RealtyWebBloqueId = (typeof REALTY_WEB_BLOQUE_IDS)[number];

export function esBloqueRealtyWeb(v: unknown): v is RealtyWebBloqueId {
  return typeof v === "string" && (REALTY_WEB_BLOQUE_IDS as readonly string[]).includes(v);
}

/**
 * Qué DATO SUELTO pinta de verdad un bloque.
 *
 * El manifiesto lo declara bloque por bloque y una prueba lee el JSX del
 * componente y compara — con IGUALDAD ESTRICTA en las DOS direcciones:
 * declarar de más falla igual que declarar de menos. Sin esa prueba la
 * declaración se separa del código al primer refactor y el editor le
 * miente a la inmobiliaria: le ofrece llenar "credenciales" en una
 * plantilla que no las pinta, o le esconde un campo que sí saldría.
 */
export const REALTY_WEB_PINTA_KEYS = [
  "credenciales",
  "zonas",
  "testimonios",
  "requisitos",
  "numeros",
  "sucursales",
  "agentes",
  "inmuebles",
  "buscador",
  "recorrido",
  "mapa",
  "whatsapp",
  "historia",
] as const;

export type RealtyWebPinta = (typeof REALTY_WEB_PINTA_KEYS)[number];

/** De dónde saca datos un bloque. Sin ninguno de ellos, el bloque no sale. */
export type RealtyWebFuente =
  | "inmuebles"
  | "agentes"
  | "sucursales"
  | "credenciales"
  | "zonas"
  | "testimonios"
  | "requisitos"
  | "numeros"
  | "historia"
  | "contacto";

/* ═══════════════════════════════════════════════════════════════════
   4 · TIPOS DEL MANIFIESTO
   ═══════════════════════════════════════════════════════════════════ */

/** Un texto suelto editable (botones, rótulos, etiquetas). */
export interface RealtyWebManifestCopia {
  /** Clave SEMÁNTICA y COMPARTIDA entre plantillas ("portada.cta"). */
  clave: string;
  /** Nombre visible en el editor, en español de México. */
  etiqueta: string;
  /**
   * El literal REAL que pinta ESTA plantilla si no se escribe nada. Es lo
   * que la inmobiliaria ve en gris como "esto sale si lo dejas vacío": si
   * no es el literal real, el editor miente.
   */
  porDefecto: string;
  /** Tope de caracteres. REALTY_WEB_COPY_MAX si no se dice. */
  maxLen?: number;
}

/** Ranura de foto de un bloque. */
export interface RealtyWebManifestFoto {
  id: string;
  nombre: string;
  /** Proporción recomendada, tal como se le dice a la inmobiliaria. */
  proporcion: string;
  ayuda?: string;
}

/** Título y bajada del bloque. */
export interface RealtyWebManifestTexto {
  campo: "titulo" | "subtitulo";
  etiqueta: string;
  porDefecto: string;
}

/**
 * EL BLOQUE, declarado UNA sola vez.
 *
 * `modos`, `pinta` y el `consume` por defecto viven aquí y NO en cada
 * plantilla, porque el JSX del bloque es UNO solo: si cada plantilla
 * declarara su propio `pinta`, la prueba no tendría contra qué archivo
 * comparar. Lo que sí cambia por plantilla es el maquetado (`variante`), la
 * copia por defecto y si el bloque es obligatorio.
 */
export interface RealtyWebBloqueDef {
  id: RealtyWebBloqueId;
  /** Nombre visible en el editor. */
  nombre: string;
  /** Modos en los que este bloque tiene sentido. Nunca vacío. */
  modos: RealtyMode[];
  /**
   * Qué datos NECESITA para pintarse. Sin ninguno de ellos, el bloque no
   * sale: una web con la sección "Nuestro equipo" vacía se ve peor que una
   * web sin sección de equipo.
   */
  consume: RealtyWebFuente[];
  /**
   * Lo que este bloque pinta de verdad. Una prueba lee
   * src/components/realty/web/blocks/<id>.tsx y compara con IGUALDAD
   * ESTRICTA en las dos direcciones.
   */
  pinta: RealtyWebPinta[];
}

/** El bloque DENTRO de una plantilla: maquetado y textos por defecto. */
export interface RealtyWebManifestBloque {
  id: RealtyWebBloqueId;
  /** No se puede apagar ni mover. */
  obligatoria?: boolean;
  /**
   * Recorte del `consume` del catálogo para ESTA plantilla. La portada de
   * "una-propiedad" sí necesita un inmueble (es una landing de UNO solo) y
   * la de las demás no. Si se omite, manda el catálogo.
   */
  consume?: RealtyWebFuente[];
  textos?: RealtyWebManifestTexto[];
  copia?: RealtyWebManifestCopia[];
  fotos?: RealtyWebManifestFoto[];
  /**
   * Variante de maquetado que ESTA plantilla le pide al bloque. Es lo que
   * hace que dos plantillas con el mismo bloque no se parezcan: el mismo
   * componente pinta una rejilla, una lista o una portada editorial.
   */
  variante?: string;
}

/** El bloque del catálogo. Cae a un bloque neutro si el id no existe. */
export function bloqueDef(id: string): RealtyWebBloqueDef {
  return (
    REALTY_WEB_BLOQUES[id as RealtyWebBloqueId] ?? {
      id: id as RealtyWebBloqueId,
      nombre: id,
      modos: ["AGENCY", "AGENT", "OWNER"],
      consume: [],
      pinta: [],
    }
  );
}

/** Los bloques que el editor puede ofrecer en este modo de cuenta. */
export function bloquesDeModo(mode: RealtyMode): RealtyWebBloqueDef[] {
  return REALTY_WEB_BLOQUE_IDS.map((id) => REALTY_WEB_BLOQUES[id]).filter((b) =>
    b.modos.includes(mode),
  );
}

/** Lo que este bloque necesita en ESTA plantilla (instancia o catálogo). */
export function consumeDe(b: RealtyWebManifestBloque): RealtyWebFuente[] {
  return b.consume ?? bloqueDef(b.id).consume;
}

export interface RealtyWebManifest {
  id: RealtyWebTemplateId;
  nombre: string;
  modo: RealtyMode;
  /** Una línea: para quién es. */
  para: string;
  /** Qué la hace distinta, EN ESTRUCTURA (lo lee el selector del editor). */
  estructura: string;
  acentoSugerido: RealtyWebAcento;
  /** Fondo oscuro: el editor pinta la vista previa sobre negro. */
  oscura?: boolean;
  bloques: RealtyWebManifestBloque[];
}

/* ═══════════════════════════════════════════════════════════════════
   5 · ACENTOS

   La inmobiliaria NO elige un color libre: elige un acento del catálogo.
   Un #00FF00 rompe la marca y, peor, rompe el contraste — el texto blanco
   de los botones deja de leerse.

   ♿ Los seis `fuerte` pasan AA (≥4.5:1) con texto BLANCO encima. `base`
   es para acentos, bordes, iconos y texto GRANDE; `fuerte` para todo lo
   que lleve texto blanco. Misma regla que el tema del panel
   (src/app/inmobiliaria/realty-theme.css).
   ═══════════════════════════════════════════════════════════════════ */

export interface RealtyWebAcentoDef {
  id: string;
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

export const REALTY_WEB_ACENTOS = [
  { id: "pino", nombre: "Pino", base: "#3F8461", fuerte: "#2F6B4D", suave: "#EAF2ED", claro: "#94BFA6" },
  { id: "arena", nombre: "Arena", base: "#A8813F", fuerte: "#7C5E28", suave: "#F5EEDF", claro: "#D7B778" },
  { id: "tinta", nombre: "Tinta", base: "#33546F", fuerte: "#243B53", suave: "#E7EDF3", claro: "#8FAAC2" },
  { id: "terracota", nombre: "Terracota", base: "#B85B39", fuerte: "#9C4A2F", suave: "#F7E9E2", claro: "#DE9679" },
  { id: "carbon", nombre: "Carbón", base: "#4A4A4A", fuerte: "#2B2B2B", suave: "#EDEDED", claro: "#9E9E9E" },
  { id: "vino", nombre: "Vino", base: "#8A3348", fuerte: "#6E2639", suave: "#F5E5E9", claro: "#C4899A" },
] as const satisfies readonly RealtyWebAcentoDef[];

export type RealtyWebAcento = (typeof REALTY_WEB_ACENTOS)[number]["id"];

export const REALTY_WEB_ACENTO_DEFAULT: RealtyWebAcento = "pino";

export function esAcentoRealtyWeb(v: unknown): v is RealtyWebAcento {
  return typeof v === "string" && REALTY_WEB_ACENTOS.some((a) => a.id === v);
}

export function acentoRealtyWeb(id: string | null | undefined): RealtyWebAcentoDef {
  return (
    REALTY_WEB_ACENTOS.find((a) => a.id === id) ??
    REALTY_WEB_ACENTOS.find((a) => a.id === REALTY_WEB_ACENTO_DEFAULT)!
  );
}

/* ═══════════════════════════════════════════════════════════════════
   6 · LA CONFIGURACIÓN GUARDADA (RealtyLandingConfig.data)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Una credencial del asesor o de la empresa.
 *
 * 🔴 Esto NO es relleno: solo el 10% de los asesores mexicanos está
 * capacitado y el 15% pertenece a una asociación. Enseñar el EC0110.02, la
 * AMPI o el registro estatal (ya obligatorio en Nuevo León y Durango) es el
 * diferenciador más barato que existe — y con los resúmenes de IA ganando
 * terreno, E-E-A-T pesa cada vez más.
 */
export interface RealtyWebCredencial {
  /** "EC0110.02", "AMPI Guadalajara", "Registro estatal Jalisco". */
  titulo: string;
  /** Folio o número, si lo hay. Se pinta tal cual. */
  folio?: string;
  /** Año o vigencia, texto libre corto. */
  detalle?: string;
}

export interface RealtyWebTestimonio {
  nombre: string;
  texto: string;
  /** "Compró en Providencia", "Rentó en Del Valle". */
  contexto?: string;
}

/** Un número de la empresa ("18 años", "430 operaciones cerradas"). */
export interface RealtyWebNumero {
  valor: string;
  etiqueta: string;
}

/** Estado de un bloque, por id SEMÁNTICO: se comparte entre plantillas. */
export interface RealtyWebBloqueEstado {
  visible: boolean;
  titulo: string | null;
  subtitulo: string | null;
}

export interface RealtyWebConfig {
  /** Versión de la FORMA (no del contenido: eso es la columna `version`). */
  v: number;
  /** La web está publicada. false → "próximamente" + noindex. */
  publicada: boolean;
  acento: RealtyWebAcento;

  /** Estado por bloque, por id semántico. Compartido entre plantillas. */
  bloques: Record<string, RealtyWebBloqueEstado>;
  /** Orden de los bloques POR plantilla: disposición, no contenido. */
  orden: Record<string, string[]>;
  /** Fotos por ranura: { portada: "https://…" }. */
  fotos: Record<string, string>;
  /** Textos sueltos: { "portada.cta": "Ver inmuebles" }. Solo lo reescrito. */
  copia: Record<string, string>;

  /** Historia larga (bloque sobre-mi / historia de la empresa). */
  historia: string;
  credenciales: RealtyWebCredencial[];
  zonas: string[];
  testimonios: RealtyWebTestimonio[];
  /** Requisitos para rentar (modo OWNER). Uno por línea en el editor. */
  requisitos: string[];
  numeros: RealtyWebNumero[];

  /** Contacto de la WEB. Vacío = se usa el de la cuenta. */
  whatsapp: string;
  telefono: string;
  correo: string;

  facebook: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  linkedin: string;

  seoTitulo: string;
  seoDescripcion: string;
  ogImagen: string;

  /**
   * El inmueble que protagoniza la plantilla "una-propiedad". Guarda el
   * publicUrlSlug o el id; si no existe o dejó de estar publicado, la
   * página cae al más reciente en vez de quedarse en blanco.
   */
  inmuebleDestacado: string;
}

export const REALTY_WEB_CONFIG_V = 1;

export const REALTY_WEB_COPY_MAX = 160;
export const REALTY_WEB_TITULO_MAX = 120;
export const REALTY_WEB_SUBTITULO_MAX = 300;
export const REALTY_WEB_HISTORIA_MAX = 2400;
export const REALTY_WEB_TESTIMONIO_MAX = 420;
export const REALTY_WEB_SEO_TITULO_MAX = 70;
export const REALTY_WEB_SEO_DESCRIPCION_MAX = 165;
export const REALTY_WEB_MAX_CREDENCIALES = 8;
export const REALTY_WEB_MAX_ZONAS = 24;
export const REALTY_WEB_MAX_TESTIMONIOS = 12;
export const REALTY_WEB_MAX_REQUISITOS = 12;
export const REALTY_WEB_MAX_NUMEROS = 4;
/** Tope duro del Json. Un `data` gigante hace lenta TODA la página pública. */
export const REALTY_WEB_MAX_CONFIG_BYTES = 96 * 1024;

export function configRealtyWebVacia(): RealtyWebConfig {
  return {
    v: REALTY_WEB_CONFIG_V,
    publicada: true,
    acento: REALTY_WEB_ACENTO_DEFAULT,
    bloques: {},
    orden: {},
    fotos: {},
    copia: {},
    historia: "",
    credenciales: [],
    zonas: [],
    testimonios: [],
    requisitos: [],
    numeros: [],
    whatsapp: "",
    telefono: "",
    correo: "",
    facebook: "",
    instagram: "",
    tiktok: "",
    youtube: "",
    linkedin: "",
    seoTitulo: "",
    seoDescripcion: "",
    ogImagen: "",
    inmuebleDestacado: "",
  };
}

/* ── Vocabulario: la UNIÓN de las NUEVE plantillas ─────────────────────
   Se valida contra la unión y NO contra la plantilla activa. Es lo que
   permite que cambiar de plantilla no borre nada: el texto que solo pinta
   "historia" se sigue guardando mientras la cuenta usa "minimal", y
   reaparece intacto si vuelve.

   Lo mismo con el TOPE de una clave compartida: se queda con el MAYOR de
   las plantillas que la pintan. Guardar según la activa haría que cambiar
   de plantilla recortara texto ya escrito, en silencio. */

let _vocabulario: { fotos: Set<string>; copia: Map<string, number> } | null = null;

function vocabulario() {
  if (_vocabulario) return _vocabulario;
  const fotos = new Set<string>();
  const copia = new Map<string, number>();
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    const m = REALTY_WEB_MANIFESTS[id];
    if (!m) continue;
    for (const b of m.bloques) {
      for (const f of b.fotos ?? []) fotos.add(f.id);
      for (const c of b.copia ?? []) {
        const tope = c.maxLen ?? REALTY_WEB_COPY_MAX;
        copia.set(c.clave, Math.max(copia.get(c.clave) ?? 0, tope));
      }
    }
  }
  _vocabulario = { fotos, copia };
  return _vocabulario;
}

/** ¿Este id de ranura de foto existe en alguna de las quince plantillas? */
export function esRanuraDeFotoRealtyWeb(v: unknown): boolean {
  return typeof v === "string" && vocabulario().fotos.has(v);
}

/** El tope de una clave de copia, EN TODAS las plantillas. */
export function topeDeCopia(clave: string): number {
  return vocabulario().copia.get(clave) ?? REALTY_WEB_COPY_MAX;
}

/* ── Limpieza de valores sueltos ──────────────────────────────────── */

function texto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // \r\n → \n para que el tope de caracteres cuente lo mismo en Windows y
  // en el servidor; si no, un texto pegado desde Word se recorta distinto.
  return v.replace(/\r\n/g, "\n").trim().slice(0, max);
}

function unaLinea(v: unknown, max: number): string {
  return texto(v, max).replace(/[\r\n]+/g, " ");
}

/**
 * URL de imagen aceptable para la web pública.
 *
 * Solo https: una http dentro de una página https la bloquea el navegador
 * por contenido mixto y la foto sale rota, y un `javascript:` en un src no
 * ejecuta nada moderno pero tampoco tiene por qué guardarse.
 */
export function esUrlDeImagen(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim() || v.length > 2048) return false;
  try {
    return new URL(v.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function urlImagen(v: unknown): string {
  return esUrlDeImagen(v) ? String(v).trim() : "";
}

/**
 * Usuario de red social: se guarda pelado, sin arroba ni URL.
 *
 * El valor entra en un href (`https://instagram.com/<u>`): dejar pasar
 * texto libre ahí es una URL rota o, peor, una inyección en el enlace.
 */
function usuarioRed(v: unknown): string {
  const s = unaLinea(v, 120);
  if (!s) return "";
  // Si pegaron la URL completa, nos quedamos con el último segmento.
  const sinProtocolo = s.replace(/^https?:\/\/(www\.)?[^/]+\//i, "");
  const limpio = sinProtocolo.replace(/^@+/, "").replace(/[/?#].*$/, "").trim();
  // Solo lo que de verdad puede ser un usuario: letras, dígitos, punto,
  // guion y guion bajo. Cualquier otra cosa se descarta entera.
  return /^[A-Za-z0-9._-]{1,60}$/.test(limpio) ? limpio : "";
}

function listaDeTextos(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = unaLinea(item, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/* ── La normalización total ───────────────────────────────────────── */

/**
 * Json crudo de la base → config completa y segura.
 *
 * TOTAL a propósito: nunca lanza y nunca devuelve undefined. Esta función
 * corre en una página pública cacheada por ISR; un throw aquí es una web
 * caída para un desconocido que venía de Google.
 */
export function normalizarConfigRealtyWeb(raw: unknown): RealtyWebConfig {
  const out = configRealtyWebVacia();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  const voc = vocabulario();

  if (esAcentoRealtyWeb(r.acento)) out.acento = r.acento;

  if (r.bloques && typeof r.bloques === "object" && !Array.isArray(r.bloques)) {
    for (const [id, v] of Object.entries(r.bloques as Record<string, unknown>)) {
      if (!esBloqueRealtyWeb(id)) continue;
      const s = (v ?? {}) as Record<string, unknown>;
      const titulo = unaLinea(s.titulo, REALTY_WEB_TITULO_MAX);
      const subtitulo = texto(s.subtitulo, REALTY_WEB_SUBTITULO_MAX);
      out.bloques[id] = {
        visible: s.visible !== false,
        titulo: titulo || null,
        subtitulo: subtitulo || null,
      };
    }
  }

  if (r.orden && typeof r.orden === "object" && !Array.isArray(r.orden)) {
    for (const [tpl, v] of Object.entries(r.orden as Record<string, unknown>)) {
      if (!esPlantillaRealtyWeb(tpl) || !Array.isArray(v)) continue;
      const ids: string[] = [];
      for (const x of v) if (esBloqueRealtyWeb(x) && !ids.includes(x)) ids.push(x);
      if (ids.length) out.orden[tpl] = ids;
    }
  }

  if (r.fotos && typeof r.fotos === "object" && !Array.isArray(r.fotos)) {
    for (const [slot, v] of Object.entries(r.fotos as Record<string, unknown>)) {
      if (!voc.fotos.has(slot)) continue;
      const u = urlImagen(v);
      if (u) out.fotos[slot] = u;
    }
  }

  if (r.copia && typeof r.copia === "object" && !Array.isArray(r.copia)) {
    for (const [clave, v] of Object.entries(r.copia as Record<string, unknown>)) {
      const tope = voc.copia.get(clave);
      // Clave inventada → fuera, en silencio. Lo que no declara ninguna de
      // las quince plantillas no tiene dónde pintarse.
      if (tope === undefined) continue;
      const t = texto(v, tope);
      // Vacío = "vuelve a salir el literal de la plantilla". El default
      // NUNCA se materializa en la base.
      if (t) out.copia[clave] = t;
    }
  }

  if (Array.isArray(r.credenciales)) {
    for (const c of r.credenciales) {
      if (out.credenciales.length >= REALTY_WEB_MAX_CREDENCIALES) break;
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const titulo = unaLinea(o.titulo, 90);
      if (!titulo) continue;
      const folio = unaLinea(o.folio, 60);
      const detalle = unaLinea(o.detalle, 60);
      out.credenciales.push({
        titulo,
        ...(folio ? { folio } : {}),
        ...(detalle ? { detalle } : {}),
      });
    }
  }

  if (Array.isArray(r.testimonios)) {
    for (const c of r.testimonios) {
      if (out.testimonios.length >= REALTY_WEB_MAX_TESTIMONIOS) break;
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const nombre = unaLinea(o.nombre, 70);
      const cuerpo = texto(o.texto, REALTY_WEB_TESTIMONIO_MAX);
      if (!nombre || !cuerpo) continue;
      const contexto = unaLinea(o.contexto, 70);
      out.testimonios.push({
        nombre,
        texto: cuerpo,
        ...(contexto ? { contexto } : {}),
      });
    }
  }

  if (Array.isArray(r.numeros)) {
    for (const c of r.numeros) {
      if (out.numeros.length >= REALTY_WEB_MAX_NUMEROS) break;
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const valor = unaLinea(o.valor, 16);
      const etiqueta = unaLinea(o.etiqueta, 48);
      if (!valor || !etiqueta) continue;
      out.numeros.push({ valor, etiqueta });
    }
  }

  // Solo un false explícito apaga la web: una fila vieja sin la clave sigue
  // visible. Apagar una web ya indexada no puede pasar por accidente.
  out.publicada = r.publicada !== false;
  out.historia = texto(r.historia, REALTY_WEB_HISTORIA_MAX);
  out.zonas = listaDeTextos(r.zonas, REALTY_WEB_MAX_ZONAS, 60);
  out.requisitos = listaDeTextos(r.requisitos, REALTY_WEB_MAX_REQUISITOS, 120);
  out.whatsapp = normalizarTelefonoWeb(r.whatsapp);
  out.telefono = unaLinea(r.telefono, 24);
  out.correo = correoWeb(r.correo);
  out.facebook = usuarioRed(r.facebook);
  out.instagram = usuarioRed(r.instagram);
  out.tiktok = usuarioRed(r.tiktok);
  out.youtube = usuarioRed(r.youtube);
  out.linkedin = usuarioRed(r.linkedin);
  out.seoTitulo = unaLinea(r.seoTitulo, REALTY_WEB_SEO_TITULO_MAX);
  out.seoDescripcion = unaLinea(r.seoDescripcion, REALTY_WEB_SEO_DESCRIPCION_MAX);
  out.ogImagen = urlImagen(r.ogImagen);
  out.inmuebleDestacado = unaLinea(r.inmuebleDestacado, 120).replace(/[^A-Za-z0-9_-]/g, "");
  return out;
}

/**
 * Teléfono para `https://wa.me/<numero>`.
 *
 * Solo dígitos, 10 a 15. Un local de 10 se prefija con 52 (México). Dejar
 * pasar texto libre aquí es una URL rota o una inyección en el href.
 */
export function normalizarTelefonoWeb(v: unknown): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return "";
}

/** Correo para un `mailto:`. Comprobación de forma, no de existencia. */
function correoWeb(v: unknown): string {
  const s = unaLinea(v, 120).toLowerCase();
  return /^[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[a-z]{2,}$/.test(s) ? s : "";
}

/* ── Validación de lo que ENTRA por el PATCH ──────────────────────── */

/**
 * Lista LITERAL. Nada de copiar `body[campo]` ni de recorrer el objeto: ese
 * patrón es el que dejó una fila entera de Clinic viajando al navegador en
 * el dental.
 *
 * Devuelve `{ config: null, invalidos }` cuando hay algo que la
 * normalización NO puede arreglar sola (una URL rota, un WhatsApp
 * imposible, un Json gigantesco): o entra todo, o no entra nada.
 */
export function validarConfigRealtyWeb(raw: unknown): {
  config: RealtyWebConfig | null;
  invalidos: string[];
} {
  const invalidos: string[] = [];

  if (raw && typeof raw === "object") {
    let bytes = 0;
    try {
      bytes = JSON.stringify(raw).length;
    } catch {
      return { config: null, invalidos: ["la configuración (no se pudo leer)"] };
    }
    if (bytes > REALTY_WEB_MAX_CONFIG_BYTES) {
      return { config: null, invalidos: ["la configuración (demasiado grande)"] };
    }
  }

  const r = (raw ?? {}) as Record<string, unknown>;

  // Lo que se escribió PERO no pasó el filtro se reporta: si se dejara
  // pasar en silencio, la inmobiliaria vería su cambio desaparecer sin una
  // sola explicación, que es el peor error posible en un editor.
  const noVacio = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (noVacio(r.ogImagen) && !esUrlDeImagen(r.ogImagen)) {
    invalidos.push("la imagen para compartir (tiene que empezar con https)");
  }
  if (noVacio(r.whatsapp) && !normalizarTelefonoWeb(r.whatsapp)) {
    invalidos.push("el WhatsApp (escribe los 10 dígitos)");
  }
  if (noVacio(r.correo) && !correoWeb(r.correo)) {
    invalidos.push("el correo");
  }
  if (r.fotos && typeof r.fotos === "object" && !Array.isArray(r.fotos)) {
    for (const [slot, v] of Object.entries(r.fotos as Record<string, unknown>)) {
      if (noVacio(v) && !esUrlDeImagen(v)) invalidos.push(`la foto "${slot}"`);
    }
  }

  if (invalidos.length > 0) return { config: null, invalidos };
  return { config: normalizarConfigRealtyWeb(raw), invalidos: [] };
}

/* ── Redes sociales: usuario → URL ────────────────────────────────── */

export function urlInstagram(u: string): string | null {
  return u ? `https://instagram.com/${u}` : null;
}
export function urlFacebook(u: string): string | null {
  return u ? `https://facebook.com/${u}` : null;
}
export function urlTiktok(u: string): string | null {
  return u ? `https://tiktok.com/@${u}` : null;
}
export function urlYoutube(u: string): string | null {
  return u ? `https://youtube.com/@${u}` : null;
}
export function urlLinkedin(u: string): string | null {
  return u ? `https://linkedin.com/in/${u}` : null;
}

/* ═══════════════════════════════════════════════════════════════════
   7 · ORDEN Y VISIBILIDAD DE LOS BLOQUES
   ═══════════════════════════════════════════════════════════════════ */

/**
 * El orden guardado para esta plantilla, saneado.
 *
 * Un bloque que la plantilla ya no tiene se cae; uno que el orden guardado
 * no menciona (porque la plantilla es nueva, o porque se agregó después)
 * entra en su posición del manifiesto. Así el orden nunca "pierde" un
 * bloque ni arrastra fantasmas de otra plantilla.
 */
export function ordenDeBloques(manifest: RealtyWebManifest, config: RealtyWebConfig): string[] {
  const disponibles = manifest.bloques.map((b) => b.id as string);
  const guardado = (config.orden[manifest.id] ?? []).filter((id) => disponibles.includes(id));
  if (guardado.length === 0) return disponibles;
  const out = [...guardado];
  disponibles.forEach((id, i) => {
    if (!out.includes(id)) out.splice(Math.min(i, out.length), 0, id);
  });
  return out;
}

/**
 * Los bloques que se pintan, en el orden real.
 *
 * Se cae un bloque si: la cuenta lo apagó (y no es obligatorio), o no hay
 * NINGUNO de los datos que consume. Una web con "Nuestro equipo" vacío se
 * ve peor que una web sin sección de equipo.
 */
export function bloquesVisibles(
  manifest: RealtyWebManifest,
  config: RealtyWebConfig,
  hayDatos: (f: RealtyWebFuente) => boolean,
): RealtyWebManifestBloque[] {
  const orden = ordenDeBloques(manifest, config);
  const porId = new Map(manifest.bloques.map((b) => [b.id as string, b]));
  const out: RealtyWebManifestBloque[] = [];
  for (const id of orden) {
    const b = porId.get(id);
    if (!b) continue;
    if (!b.obligatoria && config.bloques[id]?.visible === false) continue;
    const fuentes = consumeDe(b);
    if (fuentes.length > 0 && !fuentes.some((f) => hayDatos(f))) continue;
    out.push(b);
  }
  return out;
}

/**
 * ¿De qué datos dispone esta web? Lo consulta bloquesVisibles para no
 * pintar secciones vacías.
 *
 * DENTRO del editor devuelve true para todo: quien todavía no captura
 * inmuebles necesita ver dónde van a caer. En público es la verdad.
 */
export function hayDatosDe(data: RealtyWebData): (f: RealtyWebFuente) => boolean {
  if (data.editando) return () => true;
  return (f: RealtyWebFuente) => {
    switch (f) {
      case "inmuebles":
        return data.inmuebles.length > 0;
      case "agentes":
        return data.agentes.length > 0;
      case "sucursales":
        return data.sucursales.length > 0;
      case "credenciales":
        return data.config.credenciales.length > 0 || data.cuenta.licencia !== null;
      case "zonas":
        return data.config.zonas.length > 0;
      case "testimonios":
        return data.config.testimonios.length > 0;
      case "requisitos":
        return data.config.requisitos.length > 0;
      case "numeros":
        return data.config.numeros.length > 0;
      case "historia":
        return data.config.historia.trim().length > 0;
      case "contacto":
        return true;
      default:
        return false;
    }
  };
}

/* ── Lectura de contenido con el default de la plantilla ──────────────
   El default NO se materializa nunca: se resuelve al pintar, leyendo el
   manifiesto de la plantilla ACTIVA. Si el JSX escribiera su propio
   literal, el placeholder gris del editor y la página se separarían al
   primer cambio. */

/** Lo que escribió la cuenta para esa clave, o null (→ default de la plantilla). */
export function copiaRealtyWeb(c: RealtyWebConfig, clave: string): string | null {
  const v = c.copia[clave];
  return typeof v === "string" && v.trim() ? v : null;
}

export function fotoRealtyWeb(c: RealtyWebConfig, slot: string): string | null {
  const v = c.fotos[slot];
  return typeof v === "string" && v.trim() ? v : null;
}

export function tituloBloque(c: RealtyWebConfig, id: string, porDefecto: string): string {
  return c.bloques[id]?.titulo || porDefecto;
}

export function subtituloBloque(
  c: RealtyWebConfig,
  id: string,
  porDefecto?: string,
): string | null {
  return c.bloques[id]?.subtitulo || porDefecto || null;
}

/* ═══════════════════════════════════════════════════════════════════
   8 · FUSIÓN A TRES BANDAS — el 409 que casi nunca ocurre
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Serialización estable: el ORDEN de las claves no es una diferencia.
 *
 * `jsonb` de Postgres NO conserva el orden de inserción, así que un
 * JSON.stringify a secas marcaría conflicto entre dos objetos idénticos
 * que volvieron de la base reordenados.
 */
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

/**
 * Quién gana cuando los DOS cambiaron el mismo campo a valores distintos.
 *
 * · "servidor" (el default) → el que usa el endpoint al guardar: si hay
 *   choque real se devuelve 409 y decide la persona.
 * · "mio" → el que usa el botón "Publicar lo mío" de la pantalla de
 *   conflicto. Es lo que hace que ese botón signifique "gana lo mío EN LO
 *   QUE CHOCÓ" y no "revierte todo lo suyo".
 */
export type GanadorDelChoque = "servidor" | "mio";

/** Resuelve un valor suelto con la regla de tres vías. */
function resolver<T>(
  base: T,
  mio: T,
  servidor: T,
  etiqueta: string,
  conflictos: string[],
  gana: GanadorDelChoque = "servidor",
): T {
  const yoCambie = !mismoValor(base, mio);
  const elCambio = !mismoValor(base, servidor);
  if (!yoCambie) return servidor;
  if (!elCambio) return mio;
  if (mismoValor(mio, servidor)) return mio;
  conflictos.push(etiqueta);
  return gana === "mio" ? mio : servidor;
}

/** Fusiona un mapa clave→valor con la misma regla, clave por clave. */
function resolverMapa<T>(
  base: Record<string, T>,
  mio: Record<string, T>,
  servidor: Record<string, T>,
  etiqueta: (k: string) => string,
  conflictos: string[],
  gana: GanadorDelChoque = "servidor",
): Record<string, T> {
  const claves = new Set<string>();
  for (const k of Object.keys(base ?? {})) claves.add(k);
  for (const k of Object.keys(mio ?? {})) claves.add(k);
  for (const k of Object.keys(servidor ?? {})) claves.add(k);

  const out: Record<string, T> = {};
  Array.from(claves).forEach((k) => {
    const v = resolver(base?.[k], mio?.[k], servidor?.[k], etiqueta(k), conflictos, gana);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

/**
 * El mapa de BLOQUES, resuelto CAMPO A CAMPO y no como un objeto entero.
 *
 * 🔴 Un bloque son tres campos independientes (`visible`, `titulo`,
 * `subtitulo`) y editarlos es lo más cotidiano que hay: uno cambia el
 * título de la portada mientras el otro escribe la bajada. Tratando el
 * bloque como un valor único, eso daba un 409 aunque hubieran tocado cosas
 * distintas — y si la persona elegía "publicar lo mío", la bajada del otro
 * se perdía entera.
 *
 * Las LISTAS sí se siguen tratando como un valor entero (credenciales,
 * zonas, orden…), y ahí es la decisión correcta: fusionar dos
 * reordenamientos elemento a elemento produce órdenes que nadie pidió. Un
 * bloque no es una lista.
 */
function resolverBloques(
  base: Record<string, RealtyWebBloqueEstado>,
  mio: Record<string, RealtyWebBloqueEstado>,
  servidor: Record<string, RealtyWebBloqueEstado>,
  conflictos: string[],
  gana: GanadorDelChoque = "servidor",
): Record<string, RealtyWebBloqueEstado> {
  const claves = new Set<string>();
  for (const k of Object.keys(base ?? {})) claves.add(k);
  for (const k of Object.keys(mio ?? {})) claves.add(k);
  for (const k of Object.keys(servidor ?? {})) claves.add(k);

  const out: Record<string, RealtyWebBloqueEstado> = {};
  Array.from(claves).forEach((k) => {
    const b = base?.[k];
    const m = mio?.[k];
    const s = servidor?.[k];
    // La sección entera se borró en los tres lados: no hay nada que armar.
    if (b === undefined && m === undefined && s === undefined) return;
    // Si en algún lado la sección NO existe, se la trata como "por defecto"
    // (visible, sin textos): así "la creé yo" y "la borró él" se comparan
    // campo a campo igual que el resto y no salta un choque falso.
    const vacio: RealtyWebBloqueEstado = { visible: true, titulo: null, subtitulo: null };
    const bb = b ?? vacio;
    const mm = m ?? vacio;
    const ss = s ?? vacio;
    out[k] = {
      visible: resolver(bb.visible, mm.visible, ss.visible, `si se ve la sección «${k}»`, conflictos, gana),
      titulo: resolver(bb.titulo, mm.titulo, ss.titulo, `el título de «${k}»`, conflictos, gana),
      subtitulo: resolver(
        bb.subtitulo,
        mm.subtitulo,
        ss.subtitulo,
        `la bajada de «${k}»`,
        conflictos,
        gana,
      ),
    };
  });
  return out;
}

export interface FusionRealtyWeb {
  config: RealtyWebConfig;
  /** Nombres humanos de lo que los dos cambiaron distinto. Vacío = sin 409. */
  conflictos: string[];
}

/**
 * Fusiona lo que mandó esta pestaña con lo que hay en el servidor,
 * tomando como referencia la base que esta pestaña cargó.
 *
 *   · No lo toqué (mio == base)      → gana el servidor. Punto.
 *   · Lo toqué y el servidor no      → gana lo mío.
 *   · Lo tocamos los dos IGUAL       → no hay nada que decidir.
 *   · Lo tocamos los dos DISTINTO    → conflicto REAL de ESE campo.
 *
 * Solo el último caso es un 409, y dice exactamente qué campo.
 *
 * Las LISTAS (credenciales, zonas, testimonios, requisitos, números y el
 * ORDEN de los bloques) se tratan como UN valor entero a propósito:
 * fusionar dos reordenamientos elemento a elemento produce órdenes que
 * nadie pidió, y eso es peor que decir "esto lo cambiaron los dos".
 */
export function fusionarConfigRealtyWeb(
  base: RealtyWebConfig,
  mio: RealtyWebConfig,
  servidor: RealtyWebConfig,
  gana: GanadorDelChoque = "servidor",
): FusionRealtyWeb {
  const c: string[] = [];
  const out = configRealtyWebVacia();

  out.v = REALTY_WEB_CONFIG_V;
  out.publicada = resolver(base.publicada, mio.publicada, servidor.publicada, "si la web está publicada", c, gana);
  out.acento = resolver(base.acento, mio.acento, servidor.acento, "el color", c, gana);

  out.bloques = resolverBloques(base.bloques, mio.bloques, servidor.bloques, c, gana);
  out.orden = resolverMapa(
    base.orden,
    mio.orden,
    servidor.orden,
    () => "el orden de las secciones",
    c,
    gana,
  ) as Record<string, string[]>;
  out.fotos = resolverMapa(base.fotos, mio.fotos, servidor.fotos, (k) => `la foto «${k}»`, c, gana);
  out.copia = resolverMapa(base.copia, mio.copia, servidor.copia, (k) => `el texto «${k}»`, c, gana);

  out.historia = resolver(base.historia, mio.historia, servidor.historia, "la historia", c, gana);
  out.credenciales = resolver(base.credenciales, mio.credenciales, servidor.credenciales, "las credenciales", c, gana);
  out.zonas = resolver(base.zonas, mio.zonas, servidor.zonas, "las zonas", c, gana);
  out.testimonios = resolver(base.testimonios, mio.testimonios, servidor.testimonios, "los testimonios", c, gana);
  out.requisitos = resolver(base.requisitos, mio.requisitos, servidor.requisitos, "los requisitos para rentar", c, gana);
  out.numeros = resolver(base.numeros, mio.numeros, servidor.numeros, "los números", c, gana);

  out.whatsapp = resolver(base.whatsapp, mio.whatsapp, servidor.whatsapp, "el WhatsApp", c, gana);
  out.telefono = resolver(base.telefono, mio.telefono, servidor.telefono, "el teléfono", c, gana);
  out.correo = resolver(base.correo, mio.correo, servidor.correo, "el correo", c, gana);
  out.facebook = resolver(base.facebook, mio.facebook, servidor.facebook, "Facebook", c, gana);
  out.instagram = resolver(base.instagram, mio.instagram, servidor.instagram, "Instagram", c, gana);
  out.tiktok = resolver(base.tiktok, mio.tiktok, servidor.tiktok, "TikTok", c, gana);
  out.youtube = resolver(base.youtube, mio.youtube, servidor.youtube, "YouTube", c, gana);
  out.linkedin = resolver(base.linkedin, mio.linkedin, servidor.linkedin, "LinkedIn", c, gana);

  out.seoTitulo = resolver(base.seoTitulo, mio.seoTitulo, servidor.seoTitulo, "el título de Google", c, gana);
  out.seoDescripcion = resolver(
    base.seoDescripcion,
    mio.seoDescripcion,
    servidor.seoDescripcion,
    "la descripción de Google",
    c,
    gana,
  );
  out.ogImagen = resolver(base.ogImagen, mio.ogImagen, servidor.ogImagen, "la imagen para compartir", c, gana);
  out.inmuebleDestacado = resolver(
    base.inmuebleDestacado,
    mio.inmuebleDestacado,
    servidor.inmuebleDestacado,
    "el inmueble destacado",
    c,
    gana,
  );

  // Sin duplicados: dos claves de copia en conflicto no son dos avisos.
  return { config: out, conflictos: Array.from(new Set(c)) };
}

/**
 * La PLANTILLA también se fusiona: si solo uno la cambió, gana ese; si los
 * dos la cambiaron a plantillas distintas, es conflicto y hay que decirlo
 * (no se puede pintar media web con cada una).
 */
export function fusionarPlantilla(
  base: RealtyWebTemplateId,
  mio: RealtyWebTemplateId,
  servidor: RealtyWebTemplateId,
  gana: GanadorDelChoque = "servidor",
): { template: RealtyWebTemplateId; conflicto: boolean } {
  const conflictos: string[] = [];
  const template = resolver(base, mio, servidor, "la plantilla", conflictos, gana);
  return { template, conflicto: conflictos.length > 0 };
}

/* ═══════════════════════════════════════════════════════════════════
   9 · FORMATO (español de México)
   ═══════════════════════════════════════════════════════════════════ */

/** "$3,450,000" / "$18,500 USD". Sin centavos: nadie anuncia .00 en una casa. */
export function precioInmueble(monto: number, moneda: string = "MXN"): string {
  if (!Number.isFinite(monto) || monto <= 0) return "Precio a consultar";
  try {
    const s = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: moneda === "USD" ? "USD" : "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(monto);
    return moneda === "USD" ? `${s} USD` : s;
  } catch {
    return `$${Math.round(monto).toLocaleString("es-MX")}${moneda === "USD" ? " USD" : ""}`;
  }
}

/** "180 m²". null si no hay dato: un "0 m²" en una ficha se ve a error. */
export function superficie(m2: number | null | undefined): string | null {
  if (m2 === null || m2 === undefined) return null;
  const n = Number(m2);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n).toLocaleString("es-MX")} m²`;
}

/** "2 recámaras", "1 recámara". Español de México: nunca "habitación". */
export function recamaras(n: number | null | undefined): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  const r = Math.round(v);
  return r === 1 ? "1 recámara" : `${r} recámaras`;
}

export function banos(
  enteros: number | null | undefined,
  medios: number | null | undefined,
): string | null {
  const e = Number(enteros);
  const m = Number(medios);
  const total = (Number.isFinite(e) ? e : 0) + (Number.isFinite(m) ? m : 0) * 0.5;
  if (total <= 0) return null;
  const txt = Number.isInteger(total) ? String(total) : total.toFixed(1);
  return total === 1 ? "1 baño" : `${txt} baños`;
}

/** "2 cocheras". Cochera, JAMÁS "garage" ni "estacionamiento" en la ficha. */
export function cocheras(n: number | null | undefined): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  const r = Math.round(v);
  return r === 1 ? "1 cochera" : `${r} cocheras`;
}

/* ═══════════════════════════════════════════════════════════════════
   10 · DTOs PÚBLICOS — la lista blanca de salida
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 🔴 ESTA ES LA FRONTERA. Todo lo que salga de estos tipos viaja a un
 * navegador desconocido y se lee entero con "ver código fuente" — además
 * queda cacheado por ISR, así que ni siquiera hace falta que el visitante
 * llegue en el momento justo.
 *
 * Lo que NO está aquí no se pinta, y punto: internalNotes, commissionPct,
 * ownerId/owner (el dueño del inmueble no es un dato público), documentos,
 * assignedUserId, accountId, correos del equipo, whatsappToken, wabaId,
 * phoneNumberId, stripeCustomerId, stripeSubscriptionId, subscriptionStatus
 * y storageUsedBytes.
 *
 * Los mapeadores de abajo son PUROS (no tocan prisma) para que la prueba
 * pueda meterles una fila con TODO lo sensible dentro y comprobar que no
 * sale nada. La prueba vive en src/lib/realty/templates/__tests__.
 */
export interface RealtyWebFotoDTO {
  url: string;
  width: number | null;
  height: number | null;
  isCover: boolean;
}

export interface RealtyWebTourDTO {
  kind: RealtyTourKind;
  provider: string;
  url: string;
}

export interface RealtyWebInmuebleDTO {
  /** Segmento de la URL: publicUrlSlug si lo hay, si no el id. */
  ref: string;
  titulo: string;
  descripcion: string | null;
  kind: RealtyPropertyKind;
  operation: RealtyOperation;
  status: RealtyPropertyStatus;
  precio: number;
  moneda: string;
  precioRenta: number | null;
  mantenimiento: number | null;
  terrenoM2: number | null;
  construidoM2: number | null;
  recamaras: number | null;
  banos: number | null;
  mediosBanos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  amenidades: string[];
  colonia: string | null;
  ciudad: string | null;
  estado: string | null;
  /** Calle y número SOLO si showExactAddress. Si no, null. */
  direccion: string | null;
  /** Coordenadas SOLO si showExactAddress. Si no, null (ni aproximadas). */
  lat: number | null;
  lng: number | null;
  direccionExacta: boolean;
  folio: string | null;
  fotos: RealtyWebFotoDTO[];
  tours: RealtyWebTourDTO[];
  publicadoEn: string;
}

export interface RealtyWebAgenteDTO {
  /** Segmento de la URL. null = no tiene página propia. */
  ref: string | null;
  nombre: string;
  foto: string | null;
  bio: string | null;
  zonas: string[];
  especialidades: string[];
  credenciales: RealtyWebCredencial[];
  /** WhatsApp del asesor, para la atribución del prospecto. */
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
}

export interface RealtyWebSucursalDTO {
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  // SIN lat/lng: nada las pinta, y una oficina NO tiene el interruptor
  // `showExactAddress` que sí protege al inmueble. Carga muerta con filo:
  // el día que alguien pasara `data.sucursales` a un componente cliente,
  // publicaría las coordenadas exactas de las oficinas sin quererlo.
  esMatriz: boolean;
}

export interface RealtyWebCuentaDTO {
  slug: string;
  nombre: string;
  modo: RealtyMode;
  telefono: string | null;
  // 🔴 SIN `correo`. El de RealtyAccount es el MISMO con el que se entra al
  // panel (el alta escribe el mismo valor en RealtyAccount.email y en
  // RealtyUser.email, que es la credencial). El correo público es
  // `config.correo`, el que la cuenta escribe a mano en su editor sabiendo
  // que se publica. Misma regla que ya tenía el asesor.
  direccion: string | null;
  ciudad: string | null;
  estado: string | null;
  logo: string | null;
  /** Licencia inmobiliaria estatal, solo si sigue vigente. */
  licencia: { numero: string; estado: string | null } | null;
}

/**
 * Lo que recibe una plantilla. Lo arman DOS sitios —el servidor en
 * /i/[slug] y el editor en el navegador para la vista previa— así que la
 * forma se escribe aquí y no dentro de ninguno de los dos.
 */
export interface RealtyWebData {
  cuenta: RealtyWebCuentaDTO;
  config: RealtyWebConfig;
  manifest: RealtyWebManifest;
  inmuebles: RealtyWebInmuebleDTO[];
  agentes: RealtyWebAgenteDTO[];
  sucursales: RealtyWebSucursalDTO[];
  /** Cuántos inmuebles publicados hay en total (el listado enseña una página). */
  totalInmuebles: number;
  /**
   * true = se está pintando DENTRO del editor.
   *
   * Lo usan los bloques para NO esconderse cuando están vacíos: quien
   * todavía no captura inmuebles necesita ver dónde van a caer. En público
   * es siempre false y el bloque vacío no se pinta.
   */
  editando?: boolean;
}

/* ── Mapeadores puros ─────────────────────────────────────────────── */

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * ¿Esta URL de archivo se puede publicar?
 *
 * 🔴 EL BUCKET DEL VERTICAL ES PRIVADO. `realty-files` guarda escrituras,
 * prediales e identificaciones y se sirve con URLs FIRMADAS de cinco
 * minutos. Si un día la ola de inmuebles guardara una URL firmada en
 * `RealtyPropertyPhoto.url` o en `RealtyPropertyTour.fileUrl`, ese token
 * quedaría incrustado en una página ISR cacheada y legible con "ver código
 * fuente" — que es EXACTAMENTE la fuga de tokens de la mini-web del dental,
 * otra vez.
 *
 * Esta reja lo hace imposible: una URL con firma se descarta y la foto
 * simplemente no sale. Una foto que falta es un defecto que se ve y se
 * arregla; un token publicado no se ve hasta que alguien lo usa.
 */
export function esUrlDeArchivoPublica(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // Supabase Storage: /object/sign/… + ?token=…   ·   S3: ?X-Amz-Signature=…
  if (/\/object\/sign\//i.test(u.pathname)) return false;
  for (const clave of Array.from(u.searchParams.keys())) {
    if (/^(token|x-amz-signature|x-amz-credential|signature|sig|se|sp|sv)$/i.test(clave)) {
      return false;
    }
  }
  return true;
}

/**
 * Amenidades: el Json libre de RealtyProperty → lista de claves activas.
 * Solo claves con valor true; los textos libres no se pintan como pastilla.
 */
export function amenidadesActivas(amenities: unknown): string[] {
  if (!amenities || typeof amenities !== "object" || Array.isArray(amenities)) return [];
  return Object.entries(amenities as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .slice(0, 30);
}

/** Fila de inmueble (con fotos y tours ya cargados) → DTO público. */
export function aInmueblePublico(row: Record<string, unknown>): RealtyWebInmuebleDTO {
  const exacta = row.showExactAddress === true;
  const fotosRaw = Array.isArray(row.photos) ? (row.photos as Record<string, unknown>[]) : [];
  const toursRaw = Array.isArray(row.tours) ? (row.tours as Record<string, unknown>[]) : [];

  // esUrlDeArchivoPublica y no una comprobación de "hay algo": una URL
  // FIRMADA del bucket privado se descarta aquí y no llega jamás al HTML.
  const fotos: RealtyWebFotoDTO[] = fotosRaw
    .map((f) => ({
      url: esUrlDeArchivoPublica(f.url) ? String(f.url).trim() : "",
      width: num(f.width),
      height: num(f.height),
      isCover: f.isCover === true,
    }))
    .filter((f) => f.url !== "");

  const tours: RealtyWebTourDTO[] = toursRaw
    .map((t) => {
      // externalUrl XOR fileUrl. Sin ninguno, el recorrido no existe.
      const cruda = str(t.externalUrl) ?? str(t.fileUrl) ?? "";
      return {
        kind: (typeof t.kind === "string" ? t.kind : "TOUR_360") as RealtyTourKind,
        provider: typeof t.provider === "string" ? t.provider : "propio",
        url: esUrlDeArchivoPublica(cruda) ? cruda : "",
      };
    })
    .filter((t) => t.url !== "");

  const creado = row.createdAt;

  return {
    ref: str(row.publicUrlSlug) ?? String(row.id ?? ""),
    titulo: typeof row.title === "string" ? row.title : "Inmueble",
    descripcion: str(row.description),
    kind: (typeof row.kind === "string" ? row.kind : "CASA") as RealtyPropertyKind,
    operation: (typeof row.operation === "string" ? row.operation : "VENTA") as RealtyOperation,
    status: (typeof row.status === "string" ? row.status : "DISPONIBLE") as RealtyPropertyStatus,
    precio: num(row.price) ?? 0,
    moneda: row.currency === "USD" ? "USD" : "MXN",
    precioRenta: num(row.rentPrice),
    mantenimiento: num(row.maintenanceFee),
    terrenoM2: num(row.landM2),
    construidoM2: num(row.builtM2),
    recamaras: num(row.bedrooms),
    banos: num(row.bathrooms),
    mediosBanos: num(row.halfBathrooms),
    cocheras: num(row.parking),
    antiguedad: num(row.ageYears),
    amenidades: amenidadesActivas(row.amenities),
    colonia: str(row.colonia),
    ciudad: str(row.city),
    estado: str(row.state),
    // 🔴 La calle NO sale si el propietario pidió privacidad. Tampoco las
    // coordenadas: un pin "aproximado" con la latitud real a siete
    // decimales es la dirección exacta con otro nombre.
    direccion: exacta ? str(row.address) : null,
    lat: exacta ? num(row.lat) : null,
    lng: exacta ? num(row.lng) : null,
    direccionExacta: exacta,
    folio: str(row.shortTermFolio),
    fotos,
    tours,
    publicadoEn:
      creado instanceof Date
        ? creado.toISOString()
        : typeof creado === "string"
          ? creado
          : new Date(0).toISOString(),
  };
}

/**
 * Ficha pública del asesor.
 *
 * El correo del asesor NO sale: es su credencial de acceso al panel (el
 * correo del equipo es el login), y publicarlo lo convierte en la mitad de
 * un intento de entrada. El contacto público es el WhatsApp.
 */
export function aAgentePublico(row: Record<string, unknown>): RealtyWebAgenteDTO {
  const socials =
    row.socials && typeof row.socials === "object" && !Array.isArray(row.socials)
      ? (row.socials as Record<string, unknown>)
      : {};

  const credenciales: RealtyWebCredencial[] = (() => {
    const c = row.credentials;
    if (!Array.isArray(c)) return [];
    const out: RealtyWebCredencial[] = [];
    for (const x of c) {
      if (out.length >= REALTY_WEB_MAX_CREDENCIALES) break;
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const titulo = str(o.titulo) ?? str(o.title) ?? str(o.nombre);
      if (!titulo) continue;
      const folio = str(o.folio);
      const detalle = str(o.detalle);
      out.push({
        titulo: titulo.slice(0, 90),
        ...(folio ? { folio: folio.slice(0, 60) } : {}),
        ...(detalle ? { detalle: detalle.slice(0, 60) } : {}),
      });
    }
    return out;
  })();

  const lista = (v: unknown, max: number) =>
    Array.isArray(v)
      ? (v as unknown[])
          .filter((z): z is string => typeof z === "string" && !!z.trim())
          .map((z) => z.trim())
          .slice(0, max)
      : [];

  return {
    ref: str(row.publicSlug),
    nombre: typeof row.displayName === "string" ? row.displayName : "Asesor",
    foto: esUrlDeImagen(row.photoUrl) ? String(row.photoUrl).trim() : null,
    bio: str(row.bio),
    zonas: lista(row.zones, REALTY_WEB_MAX_ZONAS),
    especialidades: lista(row.specialties, 12),
    credenciales,
    whatsapp: normalizarTelefonoWeb(socials.whatsapp) || null,
    instagram: str(socials.instagram),
    facebook: str(socials.facebook),
    linkedin: str(socials.linkedin),
  };
}

export function aSucursalPublica(row: Record<string, unknown>): RealtyWebSucursalDTO {
  return {
    nombre: typeof row.name === "string" ? row.name : "Oficina",
    direccion: str(row.address),
    telefono: str(row.phone),
    esMatriz: row.isMain === true,
  };
}

/**
 * La cuenta.
 *
 * 🔴 Aquí es donde el dental se filtró la fila entera de la clínica al
 * navegador. La licencia solo sale si NO está vencida: presumir una
 * licencia caducada es peor que no enseñar ninguna.
 */
export function aCuentaPublica(
  row: Record<string, unknown>,
  ahora: Date = new Date(),
): RealtyWebCuentaDTO {
  const numero = str(row.licenseNumber);
  const vence = row.licenseExpiresAt;
  const venceDate =
    vence instanceof Date ? vence : typeof vence === "string" ? new Date(vence) : null;
  const vigente =
    !!numero &&
    (venceDate === null ||
      Number.isNaN(venceDate.getTime()) ||
      venceDate.getTime() >= ahora.getTime());

  return {
    slug: typeof row.slug === "string" ? row.slug : "",
    nombre: typeof row.name === "string" ? row.name : "",
    modo: (typeof row.mode === "string" ? row.mode : "AGENCY") as RealtyMode,
    telefono: str(row.phone),
    direccion: str(row.address),
    ciudad: str(row.city),
    estado: str(row.state),
    logo: esUrlDeImagen(row.logoUrl) ? String(row.logoUrl).trim() : null,
    licencia: vigente ? { numero: numero as string, estado: str(row.licenseState) } : null,
  };
}

/**
 * Los nombres de campo que JAMÁS pueden aparecer en un DTO público.
 *
 * La prueba serializa cada DTO y falla si encuentra cualquiera de estas
 * claves — o el VALOR centinela que se le metió a la fila de prueba. Es la
 * misma reja de src/lib/team/member-fields.ts y src/lib/b2b/vendor-fields.ts:
 * si un campo huele a credencial, la prueba falla aunque nadie se acuerde
 * de por qué.
 */
export const REALTY_WEB_CAMPOS_PROHIBIDOS: string[] = [
  "accountId",
  // El correo de la cuenta y el del asesor son su usuario del panel: el
  // público es el que se escribe a mano en el editor (config.correo).
  "email",
  "correo",
  "internalNotes",
  "commissionPct",
  "ownerId",
  "owner",
  "ownerName",
  "assignedUserId",
  "assignedUserName",
  "officeId",
  "documents",
  "whatsappToken",
  "wabaId",
  "phoneNumberId",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "subscriptionStatus",
  "storageUsedBytes",
  "supabaseId",
  "permissionsOverride",
  "realtyUserId",
  "legalName",
  "teamSize",
  "messageQuota",
  "messagesUsedPeriod",
  "apiKey",
  "isPublished",
  "plan",
];

/* ═══════════════════════════════════════════════════════════════════
   11 · UTILIDADES DE LA WEB
   ═══════════════════════════════════════════════════════════════════ */

/** ¿Este inmueble tiene recorrido virtual? (para la insignia del listado). */
export function tieneRecorrido(inm: Pick<RealtyWebInmuebleDTO, "tours">): boolean {
  return inm.tours.length > 0;
}

/** La foto de portada del inmueble, o la primera, o null. */
export function fotoPortada(inm: Pick<RealtyWebInmuebleDTO, "fotos">): RealtyWebFotoDTO | null {
  return inm.fotos.find((f) => f.isCover) ?? inm.fotos[0] ?? null;
}

/**
 * El precio que se anuncia según la operación.
 *
 * AMBAS enseña los dos: quien busca renta filtra por renta, pero quien
 * llega de Google a una ficha "venta o renta" necesita ver las dos cifras
 * sin adivinar cuál es cuál.
 */
export function precioAnunciado(inm: RealtyWebInmuebleDTO): string {
  if (inm.operation === "RENTA") {
    return `${precioInmueble(inm.precioRenta ?? inm.precio, inm.moneda)} al mes`;
  }
  if (inm.operation === "AMBAS" && inm.precioRenta) {
    return `${precioInmueble(inm.precio, inm.moneda)} · ${precioInmueble(inm.precioRenta, inm.moneda)} al mes`;
  }
  return precioInmueble(inm.precio, inm.moneda);
}

/**
 * Dónde está el inmueble, respetando la privacidad del propietario.
 *
 * 🔴 showExactAddress false → SOLO colonia y ciudad. Quien pinte una
 * dirección tiene que pedirla a esta función y no al DTO: es el único
 * punto donde se decide.
 */
export function ubicacionPublica(inm: RealtyWebInmuebleDTO): string {
  const partes = inm.direccionExacta
    ? [inm.direccion, inm.colonia, inm.ciudad, inm.estado]
    : [inm.colonia, inm.ciudad, inm.estado];
  return partes.filter((s): s is string => typeof s === "string" && !!s.trim()).join(", ");
}

/** Liga de WhatsApp con mensaje ya escrito y atribución de la fuente. */
export function ligaWhatsApp(telefono: string, mensaje: string): string | null {
  const num10 = normalizarTelefonoWeb(telefono);
  if (!num10) return null;
  return `https://wa.me/${num10}?text=${encodeURIComponent(mensaje.slice(0, 400))}`;
}

/**
 * Liga al mapa. Con dirección exacta usa la dirección; si no, la colonia y
 * la ciudad — que es justo lo que el propietario aceptó enseñar.
 */
export function ligaMapa(inm: RealtyWebInmuebleDTO): string | null {
  const q = ubicacionPublica(inm);
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * El iframe del mapa, embebido.
 *
 * www.google.com YA está en el frame-src de la CSP (next.config.mjs), así
 * que este embed carga sin tocar nada compartido. Con dirección exacta se
 * manda la dirección y zoom 16; si no, la colonia y zoom 14 — un pin de
 * colonia es una mancha de varias cuadras, que es exactamente el nivel de
 * precisión pactado con el propietario.
 */
export function embedMapa(inm: RealtyWebInmuebleDTO): string | null {
  const q = ubicacionPublica(inm);
  if (!q) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed&z=${inm.direccionExacta ? 16 : 14}`;
}

/** "Cómo llegar" de una dirección suelta (sucursal, oficina). */
export function ligaMapaDireccion(direccion: string | null): string | null {
  const q = (direccion ?? "").trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * Mapa de una dirección suelta (sucursal, oficina).
 *
 * El zoom es un parámetro y no una constante: una oficina se enseña a nivel
 * de calle (16), pero la dirección de la CUENTA en modo OWNER puede ser la
 * casa de un particular y ahí se baja a nivel de barrio (13).
 */
export function embedMapaDireccion(direccion: string, zoom = 16): string | null {
  const q = direccion.trim();
  if (!q) return null;
  const z = Number.isFinite(zoom) ? Math.min(18, Math.max(10, Math.round(zoom))) : 16;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed&z=${z}`;
}