"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Cliente de la subida DIRECTA de una FOTO CLÍNICA (N-2).
 *
 * Orquesta los tres pasos y deja el bucket limpio pase lo que pase:
 *   0. eduPrepararFoto           → 2 400 px JPEG q85 + miniatura 300 px
 *                                  WebP, EN EL NAVEGADOR y obligatorias.
 *                                  Si no se puede leer el archivo, se
 *                                  rechaza aquí y no se firma nada.
 *   1. POST .../fotos/sign       → signed upload URL + path (lo decide el
 *                                  SERVIDOR: el cliente nunca propone uno)
 *   2. PUT  <signedUrl>          → el binario va del navegador AL BUCKET,
 *                                  sin tocar el servidor — que es todo el
 *                                  arreglo: el cuerpo de un route handler
 *                                  se corta muy por debajo de una foto
 *   3. POST .../fotos/confirm    → el servidor mide el objeto real,
 *                                  comprueba su número mágico y registra
 *
 * 🔴 EL PUT VA POR XMLHttpRequest Y NO POR fetch, a propósito: `fetch`
 * todavía no expone progreso de SUBIDA en los navegadores, y una foto de
 * 20 MB por 4G sin porcentaje es indistinguible de una colgada.
 *
 * Es el MISMO patrón que `expediente/edu-upload-client.ts` (estudios). No
 * se importa aquél porque apunta a `/estudios/...`, valida extensiones de
 * estudio y no sabe nada de miniaturas — y porque esta carpeta no importa
 * de fuera de sí misma más que módulos puros.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { eduPrepararFoto, type EduFotoPreparada } from "@/components/edu/fotos/comprimir";

/** Intentos totales del PUT (1 original + 2 reintentos). */
const MAX_INTENTOS = 3;
/** Reintentos de /confirm cuando Storage aún no lista el objeto subido. */
const INTENTOS_CONFIRM = 3;

export type EduFotoUploadPhase = "preparando" | "firmando" | "subiendo" | "reintentando" | "registrando";

export interface EduFotoUploadOptions {
  patientId: string;
  file: File;
  /** La foto ya preparada, si la pantalla la preparó al elegirla. */
  preparada?: EduFotoPreparada | null;
  stage: string;
  photoType: string;
  /** ISO (mediodía UTC del día civil), o null si no se sabe. */
  capturedAt?: string | null;
  caseId?: string | null;
  notes?: string | null;
  /** 0-100. */
  onProgress?: (percent: number) => void;
  onPhase?: (phase: EduFotoUploadPhase, intento: number) => void;
  signal?: AbortSignal;
}

/** El usuario canceló: no es un error que haya que enseñar en rojo. */
export class EduFotoUploadCancelled extends Error {
  constructor() {
    super("Subida cancelada");
    this.name = "EduFotoUploadCancelled";
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
  if (res.status === 403) {
    return new Error("Tu cuenta no tiene permiso para subir fotos a este expediente.");
  }
  if (res.status === 401) return new Error("Tu sesión caducó. Vuelve a entrar.");
  return new Error(`${porDefecto} (HTTP ${res.status})`);
}

/**
 * PUT del binario a la signed URL, con progreso real. Distingue los fallos
 * que vale la pena reintentar (red caída, 5xx) de los que no (4xx del
 * bucket): reintentar un 413 solo vuelve a perder el tiempo de subida.
 */
function putConProgreso(
  signedUrl: string,
  blob: Blob,
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
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return fin(resolve);
      if (xhr.status === 413) {
        return fin(() =>
          reject(
            new Error(
              "El almacenamiento rechazó la foto por tamaño. Avísale a quien administra el " +
                "instituto: hay que revisar el límite del bucket en Supabase.",
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
    xhr.onabort = () => fin(() => reject(new EduFotoUploadCancelled()));

    if (abortado(signal)) return fin(() => reject(new EduFotoUploadCancelled()));
    if (signal) signal.addEventListener("abort", alAbortar, { once: true });
    xhr.send(blob);
  });
}

/**
 * Borra del bucket lo que se subió y nunca se confirmó. Best-effort: si
 * falla, quien subió no se entera (bastante tiene con su subida cancelada)
 * y el objeto queda para el barrido de huérfanos.
 *
 * 🔴 SE LLAMA TAMBIÉN CUANDO /confirm FALLA DE VERDAD, y no solo al
 * cancelar: es la lección de H-26. La cuota se calcula con
 * `SUM(EduClinicalPhoto.sizeBytes)`, así que un objeto sin fila son bytes
 * que se pagan y que no aparecen en el medidor.
 */
async function limpiar(patientId: string, path: string, thumbPath: string | null): Promise<void> {
  try {
    await fetch(`/api/instituto/pacientes/${patientId}/fotos/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, thumbPath }),
      // keepalive: que la limpieza salga aunque la pestaña se esté cerrando.
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Sube una foto clínica de punta a punta. Lanza `EduFotoUploadCancelled` si
 * la persona cancela, `EduFotoIlegible` si el navegador no puede leer el
 * archivo, o un Error con el mensaje ya escrito para enseñar.
 */
export async function eduUploadPhoto({
  patientId,
  file,
  preparada,
  stage,
  photoType,
  capturedAt,
  caseId,
  notes,
  onProgress,
  onPhase,
  signal,
}: EduFotoUploadOptions): Promise<{ id: string }> {
  if (abortado(signal)) throw new EduFotoUploadCancelled();

  // ── 0. PREPARAR. Lanza EduFotoIlegible si no se puede: entonces NO se
  //    firma nada, no se sube nada y no hay que limpiar nada.
  if (onPhase) onPhase("preparando", 1);
  const lista = preparada ?? (await eduPrepararFoto(file));

  let ultimoError: Error | null = null;

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    if (abortado(signal)) throw new EduFotoUploadCancelled();

    if (onPhase) onPhase(intento === 1 ? "firmando" : "reintentando", intento);
    if (onProgress) onProgress(0);

    // Cada intento pide su PROPIO path: así el anterior (que puede haber
    // dejado bytes a medias) se borra entero y nunca se mezclan dos
    // subidas en el mismo objeto.
    let firmaRes: Response;
    try {
      firmaRes = await fetch(`/api/instituto/pacientes/${patientId}/fotos/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lista.fileName,
          size: lista.size,
          contentType: lista.blob.type || "image/jpeg",
        }),
        signal,
      });
    } catch (e) {
      // Un `fetch` abortado lanza un DOMException "AbortError", no nuestro
      // EduFotoUploadCancelled: se traduce, o la pantalla enseñaría el
      // nombre de una excepción del navegador en rojo. Aquí todavía no hay
      // `path`, así que no hay nada que limpiar.
      if (abortado(signal)) throw new EduFotoUploadCancelled();
      throw e;
    }
    if (!firmaRes.ok) {
      // 413 (muy grande), 400 (formato), 403 (permiso), 404 (no te toca),
      // 507 (la escuela no tiene sitio): son definitivos. El mensaje del
      // servidor ya explica qué hacer.
      throw await mensajeDeError(firmaRes, "No se pudo preparar la subida");
    }
    const { path, thumbPath, signedUrl, thumbSignedUrl, contentType, thumbContentType } =
      (await firmaRes.json()) as {
        path: string;
        thumbPath: string;
        signedUrl: string;
        thumbSignedUrl: string;
        contentType: string;
        thumbContentType: string;
      };

