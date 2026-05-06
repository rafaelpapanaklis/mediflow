"use client";
// Orthodontics — visualizador del setup digital (ClinCheck/CS Imaging/etc.).
// El doctor sube imágenes secuenciales del setup (rendered desde el
// software externo) y las ve en formato carrusel + thumbnails.

import { useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Plus } from "lucide-react";

export interface SetupSlide {
  /** ID del PatientFile o URL pública. */
  fileId: string;
  url: string;
  /** Etapa o número de paso del setup. */
  stage: number;
  caption?: string | null;
}

export interface OrthoSetupPlannerProps {
  slides: SetupSlide[];
  onAddSlide?: () => void;
  /** Si presente, abre fullscreen al hacer click en la imagen. */
  enableFullscreen?: boolean;
}

export function OrthoSetupPlanner(props: OrthoSetupPlannerProps) {
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const slides = [...props.slides].sort((a, b) => a.stage - b.stage);
  const current = slides[index] ?? null;

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(slides.length - 1, i + 1));

  if (slides.length === 0) {
    return (
      <section
        style={{
          padding: 24,
          background: "var(--surface-1, #ffffff)",
          border: "1px dashed var(--border, #e5e5ed)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
        aria-label="Setup digital"
      >
        <strong style={{ fontSize: 14 }}>Sin setup digital cargado</strong>
        <small style={{ fontSize: 12, color: "var(--text-2, #6b6b78)", textAlign: "center" }}>
          Importa los renders del setup ClinCheck/CS Imaging para visualizarlos
          aquí en formato secuencial.
        </small>
        {props.onAddSlide ? (
          <button type="button" onClick={props.onAddSlide} style={btnPrimary}>
            <Plus size={13} aria-hidden /> Subir imágenes
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      style={{
        background: "var(--surface-1, #ffffff)",
        border: "1px solid var(--border, #e5e5ed)",
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      aria-label="Setup digital"
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <strong style={{ fontSize: 14 }}>Setup digital · etapa {current?.stage ?? "—"}</strong>
        <div style={{ display: "flex", gap: 4 }}>
          {props.enableFullscreen ? (
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              style={iconBtn}
              aria-label="Pantalla completa"
            >
              <Maximize size={13} aria-hidden />
            </button>
          ) : null}
          {props.onAddSlide ? (
            <button type="button" onClick={props.onAddSlide} style={iconBtn} aria-label="Agregar">
              <Plus size={13} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background: "var(--surface-2, #f5f5f7)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {current ? (
          <img
            src={current.url}
            alt={`Setup etapa ${current.stage}`}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : null}
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="Anterior"
          style={{ ...navBtn, left: 8 }}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={index === slides.length - 1}
          aria-label="Siguiente"
          style={{ ...navBtn, right: 8 }}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {slides.map((s, i) => (
          <button
            key={s.fileId}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Ir a etapa ${s.stage}`}
            style={{
              flex: "0 0 auto",
              width: 64,
              height: 40,
              borderRadius: 4,
              border: i === index
                ? "2px solid var(--brand, #6366f1)"
                : "1px solid var(--border, #e5e5ed)",
              padding: 0,
              cursor: "pointer",
              background: `url("${s.url}") center / cover no-repeat`,
            }}
          />
        ))}
      </div>

      {current?.caption ? (
        <small style={{ fontSize: 11, color: "var(--text-2, #6b6b78)" }}>
          {current.caption}
        </small>
      ) : null}

      {fullscreen && current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Setup digital pantalla completa"
          onClick={() => setFullscreen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1500,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            cursor: "zoom-out",
          }}
        >
          <img
            src={current.url}
            alt={`Setup etapa ${current.stage}`}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        </div>
      ) : null}
    </section>
  );
}

const navBtn: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  background: "rgba(0,0,0,0.55)",
  color: "white",
  border: "none",
  borderRadius: "50%",
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border, #e5e5ed)",
  borderRadius: 4,
  padding: "4px 6px",
  cursor: "pointer",
  color: "var(--text-2, #6b6b78)",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 12,
  background: "var(--brand, #6366f1)",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
