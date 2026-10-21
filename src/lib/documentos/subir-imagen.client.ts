"use client";

/**
 * Sube una imagen del editor de documentos y devuelve su clave
 * (`documentos/<clinicId>/<id>.webp`), que es lo que el editor guarda en
 * `<img data-archivo>`. Es lo que el editor recibe como `onSubirImagen`.
 *
 * Una foto de 40 MB no cabe por una ruta de API (Vercel corta el cuerpo en
 * ~4.5 MB). Por eso hay dos caminos:
 *
 *   1. NORMAL: el navegador abre la foto, la deja en 1600 px y la recodifica
 *      (webp, o jpeg en el Safari que no codifica webp). Lo que viaja pesa
 *      < 1 MB y ya sin la ubicación GPS del EXIF. POST /api/documentos/imagenes.
 *   2. RESPALDO: si el navegador no pudo abrirla (foto de 200 MP en un teléfono
 *      sin memoria, formato que ese navegador no decodifica), el ORIGINAL sube
 *      directo al bucket con una URL firmada y el servidor lo comprime con sharp.
 *
 * En los dos el servidor vuelve a validar por los bytes y recodifica: lo de
 * aquí es para fallar rápido y con un mensaje claro, no la seguridad.
 *
 * HEIC (iPhone): Safari lo abre, así que desde el iPhone o la Mac entra por el
 * camino normal ya convertido. Chrome/Edge/Firefox de escritorio no lo abren y
 * el servidor tampoco (su sharp no trae HEVC): ahí se avisa sin subir nada.
 *
 * `onProgreso` recibe un porcentaje entero de 0 a 100.
 */

import { IMAGEN_MAX_POR_DOCUMENTO } from "./limites-imagen";
import {
  MENSAJES_IMAGEN,
  RUTA_IMAGENES,
  TOPE_CUERPO_RUTA,
  esHeic,
  medidasFinales,
  revisarArchivo,
  tipoDeclarado,
  type CodigoImagen,
} from "./imagenes";

export interface OpcionesSubidaImagen {
  signal?: AbortSignal;
  /** Porcentaje entero 0–100. */
  onProgreso?: (p: number) => void;
  /** Cuántas imágenes lleva ya el documento (si el editor lo sabe): corta antes de subir la 41.ª. */
  enDocumento?: number;
}

export interface ImagenSubida {
  clave: string;
  ancho: number;
  alto: number;
}

/** Error con mensaje listo para enseñar. `codigo` sirve para traducirlo o reaccionar. */
export class ErrorImagenDocumento extends Error {
  codigo: string;
  estado?: number;
  constructor(mensaje: string, codigo: string, estado?: number) {
    super(mensaje);
    this.name = "ErrorImagenDocumento";
    this.codigo = codigo;
    this.estado = estado;
  }
}

/** La persona canceló: no es un error que haya que enseñar en rojo. */
export class SubidaImagenCancelada extends Error {
  constructor() {
    super("Subida cancelada");
    this.name = "AbortError";
  }
}

const deCodigo = (codigo: CodigoImagen, estado?: number) => new ErrorImagenDocumento(MENSAJES_IMAGEN[codigo], codigo, estado);

/** Calidad en el navegador: alta, porque el servidor vuelve a comprimir. */
const CALIDAD_NAVEGADOR = 0.92;
/** Intentos del PUT del original ante cortes de red o 5xx. */
const INTENTOS_PUT = 2;

