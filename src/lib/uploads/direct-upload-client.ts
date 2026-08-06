"use client";

/**
 * Cliente de la subida DIRECTA de estudios pesados (hasta 2 GB) al expediente.
 *
 * Orquesta los 3 pasos y deja el bucket limpio pase lo que pase:
 *   1. POST .../uploads/sign     → signed upload URL + path (lo decide el servidor)
 *   2. PUT  <signedUrl>          → el binario va del navegador AL BUCKET, sin
 *                                  tocar el servidor (por eso caben 2 GB)
 *   3. POST .../uploads/confirm  → el servidor mide el objeto real y lo registra
 *
 * El PUT va por XMLHttpRequest y no por fetch a propósito: `fetch` todavía no
 * expone progreso de SUBIDA en los navegadores, y una subida de 900 MB sin
 * porcentaje es indistinguible de una colgada.
 *
 * SOBRE "REANUDABLE": un corte de red se reintenta automáticamente (hasta 3
 * intentos con backoff) y el intento fallido se limpia del bucket, así que la
 * subida sobrevive al corte — pero los bytes vuelven a empezar. La reanudación
 * real byte a byte necesita TUS (/upload/resumable), que exige mandar el JWT del
 * usuario desde el navegador y abrir políticas RLS de escritura sobre
 * `storage.objects` en el bucket de archivos clínicos. Hoy ese bucket es privado
 * con deny-all y todo pasa por signed URLs de service-role; abrirlo es una
 * decisión de seguridad aparte, no un detalle de implementación. Queda anotado
 * como follow-up en ORQUESTA.md.
 */

import {
  MAX_STUDY_UPLOAD_BYTES,
  MAX_STUDY_UPLOAD_LABEL,
  STUDY_UPLOAD_EXT,
  extOfName,
  formatBytes,
  isStudyExt,
} from "@/lib/uploads/patient-study-upload";

/** Intentos totales del PUT antes de rendirse (1 original + 2 reintentos). */
const MAX_ATTEMPTS = 3;
/** Reintentos de /confirm cuando Storage aún no lista el objeto recién subido. */
const CONFIRM_ATTEMPTS = 3;

export type UploadPhase = "signing" | "uploading" | "retrying" | "confirming";

export interface UploadedStudy {
  id: string;
  name: string;
  url: string;
  webUrl?: string;
  size: number | null;
  mimeType: string | null;
  createdAt: string;
  /** false = archivo grande guardado tal cual, sin procesamiento automático. */
  inspected?: boolean;
}

export interface DirectUploadOptions {
  patientId: string;
  file: File;
  /** 0-100. */
  onProgress?: (percent: number) => void;
  /** Para que la UI diga "Reintentando (2/3)…" en vez de quedarse muda. */
  onPhase?: (phase: UploadPhase, attempt: number) => void;
  signal?: AbortSignal;
}

/** El usuario canceló: no es un error que haya que mostrar en rojo. */
export class UploadCancelled extends Error {
  constructor() {
    super("Subida cancelada");
    this.name = "UploadCancelled";
  }
}

class RetryableError extends Error {}

/**
 * Fallo con el `code` que mandó el servidor (p. ej. PLAN_LIMIT_STORAGE), para
 * que la UI pueda reaccionar —mostrar el CTA de plan— sin adivinar leyendo el
 * texto del mensaje.
 */
export class UploadFailed extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "UploadFailed";
    this.code = code;
  }
}

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

async function failureFrom(res: Response, fallback: string): Promise<UploadFailed> {
  try {
    const body = await res.json();
    if (body?.error) return new UploadFailed(String(body.error), body?.code);
  } catch {
    /* respuesta sin JSON */
  }
  return new UploadFailed(fallback);
}

/**
 * PUT del archivo al signed URL con progreso real. Distingue los fallos que
 * vale la pena reintentar (red caída, 5xx) de los que no (413 del bucket, 4xx):
 * reintentar un 413 sólo hace perder otra vez el tiempo de subida.
 */
function putWithProgress(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onSignalAbort = () => xhr.abort();

    const done = (fn: () => void) => {
      signal?.removeEventListener("abort", onSignalAbort);
      fn();
    };

    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return done(resolve);
      if (xhr.status === 413) {
        return done(() =>
          reject(
            new Error(
              `El almacenamiento rechazó el archivo por tamaño. Revisa el límite de tamaño del bucket (debe permitir ${MAX_STUDY_UPLOAD_LABEL}).`,
            ),
          ),
        );
      }
      if (xhr.status >= 500 || xhr.status === 0) {
        return done(() => reject(new RetryableError(`El almacenamiento falló (${xhr.status})`)));
      }
      done(() => reject(new Error(`La subida falló (${xhr.status})`)));
    };
    // Red caída / DNS / TLS: el caso clásico del corte a media subida.
    xhr.onerror = () => done(() => reject(new RetryableError("Se interrumpió la conexión")));
    xhr.ontimeout = () => done(() => reject(new RetryableError("La subida tardó demasiado")));
    xhr.onabort = () => done(() => reject(new UploadCancelled()));

    if (isAborted(signal)) return done(() => reject(new UploadCancelled()));
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    xhr.send(file);
  });
}

