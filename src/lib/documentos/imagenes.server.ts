import "server-only";

// Imágenes del editor de documentos (P4) — lado servidor.
//
// Bucket privado `patient-files` (el de siempre, deny-all, URL firmada de 300 s),
// bajo `documentos/<clinicId>/`. Sin tabla: la clave viaja en el HTML del
// documento (decisión 4 de Rafael, 20-oct).
//
// DOS CAMINOS DE ENTRADA, una sola salida (webp de ≤ 1600 px, sin metadatos):
//
//   1. Normal — el navegador ya comprimió la foto (subir-imagen.client.ts) y la
//      manda por POST /api/documentos/imagenes: pesa < 1 MB, cabe de sobra en
//      los ~4.5 MB que Vercel deja pasar por una ruta.
//   2. Respaldo — el navegador NO pudo abrirla (una foto de 200 MP en un
//      teléfono sin memoria, un formato que ese navegador no decodifica): el
//      ORIGINAL (hasta 40 MB) sube directo al bucket con una URL firmada, a
//      `documentos/<clinicId>/originales/<id>`, y POST …/original/procesar lo
//      baja servidor→servidor, lo comprime aquí y borra el original.
//
// En los dos casos el servidor vuelve a decodificar y recodificar con sharp: lo
// que se guarda nunca es lo que mandó el cliente. Eso quita de paso el EXIF (la
// ubicación GPS de la foto del celular no llega al bucket) y cualquier cosa
// escondida en el archivo.
//
// HEIC: el sharp del repo NO lo decodifica (su libheif no trae HEVC, y
// `sharp-bloqueos.ts` apaga ese cargador). La foto HEIC entra cuando el
// navegador la abre (Safari en iPhone/Mac, que es de donde salen) y llega aquí
// ya convertida; si el navegador no puede, se avisa con un mensaje claro.

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { createClient as createAdmin } from "@supabase/supabase-js";
import {
  BUCKETS,
  SIGNED_URL_TTL_SECONDS,
  createSignedFileUrl,
  getStorageObjectSize,
  removeFileFromStorage,
  uploadFileToStorage,
} from "@/lib/storage";
import { insertarFilaBitacora } from "@/lib/movimientos-paciente/fila";
import { registrarSubidaRechazada, type CodigoRechazo } from "@/lib/uploads/validar-archivo";
import { IMAGEN_LADO_MAX_PX, IMAGEN_MAX_BYTES, IMAGEN_TIPOS } from "./limites-imagen";
import {
  IMAGEN_MEGAPIXELES_MAX,
  MENSAJES_IMAGEN,
  claveDeImagen,
  claveDeOriginal,
  claveEsDeLaClinica,
  clavesEnHtml,
  esHeic,
  type CodigoImagen,
} from "./imagenes";

/** Calidad del webp guardado: a 1600 px no se distingue del original en la hoja ni en el PDF. */
const CALIDAD_WEBP = 82;

/** Estado HTTP de cada rechazo. */
export const ESTADO_POR_CODIGO: Record<CodigoImagen, number> = {
  vacia: 400,
  muy_pesada: 413,
  tipo_no_permitido: 415,
  heic_no_legible: 415,
  no_se_pudo_leer: 422,
  demasiados_pixeles: 422,
  tope_por_documento: 409,
};

const RECHAZO_POR_CODIGO: Record<CodigoImagen, CodigoRechazo> = {
  vacia: "vacio",
  muy_pesada: "demasiado_grande",
  tipo_no_permitido: "tipo_no_permitido",
  heic_no_legible: "tipo_no_permitido",
  no_se_pudo_leer: "imagen_corrupta",
  demasiados_pixeles: "imagen_excesiva",
  tope_por_documento: "tipo_no_permitido",
};

export class ImagenNoEncontrada extends Error {
  constructor() {
    super("Imagen no encontrada");
    this.name = "ImagenNoEncontrada";
  }
}

export const nuevoIdDeImagen = () => randomUUID().replace(/-/g, "");

