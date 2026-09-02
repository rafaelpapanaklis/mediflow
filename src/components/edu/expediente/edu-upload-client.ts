"use client";

/**
 * Cliente de la subida DIRECTA de estudios al expediente del instituto.
 *
 * Orquesta los tres pasos y deja el bucket limpio pase lo que pase:
 *   1. POST .../estudios/sign     → signed upload URL + path (lo decide el
 *                                   SERVIDOR: el cliente nunca propone uno)
 *   2. PUT  <signedUrl>           → el binario va del navegador AL BUCKET,
 *                                   sin tocar el servidor (por eso caben
 *                                   cientos de MB)
 *   3. POST .../estudios/confirm  → el servidor mide el objeto real y lo
 *                                   registra
 *
 * 🔴 EL PUT VA POR XMLHttpRequest Y NO POR fetch, a propósito: `fetch`
 * todavía no expone progreso de SUBIDA en los navegadores, y una subida de
 * 900 MB sin porcentaje es indistinguible de una colgada. El usuario
 * cancela y vuelve a empezar, que es exactamente lo que no queremos.
 *
 * SOBRE "REANUDABLE": un corte de red se reintenta (hasta 3 intentos con
 * backoff) y el intento fallido se limpia del bucket, así que la subida
 * sobrevive al corte — pero los bytes vuelven a empezar. La reanudación
 * real byte a byte necesita TUS (/upload/resumable), que exige mandar el
 * JWT del usuario desde el navegador y abrir políticas RLS de escritura
 * sobre `storage.objects`. Hoy el bucket es privado con deny-all y todo
 * pasa por signed URLs de service role; abrirlo es una decisión de
 * seguridad aparte, no un detalle de implementación. Queda anotado en
 * ORQUESTA.md.
 *
 * Es el mismo patrón que src/lib/uploads/direct-upload-client.ts (dental).
 * No se importa porque ése apunta a /api/patients/... y compone el path con
 * el clinicId del dental.
 */

import {
  EDU_MAX_STUDY_BYTES,
  EDU_MAX_STUDY_LABEL,
  EDU_STUDY_EXT,
  eduExtOfName,
  eduFormatBytes,
  eduIsStudyExt,
} from "@/lib/edu/estudios-core";

/** Intentos totales del PUT (1 original + 2 reintentos). */
const MAX_INTENTOS = 3;
/** Reintentos de /confirm cuando Storage aún no lista el objeto subido. */
const INTENTOS_CONFIRM = 3;

export type EduUploadPhase = "firmando" | "subiendo" | "reintentando" | "registrando";

export interface EduUploadOptions {
  patientId: string;
  file: File;
  caseId?: string | null;
  notes?: string | null;
  /** 0-100. */
  onProgress?: (percent: number) => void;
  /** Para que la UI diga "Reintentando (2/3)…" en vez de quedarse muda. */
  onPhase?: (phase: EduUploadPhase, intento: number) => void;
  signal?: AbortSignal;
}

/** El usuario canceló: no es un error que haya que enseñar en rojo. */
export class EduUploadCancelled extends Error {
  constructor() {
    super("Subida cancelada");
    this.name = "EduUploadCancelled";
  }
}

class ReintentableError extends Error {}

function abortado(signal?: AbortSignal): boolean {
  return Boolean(signal && signal.aborted);
}

async function mensajeDeError(res: Response, porDefecto: string): Promise<Error> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return new Error(body.error);
  } catch {
    /* respuesta sin JSON */
  }
  return new Error(`${porDefecto} (HTTP ${res.status})`);
}

/**
 * PUT del archivo a la signed URL, con progreso real. Distingue los fallos
 * que vale la pena reintentar (red caída, 5xx) de los que no (413 del
 * bucket, 4xx): reintentar un 413 solo vuelve a perder el tiempo de subida.
 */
function putConProgreso(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const alAbortar = () => xhr.abort();

    const fin = (fn: () => void) => {
      if (signal) signal.removeEventListener("abort", alAbortar);
      fn();
    };

    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return fin(resolve);
      if (xhr.status === 413) {
        return fin(() =>
          reject(
            new Error(
              `El almacenamiento rechazó el archivo por tamaño. Revisa el límite del bucket en Supabase (tiene que permitir ${EDU_MAX_STUDY_LABEL}).`,
            ),
          ),
        );
      }
      if (xhr.status >= 500 || xhr.status === 0) {
        return fin(() => reject(new ReintentableError(`El almacenamiento falló (${xhr.status})`)));
      }
      fin(() => reject(new Error(`La subida falló (${xhr.status})`)));
    };
    xhr.onerror = () => fin(() => reject(new ReintentableError("Se interrumpió la conexión")));
    xhr.ontimeout = () => fin(() => reject(new ReintentableError("La subida tardó demasiado")));
    xhr.onabort = () => fin(() => reject(new EduUploadCancelled()));

    if (abortado(signal)) return fin(() => reject(new EduUploadCancelled()));
    if (signal) signal.addEventListener("abort", alAbortar, { once: true });
    xhr.send(file);
  });
}

