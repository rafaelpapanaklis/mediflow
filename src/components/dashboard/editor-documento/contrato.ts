// El CONTRATO del HTML que el editor guarda: la «lista blanca ampliada» de la
// sección 5 del diseño aprobado (20-oct-2026), con sus valores enumerados. El
// saneador del servidor (P2, `src/lib/document-templates/sanitize.ts`) la
// reconstruye con esta misma tabla; lo que no esté aquí, el editor no lo emite
// y el servidor lo tira. Nunca `style`, nunca `class`, nunca `src`.
//
// PURO: sin DOM ni React. Lo importan las extensiones, la normalización y las pruebas.

/** Tamaños de letra que se ofrecen, en puntos. 12 es el del cuerpo y no se guarda. */
export const TAMANOS = ["10", "11", "12", "14", "16", "18", "24"] as const;
export type Tamano = (typeof TAMANOS)[number];
export const TAMANO_BASE: Tamano = "12";

/** Alineación de párrafos y títulos (`data-alineacion`). «izquierda» es la de siempre y no se guarda. */
export const ALINEACIONES = ["izquierda", "centro", "derecha", "justificado"] as const;
export type Alineacion = (typeof ALINEACIONES)[number];

/** Imagen: tamaño (`data-ancho`) y lado (`data-alineacion`). */
export const ANCHOS_IMAGEN = ["chico", "medio", "completo"] as const;
export type AnchoImagen = (typeof ANCHOS_IMAGEN)[number];
export const LADOS = ["izquierda", "centro", "derecha"] as const;
export type Lado = (typeof LADOS)[number];

/** Sangría de párrafos y títulos (`data-sangria`): de 0 (sin) a 6 niveles. */
export const SANGRIA_MAX = 6;
/** Cuánto se corre cada nivel, en px (36 px = media pulgada, como Word). */
export const SANGRIA_PASO_PX = 36;

/** Columnas: dos o tres. */
export const COLUMNAS = [2, 3] as const;
export type NumeroColumnas = (typeof COLUMNAS)[number];

/**
 * La clave de archivo de una imagen: `documentos/<clinicId>/<id>.webp`, nada más.
 * Siempre .webp: P4 (t6) guarda comprimido a webp y el saneador (P2, t9) solo acepta .webp.
 */
export const PATRON_ARCHIVO_IMAGEN = /^documentos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.webp$/;

/** Dónde pide el navegador la imagen al pintarla (P4 la sirve); nunca se guarda en el HTML. */
export function rutaImagen(archivo: string): string {
  return `/api/documentos/imagenes/${encodeURIComponent(archivo)}`;
}

/** Un marcador tal como viaja en el HTML guardado: `[NOMBRE_PACIENTE]`. */
export const PATRON_MARCADOR = /\[([A-Z][A-Z0-9_]{2,})\]/g;

export const esTamano = (v: unknown): v is Tamano => typeof v === "string" && (TAMANOS as readonly string[]).includes(v);
export const esAlineacion = (v: unknown): v is Alineacion =>
  typeof v === "string" && (ALINEACIONES as readonly string[]).includes(v);
export const esAnchoImagen = (v: unknown): v is AnchoImagen =>
  typeof v === "string" && (ANCHOS_IMAGEN as readonly string[]).includes(v);
export const esLado = (v: unknown): v is Lado => typeof v === "string" && (LADOS as readonly string[]).includes(v);

/** `text-align` de Word o de un HTML viejo → nuestro valor. */
export function alineacionDesdeCss(textAlign: string | null | undefined): Alineacion | null {
  switch ((textAlign ?? "").trim().toLowerCase()) {
    case "center":
      return "centro";
    case "right":
    case "end":
      return "derecha";
    case "justify":
      return "justificado";
    case "left":
    case "start":
      return "izquierda";
    default:
      return null;
  }
}

/** `font-size: 11.0pt` de Word → «11» si es uno de los nuestros; si no, nada (se queda el tamaño del cuerpo). */
export function tamanoDesdeCss(fontSize: string | null | undefined): Tamano | null {
  const m = /^\s*([\d.]+)\s*(pt|px)?\s*$/i.exec(fontSize ?? "");
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  // Los px se pasan a puntos (16 px = 12 pt) para que un HTML a px no pierda el tamaño.
  const pt = (m[2] ?? "pt").toLowerCase() === "px" ? (n * 3) / 4 : n;
  const redondo = String(Math.round(pt));
  return esTamano(redondo) && redondo !== TAMANO_BASE ? redondo : null;
}

export function sangriaValida(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(SANGRIA_MAX, Math.trunc(n)));
}