    let thumbSubida = false;
    try {
      if (onPhase) onPhase("subiendo", intento);
      await putConProgreso(
        signedUrl,
        lista.blob,
        contentType || "image/jpeg",
        (p) => onProgress && onProgress(p),
        signal,
      );
      // La miniatura va DESPUÉS y no en paralelo: son 20 KB, y en un 4G
      // flojo dos subidas a la vez se estorban. Su progreso no se pinta —
      // el porcentaje que la persona mira es el de su foto.
      if (lista.thumb) {
        await putConProgreso(
          thumbSignedUrl,
          lista.thumb,
          thumbContentType || "image/webp",
          () => {},
          signal,
        );
        thumbSubida = true;
      }
    } catch (e) {
      // El intento dejó (o pudo dejar) objetos a medias: se limpian siempre.
      await limpiar(patientId, path, thumbPath);
      if (e instanceof EduFotoUploadCancelled) throw e;
      if (e instanceof ReintentableError && intento < MAX_INTENTOS) {
        ultimoError = e;
        // Backoff 1s, 3s: le da tiempo al wifi de volver sin castigar a
        // quien está esperando.
        await new Promise((r) => setTimeout(r, intento * 2000 - 1000));
        continue;
      }
      throw e instanceof ReintentableError ? new Error(`${e.message}. Vuelve a intentarlo.`) : e;
    }

    // Subido. Si cancelan justo aquí, los objetos se borran: sin fila que
    // los registre serían espacio pagado e invisible.
    if (abortado(signal)) {
      await limpiar(patientId, path, thumbPath);
      throw new EduFotoUploadCancelled();
    }

    if (onPhase) onPhase("registrando", intento);
    if (onProgress) onProgress(100);

    for (let c = 1; c <= INTENTOS_CONFIRM; c++) {
      let confirmRes: Response;
      try {
        confirmRes = await fetch(`/api/instituto/pacientes/${patientId}/fotos/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path,
            thumbPath: thumbSubida ? thumbPath : undefined,
            etapa: stage,
            vista: photoType,
            capturedAt: capturedAt || undefined,
            caseId: caseId || undefined,
            notas: notes || undefined,
            width: lista.width,
            height: lista.height,
          }),
          signal,
        });
      } catch (e) {
        // Cancelado durante "Registrando…", o la red se cayó. En los dos
        // casos hay objetos subidos y SIN fila: se limpian.
        await limpiar(patientId, path, thumbPath);
        throw abortado(signal) ? new EduFotoUploadCancelled() : e;
      }

      if (confirmRes.ok) return (await confirmRes.json()) as { id: string };

      // 409: Storage todavía no lista el objeto recién subido. El objeto SÍ
      // está ahí, así que se reintenta el REGISTRO (no la subida).
      if (confirmRes.status === 409 && c < INTENTOS_CONFIRM) {
        await new Promise((r) => setTimeout(r, 1000 * c));
        continue;
      }

      await limpiar(patientId, path, thumbPath);
      throw await mensajeDeError(confirmRes, "No se pudo registrar la foto");
    }
  }

  throw new Error(ultimoError ? ultimoError.message : "No se pudo subir la foto");
}
