"use client";
// Clinical-shared — galería completa: grid + uploader + lightbox + compare + timeline.

import { useCallback, useEffect, useState } from "react";
import { Camera, GitCompare, LayoutGrid, Trash2 } from "lucide-react";
import type {
  ClinicalModule,
  ClinicalPhotoDTO,
  ClinicalPhotoStage,
  ClinicalPhotoType,
} from "@/lib/clinical-shared/photos/types";
import { STAGE_LABELS } from "@/lib/clinical-shared/photos/types";
import {
  deleteClinicalPhotoAction,
  listClinicalPhotosAction,
} from "@/app/actions/clinical-shared/photos";
import { isFailure } from "@/lib/clinical-shared/result";
import { PhotoUploader } from "./PhotoUploader";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoCompare } from "./PhotoCompare";
import { PhotoTimeline } from "./PhotoTimeline";

type View = "grid" | "timeline" | "compare";

export interface ClinicalPhotoGalleryProps {
  patientId: string;
  module: ClinicalModule;
  defaultPhotoType: ClinicalPhotoType;
  defaultStage?: ClinicalPhotoStage;
  initialPhotos?: ClinicalPhotoDTO[];
  /** Si se omite, el componente fetch-ea con listClinicalPhotosAction. */
  reloadOnMount?: boolean;
}

export function ClinicalPhotoGallery(props: ClinicalPhotoGalleryProps) {
  const [photos, setPhotos] = useState<ClinicalPhotoDTO[]>(props.initialPhotos ?? []);
  const [view, setView] = useState<View>("grid");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listClinicalPhotosAction({
      patientId: props.patientId,
      module: props.module,
    });
    if (isFailure(res)) {
      setError(res.error);
    } else {
      setPhotos(res.data);
    }
    setLoading(false);
  }, [props.patientId, props.module]);

  useEffect(() => {
    if (props.reloadOnMount !== false && !props.initialPhotos) void reload();
  }, [props.reloadOnMount, props.initialPhotos, reload]);

  const handleDelete = async (id: string) => {
    const ok = window.confirm("¿Eliminar esta foto? La acción es reversible solo desde DB.");
    if (!ok) return;
    const res = await deleteClinicalPhotoAction({ id });
    if (isFailure(res)) {
      setError(res.error);
    } else {
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Camera size={16} aria-hidden style={{ color: "var(--text-2)" }} />
          <h3 style={{ margin: 0, fontSize: 15, color: "var(--text-1)" }}>
            Galería clínica ({photos.length})
          </h3>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <ToolbarBtn active={view === "grid"} onClick={() => setView("grid")} aria="Grid">
            <LayoutGrid size={14} aria-hidden /> Grid
          </ToolbarBtn>
          <ToolbarBtn
            active={view === "timeline"}
            onClick={() => setView("timeline")}
            aria="Timeline"
          >
            Timeline
          </ToolbarBtn>
          <ToolbarBtn
            active={view === "compare"}
            onClick={() => setView("compare")}
            aria="Compare"
          >
            <GitCompare size={14} aria-hidden /> Comparar
          </ToolbarBtn>
        </div>
      </header>

      <PhotoUploader
        patientId={props.patientId}
        module={props.module}
        defaultPhotoType={props.defaultPhotoType}
        defaultStage={props.defaultStage}
        onUploaded={() => void reload()}
      />

      {error ? (
        <div
          role="alert"
          style={{
            padding: 8,
            background: "var(--danger-surface, #fee2e2)",
            color: "var(--danger, #b91c1c)",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>Cargando…</div>
      ) : photos.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-2)",
            fontSize: 13,
          }}
        >
          Sin fotos cargadas.
        </div>
      ) : view === "grid" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8,
          }}
        >
          {photos.map((p, i) => (
            <figure
              key={p.id}
              style={{
                margin: 0,
                position: "relative",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setOpenIndex(i)}
                aria-label="Abrir foto"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumbnailUrl ?? p.blobUrl}
                  alt={p.notes ?? "Foto clínica"}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </button>
              <figcaption
                style={{
                  fontSize: 11,
                  color: "var(--text-2)",
                  padding: "4px 6px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  {STAGE_LABELS[p.stage]} ·{" "}
                  {new Date(p.capturedAt).toLocaleDateString("es-MX")}
                </span>
                <button
                  type="button"
                  aria-label="Eliminar"
                  onClick={() => void handleDelete(p.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-2)",
                    cursor: "pointer",
                    padding: 2,
                  }}
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : view === "timeline" ? (
        <PhotoTimeline
          photos={photos}
          onSelect={(id) => setOpenIndex(photos.findIndex((p) => p.id === id))}
        />
      ) : (
        <PhotoCompare photos={photos} />
      )}

      {openIndex !== null ? (
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
        />
      ) : null}
    </section>
  );
}

function ToolbarBtn(props: {
  active: boolean;
  onClick: () => void;
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      aria-label={props.aria}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        fontSize: 12,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: props.active ? "var(--surface-2)" : "transparent",
        color: "var(--text-1)",
        cursor: "pointer",
      }}
    >
      {props.children}
    </button>
  );
}
