/* ============================================================
   QUÉ PUEDE ESCRIBIR EL EDITOR DE LA MINI-WEB, Y CON QUÉ FORMA.

   Fuente única del PATCH de /api/clinic-landing. Antes el handler
   copiaba `body[campo]` tal cual: un cliente podía guardar un objeto
   donde la plantilla espera texto, un JSON de megas o una URL
   `javascript:` en el mapa — que se pinta como `<iframe src>` en la
   página PÚBLICA.

   Dos reglas que no se negocian:

   1. La lista es LITERAL. Nada de recorrer el body ni de comparar
      objetos para deducir "qué cambió": ese patrón fue el que causó
      la fuga del commit 0424d5ab (la fila entera de Clinic viajando
      al navegador). Si un campo no está escrito aquí abajo, no se
      guarda.

   2. Cada campo trae su validador. Un valor con la forma equivocada
      NO se escribe y el PATCH responde 400 diciendo cuál es.

   Espejo: CAMPOS_VIVOS en src/app/[slug]/_shared/live-preview.tsx
   valida lo mismo para la vista previa en vivo. Un campo nuevo se
   agrega en los DOS lados: allá para que se VEA mientras se escribe,
   aquí para que se GUARDE.
   ============================================================ */
import {
  TEMPLATE_MANIFESTS, allPhotoSlotIds, allCopyKeys, esClaveDeCopia, topeDeCopia,
} from "@/app/[slug]/_shared/template-manifest";

/** Tope por campo JSON ya serializado. 64 KB es ~400 servicios o ~300 FAQs. */
const MAX_JSON_BYTES = 64 * 1024;

/* ── piezas ────────────────────────────────────────────────── */

const esNulo = (v: unknown) => v === null || v === undefined;

/** Texto acotado, o null. La cadena vacía cuenta como texto (borra el campo). */
const texto = (max: number) => (v: unknown) =>
  esNulo(v) || (typeof v === "string" && v.length <= max);

/** Texto obligatorio: ni null ni vacío (el nombre de la clínica, p. ej.). */
const textoObligatorio = (min: number, max: number) => (v: unknown) =>
  typeof v === "string" && v.trim().length >= min && v.length <= max;

/**
 * URL http(s) y nada más.
 *
 * `landingMapEmbed` termina en `<iframe src>` de la página pública y
 * `landingCoverUrl`/`landingGallery` en `<img src>`: un `javascript:` ahí
 * es XSS almacenado en un sitio que se sirve por ISR y se lee sin
 * contraseña. La CSP (frame-src) ya lo acota, pero la validación no
 * depende de que la CSP no cambie.
 */
function esUrlWeb(v: unknown, max = 2048): boolean {
  if (typeof v !== "string" || !v || v.length > max) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const urlOpcional = (v: unknown) => esNulo(v) || v === "" || esUrlWeb(v);

/** El JSON serializado cabe en el tope. */
function cabe(v: unknown): boolean {
  try {
    return JSON.stringify(v ?? null).length <= MAX_JSON_BYTES;
  } catch {
    return false; // referencias circulares y demás: no se guarda
  }
}

/**
 * Lista acotada de elementos que cumplen `item`.
 *
 * `v.every(x => item(x))` y no `v.every(item)`: every pasa (elemento, índice,
 * array) y el índice se colaba como segundo argumento — a `esUrlWeb` le
 * llegaba como el tope de longitud, así que la primera URL de la galería se
 * comparaba contra 0 y NINGUNA galería se podía guardar.
 */
const listaDe = (max: number, item: (x: unknown) => boolean) => (v: unknown) =>
  Array.isArray(v) && v.length <= max && v.every(x => item(x)) && cabe(v);

const esObjetoPlano = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

/** Un elemento de landingSections tal como lo escribe el editor por manifiesto. */
function esSeccion(x: unknown): boolean {
  if (!esObjetoPlano(x)) return false;
  const s = x as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id || s.id.length > 60) return false;
  if (!esNulo(s.visible) && typeof s.visible !== "boolean") return false;
  if (!esNulo(s.orden) && !(typeof s.orden === "number" && Number.isFinite(s.orden))) return false;
  for (const campo of ["titulo", "subtitulo"] as const) {
    const t = s[campo];
    if (!esNulo(t) && !(typeof t === "string" && t.length <= 2000)) return false;
  }
  return true;
}

/** { idDeRanura: url }. Las llaves son ranuras REALES del manifiesto. */
function esMapaDeFotos(v: unknown): boolean {
  if (!esObjetoPlano(v)) return false;
  const ranuras = allPhotoSlotIds();
  const entradas = Object.entries(v as Record<string, unknown>);
  if (entradas.length > ranuras.length) return false;
  for (const [ranura, url] of entradas) {
    if (!ranuras.includes(ranura)) return false;
    if (!esUrlWeb(url)) return false;
  }
  return cabe(v);
}

