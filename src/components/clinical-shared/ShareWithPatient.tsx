"use client";
// Clinical-shared — botón con dos acciones para el médico:
//   1. Modo presentación — fullscreen sin chrome, datos del módulo en
//      formato legible para que el paciente/tutor lea desde el monitor.
//   2. Generar link — token público /share/p/[token] expirable 30 días.

import { useState } from "react";
import { Copy, Maximize, Share2 } from "lucide-react";
import type { ClinicalModule } from "@prisma/client";
import { createPatientShareLink } from "@/app/actions/clinical-shared/share-links";
import { isFailure } from "@/lib/clinical-shared/result";

export interface ShareWithPatientProps {
  patientId: string;
  patientName: string;
  module: ClinicalModule;
  /**
   * Render del contenido de "modo presentación". Recibe un flag fullscreen=true
   * para ajustar tipografía. Si no se pasa, se muestra un fallback simple.
   */
  presentationContent?: React.ReactNode;
}

export function ShareWithPatient(props: ShareWithPatientProps) {
  const [open, setOpen] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    setError(null);
    setGenerating(true);
    const res = await createPatientShareLink({
      patientId: props.patientId,
      module: props.module,
      expiresInDays: 30,
    });
    if (isFailure(res)) setError(res.error);
    else {
      setLink(res.data.url);
      setLinkExpiresAt(res.data.expiresAt);
    }
    setGenerating(false);
  };

  const onCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // ignore — el usuario puede copiar manualmente del input
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btnPrimary}>
        <Share2 size={13} aria-hidden /> Compartir con paciente
      </button>

      {open && !presentation ? (
        <div role="dialog" aria-modal="true" style={overlayStyle} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
              Compartir con {props.patientName}
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: "4px 0 12px" }}>
              Elige cómo quieres compartir el resumen del módulo.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setPresentation(true);
                }}
                style={btnSecondary}
              >
                <Maximize size={13} aria-hidden /> Modo presentación
              </button>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => void onGenerate()}
                  disabled={generating}
                  style={btnSecondary}
                >
                  <Share2 size={13} aria-hidden />
                  {generating ? "Generando…" : "Generar link público (30 días)"}
                </button>

                {link ? (
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      alignItems: "center",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: 6,
                    }}
                  >
                    <input
                      readOnly
                      value={link}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        color: "var(--text-1)",
                        fontSize: 12,
                        padding: 0,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void onCopy()}
                      aria-label="Copiar"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--text-2)",
                        cursor: "pointer",
                        padding: 4,
                      }}
                    >
                      <Copy size={13} aria-hidden />
                    </button>
                  </div>
                ) : null}

                {linkExpiresAt ? (
                  <small style={{ fontSize: 11, color: "var(--text-2)" }}>
                    Vence el {new Date(linkExpiresAt).toLocaleDateString("es-MX")}.
                  </small>
                ) : null}
              </div>
            </div>

            {error ? (
              <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>
                {error}
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" onClick={() => setOpen(false)} style={btnSecondary}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {presentation ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "var(--surface-1)",
            color: "var(--text-1)",
            overflowY: "auto",
            padding: "32px clamp(16px, 6vw, 80px)",
          }}
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 18,
            }}
          >
            <strong style={{ fontSize: 28 }}>{props.patientName}</strong>
            <button
              type="button"
              onClick={() => {
                setPresentation(false);
                setOpen(false);
              }}
              style={btnSecondary}
            >
              Salir
            </button>
          </header>
          <div style={{ fontSize: 18, lineHeight: 1.7 }}>
            {props.presentationContent ?? (
              <em style={{ color: "var(--text-2)" }}>
                Sin contenido específico configurado para presentación.
              </em>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const cardStyle: React.CSSProperties = {
  width: "min(480px, 100%)",
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  fontSize: 12,
  background: "var(--accent)",
  color: "var(--text-on-accent, #fff)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  fontSize: 12,
  background: "var(--surface-2)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
};
