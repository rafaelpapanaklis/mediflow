"use client";

import {
  EDU_PHOTO_JPEG_QUALITY,
  EDU_PHOTO_MAX_EDGE,
  EDU_PHOTO_THUMB_EDGE,
  EDU_PHOTO_THUMB_MIME,
  EDU_PHOTO_THUMB_QUALITY,
  EDU_PHOTO_UPLOAD_MIME,
} from "@/lib/edu/fotos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * COMPRESIÓN EN EL NAVEGADOR, ANTES DE SUBIR — Y AHORA OBLIGATORIA (N-2).
 *
 * 🔴 QUÉ CAMBIÓ Y POR QUÉ.
 *
 * Antes esto era un ATAJO best-effort: solo se intentaba por encima de
 * 3.5 MB y, si el navegador no sabía decodificar el formato, se mandaba el
 * ORIGINAL «y que lo intente sharp». Eso valía mientras la foto pasara por
 * el servidor. Ya no pasa: sube DIRECTO al bucket, sharp no la ve nunca, y
 * lo que salga de aquí es exactamente lo que queda en el expediente.
 *
 * Así que ahora esta función hace las dos cosas, siempre:
 *   · el PRINCIPAL: 2 400 px como lado mayor, JPEG q85 — los mismos
 *     parámetros que usaba sharp, importados y no copiados;
 *   · la MINIATURA: 300 px recortada al cuadrado, WebP q80 — sin ella una
 *     galería de 40 fotos se descarga entera para pintar 40 cuadraditos.
 *
 * 🔴 Y SI EL NAVEGADOR NO PUEDE LEER EL ARCHIVO, SE RECHAZA. No se manda el
 * original. Un HEIC en el Chrome de un escritorio no lo decodifica nadie:
 * subirlo tal cual dejaba en el bucket un binario que después la galería no
 * sabe pintar, la tarjeta salía rota y el aviso decía «los enlaces
 * caducaron» — se pulsaba «Renovar», volvía a fallar, y así para siempre.
 * Es el bucle de N-5, y se corta aquí, antes de que exista la fila.
 *
 * ⚠️ `imageOrientation: "from-image"` no es un detalle: sin él, media
 * galería de un iPhone se sube de lado. Y ahora es la ÚNICA oportunidad de
 * aplicarlo — al pasar por el canvas los metadatos EXIF se pierden, y el
 * `.rotate()` del servidor ya no está detrás para arreglarlo.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** La calidad del JPEG que sale del canvas. La misma que usaba sharp. */
const CALIDAD = EDU_PHOTO_JPEG_QUALITY / 100;
const CALIDAD_THUMB = EDU_PHOTO_THUMB_QUALITY / 100;

/**
 * El navegador no supo leer el archivo. Es un error PARA LA PERSONA, con
 * la salida escrita: se distingue de un fallo de red para que la pantalla
 * no le ofrezca «reintentar» algo que va a fallar exactamente igual.
 */
export class EduFotoIlegible extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EduFotoIlegible";
  }
}

export interface EduFotoPreparada {
  /** El JPEG de 2 400 px que se sube al bucket. */
  blob: Blob;
  /**
   * La miniatura WebP, o `null` en el único caso en que se acepta que
   * falte: un navegador que no sabe CODIFICAR WebP (`toBlob` cae a PNG por
   * especificación, y se detecta mirando el `type` del blob). La columna
   * `thumbnailPath` es nullable justo para esto y la galería cae a la foto
   * completa. Perder la foto por la copia pequeña sería el intercambio al
   * revés.
   */
  thumb: Blob | null;
  /** El nombre con el que viaja: siempre `.jpg`, porque el binario lo es. */
  fileName: string;
  size: number;
  width: number;
  height: number;
  /** Lo que pesaba el archivo elegido. Es lo que la pantalla puede DECIR. */
  originalSize: number;
}

