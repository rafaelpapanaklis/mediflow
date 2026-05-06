"use client";
// Clinical-shared — lightbox para visualizar foto a tamaño completo.

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ClinicalPhotoDTO } from "@/lib/clinical-shared/photos/types";
import { STAGE_LABELS } from "@/lib/clinical-shared/photos/types";

export interface PhotoLightboxProps {
  photos: ClinicalPhotoDTO[];
  index: number;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export function PhotoLightbox(props: PhotoLightboxProps) {
  const photo = props.photos[props.index];
  const total = props.photos.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      if (e.key === "ArrowLeft" && props.index > 0) props.onNavigate(props.index - 1);
      if (e.key === "ArrowRight" && props.index < total - 1) props.onNavigate(props.index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, total]);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto clínica"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          color: "var(--text-on-dark, #fff)",
        }}
      >
        <div style={{ fontSize: 13 }}>
          {props.index + 1} / {total} — {STAGE_LABELS[photo.stage]}
          {photo.toothFdi != null ? ` · diente ${photo.toothFdi}` : ""}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Cerrar"
          style={{
            background: "transparent",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={22} aria-hidden />
        </button>
      </header>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 12,
        }}
      >
        {props.index > 0 ? (
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => props.onNavigate(props.index - 1)}
            style={navBtnStyle}
          >
            <ChevronLeft size={28} aria-hidden />
          </button>
        ) : (
          <div style={{ width: 48 }} />
        )}

        <div style={{ position: "relative", maxWidth: "85vw", maxHeight: "78vh" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.blobUrl}
            alt={photo.notes ?? "Foto clínica"}
            style={{
              maxWidth: "85vw",
              maxHeight: "78vh",
              objectFit: "contain",
              borderRadius: 6,
            }}
          />
          {photo.annotations?.map((a, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                transform: "translate(-50%,-50%)",
                background: a.color ?? "var(--accent)",
                color: "#fff",
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                whiteSpace: "nowrap",
              }}
            >
              {a.label}
            </div>
          ))}
        </div>

        {props.index < total - 1 ? (
          <button
            type="button"
            aria-label="Siguiente"
            onClick={() => props.onNavigate(props.index + 1)}
            style={navBtnStyle}
          >
            <ChevronRight size={28} aria-hidden />
          </button>
        ) : (
          <div style={{ width: 48 }} />
        )}
      </div>

      {photo.notes ? (
        <footer
          style={{
            color: "var(--text-on-dark, #fff)",
            fontSize: 13,
            padding: "8px 16px 16px",
            opacity: 0.85,
            textAlign: "center",
          }}
        >
          {photo.notes}
        </footer>
      ) : null}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 24,
  background: "rgba(255,255,255,0.1)",
  border: "none",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
