// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — contrato PURO del área. Sin Prisma, sin red, sin
// `server-only`: lo importa el navegador y se prueba sin base de datos.
// ═══════════════════════════════════════════════════════════════════════

/** Lo que sabe hacer el estudio. Cada uno cuesta y cada uno tiene su tope. */
export type RealtyStudioKind =
  | "reel"
  | "staging"
  | "description"
  | "social";

/** Tono de la redacción. Tres, no diez: más opciones no mejoran el texto. */
export type RealtyCopyTone = "directo" | "calido" | "premium";

export const REALTY_COPY_TONES: readonly RealtyCopyTone[] = [
  "directo",
  "calido",
  "premium",
];

/**
 * Plantillas del reel. El nombre NO es decorativo: cambia el orden de las
 * fotos y el ritmo, que es lo único que distingue un reel que retiene de
 * uno que se saltan.
 */
export type RealtyReelTemplate = "recorrido" | "antes-de-que-se-vaya" | "tour-rapido";

export const REALTY_REEL_TEMPLATES: readonly RealtyReelTemplate[] = [
  "recorrido",
  "antes-de-que-se-vaya",
  "tour-rapido",
];

/** Estilos del home staging virtual. */
export type RealtyStagingStyle = "moderno" | "calido" | "minimalista";

export const REALTY_STAGING_STYLES: readonly RealtyStagingStyle[] = [
  "moderno",
  "calido",
  "minimalista",
];

// ── El reel ─────────────────────────────────────────────────────────────

/**
 * 🔴 9:16 REAL, en píxeles de verdad. TikTok, Reels y Shorts recortan
 * cualquier otra cosa, y lo que recortan es siempre el texto de abajo — el
 * precio. 1080×1920 es el tamaño que los tres aceptan sin reencodear.
 */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

/** Una escena = una foto en pantalla, con su texto encima. */
export interface RealtyReelScene {
  /** URL firmada de la foto. La pinta el navegador. */
  photoUrl: string;
  /** Cuánto dura en pantalla, en milisegundos. */
  durationMs: number;
  /** Línea grande (el gancho o el dato). Puede ir vacía. */
  title: string;
  /** Línea chica debajo. Puede ir vacía. */
  subtitle: string;
  /**
   * Zoom lento (efecto Ken Burns). `from` y `to` son escalas: 1 = la foto
   * llena el cuadro. Da sensación de movimiento sin tener video.
   */
  zoomFrom: number;
  zoomTo: number;
}

export interface RealtyReelPlan {
  template: RealtyReelTemplate;
  width: number;
  height: number;
  fps: number;
  /** Duración total, para que la pantalla la enseñe antes de renderizar. */
  totalMs: number;
  /** Milisegundos de cruce entre escena y escena. */
  crossfadeMs: number;
  scenes: RealtyReelScene[];
  /** Logo de la cuenta, si lo hay. Va en una esquina, chico. */
  logoUrl: string | null;
  /** Marca de agua de la cuenta: el nombre, abajo. */
  accountName: string;
  /** Cierre: el teléfono o la web, para que sepan a quién llamarle. */
  cta: string;
}

// ── Resultados ──────────────────────────────────────────────────────────

export interface RealtyDescriptionResult {
  tone: RealtyCopyTone;
  /** La descripción del anuncio, en español de México. */
  text: string;
}

export interface RealtySocialResult {
  /** El copy del post. */
  post: string;
  /** Hashtags con la zona incluida. Sin el "#": lo pone la pantalla. */
  hashtags: string[];
  /** El primer comentario (donde van los hashtags largos, para no ensuciar). */
  firstComment: string;
}

export interface RealtyStagingResult {
  /** Id de la foto NUEVA. La original no se toca jamás. */
  photoId: string;
  /** URL firmada para verla ya. */
  url: string;
  style: RealtyStagingStyle;
}

/**
 * Un renglón de lo que se ha generado para un inmueble. Sale de la bitácora
 * (RealtyAdminAction), que es donde se registra cada generación.
 */
