"use client";

import { EDU_PHOTO_MAX_EDGE } from "@/lib/edu/fotos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * COMPRESIÓN EN EL NAVEGADOR, ANTES DE SUBIR.
 *
 * 🔴 POR QUÉ EXISTE, SI EL SERVIDOR YA COMPRIME CON SHARP.
 *
 * Porque la foto tiene que LLEGAR al servidor para que sharp la vea, y el
 * cuerpo de una petición en Vercel se corta muy por debajo de lo que pesa
 * una foto de iPhone (una de 48 Mpx ronda los 8-12 MB). Sin esto, la mitad
 * de las subidas desde un teléfono rebotan antes de empezar — y rebotan
 * con el paciente todavía en el sillón.
 *
 * Es lo mismo que hace el dental (patient-photos-tab.tsx), escrito aquí:
 * se copia la idea, no el archivo.
 *
 * 🔴 Y ES BEST-EFFORT, SIEMPRE. Si el navegador no sabe decodificar el
 * formato —HEIC en Chrome de escritorio, por ejemplo— se manda el ORIGINAL
 * y que lo intente sharp, que sí trae libheif. Rebotar la foto porque el
 * navegador no supo encogerla sería perderla por la copia pequeña.
 *
 * ⚠️ `imageOrientation: "from-image"` no es un detalle: sin él, media
 * galería de un iPhone se sube de lado. El servidor vuelve a aplicar la
 * orientación EXIF con `.rotate()`, pero al pasar por el canvas los
 * metadatos EXIF SE PIERDEN — si el giro no se aplica aquí, ya no lo
 * aplica nadie.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Por encima de esto se intenta comprimir. 3.5 MB es el mismo umbral que
 * el dental, y está donde está porque el techo del cuerpo de una petición
 * serverless ronda los 4.5 MB: se deja margen para el resto del multipart
 * (etapa, vista, fecha, notas y las fronteras).
 */
export const EDU_FOTO_UMBRAL_COMPRIMIR = 3.5 * 1024 * 1024;
export const EDU_FOTO_UMBRAL_LABEL = "3.5 MB";

/** La calidad del JPEG que sale del canvas. La misma que usa sharp. */
const CALIDAD = 0.85;

export interface EduFotoPreparada {
  /** Lo que se mete en el FormData: el File original o el Blob encogido. */
  blob: Blob;
  fileName: string;
  size: number;
  /** true si de verdad se encogió. Es lo que la pantalla puede DECIR. */
  comprimida: boolean;
}

function talCual(file: File): EduFotoPreparada {
  return { blob: file, fileName: file.name, size: file.size, comprimida: false };
}

export async function eduPrepararFoto(file: File): Promise<EduFotoPreparada> {
  if (!file || file.size <= EDU_FOTO_UMBRAL_COMPRIMIR) return talCual(file);
  // `createImageBitmap` no existe en todos los navegadores viejos, y en un
  // entorno sin DOM (una prueba) tampoco: se comprueba en vez de suponerlo.
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return talCual(file);
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);

    const escala = Math.min(1, EDU_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return talCual(file);

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", CALIDAD),
    );

    // Si el "comprimido" pesa MÁS que el original (pasa con capturas de
    // pantalla PNG de pocos colores), se manda el original: encoger no
    // puede ser una forma de engordar.
    if (!blob || blob.size >= file.size) return talCual(file);

    return {
      blob,
      // El nombre cambia de extensión porque el binario cambió de formato:
      // un ".heic" que en realidad es JPEG es una mentira que el visor
      // acaba creyéndose.
      fileName: `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
      size: blob.size,
      comprimida: true,
    };
  } catch {
    // HEIC en un navegador que no lo decodifica, o cualquier otro formato
    // que el canvas no sepa leer: que lo intente sharp.
    return talCual(file);
  } finally {
    bitmap?.close?.();
  }
}
