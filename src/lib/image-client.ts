/* ============================================================
   COMPRIMIR EN EL NAVEGADOR ANTES DE SUBIR.

   El runtime serverless corta el cuerpo de la petición en ~4.5 MB.
   Una foto de celular moderno pesa 8-15 MB: nunca llegaba al endpoint
   y el error no explicaba nada. Aquí se redimensiona a 2000 px de lado
   máximo y se recodifica en webp antes de que salga la request.

   De paso arregla dos cosas más:
     · el HEIC del iPhone (que el endpoint rechaza por tipo) sale
       convertido, siempre que el navegador sepa decodificarlo — Safari
       sí; Chrome de escritorio no, y ahí se avisa con un mensaje claro
       en vez de un 400 críptico.
     · la orientación EXIF, que se aplica al redibujar.

   Lo que NO hace: tocar imágenes que ya estaban bien. Una foto chica y
   dentro de medida se manda tal cual — recomprimirla solo la
   degradaría. Y si el resultado pesa más que el original, gana el
   original.
   ============================================================ */

/** Lado máximo. Una portada 16:9 a 2000 px se ve nítida hasta en 4K. */
const LADO_MAX = 2000;

/** Calidad del webp. 0.82 es el punto donde deja de notarse a simple vista. */
const CALIDAD = 0.82;

/**
 * Por debajo de esto no se toca nada si además cabe en LADO_MAX: un logo o una
 * foto ya optimizada no gana nada pasando otra vez por el codificador.
 */
const YA_ESTABA_BIEN = 900 * 1024;

/** Lo que acepta /api/landing-upload (su ALLOWED_TYPES, menos el pdf). */
const TIPOS_QUE_PASAN = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff"];

/** Tope del endpoint. Se comprueba aquí para fallar antes de subir 4 MB en balde. */
export const TOPE_SUBIDA_BYTES = 4 * 1024 * 1024;

export class ImagenNoLegible extends Error {
  constructor() {
    super("No pudimos leer esa imagen en este navegador. Guárdala como JPG o PNG e inténtalo otra vez.");
    this.name = "ImagenNoLegible";
  }
}

export class ImagenDemasiadoGrande extends Error {
  constructor(bytes: number) {
    super(`Aun comprimida pesa ${(bytes / (1024 * 1024)).toFixed(1)} MB y el máximo son 4 MB. Recórtala e inténtalo otra vez.`);
    this.name = "ImagenDemasiadoGrande";
  }
}

function nombreCon(file: File, ext: string): string {
  return `${file.name.replace(/\.[^.]+$/, "") || "imagen"}.${ext}`;
}

/** El archivo tal cual, cuando comprimirlo no aporta. */
function talCual(file: File): File {
  return file;
}

async function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, tipo, calidad));
}

/**
 * Deja la imagen lista para subir.
 *
 * Devuelve el MISMO File si no hacía falta tocarlo, o uno nuevo en webp.
 * Lanza `ImagenNoLegible` si el navegador no sabe decodificar el formato y
 * el endpoint tampoco lo aceptaría (HEIC en Chrome, por ejemplo), y
 * `ImagenDemasiadoGrande` si ni comprimida entra.
 */
export async function prepararImagen(file: File): Promise<File> {
  const tipoSirve = TIPOS_QUE_PASAN.includes(file.type);

  // Los GIF se mandan tal cual: pasarlos por el canvas los deja en un solo
  // fotograma, o sea que "comprimir" sería romper la animación.
  if (file.type === "image/gif") {
    if (file.size > TOPE_SUBIDA_BYTES) throw new ImagenDemasiadoGrande(file.size);
    return talCual(file);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Formato que este navegador no decodifica. Si el endpoint lo acepta y
    // cabe, que lo intente él; si no, no hay nada que hacer con este archivo.
    if (tipoSirve && file.size <= TOPE_SUBIDA_BYTES) return talCual(file);
    throw new ImagenNoLegible();
  }

  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));

  // Ya estaba bien: dentro de medida, ligera y en un formato que el endpoint
  // acepta. Recomprimir solo le quitaría calidad.
  if (escala === 1 && tipoSirve && file.size <= YA_ESTABA_BIEN) {
    bitmap.close();
    return talCual(file);
  }

  const canvas = document.createElement("canvas");
  canvas.width  = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    if (tipoSirve && file.size <= TOPE_SUBIDA_BYTES) return talCual(file);
    throw new ImagenNoLegible();
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Safari viejo no codifica webp y toBlob cae a png por spec — un png de una
  // foto pesa MÁS que el original. Si no salió webp, se reintenta en jpeg.
  let blob = await aBlob(canvas, "image/webp", CALIDAD);
  let ext  = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await aBlob(canvas, "image/jpeg", CALIDAD);
    ext  = "jpg";
  }

  if (!blob) {
    if (tipoSirve && file.size <= TOPE_SUBIDA_BYTES) return talCual(file);
    throw new ImagenNoLegible();
  }

  // Comprimir empeoró el archivo (pasa con capturas de pantalla en png ya
  // optimizadas): se queda el original, si el endpoint lo admite.
  if (blob.size >= file.size && tipoSirve) {
    if (file.size > TOPE_SUBIDA_BYTES) throw new ImagenDemasiadoGrande(file.size);
    return talCual(file);
  }

  if (blob.size > TOPE_SUBIDA_BYTES) throw new ImagenDemasiadoGrande(blob.size);

  return new File([blob], nombreCon(file, ext), { type: blob.type });
}