/**
 * { claveDeclarada: texto } — TODO el texto suelto de la mini-web.
 *
 * Tres candados, y los tres hacen falta:
 *   1. La clave tiene que estar DECLARADA en el manifiesto de alguna plantilla.
 *      Sin esto, `landingCopy` sería una bolsa libre donde cualquiera guarda lo
 *      que quiera y nadie pinta nunca — imposible de validar y de limpiar.
 *   2. Cada valor va acotado por el tope de SU clave (el mayor declarado; el
 *      fino lo pone el campo del lienzo, que sí sabe en qué plantilla está).
 *   3. El mapa entero cabe en 8 KB. Con ~40 claves por plantilla sobra.
 */
const MAX_COPY_BYTES = 8 * 1024;

function esMapaDeCopia(v: unknown): boolean {
  if (esNulo(v)) return true; // borrar la columna entera es legítimo
  if (!esObjetoPlano(v)) return false;
  const entradas = Object.entries(v as Record<string, unknown>);
  if (entradas.length > allCopyKeys().length) return false;
  for (const [clave, texto] of entradas) {
    if (!esClaveDeCopia(clave)) return false;
    if (typeof texto !== "string") return false;
    if (texto.length > topeDeCopia(clave)) return false;
  }
  try {
    return JSON.stringify(v).length <= MAX_COPY_BYTES;
  } catch {
    return false;
  }
}

const esEnteroEntre = (min: number, max: number) => (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/* ── el mapa: campo → validador. LISTA LITERAL. ────────────── */

export const CAMPOS_EDITABLES = {
  /* Publicación y plantilla */
  landingActive:  (v: unknown) => typeof v === "boolean",
  landingTemplate: (v: unknown) => typeof v === "string" && v in TEMPLATE_MANIFESTS,

  /* Identidad y contacto — lo que pintan las ocho plantillas en el
     encabezado y en el bloque de contacto. */
  name:    textoObligatorio(2, 120),
  phone:   texto(40),
  email:   (v: unknown) =>
    esNulo(v) || (typeof v === "string" && (v === "" || (v.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))),
  address: texto(300),

  /* Textos */
  description:            texto(5000),
  landingTagline:         texto(300),
  landingPatients:        texto(60),
  landingUrgentText:      texto(1000),
  landingYearsExperience: (v: unknown) => esNulo(v) || esEnteroEntre(0, 120)(v),

  /* Apariencia */
  landingThemeColor: (v: unknown) =>
    esNulo(v) || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)),

  /* Imágenes */
  landingCoverUrl: urlOpcional,
  landingGallery:  listaDe(12, esUrlWeb),
  landingPhotos:   esMapaDeFotos,

  /* Contenido en JSON — la forma fina la normalizan las plantillas
     (serviceList, testimonialList, faqList en _shared/landing-data.ts);
     aquí se exige que sea una lista y que no sea enorme. */
  landingServices:     listaDe(60, esObjetoPlano),
  landingTestimonials: listaDe(60, esObjetoPlano),
  landingFaqs:         listaDe(60, esObjetoPlano),
  landingSections:     listaDe(60, esSeccion),
  landingCopy:         esMapaDeCopia,

  /* Redes y mapa */
  landingWhatsapp:  texto(200),
  landingInstagram: texto(200),
  landingFacebook:  texto(200),
  landingTiktok:    texto(200),
  landingMapEmbed:  urlOpcional,

  /* Meses sin intereses */
  landingMsiPlazos: listaDe(12, esEnteroEntre(2, 60)),
} satisfies Record<string, (v: unknown) => boolean>;

export type CampoEditable = keyof typeof CAMPOS_EDITABLES;

export const CAMPOS_EDITABLES_KEYS = Object.keys(CAMPOS_EDITABLES) as CampoEditable[];

export interface ResultadoValidacion {
  /** Solo los campos presentes en el body Y válidos. Va tal cual al update. */
  data: Record<string, unknown>;
  /** Campos presentes con la forma equivocada. Si hay alguno, no se escribe nada. */
  invalidos: string[];
}

/**
 * Recorre la lista literal y se queda con lo que venga bien.
 *
 * Un campo con la forma equivocada NO se ignora en silencio: se devuelve en
 * `invalidos` y el handler responde 400. Guardar "lo que se pudo" dejaba a la
 * clínica creyendo que su cambio se publicó.
 */
export function validarCamposLanding(body: unknown): ResultadoValidacion {
  const data: Record<string, unknown> = {};
  const invalidos: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return { data, invalidos };

  const entrada = body as Record<string, unknown>;
  for (const campo of CAMPOS_EDITABLES_KEYS) {
    if (!(campo in entrada)) continue;
    const valor = entrada[campo];
    if (CAMPOS_EDITABLES[campo](valor)) data[campo] = valor;
    else invalidos.push(campo);
  }
  return { data, invalidos };
}
