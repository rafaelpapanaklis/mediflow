"use client";

// Modal de CANCELAR cita — portal del paciente (WS1-T5). Self-contained:
// overlay fixed propio (sin Radix), responsive, dark theme del portal.
//
// CONTRATO de props (no cambiar — citas/page.tsx ya lo consume así):
//   cita, clinicNombre, autoApprove, open, onClose, onDone({ autoApproved }).
//   El caller hace mutate() en onDone; onClose limpia la selección.
// API: POST /api/paciente/appointments/{cita.id}/change-request
//   body { type: "CANCEL", reason?: string }
//   → 200 { ok, autoApproved, status } · 409 { error: "pending_exists" }
//   · 422 { error: "window", minHours } · 401/404. credentials "same-origin".

import { useEffect, useState } from "react";
import type { PacienteCita } from "@/lib/patient-portal/types";
import { formatFechaHora } from "@/components/paciente/ui";

export interface CancelarModalProps {
  cita: PacienteCita;
  clinicNombre: string;
  autoApprove: boolean;
  open: boolean;
  onClose: () => void;
  onDone: (r: { autoApproved: boolean }) => void;
}

const TEXT = "#f5f5f7";
const MUTED = "rgba(255,255,255,0.65)";
const FAINT = "rgba(255,255,255,0.5)";

export function CancelarModal({
  cita,
  clinicNombre,
  autoApprove,
  open,
  onClose,
  onDone,
}: CancelarModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ autoApproved: boolean } | null>(null);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setReason("");
      setSubmitting(false);
      setError(null);
      setDone(null);
    }
  }, [open]);

  // Cerrar con Escape (tras éxito también dispara onDone para refrescar)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || submitting) return;
      if (done) onDone(done);
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, done, onClose, onDone]);

  if (!open) return null;

  const handleClose = () => {
    if (submitting) return;
    if (done) onDone(done);
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting || done) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/paciente/appointments/${cita.id}/change-request`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          reason.trim()
            ? { type: "CANCEL", reason: reason.trim() }
            : { type: "CANCEL" }
        ),
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        /* respuesta sin JSON: se maneja solo por status */
      }
      if (res.ok) {
        setDone({ autoApproved: !!(body && body.autoApproved) });
      } else if (res.status === 409) {
        setError("Ya tienes una solicitud en revisión para esta cita.");
      } else if (res.status === 422) {
        const mh = body && typeof body.minHours === "number" ? body.minHours : 24;
        setError(
          `Las cancelaciones se permiten hasta ${mh} h antes — contacta a la clínica.`
        );
      } else if (res.status === 401) {
        setError("Tu sesión expiró. Vuelve a iniciar sesión.");
      } else if (res.status === 404) {
        setError("No encontramos esta cita. Actualiza la página e inténtalo de nuevo.");
      } else {
        setError("No pudimos cancelar tu cita. Inténtalo de nuevo.");
      }
    } catch {
      setError("No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cancelar cita"
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(5,5,10,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        colorScheme: "dark",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#121020",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: "clamp(16px, 3vw, 24px)",
          color: TEXT,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Cancelar cita</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "none",
              color: MUTED,
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {done ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 12,
              padding: "10px 0 4px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
                color: done.autoApproved ? "#34d399" : "#fbbf24",
                background: done.autoApproved
                  ? "rgba(52,211,153,0.12)"
                  : "rgba(251,191,36,0.12)",
              }}
            >
              ✓
            </span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {done.autoApproved ? "Tu cita fue cancelada" : "Solicitud enviada"}
            </span>
            <span style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>
              {done.autoApproved
                ? "Ya quedó cancelada. Si la necesitas de nuevo, agenda otra cita con la clínica."
                : "Enviamos tu solicitud a la clínica. Te avisaremos cuando la revisen."}
            </span>
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: 4,
                padding: "10px 28px",
                borderRadius: 10,
                border: "none",
                background: "#7c3aed",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              Listo
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>
                {formatFechaHora(cita.startsAt)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{cita.type}</span>
              <span style={{ fontSize: 13, color: MUTED }}>Con {cita.doctorName}</span>
              <span style={{ fontSize: 12, color: FAINT }}>{clinicNombre}</span>
            </div>

            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 13,
                color: MUTED,
              }}
            >
              Motivo (opcional)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Cuéntanos por qué…"
                disabled={submitting}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 76,
                  resize: "vertical",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: TEXT,
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                }}
              />
            </label>

            {error && (
              <div
                role="alert"
                style={{
                  background: "rgba(248,113,113,0.1)",
                  border: "1px solid rgba(248,113,113,0.35)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  color: "#f87171",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                style={{
                  flex: "1 1 auto",
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: MUTED,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: submitting ? "default" : "pointer",
                }}
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  flex: "2 1 auto",
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: submitting ? "default" : "pointer",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? "Cancelando…" : "Cancelar cita"}
              </button>
            </div>

            <span style={{ fontSize: 12, color: FAINT, lineHeight: 1.5 }}>
              {autoApprove
                ? "La cancelación se aplica al instante."
                : `${clinicNombre} revisará tu solicitud.`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