/** Cómo se llama el formato que el navegador no supo leer, para el aviso. */
function formatoDe(file: File): string {
  const tipo = String(file?.type ?? "").toLowerCase();
  if (tipo === "image/heic" || tipo === "image/heif") return "HEIC";
  const ext = /\.([a-z0-9]{1,5})$/i.exec(file?.name ?? "");
  if (ext) {
    const e = ext[1].toLowerCase();
    if (e === "heic" || e === "heif") return "HEIC";
    return `.${e}`;
  }
  return "ese formato";
}

/** El aviso, con la salida escrita. Es lo único que lee quien está de pie. */
function mensajeIlegible(file: File): string {
  const f = formatoDe(file);
  if (f === "HEIC") {
    return (
      "Este navegador no puede leer HEIC; súbela desde el teléfono o como JPG. " +
      "(En un iPhone: Ajustes → Cámara → Formatos → «Más compatible».)"
    );
  }
  return (
    `Este navegador no puede leer ${f}: la foto no se puede preparar y no se sube. ` +
    "Vuelve a exportarla como JPG, o súbela desde el teléfono."
  );
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

/**
 * Prepara la foto: el JPEG grande y su miniatura. Lanza `EduFotoIlegible`
 * con el motivo escrito si el navegador no puede con el archivo.
 */
export async function eduPrepararFoto(file: File): Promise<EduFotoPreparada> {
  if (!file || file.size === 0) {
    throw new EduFotoIlegible("El archivo está vacío. Vuelve a elegirlo.");
  }
  // `createImageBitmap` no existe en navegadores viejos, y en un entorno sin
  // DOM (una prueba) tampoco: se comprueba en vez de suponerlo. Antes esto
  // era una de las cuatro puertas por las que se colaba el original.
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new EduFotoIlegible(
      "Este navegador no puede preparar la foto para subirla. Ábrelo desde el teléfono, " +
        "o actualiza el navegador.",
    );
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    throw new EduFotoIlegible(mensajeIlegible(file));
  }

  try {
    const escala = Math.min(1, EDU_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new EduFotoIlegible(mensajeIlegible(file));
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await aBlob(canvas, EDU_PHOTO_UPLOAD_MIME, CALIDAD);
    if (!blob || blob.size === 0) throw new EduFotoIlegible(mensajeIlegible(file));

    // ── La MINIATURA, recortada al cuadrado desde el centro ────────────
    // `fit: "cover"` de sharp, hecho a mano: se toma el cuadrado central
    // del original y se dibuja en 300×300. Recortar desde una esquina
    // dejaría media cara fuera en las fotos verticales, que son casi todas.
    const lado = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - lado) / 2);
    const sy = Math.round((bitmap.height - lado) / 2);
    const mini = document.createElement("canvas");
    mini.width = EDU_PHOTO_THUMB_EDGE;
    mini.height = EDU_PHOTO_THUMB_EDGE;
    const mctx = mini.getContext("2d");
    let thumb: Blob | null = null;
    if (mctx) {
      mctx.drawImage(
        bitmap,
        sx,
        sy,
        lado,
        lado,
        0,
        0,
        EDU_PHOTO_THUMB_EDGE,
        EDU_PHOTO_THUMB_EDGE,
      );
      const t = await aBlob(mini, EDU_PHOTO_THUMB_MIME, CALIDAD_THUMB);
      // 🔴 `toBlob` con un tipo que no soporta cae a PNG POR ESPECIFICACIÓN,
      // sin avisar. Si no salió WebP, no se sube nada: subir un PNG bajo un
      // path `-thumb.webp` con `Content-Type: image/webp` es sembrar una
      // mentira en el bucket.
      thumb = t && t.type === EDU_PHOTO_THUMB_MIME && t.size > 0 ? t : null;
    }

    return {
      blob,
      thumb,
      // El nombre cambia de extensión porque el binario cambió de formato:
      // un ".heic" que en realidad es JPEG es una mentira que el visor
      // acaba creyéndose.
      fileName: `${file.name.replace(/\.[^.]+$/, "") || "foto"}.jpg`,
      size: blob.size,
      width: ancho,
      height: alto,
      originalSize: file.size,
    };
  } finally {
    bitmap?.close?.();
  }
}