export async function subirImagenDocumento(file: File, opts: OpcionesSubidaImagen = {}): Promise<ImagenSubida> {
  const { signal, onProgreso, enDocumento } = opts;
  const codigo = revisarArchivo(file);
  if (codigo) throw deCodigo(codigo);
  if (typeof enDocumento === "number" && enDocumento >= IMAGEN_MAX_POR_DOCUMENTO) throw deCodigo("tope_por_documento");
  cortarSiCancelada(signal);
  onProgreso?.(0);

  const comprimida = await comprimirEnNavegador(file);
  cortarSiCancelada(signal);

  if (comprimida && comprimida.size <= TOPE_CUERPO_RUTA) {
    const cuerpo = new FormData();
    const ext = comprimida.type === "image/webp" ? "webp" : "jpg";
    cuerpo.append("archivo", comprimida, `imagen.${ext}`);
    cuerpo.append("nombre", file.name.slice(0, 120));
    if (typeof enDocumento === "number") cuerpo.append("enDocumento", String(enDocumento));
    const r = await enviar({
      metodo: "POST",
      url: RUTA_IMAGENES,
      cuerpo,
      signal,
      onProgreso: (p) => onProgreso?.(Math.min(95, Math.round(p * 0.95))),
    });
    const imagen = await resultado(r);
    onProgreso?.(100);
    return imagen;
  }

  if (esHeic(tipoDeclarado(file))) throw deCodigo("heic_no_legible");
  return subirOriginal(file, opts);
}

// ─────────────────────────── Camino de respaldo ───────────────────────────

async function subirOriginal(file: File, { signal, onProgreso, enDocumento }: OpcionesSubidaImagen): Promise<ImagenSubida> {
  const firma = await fetch(`${RUTA_IMAGENES}/original`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: file.name, tamano: file.size, tipo: file.type, enDocumento }),
    signal,
  }).catch((e) => lanzarDeRed(e, signal));
  if (!firma.ok) throw await errorDeRespuesta(firma.status, await firma.text());
  const { id, signedUrl } = (await firma.json()) as { id: string; signedUrl: string };

  const descartar = () =>
    fetch(`${RUTA_IMAGENES}/original?id=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => undefined);

  for (let intento = 1; ; intento++) {
    let r: Respuesta;
    try {
      r = await enviar({
        metodo: "PUT",
        url: signedUrl,
        cuerpo: file,
        cabeceras: { "Content-Type": file.type || "application/octet-stream" },
        signal,
        onProgreso: (p) => onProgreso?.(Math.round(p * 0.9)),
      });
    } catch (e) {
      if (e instanceof SubidaImagenCancelada || intento >= INTENTOS_PUT) {
        await descartar();
        throw e;
      }
      continue;
    }
    if (r.estado >= 200 && r.estado < 300) break;
    if ((r.estado >= 500 || r.estado === 0) && intento < INTENTOS_PUT) continue;
    await descartar();
    throw r.estado === 413 ? deCodigo("muy_pesada", 413) : new ErrorImagenDocumento("No se pudo subir la imagen. Inténtalo otra vez.", "almacen", r.estado);
  }

  if (signal?.aborted) {
    await descartar();
    throw new SubidaImagenCancelada();
  }
  onProgreso?.(92);

  // El original ya está en el bucket: procesarlo no se cancela a medias. El
  // servidor lo borra al terminar, salga bien o mal; si la petición ni llegó
  // a procesarlo (red, sesión vencida, límite), se descarta desde aquí.
  try {
    const proc = await fetch(`${RUTA_IMAGENES}/original/procesar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, nombre: file.name }),
    }).catch((e) => lanzarDeRed(e));
    const imagen = await resultado({ estado: proc.status, texto: await proc.text() });
    onProgreso?.(100);
    return imagen;
  } catch (e) {
    await descartar();
    throw e;
  }
}

// ─────────────────────────── Comprimir en el navegador ───────────────────────────

/**
 * La foto en ≤ 1600 px, derecha según su EXIF, recodificada. `null` si este
 * navegador no la puede abrir (o se quedó sin memoria): entonces va el original.
 */
async function comprimirEnNavegador(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let mapa: ImageBitmap;
  try {
    mapa = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch (e) {
    // Un WebKit viejo (iOS 16) no conoce "from-image" y lanza TypeError por la
    // opción, no por la foto: se reintenta sin opciones (ahí el navegador ya
    // aplica el EXIF por su cuenta o la deja como viene).
    if (!(e instanceof TypeError)) return null;
    try {
      mapa = await createImageBitmap(file);
    } catch {
      return null;
    }
  }
  try {
    const { ancho, alto } = medidasFinales(mapa.width, mapa.height);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mapa, 0, 0, ancho, alto);
    const webp = await aBlob(lienzo, "image/webp");
    if (webp && webp.type === "image/webp") return webp;
    // Safari no codifica webp (toBlob cae a png, que pesa más que el original):
    // jpeg sobre blanco, que es el papel de la hoja.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, ancho, alto);
    return await aBlob(lienzo, "image/jpeg");
  } catch {
    return null;
  } finally {
    mapa.close();
  }
}