/**
 * Borra del bucket un objeto que se subió y nunca se confirmó. Best-effort:
 * si falla, el usuario no se entera (bastante tiene con su subida
 * cancelada) y el objeto queda para el barrido de huérfanos.
 */
async function limpiar(patientId: string, path: string): Promise<void> {
  try {
    await fetch(`/api/instituto/pacientes/${patientId}/estudios/abort`, {
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
 * Sube un estudio de punta a punta. Lanza `EduUploadCancelled` si el
 * usuario cancela, o un Error con el mensaje listo para enseñar.
 */
export async function eduUploadStudy({
  patientId,
  file,
  caseId,
  notes,
  onProgress,
  onPhase,
  signal,
}: EduUploadOptions): Promise<{ id: string }> {
  // Validación de CORTESÍA: el servidor vuelve a validar todo esto. Aquí
  // solo evita que alguien espere una subida que iba a rebotar igual.
  const ext = eduExtOfName(file.name);
  if (!eduIsStudyExt(ext)) {
    throw new Error(
      `Ese formato no se acepta. Se aceptan: ${EDU_STUDY_EXT.map((e) => `.${e}`).join(", ")}.`,
    );
  }
  if (file.size > EDU_MAX_STUDY_BYTES) {
    throw new Error(
      `Ese archivo pesa ${eduFormatBytes(file.size)} y el máximo es ${EDU_MAX_STUDY_LABEL}.`,
    );
  }
  if (file.size === 0) throw new Error("El archivo está vacío.");

  let ultimoError: Error | null = null;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    if (abortado(signal)) throw new EduUploadCancelled();

    if (onPhase) onPhase(intento === 1 ? "firmando" : "reintentando", intento);
    if (onProgress) onProgress(0);

    // Cada intento pide su PROPIO path: así el anterior (que puede haber
    // dejado bytes a medias) se borra entero y nunca se mezclan dos
    // subidas en el mismo objeto.
    const firmaRes = await fetch(`/api/instituto/pacientes/${patientId}/estudios/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
    if (!firmaRes.ok) {
      // 413 (muy grande), 400 (formato), 403 (permiso), 404 (no te toca):
      // son definitivos. El mensaje del servidor ya explica qué hacer.
      throw await mensajeDeError(firmaRes, "No se pudo preparar la subida");
    }
    const { path, signedUrl, contentType } = (await firmaRes.json()) as {
      path: string;
      signedUrl: string;
      contentType: string;
    };

    try {
      if (onPhase) onPhase("subiendo", intento);
      await putConProgreso(signedUrl, file, contentType, (p) => onProgress && onProgress(p), signal);
    } catch (e) {
      // El intento dejó (o pudo dejar) un objeto a medias: se limpia siempre.
      await limpiar(patientId, path);
      if (e instanceof EduUploadCancelled) throw e;
      if (e instanceof ReintentableError && intento < MAX_INTENTOS) {
        ultimoError = e;
        // Backoff 1s, 3s: le da tiempo al wifi de volver sin castigar a
        // quien está esperando.
        await new Promise((r) => setTimeout(r, intento * 2000 - 1000));
        continue;
      }
      throw e instanceof ReintentableError ? new Error(`${e.message}. Vuelve a intentarlo.`) : e;
    }

    // Subido. Si cancelan justo aquí, el objeto se borra: sin fila que lo
    // registre sería espacio pagado e invisible.
    if (abortado(signal)) {
      await limpiar(patientId, path);
      throw new EduUploadCancelled();
    }

    if (onPhase) onPhase("registrando", intento);
    if (onProgress) onProgress(100);

    for (let c = 1; c <= INTENTOS_CONFIRM; c++) {
      const confirmRes = await fetch(`/api/instituto/pacientes/${patientId}/estudios/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          name: file.name,
          caseId: caseId || undefined,
          notes,
        }),
      });
      if (confirmRes.ok) return (await confirmRes.json()) as { id: string };

      // 409: Storage todavía no lista el objeto recién subido. El objeto SÍ
      // está ahí, así que se reintenta el REGISTRO (no la subida).
      if (confirmRes.status === 409 && c < INTENTOS_CONFIRM) {
        await new Promise((r) => setTimeout(r, 1000 * c));
        continue;
      }
      throw await mensajeDeError(confirmRes, "No se pudo registrar el estudio");
    }
  }

  throw new Error(ultimoError ? ultimoError.message : "No se pudo subir el estudio");
}