let cliente: ReturnType<typeof createAdmin> | null = null;
function bucket() {
  if (!cliente) {
    cliente = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return cliente.storage.from(BUCKETS.PATIENT_FILES);
}

export const almacenConfigurado = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────── Comprimir ───────────────────────────

export type ResultadoCompresion =
  | { ok: true; webp: Buffer; ancho: number; alto: number; tipoOriginal: string; codigo?: undefined }
  | { ok: false; codigo: CodigoImagen; webp?: undefined };

const fallo = (codigo: CodigoImagen): ResultadoCompresion => ({ ok: false, codigo });

/**
 * Valida por los BYTES (no por el nombre ni por el Content-Type) y deja la
 * imagen en webp de lado mayor ≤ IMAGEN_LADO_MAX_PX, derecha según su EXIF y
 * sin metadatos.
 */
export async function comprimirImagen(bytes: Buffer): Promise<ResultadoCompresion> {
  if (bytes.length === 0) return fallo("vacia");
  if (bytes.length > IMAGEN_MAX_BYTES) return fallo("muy_pesada");

  // SVG, PDF, HTML… no tienen firma de imagen y salen sin tipo: fuera.
  const detectado = await fileTypeFromBuffer(bytes).catch(() => undefined);
  if (!detectado || !IMAGEN_TIPOS.includes(detectado.mime)) return fallo("tipo_no_permitido");
  if (esHeic(detectado.mime)) return fallo("heic_no_legible");

  const entrada = () => sharp(bytes, { limitInputPixels: IMAGEN_MEGAPIXELES_MAX, failOn: "error" });
  try {
    const meta = await entrada().metadata();
    if (!meta.width || !meta.height) return fallo("no_se_pudo_leer");
    if (meta.width * meta.height > IMAGEN_MEGAPIXELES_MAX) return fallo("demasiados_pixeles");
  } catch (e) {
    return fallo(/pixel limit/i.test(String((e as Error)?.message)) ? "demasiados_pixeles" : "no_se_pudo_leer");
  }

  try {
    const { data, info } = await entrada()
      .rotate()
      .resize({ width: IMAGEN_LADO_MAX_PX, height: IMAGEN_LADO_MAX_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, webp: data, ancho: info.width, alto: info.height, tipoOriginal: detectado.mime };
  } catch (e) {
    return fallo(/pixel limit/i.test(String((e as Error)?.message)) ? "demasiados_pixeles" : "no_se_pudo_leer");
  }
}

/** Sube el webp ya comprimido y devuelve su clave. `upsert: false`: el id es nuevo. */
export async function guardarImagenComprimida(clinicId: string, webp: Buffer): Promise<{ id: string; clave: string }> {
  const id = nuevoIdDeImagen();
  const clave = claveDeImagen(clinicId, id);
  await uploadFileToStorage(clave, webp, "image/webp");
  return { id, clave };
}

// ─────────────────────────── Camino del original ───────────────────────────

/** URL firmada para que el navegador suba el original directo al bucket. El path lo decide el servidor. */
export async function firmarSubidaDeOriginal(clinicId: string): Promise<{ id: string; signedUrl: string; token: string }> {
  const id = nuevoIdDeImagen();
  // upsert: un reintento del PUT sobre el mismo id no muere con 409 (el header
  // x-upsert lo ignora Storage en las URL firmadas; va al firmar). El id es nuevo.
  const { data, error } = await bucket().createSignedUploadUrl(claveDeOriginal(clinicId, id), { upsert: true });
  if (error || !data) throw new Error(`No se pudo firmar la subida: ${error?.message ?? "sin datos"}`);
  return { id, signedUrl: data.signedUrl, token: data.token };
}

/** Borra el original de una subida directa. Best-effort: nunca lanza. */
export async function descartarOriginal(clinicId: string, id: string): Promise<void> {
  try {
    await removeFileFromStorage(claveDeOriginal(clinicId, id));
  } catch (e) {
    console.warn("[documentos/imagenes] no se pudo borrar el original:", (e as Error).message);
  }
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ResultadoOriginal =
  | { ok: true; clave: string; id: string; ancho: number; alto: number; bytesOriginal: number; bytesGuardados: number; codigo?: undefined }
  | { ok: false; codigo: CodigoImagen | "no_esta"; clave?: undefined };

/**
 * Baja el original que subió el navegador, lo comprime y guarda el webp. El
 * original se borra SIEMPRE (haya salido bien o no): sin tabla que lo cuente,
 * un original olvidado sería espacio pagado e invisible.
 *
 * El tamaño se le pregunta a Storage ANTES de bajar nada: la URL firmada no
 * limita lo que el cliente sube, y meter 2 GB en memoria tumbaría la función.
 */
export async function procesarOriginal(clinicId: string, id: string): Promise<ResultadoOriginal> {
  const ruta = claveDeOriginal(clinicId, id);
  try {
    // Justo después de un PUT grande, Storage puede tardar un instante en listarlo.
    let tamano: number | null = null;
    for (let intento = 0; intento < 4 && tamano === null; intento++) {
      tamano = await getStorageObjectSize(ruta);
      if (tamano === null && intento < 3) await esperar(300 * (intento + 1));
    }
    if (tamano === null) return { ok: false, codigo: "no_esta" };
    if (tamano === 0) return { ok: false, codigo: "vacia" };
    if (tamano > IMAGEN_MAX_BYTES) return { ok: false, codigo: "muy_pesada" };

    const { data, error } = await bucket().download(ruta);
    if (error || !data) return { ok: false, codigo: "no_esta" };
    const bytes = Buffer.from(await data.arrayBuffer());
    // Defensa por si el objeto cambió entre la medida y la descarga.
    if (bytes.length > IMAGEN_MAX_BYTES) return { ok: false, codigo: "muy_pesada" };

    const r = await comprimirImagen(bytes);
    if (!r.ok) return { ok: false, codigo: r.codigo };
    const { id: idFinal, clave } = await guardarImagenComprimida(clinicId, r.webp);
    return { ok: true, clave, id: idFinal, ancho: r.ancho, alto: r.alto, bytesOriginal: bytes.length, bytesGuardados: r.webp.length };
  } finally {
    await descartarOriginal(clinicId, id);
  }
}

// ─────────────────────────── Leer ───────────────────────────

/** URL firmada (300 s) de una imagen de ESTA clínica. Lanza ImagenNoEncontrada si la clave no es suya o no existe. */
export async function urlFirmadaDeImagen(clinicId: string, clave: string): Promise<string> {
  if (!claveEsDeLaClinica(clave, clinicId)) throw new ImagenNoEncontrada();
  try {
    return await createSignedFileUrl(clave, SIGNED_URL_TTL_SECONDS);
  } catch {
    throw new ImagenNoEncontrada();
  }
}

/**
 * Los bytes (webp) de una imagen de ESTA clínica, para el PDF del servidor
 * (P5: se incrustan como `data:` en la hoja que imprime Chromium). Lanza
 * ImagenNoEncontrada si la clave no es de `clinicId` —el de la SESIÓN o el del
 * documento ya cargado con su filtro de clínica, nunca uno del cliente— o si el
 * objeto no existe.
 */
export async function leerImagenDocumento(clinicId: string, clave: string): Promise<Buffer> {
  if (!claveEsDeLaClinica(clave, clinicId)) throw new ImagenNoEncontrada();
  const { data, error } = await bucket().download(clave);
  if (error || !data) throw new ImagenNoEncontrada();
  return Buffer.from(await data.arrayBuffer());
}

// ─────────────────────────── Copiar a otra sede ───────────────────────────

/**
 * Para cuando un documento o plantilla pasa a OTRA clínica (copiar la
 * configuración a una sede nueva, `copia-sede.server.ts`): cada imagen de
 * `deClinicId` se copia en el bucket a la carpeta de `aClinicId` con un id
 * nuevo y el HTML sale con las claves nuevas. Sin esto, la copia apuntaría a
 * la carpeta de la otra clínica y en la sede nueva se vería rota (404).
 * Una imagen que no se pudo copiar se queda con su clave vieja (se ve rota,
 * pero la copia de la plantilla no falla por ella). Las claves de cualquier
 * otra clínica no se tocan.
 */
export async function copiarImagenesEntreClinicas(html: string, deClinicId: string, aClinicId: string): Promise<string> {
  if (deClinicId === aClinicId) return html;
  let salida = html;
  for (const clave of clavesEnHtml(html)) {
    if (!claveEsDeLaClinica(clave, deClinicId)) continue;
    const nueva = claveDeImagen(aClinicId, nuevoIdDeImagen());
    const { error } = await bucket().copy(clave, nueva);
    if (error) {
      console.warn("[documentos/imagenes] no se pudo copiar a la otra sede:", clave, error.message);
      continue;
    }
    salida = salida.split(clave).join(nueva);
  }
  return salida;
}

// ─────────────────────────── Bitácora ───────────────────────────

export interface QuienSube {
  clinicId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Una fila por imagen guardada (sin paciente: la imagen es del documento, no de un expediente). */
export async function registrarImagenGuardada(
  quien: QuienSube,
  datos: { id: string; clave: string; camino: "navegador" | "original"; bytesRecibidos: number; bytesGuardados: number; ancho: number; alto: number },
): Promise<void> {
  try {
    await insertarFilaBitacora({
      clinicId: quien.clinicId,
      userId: quien.userId,
      entityType: "document-image",
      entityId: datos.id,
      action: "create",
      changes: {
        _imagen: {
          before: null,
          after: {
            clave: datos.clave,
            camino: datos.camino,
            bytesRecibidos: datos.bytesRecibidos,
            bytesGuardados: datos.bytesGuardados,
            ancho: datos.ancho,
            alto: datos.alto,
          },
        },
      },
      ipAddress: quien.ipAddress ?? null,
      userAgent: quien.userAgent ?? null,
      patientId: null,
    });
  } catch (e) {
    // La bitácora nunca tumba la subida.
    console.error("[documentos/imagenes] bitácora:", e);
  }
}

/** Rechazo a la bitácora de subidas rechazadas (la misma que usan las demás rutas de subida). */
export async function registrarImagenRechazada(
  quien: QuienSube,
  ruta: string,
  codigo: CodigoImagen,
  nombreOriginal: string,
): Promise<void> {
  await registrarSubidaRechazada({
    clinicId: quien.clinicId,
    userId: quien.userId,
    ruta,
    motivo: MENSAJES_IMAGEN[codigo],
    codigo: RECHAZO_POR_CODIGO[codigo],
    nombreOriginal: nombreOriginal || "imagen",
    ipAddress: quien.ipAddress,
    userAgent: quien.userAgent,
  });
}
