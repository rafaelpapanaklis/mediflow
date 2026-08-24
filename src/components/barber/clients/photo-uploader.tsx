"use client";

import { useRef, useState } from "react";
import { Camera, Eye, EyeOff, Loader2 } from "lucide-react";
import type { BarberPhotoKind } from "@/lib/barber/types";
import { clientStyles as s, formatBytes, type BarberT } from "./ui";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * COMPRIMIR EN EL NAVEGADOR, ANTES DE SUBIR. No es una optimización: es
 * la diferencia entre que funcione y que no.
 *
 * Una foto de un celular de 2025 pesa entre 8 y 15 MB. El cuerpo de una
 * petición serverless se corta en ~4.5 MB, así que sin esto la foto no
 * llega nunca y el barbero ve un error que no explica nada. Y aunque
 * llegara: un portafolio de cortes a 12 MB por foto se come el Storage de
 * la barbería en una semana.
 *
 * Lo que hace, en este orden:
 *   1. Decodifica con createImageBitmap y `imageOrientation: "from-image"`,
 *      que aplica la rotación EXIF — si no, las fotos verticales del
 *      iPhone salen acostadas.
 *   2. Redimensiona el LADO MAYOR a 1600 px. Para "así me lo hiciste la
 *      vez pasada" sobra: se ve nítida a pantalla completa en un celular.
 *   3. Recodifica en WebP calidad 0.8. Si el navegador no sabe (Safari
 *      viejo cae a PNG por spec, que pesaría MÁS), reintenta en JPEG 0.8.
 *
 * Lo que NO hace: tocar lo que ya estaba bien. Una foto pequeña y ligera
 * se manda tal cual — recomprimirla solo la degradaría. Y si el resultado
 * pesa más que el original, gana el original.
 *
 * Mismo criterio que src/lib/image-client.ts del panel dental (que NO se
 * toca): esta copia existe porque el tope de este módulo es 1600 px, no
 * 2000, y porque el vertical barber no comparte archivos con el dental.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Lado mayor tras redimensionar. */
export const LADO_MAX = 1600;
/** Calidad del WebP/JPEG. 0.8 es donde deja de notarse a simple vista. */
export const CALIDAD = 0.8;
/** Tope del endpoint (mismo número que PHOTO_MAX_BYTES en el servidor). */
export const TOPE_BYTES = 4 * 1024 * 1024;
/** Por debajo de esto y dentro de medida, no se toca. */
const YA_ESTABA_BIEN = 500 * 1024;

const TIPOS_QUE_ACEPTA_EL_SERVIDOR = ["image/webp", "image/jpeg", "image/png"];

export class FotoIlegible extends Error {
  constructor() {
    super("ilegible");
    this.name = "FotoIlegible";
  }
}

export class FotoDemasiadoGrande extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super("grande");
    this.name = "FotoDemasiadoGrande";
    this.bytes = bytes;
  }
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

export interface FotoComprimida {
  file: File;
  bytesAntes: number;
  bytesDespues: number;
}

export async function comprimirFotoDeCorte(file: File): Promise<FotoComprimida> {
  const tipoSirve = TIPOS_QUE_ACEPTA_EL_SERVIDOR.indexOf(file.type) >= 0;
  const talCual = (): FotoComprimida => ({
    file,
    bytesAntes: file.size,
    bytesDespues: file.size,
  });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
  } catch {
    // HEIC en Chrome de escritorio, por ejemplo. Si el servidor lo aceptaría
    // y cabe, que lo intente él; si no, no hay nada que hacer con este archivo.
    if (tipoSirve && file.size <= TOPE_BYTES) return talCual();
    throw new FotoIlegible();
  }

  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));

  if (escala === 1 && tipoSirve && file.size <= YA_ESTABA_BIEN) {
    bitmap.close();
    return talCual();
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    if (tipoSirve && file.size <= TOPE_BYTES) return talCual();
    throw new FotoIlegible();
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await aBlob(canvas, "image/webp", CALIDAD);
  let ext = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await aBlob(canvas, "image/jpeg", CALIDAD);
    ext = "jpg";
  }
  if (!blob) {
    if (tipoSirve && file.size <= TOPE_BYTES) return talCual();
    throw new FotoIlegible();
  }

  // Comprimir empeoró el archivo (pasa con capturas ya optimizadas).
  if (blob.size >= file.size && tipoSirve) {
    if (file.size > TOPE_BYTES) throw new FotoDemasiadoGrande(file.size);
    return talCual();
  }
  if (blob.size > TOPE_BYTES) throw new FotoDemasiadoGrande(blob.size);

  const base = file.name.replace(/\.[^.]+$/, "") || "corte";
  return {
    file: new File([blob], `${base}.${ext}`, { type: blob.type }),
    bytesAntes: file.size,
    bytesDespues: blob.size,
  };
}

