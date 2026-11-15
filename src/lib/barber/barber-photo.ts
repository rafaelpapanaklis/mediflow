// ═══════════════════════════════════════════════════════════════════════
// Foto del barbero subida desde el teléfono — piezas puras.
//
// Las usa POST /api/barber/team/barbers/[id]/photo. Van aparte (sin Prisma,
// sin Supabase) para poder probar qué carpeta se usa y QUÉ objeto se borra:
// borrar de más en un bucket público es el error caro de esta ruta.
// ═══════════════════════════════════════════════════════════════════════

/** Lo que acepta la ruta. Sin GIF: la foto de un barbero no se anima. */
export const FOTO_BARBERO_TIPOS = ["image/jpeg", "image/png", "image/webp"];

/** Tope real del cuerpo de la petición serverless; el navegador comprime antes. */
export const FOTO_BARBERO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * ¿Esta foto la subió la propia pantalla (vive en una carpeta `barberos/` de
 * nuestro bucket)? Si no, es una liga pegada a mano por la barbería: esa se
 * respeta y se sigue pudiendo editar, pero ya no se ofrece como forma de
 * poner una foto nueva.
 */
export function esFotoSubida(url: string | null | undefined): boolean {
  return Boolean(url && url.includes("/barber/") && url.includes("/barberos/"));
}

/** La extensión sale del TIPO REAL ya validado, nunca del nombre que mande el navegador. */
export function extensionFotoBarbero(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Carpeta de las fotos de UN barbero. El shopId sale de la fila del barbero, no del body. */
export function carpetaFotoBarbero(barbershopId: string, barberId: string): string {
  return `barber/${barbershopId}/barberos/${barberId}`;
}

/**
 * El objeto del bucket que corresponde a la foto anterior, SOLO si vive en la
 * carpeta de ESE barbero. Una liga pegada a mano, la foto de otro barbero, el
 * logo o cualquier otra cosa devuelven null y no se tocan.
 */
export function objetoFotoAnterior(
  previousUrl: string | null | undefined,
  bucket: string,
  carpeta: string,
): string | null {
  if (!previousUrl) return null;
  const marca = `/${bucket}/`;
  const i = previousUrl.indexOf(marca);
  if (i < 0) return null;
  const objeto = previousUrl.slice(i + marca.length).split("?")[0].split("#")[0];
  let limpio: string;
  try {
    limpio = decodeURIComponent(objeto);
  } catch {
    return null;
  }
  // Sin «..» ni barras raras, y estrictamente DENTRO de la carpeta del barbero.
  if (limpio.includes("..") || limpio.includes("//")) return null;
  if (!limpio.startsWith(`${carpeta}/`) || limpio.length <= carpeta.length + 1) return null;
  return limpio;
}
