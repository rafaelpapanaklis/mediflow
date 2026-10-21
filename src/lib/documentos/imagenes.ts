// Imágenes del editor de documentos (P4): lo que comparten el navegador, las
// rutas y el lector del PDF. Puro: sin DOM, sin red, sin sharp. Lo de servidor
// vive en `imagenes.server.ts` y lo del navegador en `subir-imagen.client.ts`.
//
// Contrato con el editor (P1) y el saneador (P2): el HTML guardado de una imagen
// es `<img data-archivo="documentos/<clinicId>/<id>.webp" …>` SIN `src`. Esa
// clave es lo único que se guarda; para pintarla, el editor y el visor ponen
// `src = rutaDeImagen(clave)` al cargar, y la ruta firma una URL de 300 s
// después de comprobar que la clave es de la clínica de la sesión.
//
// La clave no se adivina (32 hex al azar) pero tampoco es un secreto: lo que
// protege la imagen es que la ruta compara el prefijo con la clínica de la
// SESIÓN. Una clave de otra clínica da 404, igual que una inventada.

import {
  IMAGEN_LADO_MAX_PX,
  IMAGEN_MAX_BYTES,
  IMAGEN_MAX_POR_DOCUMENTO,
  IMAGEN_TIPOS,
} from "./limites-imagen";

/** Carpeta del bucket `patient-files` donde viven las imágenes de documentos. */
export const PREFIJO_IMAGENES = "documentos";

/** Ruta pública (con sesión) que sirve una imagen por su clave. */
export const RUTA_IMAGENES = "/api/documentos/imagenes";

/**
 * Lo que puede pesar el cuerpo de un POST a una ruta de API: Vercel corta en
 * ~4.5 MB. Una imagen ya comprimida en el navegador (1600 px) pesa < 1 MB;
 * si aun así pasa de esto, viaja por el camino del original (subida directa).
 */
export const TOPE_CUERPO_RUTA = 4 * 1024 * 1024;

/**
 * Topes de píxeles al decodificar en el servidor. No son límites de producto
 * (ese es IMAGEN_MAX_BYTES): son el freno contra una «bomba» (un PNG de menos
 * de 1 MB de un solo color puede declarar cientos de millones de píxeles).
 *
 * JPEG: 250 MP, para que entren las cámaras de 200 MP de los teléfonos y las
 * de formato medio de 100 MP; sharp lo reduce AL decodificar (1/2, 1/4, 1/8),
 * así que casi no gasta memoria. PNG y WebP no se reducen al decodificar:
 * 60 MP, el mismo tope que el resto de subidas del repo (validar-archivo.ts).
 */
export const IMAGEN_MEGAPIXELES_MAX = 250_000_000;
export const IMAGEN_MEGAPIXELES_MAX_SIN_REDUCIR = 60_000_000;

const ID_IMAGEN = /^[0-9a-f]{32}$/;
const ID_CLINICA = /^[A-Za-z0-9_-]{1,128}$/;
const CLAVE = /^documentos\/([A-Za-z0-9_-]{1,128})\/([0-9a-f]{32})\.webp$/;

export const esIdDeImagen = (id: unknown): id is string => typeof id === "string" && ID_IMAGEN.test(id);

/** ¿Este clinicId sirve como carpeta? (los ids importados no siempre son uuid). */
export const esClinicaParaClave = (clinicId: unknown): clinicId is string =>
  typeof clinicId === "string" && ID_CLINICA.test(clinicId);

/** La clave final de una imagen ya comprimida. */
export function claveDeImagen(clinicId: string, id: string): string {
  if (!esClinicaParaClave(clinicId) || !esIdDeImagen(id)) throw new Error("clave de imagen inválida");
  return `${PREFIJO_IMAGENES}/${clinicId}/${id}.webp`;
}

/** Dónde espera el original de la subida directa (camino de respaldo) hasta procesarse. */
export function claveDeOriginal(clinicId: string, id: string): string {
  if (!esClinicaParaClave(clinicId) || !esIdDeImagen(id)) throw new Error("clave de original inválida");
  return `${PREFIJO_IMAGENES}/${clinicId}/originales/${id}`;
}

/** `{ clinicId, id }` si la clave tiene la forma exacta; `null` si no (incluye `../`, `%2F`, otra extensión…). */
export function leerClave(clave: unknown): { clinicId: string; id: string } | null {
  if (typeof clave !== "string") return null;
  const m = CLAVE.exec(clave);
  return m ? { clinicId: m[1]!, id: m[2]! } : null;
}

/** La única comprobación de tenant: la clave es de ESTA clínica. */
export function claveEsDeLaClinica(clave: unknown, clinicId: string): clave is string {
  const leida = leerClave(clave);
  return leida !== null && leida.clinicId === clinicId;
}

/** `src` con el que el editor y el visor pintan una imagen guardada. */
export function rutaDeImagen(clave: string): string {
  return `${RUTA_IMAGENES}/${encodeURIComponent(clave)}`;
}

/**
 * Para PINTAR un HTML ya saneado (visor de documentos): a cada
 * `<img data-archivo="…">` le pone su `src` por `rutaDeImagen`. Solo a claves
 * con la forma exacta (la ruta comprueba además la clínica de la sesión). El
 * HTML guardado no cambia: esto es solo para mostrarlo.
 */
