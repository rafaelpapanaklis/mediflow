"use client";

// Lo que llegó (o salió) por WhatsApp que no es texto: la foto de la muela, la
// nota de voz, el PDF del laboratorio. Se pinta DENTRO de la burbuja, encima
// del cuerpo, que queda debajo como pie de foto.
//
// Nada se descarga de Meta hasta que alguien lo pide: las fotos van con
// loading="lazy" y video/audio con preload="none". Sin eso, abrir un hilo con
// 20 videos se bajaría 300 MB antes de que nadie pulse play.
//
// El binario nunca sale de Meta hacia Supabase: se lee a través del proxy
// /api/whatsapp/media/{messageId}?i=N, que es el que lleva el token de la
// clínica (el navegador jamás lo ve) y el que sabe decir "410: caducó".

import { useState } from "react";
import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import styles from "@/app/dashboard/inbox/inbox.module.css";

/** Un adjunto ya normalizado: `attachments` llega tipado como unknown. */
type MediaItem =
  /** Lo mandó el paciente: vive en Meta y se sirve por el proxy. */
  | { via: "meta"; kind: MetaKind; filename: string | null }
  /** Lo mandó el panel con una URL propia (Twilio legacy / storage): enlace normal. */
  | { via: "url"; url: string; name: string | null }
  /** Solo quedó registro ({name, mime, size}): el PDF de factura que salió por WhatsApp. */
  | { via: "record"; name: string; size: number | null };

const META_KINDS = ["image", "video", "audio", "document", "sticker"] as const;
type MetaKind = (typeof META_KINDS)[number];

/**
 * Normaliza en la puerta. Si `attachments` no es un array (null, objeto
 * suelto, basura), devuelve null y el hilo sigue pintándose: un adjunto raro
 * no puede tumbar la conversación entera.
 */
function normalize(raw: unknown): MediaItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: MediaItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const a = entry as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    if (str(a.mediaId)) {
      const kind: MetaKind = (META_KINDS as readonly string[]).includes(String(a.kind))
        ? (a.kind as MetaKind)
        : "document";
      items.push({ via: "meta", kind, filename: str(a.filename) ?? str(a.name) });
      continue;
    }
    const url = str(a.url);
    if (url) {
      items.push({ via: "url", url, name: str(a.name) ?? str(a.filename) });
      continue;
    }
    const name = str(a.name) ?? str(a.filename);
    if (name) {
      const size = typeof a.size === "number" && Number.isFinite(a.size) ? a.size : null;
      items.push({ via: "record", name, size });
    }
  }
  return items.length > 0 ? items : null;
}

/** "245 KB", "1.2 MB". Solo para el chip sin enlace: es lo único que se sabe de ese archivo. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaBubble({ messageId, attachments }: { messageId: string; attachments: unknown }) {
  const t = useT();
  // Índices cuyo archivo ya no está (onError del img/video/audio, o el 410 del
  // proxy). Se sustituye la pieza por el aviso: es la verdad y hay que decirla,
  // no dejar un ícono roto.
  const [gone, setGone] = useState<Record<number, true>>({});

  const items = normalize(attachments);
  if (!items) return null;

  const src = (i: number) => `/api/whatsapp/media/${encodeURIComponent(messageId)}?i=${i}`;
  const markGone = (i: number) => setGone((prev) => (prev[i] ? prev : { ...prev, [i]: true }));

  return (
    <>
      {items.map((item, i) => {
        if (item.via === "meta" && gone[i]) {
          return (
            <span key={i} className={styles.mediaGone}>
              {t("inbox.client.mediaExpired")}
            </span>
          );
        }
        if (item.via === "meta") {
          switch (item.kind) {
            case "image":
            case "sticker":
              return (
                <a
                  key={i}
                  href={src(i)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.mediaImgLink}
                  title={t("inbox.client.mediaOpen")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- viene del proxy, no de un dominio de next/image */}
                  <img
                    src={src(i)}
                    alt={t("inbox.client.mediaOpen")}
                    loading="lazy"
                    className={styles.mediaImg}
                    onError={() => markGone(i)}
                  />
                </a>
              );
            case "video":
              return (
                <video
                  key={i}
                  src={src(i)}
                  controls
                  preload="none"
                  className={styles.mediaVideo}
                  onError={() => markGone(i)}
                />
              );
            case "audio":
              return (
                <audio
                  key={i}
                  src={src(i)}
                  controls
                  preload="none"
                  className={styles.mediaAudio}
                  onError={() => markGone(i)}
                />
              );
            case "document":
            default:
              return (
                <span key={i} className={styles.mediaDoc}>
                  <FileText size={15} strokeWidth={2} aria-hidden />
                  {item.filename && <span className={styles.mediaDocName}>{item.filename}</span>}
                  <a
                    href={src(i)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.mediaDocLink}
                  >
                    {t("inbox.client.mediaDocOpen")}
                    <ExternalLink size={11} strokeWidth={2.2} aria-hidden />
                  </a>
                </span>
              );
          }
        }
        if (item.via === "url") {
          return (
            <span key={i} className={styles.mediaDoc}>
              <Paperclip size={14} strokeWidth={2} aria-hidden />
              <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.mediaDocLink}>
                {item.name ?? item.url}
                <ExternalLink size={11} strokeWidth={2.2} aria-hidden />
              </a>
            </span>
          );
        }
        // Registro sin archivo: nombre y peso, sin enlace (no hay a dónde ir).
        return (
          <span key={i} className={styles.mediaDoc}>
            <FileText size={15} strokeWidth={2} aria-hidden />
            <span className={styles.mediaDocName}>{item.name}</span>
            {item.size !== null && <span className={styles.mediaDocMeta}>{formatBytes(item.size)}</span>}
          </span>
        );
      })}
    </>
  );
}
