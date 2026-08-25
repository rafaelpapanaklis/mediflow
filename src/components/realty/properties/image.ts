/**
 * INMUEBLES — comprimir y redimensionar EN EL NAVEGADOR antes de subir.
 *
 * 🔴 POR QUÉ ES OBLIGATORIO. Una foto de celular pesa 8-15 MB y el runtime
 * serverless corta el cuerpo de la petición en ~4.5 MB: sin esto, la foto
 * NUNCA llega al servidor y el asesor ve un error que no explica nada. Y
 * aunque llegara, veinte inmuebles con quince fotos cada uno se comen el
 * cupo del plan en una tarde. Es la lección directa de barber.
 *
 * Cuatro invariantes que se conservan del helper del dental y de barber —
 * las cuatro salieron de un bug real:
 *   1. GIF pasa tal cual: el canvas se queda con UN fotograma y mata la
 *      animación.
 *   2. imageOrientation: "from-image" o las fotos verticales de iPhone
 *      llegan acostadas.
 *   3. Si comprimir dejó el archivo MÁS pesado, gana el original.
 *   4. createImageBitmap que truena = HEIC en Chrome. Mensaje explícito, no
 *      un 400 críptico.
 *
 * El servidor vuelve a comprobar tamaño y magic number: esto es la primera
 * red, no la única.
 */

/** Lado largo máximo. 1920 basta para pantalla completa en un monitor. */
const LADO_MAX = 1920;
/** Calidad WebP. 0.82 es donde deja de notarse la diferencia. */
const CALIDAD = 0.82;
/** Por debajo de esto ya está bien: recodificar solo la empeoraría. */
const YA_ESTABA_BIEN = 350 * 1024;
/** Tope del cuerpo de la petición. */
export const TOPE_SUBIDA = 4 * 1024 * 1024;

const TIPOS_QUE_PASAN = ["image/jpeg", "image/png", "image/webp"];

export class ImagenNoLegible extends Error {
  constructor() {
    super(
      "No pudimos leer esa imagen. Si viene de un iPhone en formato HEIC, " +
        "compártela como JPG desde la app de Fotos.",
    );
    this.name = "ImagenNoLegible";
  }
}

export class ImagenPesada extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super("Esa imagen pesa demasiado incluso después de comprimirla.");
    this.name = "ImagenPesada";
    this.bytes = bytes;
  }
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

function conNombre(file: File, ext: string): string {
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 60);
  return `${base || "foto"}.${ext}`;
}

/**
 * Deja la foto lista para subir: máximo 1920 px de lado largo y WebP 0.82
 * cuando el navegador lo permite (Safari viejo cae a JPEG por la propia
 * especificación de toBlob, que devuelve PNG si no conoce el tipo).
 */
export async function prepararFoto(file: File): Promise<File> {
  const tipoSirve = TIPOS_QUE_PASAN.includes(file.type);

  if (file.type === "image/gif") {
    if (file.size > TOPE_SUBIDA) throw new ImagenPesada(file.size);
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    if (tipoSirve && file.size <= TOPE_SUBIDA) return file;
    throw new ImagenNoLegible();
  }

  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  if (escala === 1 && tipoSirve && file.size <= YA_ESTABA_BIEN) {
    bitmap.close();
    return file;
  }

  const ancho = Math.max(1, Math.round(bitmap.width * escala));
  const alto = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    if (tipoSirve && file.size <= TOPE_SUBIDA) return file;
    throw new ImagenNoLegible();
  }
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  let blob = await aBlob(canvas, "image/webp", CALIDAD);
  let ext = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await aBlob(canvas, "image/jpeg", CALIDAD);
    ext = "jpg";
  }
  if (!blob) {
    if (tipoSirve && file.size <= TOPE_SUBIDA) return file;
    throw new ImagenNoLegible();
  }

  if (tipoSirve && blob.size >= file.size && file.size <= TOPE_SUBIDA) return file;
  if (blob.size > TOPE_SUBIDA) throw new ImagenPesada(blob.size);

  return new File([blob], conNombre(file, ext), {
    type: blob.type,
    lastModified: Date.now(),
  });
}

/**
 * Panorámica equirectangular: se conserva la proporción 2:1 y NO se
 * recorta. Se permite más ancho que una foto normal (4096) porque el visor
 * la envuelve alrededor del espectador y a 1920 se ve pastosa; aun así
 * tiene que caber en el tope de la petición.
 */
export async function prepararPanoramica(file: File): Promise<File> {
  const PANO_MAX = 4096;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    if (TIPOS_QUE_PASAN.includes(file.type) && file.size <= TOPE_SUBIDA) return file;
    throw new ImagenNoLegible();
  }

  const escala = Math.min(1, PANO_MAX / bitmap.width);
  const ancho = Math.max(1, Math.round(bitmap.width * escala));
  const alto = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImagenNoLegible();
  }
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  let blob = await aBlob(canvas, "image/webp", 0.85);
  let ext = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await aBlob(canvas, "image/jpeg", 0.85);
    ext = "jpg";
  }
  if (!blob) throw new ImagenNoLegible();
  if (blob.size > TOPE_SUBIDA) throw new ImagenPesada(blob.size);

  return new File([blob], conNombre(file, ext), {
    type: blob.type,
    lastModified: Date.now(),
  });
}

/** ¿La imagen parece equirectangular? (2:1 con tolerancia). Solo para avisar. */
export async function pareceEquirectangular(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = bitmap.width / bitmap.height;
    bitmap.close();
    return ratio > 1.7 && ratio < 2.3;
  } catch {
    return true; // ante la duda no se estorba al usuario
  }
}
