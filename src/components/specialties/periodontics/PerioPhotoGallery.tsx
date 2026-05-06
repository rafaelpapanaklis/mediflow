"use client";
// Periodontics — galería de fotos clínicas perio. SPEC §6, COMMIT 2.

import { useMemo, useState } from "react";
import {
  PERIO_PHOTO_KIND,
  PERIO_PHOTO_LABEL,
  type PerioPhotoKind,
} from "@/lib/periodontics/photo-types";
import type { PerioPhotoListItem } from "@/lib/periodontics/photo-load";

export interface PerioPhotoGalleryProps {
  photos: PerioPhotoListItem[];
  /** Si se provee, muestra botón de subir foto. */
  onUploadClick?: (kind: PerioPhotoKind) => void;
  /** Soft-delete handler. Si no se provee, no se muestra el botón. */
  onDelete?: (photoId: string) => void;
}

type Filter = "all" | PerioPhotoKind | "unclassified";

const FILTER_OPTIONS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "Todas" },
  ...PERIO_PHOTO_KIND.map((k) => ({ value: k as Filter, label: PERIO_PHOTO_LABEL[k] })),
  { value: "unclassified", label: "Sin clasificar (legacy)" },
];

export function PerioPhotoGallery(props: PerioPhotoGalleryProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [lightbox, setLightbox] = useState<PerioPhotoListItem | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return props.photos;
    if (filter === "unclassified") {
      return props.photos.filter((p) => p.kind === null);
    }
    return props.photos.filter((p) => p.kind === filter);
  }, [props.photos, filter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: props.photos.length, unclassified: 0 };
    for (const k of PERIO_PHOTO_KIND) out[k] = 0;
    for (const p of props.photos) {
      if (p.kind === null) out.unclassified += 1;
      else out[p.kind] += 1;
    }
    return out;
  }, [props.photos]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          padding: 8,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.value;
          const count = counts[opt.value] ?? 0;
          if (opt.value !== "all" && count === 0 && filter !== opt.value) return null;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 6,
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-2)",
                cursor: "pointer",
              }}
            >
              {opt.label}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          filter={filter}
          onUpload={
            props.onUploadClick && filter !== "all" && filter !== "unclassified"
              ? () => props.onUploadClick?.(filter)
              : undefined
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          {filtered.map((p) => (
            <PhotoCard
              key={p.id}
              photo={p}
              onClick={() => setLightbox(p)}
              onDelete={props.onDelete}
            />
          ))}
        </div>
      )}

      {props.onUploadClick && filter !== "all" && filter !== "unclassified" ? (
        <button
          type="button"
          onClick={() => props.onUploadClick?.(filter)}
          style={{
            alignSelf: "flex-start",
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          Subir foto: {PERIO_PHOTO_LABEL[filter]}
        </button>
      ) : null}

      {lightbox ? (
        <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  );
}

function PhotoCard(props: {
  photo: PerioPhotoListItem;
  onClick: () => void;
  onDelete?: (photoId: string) => void;
}) {
  const { photo } = props;
  const label = photo.kind ? PERIO_PHOTO_LABEL[photo.kind] : "Sin clasificar";
  return (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg-elev)",
      }}
    >
      <button
        type="button"
        onClick={props.onClick}
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        <img
          src={photo.thumbnailUrl ?? photo.blobUrl}
          alt={label}
          loading="lazy"
          style={{
            display: "block",
            width: "100%",
            aspectRatio: "1 / 1",
            objectFit: "cover",
            background: "var(--bg-1)",
          }}
        />
      </button>
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
          {photo.capturedAt.toLocaleDateString("es-MX")}
          {photo.toothFdi ? ` · D${photo.toothFdi}` : ""}
        </div>
      </div>
      {props.onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("¿Eliminar esta foto?")) props.onDelete?.(photo.id);
          }}
          aria-label="Eliminar foto"
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg-1)",
            color: "var(--text-2)",
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function Lightbox(props: { photo: PerioPhotoListItem; onClose: () => void }) {
  const { photo } = props;
  const label = photo.kind ? PERIO_PHOTO_LABEL[photo.kind] : "Sin clasificar";
  return (
    <div
      role="dialog"
      aria-label={`Vista ampliada: ${label}`}
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <img
          src={photo.blobUrl}
          alt={label}
          style={{
            maxWidth: "90vw",
            maxHeight: "78vh",
            objectFit: "contain",
            borderRadius: 8,
          }}
        />
        <div
          style={{
            padding: 10,
            background: "var(--bg-elev)",
            borderRadius: 8,
            color: "var(--text-1)",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
            {photo.capturedAt.toLocaleString("es-MX")}
            {photo.toothFdi ? ` · Diente ${photo.toothFdi}` : ""}
            {" · "}
            <button
              type="button"
              onClick={props.onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              cerrar
            </button>
          </div>
          {photo.notes ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-2)" }}>
              {photo.notes}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyState(props: { filter: Filter; onUpload?: () => void }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        color: "var(--text-3)",
        fontSize: 13,
      }}
    >
      <div>Sin fotos para este filtro.</div>
      {props.onUpload ? (
        <button
          type="button"
          onClick={props.onUpload}
          style={{
            marginTop: 10,
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          Subir primera foto
        </button>
      ) : null}
    </div>
  );
}