function aBlob(lienzo: HTMLCanvasElement, tipo: string): Promise<Blob | null> {
  return new Promise((resolve) => lienzo.toBlob(resolve, tipo, CALIDAD_NAVEGADOR));
}

// ─────────────────────────── Red ───────────────────────────

interface Respuesta {
  estado: number;
  texto: string;
}

/**
 * XMLHttpRequest y no fetch: fetch todavía no da progreso de SUBIDA, y 40 MB
 * sin porcentaje no se distinguen de una subida colgada.
 */
function enviar(o: {
  metodo: "POST" | "PUT";
  url: string;
  cuerpo: Blob | FormData;
  cabeceras?: Record<string, string>;
  signal?: AbortSignal;
  onProgreso?: (p: number) => void;
}): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const alCancelar = () => xhr.abort();
    const fin = (f: () => void) => {
      o.signal?.removeEventListener("abort", alCancelar);
      f();
    };
    xhr.open(o.metodo, o.url);
    for (const [k, v] of Object.entries(o.cabeceras ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) o.onProgreso?.(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => fin(() => resolve({ estado: xhr.status, texto: String(xhr.responseText ?? "") }));
    xhr.onerror = () => fin(() => reject(new ErrorImagenDocumento("Se cortó la conexión. Inténtalo otra vez.", "red")));
    xhr.ontimeout = () => fin(() => reject(new ErrorImagenDocumento("La subida tardó demasiado. Inténtalo otra vez.", "red")));
    xhr.onabort = () => fin(() => reject(new SubidaImagenCancelada()));
    if (o.signal?.aborted) return fin(() => reject(new SubidaImagenCancelada()));
    o.signal?.addEventListener("abort", alCancelar, { once: true });
    xhr.send(o.cuerpo);
  });
}

async function resultado(r: Respuesta): Promise<ImagenSubida> {
  if (r.estado < 200 || r.estado >= 300) throw await errorDeRespuesta(r.estado, r.texto);
  const datos = JSON.parse(r.texto) as Partial<ImagenSubida>;
  if (typeof datos.clave !== "string") throw new ErrorImagenDocumento("No se pudo subir la imagen. Inténtalo otra vez.", "servidor", r.estado);
  return { clave: datos.clave, ancho: Number(datos.ancho) || 0, alto: Number(datos.alto) || 0 };
}

async function errorDeRespuesta(estado: number, texto: string): Promise<ErrorImagenDocumento> {
  let cuerpo: { error?: unknown; code?: unknown } = {};
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    /* sin JSON (un 413 del proxy, por ejemplo) */
  }
  const codigo = typeof cuerpo.code === "string" ? cuerpo.code : "";
  if (codigo in MENSAJES_IMAGEN) return deCodigo(codigo as CodigoImagen, estado);
  if (estado === 413) return deCodigo("muy_pesada", estado);
  if (estado === 401) return new ErrorImagenDocumento("Tu sesión terminó. Vuelve a entrar e inténtalo otra vez.", "sesion", estado);
  const mensaje = typeof cuerpo.error === "string" && estado < 500 ? cuerpo.error : "No se pudo subir la imagen. Inténtalo otra vez.";
  return new ErrorImagenDocumento(mensaje, codigo || "servidor", estado);
}

function cortarSiCancelada(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SubidaImagenCancelada();
}

function lanzarDeRed(e: unknown, signal?: AbortSignal): never {
  if (signal?.aborted || (e as Error)?.name === "AbortError") throw new SubidaImagenCancelada();
  throw new ErrorImagenDocumento("Se cortó la conexión. Inténtalo otra vez.", "red");
}
