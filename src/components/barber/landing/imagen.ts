"use client";

/* ═══════════════════════════════════════════════════════════════════════
   COMPRIMIR EN EL NAVEGADOR, ANTES DE SUBIR.

   Una barbería sube fotos DESDE EL CELULAR, y una foto de celular
   moderno pesa entre 8 y 15 MB. El runtime serverless corta el cuerpo de
   la petición en ~4,5 MB, así que sin esto la foto nunca llegaría al
   endpoint y el error que vería sería un fallo de red sin explicación.

   Qué hace: redimensiona a 1600 px de lado mayor y recodifica en WebP
   con calidad 0.8. Una foto de 8 MB sale típicamente entre 150 y 400 KB.

   Qué NO hace:
     · Tocar una foto que ya estaba bien. Una imagen chica, ligera y en un
       formato que el endpoint acepta se manda tal cual: recomprimirla
       solo le quitaría calidad.
     · Romper un GIF. Pasarlo por el canvas lo deja en un fotograma, o
       sea que "comprimirlo" sería romper la animación: se manda tal cual.
     · Empeorar. Si el WebP sale más pesado que el original (pasa con
       capturas de pantalla planas), gana el original.

   De paso arregla dos cosas más: el HEIC del iPhone sale convertido
   siempre que el navegador sepa decodificarlo (Safari sí, Chrome de
   escritorio no — y ahí se avisa con un mensaje que se entiende), y la
   orientación EXIF, que se aplica al redibujar.
   ═══════════════════════════════════════════════════════════════════════ */

/** Lado mayor. A 1600 px una portada se ve nítida hasta en pantalla grande. */
const LADO_MAX = 1600;

/** Calidad del WebP. 0.8 es donde deja de notarse a simple vista. */
const CALIDAD = 0.8;

/** Por debajo de esto (y dentro de medida) no se toca nada. */
const YA_ESTABA_BIEN = 400 * 1024;

/** Lo que acepta /api/barber/landing/upload. */
const TIPOS_QUE_PASAN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Tope del endpoint. Se comprueba aquí para no subir 4 MB en balde. */
export const TOPE_SUBIDA = 4 * 1024 * 1024;

export class ImagenNoLegible extends Error {
  constructor() {
    super("No pudimos leer esa imagen en este navegador. Guárdala como JPG o PNG e inténtalo otra vez.");
    this.name = "ImagenNoLegible";
  }
}

export class ImagenPesada extends Error {
  constructor(bytes: number) {
    super(
      `Aun comprimida pesa ${(bytes / (1024 * 1024)).toFixed(1)} MB y el máximo son 4 MB. Recórtala e inténtalo otra vez.`,
    );
    this.name = "ImagenPesada";
  }
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

function conNombre(file: File, ext: string): string {
  const base = file.name.replace(/\.[^.]+$/, "") || "foto";
  return `${base}.${ext}`;
}

/** Deja la imagen lista para subir. Devuelve el mismo File si no hacía falta tocarlo. */
export async function prepararFoto(file: File): Promise<File> {
  const tipoSirve = TIPOS_QUE_PASAN.includes(file.type);

  if (file.type === "image/gif") {
    if (file.size > TOPE_SUBIDA) throw new ImagenPesada(file.size);
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Formato que este navegador no decodifica (HEIC en Chrome, p. ej.).
    // Si el endpoint lo aceptaría y cabe, que lo intente él.
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
  // Un navegador sin codificador WebP devuelve un PNG con el tipo cambiado
  // o directamente null. En los dos casos, JPEG es la salida segura.
  if (!blob || blob.type !== "image/webp") {
    blob = await aBlob(canvas, "image/jpeg", CALIDAD);
    ext = "jpg";
  }
  if (!blob) {
    if (tipoSirve && file.size <= TOPE_SUBIDA) return file;
    throw new ImagenNoLegible();
  }

  // Si comprimir la dejó más pesada (pasa con capturas planas), gana el original.
  if (tipoSirve && blob.size >= file.size && file.size <= TOPE_SUBIDA) return file;
  if (blob.size > TOPE_SUBIDA) throw new ImagenPesada(blob.size);

  return new File([blob], conNombre(file, ext), { type: blob.type, lastModified: Date.now() });
}

export interface FotoSubida {
  url: string;
  /** Bytes que se subieron DE VERDAD, tras comprimir. */
  bytes: number;
}

/** Comprime y sube. Lanza `Error` con un mensaje ya legible si algo falla. */
export async function subirFoto(file: File, destino: string): Promise<FotoSubida> {
  const listo = await prepararFoto(file);

  const form = new FormData();
  form.append("file", listo);
  form.append("destino", destino);

  const r = await fetch("/api/barber/landing/upload", { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? "No se pudo subir la imagen.");
  return { url: j.url as string, bytes: listo.size };
}