export function conSrcDeImagenes(html: string): string {
  if (!html.includes("data-archivo")) return html;
  return html.replace(/<img data-archivo="([^"]*)"/g, (todo, clave: string) =>
    leerClave(clave) ? `<img src="${rutaDeImagen(clave)}" data-archivo="${clave}"` : todo,
  );
}

/**
 * La clave a partir de los segmentos del catch-all `[...clave]`, que Next YA
 * entrega decodificados (cada segmento pasa por decodeURIComponent en su
 * route-matcher). Aquí no se decodifica otra vez: la clave codificada en un
 * solo segmento (`documentos%2F…`) llega como `documentos/…`, partida en
 * segmentos (si un proxy decodificó el `%2F`) se une igual, y una doble
 * codificación (`%252F`) llega con `%` y no pasa el patrón.
 */
export function claveDesdeSegmentos(segmentos: string[] | string | undefined): string | null {
  const clave = Array.isArray(segmentos) ? segmentos.join("/") : segmentos ?? "";
  if (!clave || clave.length > 300) return null;
  return leerClave(clave) ? clave : null;
}

// ─────────────────────────── Tipo y tamaño ───────────────────────────

const MB = 1024 * 1024;

/** Extensiones que se aceptan cuando el navegador no dice el tipo (HEIC en Windows llega con `type` vacío). */
const EXTENSION_A_TIPO: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export type CodigoImagen =
  | "vacia"
  | "muy_pesada"
  | "tipo_no_permitido"
  | "no_se_pudo_leer"
  | "heic_no_legible"
  | "demasiados_pixeles"
  | "tope_por_documento";

export const MENSAJES_IMAGEN: Record<CodigoImagen, string> = {
  vacia: "La imagen está vacía.",
  muy_pesada: `La imagen pesa más de ${Math.round(IMAGEN_MAX_BYTES / MB)} MB.`,
  tipo_no_permitido: "Solo fotos JPG, PNG, WEBP o HEIC.",
  no_se_pudo_leer: "No pudimos leer esa imagen. Puede estar dañada; guárdala otra vez como JPG o PNG.",
  heic_no_legible:
    "Este navegador no puede abrir fotos HEIC. Súbela desde el iPhone o desde Safari, o guárdala como JPG.",
  demasiados_pixeles: "La imagen tiene demasiados píxeles. Redúcela e inténtalo otra vez.",
  tope_por_documento: `Un documento admite hasta ${IMAGEN_MAX_POR_DOCUMENTO} imágenes.`,
};

function extension(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto >= 0 ? nombre.slice(punto + 1).toLowerCase() : "";
}

/**
 * El tipo que DECLARA el archivo (lo que dice el navegador o, si no dice nada,
 * su extensión). Es una pista para fallar rápido: el servidor vuelve a mirar
 * los bytes y decide él.
 */
export function tipoDeclarado(archivo: { type?: string | null; name?: string | null }): string | null {
  const tipo = (archivo.type ?? "").toLowerCase().trim();
  if (tipo) return IMAGEN_TIPOS.includes(tipo) ? tipo : null;
  return EXTENSION_A_TIPO[extension(archivo.name ?? "")] ?? null;
}

export const esHeic = (tipo: string | null | undefined) => tipo === "image/heic" || tipo === "image/heif";

/** Validación de cortesía (navegador y firma de la subida directa): `null` = adelante. */
export function revisarArchivo(archivo: { type?: string | null; name?: string | null; size: number }): CodigoImagen | null {
  if (!Number.isFinite(archivo.size) || archivo.size <= 0) return "vacia";
  if (!tipoDeclarado(archivo)) return "tipo_no_permitido";
  if (archivo.size > IMAGEN_MAX_BYTES) return "muy_pesada";
  return null;
}

/** Medidas finales: lado mayor ≤ IMAGEN_LADO_MAX_PX, sin agrandar nunca. */
export function medidasFinales(ancho: number, alto: number): { ancho: number; alto: number } {
  const escala = Math.min(1, IMAGEN_LADO_MAX_PX / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

// ─────────────────────────── Tope por documento ───────────────────────────

const IMG_CON_ARCHIVO = /<img\b[^>]*\bdata-archivo\s*=\s*(["'])(.*?)\1/gi;

/** Las claves de imagen que trae un HTML, en orden y sin repetir. */
export function clavesEnHtml(html: string): string[] {
  const vistas = new Set<string>();
  for (const m of html.matchAll(IMG_CON_ARCHIVO)) vistas.add(m[2]!);
  return Array.from(vistas);
}

/**
 * Lo que hay que mirar al GUARDAR un documento (P2/P5): cuántas imágenes trae y
 * cuáles no son de la clínica (una clave pegada desde otra clínica no se
 * mostraría nunca, y no debe quedar guardada como si fuera propia).
 */
export function revisarImagenesDelDocumento(
  html: string,
  clinicId: string,
): { total: number; excedeTope: boolean; ajenas: string[] } {
  // Se cuentan las <img>, no las claves distintas: la misma foto puesta dos
  // veces pesa dos veces en la hoja y en el PDF.
  const total = Array.from(html.matchAll(IMG_CON_ARCHIVO)).length;
  return {
    total,
    excedeTope: total > IMAGEN_MAX_POR_DOCUMENTO,
    ajenas: clavesEnHtml(html).filter((c) => !claveEsDeLaClinica(c, clinicId)),
  };
}