// ── Componente ─────────────────────────────────────────────────────────

const KINDS: BarberPhotoKind[] = ["BEFORE", "AFTER", "REFERENCE"];

export interface UploadedPhoto {
  id: string;
  clientId: string;
  appointmentId: string | null;
  url: string;
  kind: BarberPhotoKind;
  visibleToClient: boolean;
  createdAt: string;
  signedUrl: string;
}

export function PhotoUploader({
  clientId,
  appointmentId,
  canPublish,
  t,
  onUploaded,
  onMessage,
}: {
  clientId: string;
  appointmentId?: string | null;
  /** Tiene portal.manage: puede marcar la foto visible para el cliente. */
  canPublish: boolean;
  t: BarberT;
  onUploaded: (photo: UploadedPhoto) => void;
  onMessage: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<BarberPhotoKind>("AFTER");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const kindLabel = (k: BarberPhotoKind) =>
    k === "BEFORE" ? t("photos.kindBefore") : k === "AFTER" ? t("photos.kindAfter") : t("photos.kindReference");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const raw = files[i];
        setProgress(t("photos.compressing"));

        let prepared: FotoComprimida;
        try {
          prepared = await comprimirFotoDeCorte(raw);
        } catch (e) {
          if (e instanceof FotoDemasiadoGrande) {
            onMessage(t("photos.tooBig", { size: formatBytes(e.bytes) }));
          } else {
            onMessage(t("photos.unreadable"));
          }
          continue;
        }

        setProgress(t("photos.adding"));
        const body = new FormData();
        body.append("file", prepared.file);
        body.append("kind", kind);
        body.append("visibleToClient", visible ? "true" : "false");
        if (appointmentId) body.append("appointmentId", appointmentId);

        const res = await fetch(`/api/barber/clients/${clientId}/photos`, {
          method: "POST",
          body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          onMessage(data?.error || t("errors.generic"));
          continue;
        }
        onUploaded(data.photo as UploadedPhoto);
        if (data.visibleDenied) onMessage(t("photos.visibleDenied"));
        else {
          onMessage(
            t("photos.compressed", {
              from: formatBytes(prepared.bytesAntes),
              to: formatBytes(prepared.bytesDespues),
            }),
          );
        }
      }
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`${s.tab} ${kind === k ? s.tabActive : ""}`}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {kindLabel(k)}
          </button>
        ))}

        {canPublish ? (
          <button
            type="button"
            className={`${s.tab} ${visible ? s.tabActive : ""}`}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            title={t("photos.visibleHelp")}
          >
            {visible ? <Eye size={13} /> : <EyeOff size={13} />}
            <span style={{ marginLeft: 5 }}>{t("photos.visible")}</span>
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className={s.dropZone}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Loader2 size={22} className={s.spin} /> : <Camera size={22} />}
        <span>{busy ? progress ?? t("photos.adding") : t("photos.add")}</span>
        <span className={s.hint}>{t("photos.subtitle")}</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className={s.visuallyHidden}
        onChange={(e) => handleFiles(e.target.files)}
        aria-label={t("photos.add")}
      />

      {canPublish ? <span className={s.hint}>{t("photos.visibleHelp")}</span> : null}
    </div>
  );
}