/**
 * Borra del bucket un objeto que se subió pero nunca se confirmó. Best-effort:
 * si falla, el usuario no se entera (ya tiene bastante con su subida cancelada)
 * y el objeto queda para el barrido de huérfanos.
 */
async function abortUpload(patientId: string, path: string): Promise<void> {
  try {
    await fetch(`/api/patients/${patientId}/uploads/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
      // keepalive: que la limpieza salga aunque la pestaña se esté cerrando.
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Sube un estudio de punta a punta. Lanza `UploadCancelled` si el usuario
 * cancela, o un Error con mensaje ya listo para mostrar en cualquier otro caso.
 */
export async function uploadStudyDirect({
  patientId,
  file,
  onProgress,
  onPhase,
  signal,
}: DirectUploadOptions): Promise<UploadedStudy> {
  // Validación de cortesía: el servidor vuelve a validar todo esto. Aquí sólo
  // evita que el usuario espere una subida que iba a rebotar de todas formas.
  const ext = extOfName(file.name);
  if (!isStudyExt(ext)) {
    throw new Error(
      `Formato no permitido. Se aceptan: ${STUDY_UPLOAD_EXT.map((e) => `.${e}`).join(", ")}.`,
    );
  }
  if (file.size > MAX_STUDY_UPLOAD_BYTES) {
    throw new Error(
      `El archivo pesa ${formatBytes(file.size)} y el máximo es ${MAX_STUDY_UPLOAD_LABEL}.`,
    );
  }
  if (file.size === 0) throw new Error("El archivo está vacío.");

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (isAborted(signal)) throw new UploadCancelled();

    onPhase?.(attempt === 1 ? "signing" : "retrying", attempt);
    onProgress?.(0);

    // Cada intento pide su propio path: así el intento anterior (que puede haber
    // dejado bytes a medias) se borra entero y nunca se mezclan dos subidas.
    const signRes = await fetch(`/api/patients/${patientId}/uploads/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
    if (!signRes.ok) {
      // 402 (cuota), 413 (muy grande), 400 (formato): son definitivos, no se
      // reintentan — el mensaje del servidor ya explica qué hacer.
      throw await failureFrom(signRes, "No se pudo preparar la subida");
    }
    const { path, signedUrl, contentType } = (await signRes.json()) as {
      path: string;
      signedUrl: string;
      contentType: string;
    };

    try {
      onPhase?.("uploading", attempt);
      await putWithProgress(signedUrl, file, contentType, (p) => onProgress?.(p), signal);
    } catch (e) {
      // El intento dejó (o pudo dejar) un objeto a medias: se limpia siempre.
      await abortUpload(patientId, path);
      if (e instanceof UploadCancelled) throw e;
      if (e instanceof RetryableError && attempt < MAX_ATTEMPTS) {
        lastError = e;
        // Backoff: 1s, 3s. Da tiempo a que vuelva el wifi sin castigar al usuario.
        await new Promise((r) => setTimeout(r, attempt * 2000 - 1000));
        continue;
      }
      throw e instanceof RetryableError
        ? new Error(`${e.message}. Vuelve a intentarlo.`)
        : (e as Error);
    }

    // Subido. Si cancelan justo aquí, el objeto se borra: sin fila que lo
    // registre sería espacio pagado e invisible.
    if (isAborted(signal)) {
      await abortUpload(patientId, path);
      throw new UploadCancelled();
    }

    onPhase?.("confirming", attempt);
    onProgress?.(100);

    for (let c = 1; c <= CONFIRM_ATTEMPTS; c++) {
      const confirmRes = await fetch(`/api/patients/${patientId}/uploads/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name: file.name }),
      });
      if (confirmRes.ok) return (await confirmRes.json()) as UploadedStudy;

      // 409: Storage todavía no lista el objeto recién subido. El objeto SÍ está
      // ahí, así que se reintenta el registro (no la subida) antes de rendirse.
      if (confirmRes.status === 409 && c < CONFIRM_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * c));
        continue;
      }

      // Cuota, contenido inválido o error real: el servidor ya borró el objeto
      // en los casos en que corresponde. Mensaje directo al usuario.
      throw await failureFrom(confirmRes, "No se pudo registrar el estudio");
    }
  }

  throw new Error(lastError?.message ?? "No se pudo subir el estudio");
}