export interface RealtyStudioItem {
  id: string;
  kind: RealtyStudioKind;
  propertyId: string | null;
  propertyTitle: string | null;
  /** Micros que costó. La pantalla lo enseña en dólares. */
  micros: number;
  createdAt: string;
  /** Resumen legible: el tono, el estilo o la plantilla. */
  detail: string;
}

// ── Errores que la pantalla tiene que saber distinguir ──────────────────

/**
 * Por qué NO se generó. Es un CÓDIGO y no una frase: la pantalla decide qué
 * decir, y "llegaste a tu límite de hoy" no es lo mismo que "falta la llave
 * de la IA". Un error críptico en esta pantalla es una llamada a soporte.
 */
export type RealtyStudioErrorCode =
  | "cap_reached"
  | "not_configured"
  | "no_photos"
  | "not_found"
  | "provider"
  | "invalid";

export interface RealtyStudioError {
  code: RealtyStudioErrorCode;
  /** Frase en español de México, lista para pintarse. */
  message: string;
}

/** La marca que se quema en TODA imagen generada. No es configurable. */
export const REALTY_STAGING_WATERMARK = "IMAGEN ILUSTRATIVA";

/**
 * Prefijo del NOMBRE de archivo de una foto generada por IA.
 *
 * RealtyPropertyPhoto no tiene ninguna columna que diga "esta la hizo la
 * IA", y el schema no se toca en esta ola, así que el único rastro
 * disponible es el nombre del archivo. Vive aquí —y no dentro de la ruta
 * que lo escribe— para que quien lo ESCRIBE y quien lo LEE usen la misma
 * cadena: dos literales iguales en dos archivos se separan en cuanto
 * alguien toca uno.
 */
export const REALTY_AI_PHOTO_PREFIX = "ia-";

/**
 * ¿Esta foto la generó la IA?
 *
 * Sirve para pintarle un distintivo en la galería del panel y en la web
 * pública. ⚠️ Es un rastro por nombre, no una columna: no lo uses como
 * control de acceso ni como prueba legal. La advertencia que SÍ es
 * confiable va QUEMADA en los píxeles de la imagen (ver staging.ts), y por
 * eso viaja con el archivo aunque alguien lo descargue, lo reenvíe o lo
 * suba a un portal — que es justo donde este helper ya no llega.
 *
 * Acepta el path guardado o una URL firmada (con su query encima).
 */
export function isRealtyAiPhoto(urlOrPath: string | null | undefined): boolean {
  if (!urlOrPath) return false;
  const sinQuery = String(urlOrPath).split("?")[0];
  const nombre = sinQuery.substring(sinQuery.lastIndexOf("/") + 1);
  return nombre.startsWith(REALTY_AI_PHOTO_PREFIX);
}

// ── Las llaves de la puerta ─────────────────────────────────────────────
//
// Viven AQUÍ, en el contrato puro, y no en `_server.ts`, para que la página
// pueda comprobar lo mismo que la API sin arrastrar `server-only` (ni todo
// lo que ese archivo importa) a su grafo. Importar UNA constante desde un
// módulo `server-only` es como se tumba un build en este repo.

/** La feature del plan que abre el estudio. Se comprueba por ESTO, jamás
 *  por `plan.id`: los planes se editan en tabla y sin desplegar. */
export const REALTY_STUDIO_FEATURE = "aiStudio";

/**
 * El permiso del rol.
 *
 * ⚠️ Es `properties.edit` y NO uno propio. El estudio genera contenido PARA
 * un inmueble y todo lo que produce se cuelga de él, así que quien puede
 * editar el inmueble puede generarlo. Una llave nueva en REALTY_PERMISSIONS
 * exigía tocar src/lib/realty/permissions.ts, fuera del alcance de esta
 * terminal. El corte queda razonable: AGENT sí (tiene properties.edit),
 * ASSISTANT no (solo properties.view).
 *
 * El tipo se declara como la llave literal y no se importa
 * `RealtyPermissionKey`, para que este archivo no dependa de nada.
 */
export const REALTY_STUDIO_PERMISSION = "properties.edit";
