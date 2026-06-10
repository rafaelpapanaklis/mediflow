"use client";

// Modal de REAGENDAR cita — portal del paciente (WS1-T5 / A3). Self-contained:
// overlay fixed propio (sin Radix ni portales), responsive, dark theme del portal.
// Consume las APIs de A2 (firmas fijas):
//   GET  /api/paciente/appointments/{id}/slots?date=YYYY-MM-DD
//        → { date, timezone, durationMin, slots: ["HH:mm"] } | 400 | 422 window/
//          not_changeable | 404
//   POST /api/paciente/appointments/{id}/change-request
//        { type: "RESCHEDULE", date, startTime, reason? }
//        → { ok, autoApproved, status } | 409 slot_taken/pending_exists | 422 window
// El caller (citas/page.tsx) hace mutate() en onDone.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PacienteCita } from "@/lib/patient-portal/types";
import { formatFecha, formatFechaHora } from "@/components/paciente/ui";

export interface ReagendarModalProps {
  cita: PacienteCita;
  clinicNombre: string;
  /** Política de la clínica: true = el cambio se aplica al instante. */
  autoApprove: boolean;
  open: boolean;
  onClose: () => void;
  onDone: (r: { autoApproved: boolean }) => void;
}

// ── Paleta / estilos compartidos (mismos del portal) ────────────────────────

const TEXT = "#f5f5f7";
const MUTED = "rgba(245,245,247,0.65)";
const FAINT = "rgba(245,245,247,0.5)";
const BORDER = "1px solid rgba(255,255,255,0.1)";
const ERROR_COLOR = "#f87171";

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: "rgba(245,245,247,0.8)",
  marginBottom: 6,
};

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: BORDER,
  borderRadius: 10,
  color: TEXT,
  fontSize: 13.5,
  fontFamily: "inherit",
  padding: "10px 12px",
  outline: "none",
  colorScheme: "dark", // inputs date/textarea nativos en dark
};

const PRIMARY_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  padding: "11px 16px",
  borderRadius: 10,
  border: "1px solid #8b5cf6",
  background: "#7c3aed",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
};

const HINT_STYLE: React.CSSProperties = {
  margin: 0,
  padding: "6px 0",
  fontSize: 13,
  color: FAINT,
  lineHeight: 1.45,
};

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="animate-spin"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-block",
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.25)",
        borderTopColor: "#a78bfa",
      }}
    />
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Hoy en local como YYYY-MM-DD (para min del input date). */
function hoyLocal(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function mensajeWindow(minHours?: number): string {
  return typeof minHours === "number"
    ? `Los cambios se permiten hasta ${minHours} h antes de la cita — contacta a la clínica.`
    : "Ya no es posible cambiar esta cita por la cercanía del horario — contacta a la clínica.";
}

const MSG_NOT_CHANGEABLE =
  "Esta cita ya no se puede cambiar desde el portal — contacta a la clínica.";
const MSG_SESION = "Tu sesión expiró. Vuelve a iniciar sesión.";
const MSG_NOT_FOUND = "No encontramos esta cita. Recarga la página e inténtalo de nuevo.";

interface SlotsError {
  message: string;
  retryable: boolean;
}

// ── Componente ───────────────────────────────────────────────────────────────

export function ReagendarModal({
  cita,
  clinicNombre,
  autoApprove,
  open,
  onClose,
  onDone,
}: ReagendarModalProps) {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<SlotsError | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ autoApproved: boolean } | null>(null);

  /** Descarta respuestas de fetches viejos (carreras al cambiar fecha rápido). */
  const reqIdRef = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const hoy = hoyLocal();

  // Cierre unificado: en éxito siempre notifica onDone (aunque cierren con
  // Escape/overlay/✕) para que el caller haga mutate(). Bloqueado mientras envía.
  const handleClose = useCallback(() => {
    if (submitting) return;
    if (success) onDone({ autoApproved: success.autoApproved });
    onClose();
  }, [submitting, success, onDone, onClose]);

  // Reset de estado interno en cada apertura.
  useEffect(() => {
    if (!open) return;
    reqIdRef.current += 1; // invalida fetches en vuelo de aperturas previas
    setDate("");
    setSlots(null);
    setSlotsLoading(false);
    setSlotsError(null);
    setSelectedSlot(null);
    setReason("");
    setSubmitting(false);
    setSubmitError(null);
    setSuccess(null);
    const t = window.setTimeout(() => {
      if (cardRef.current) cardRef.current.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  const fetchSlots = useCallback(
    async (d: string) => {
      const reqId = ++reqIdRef.current;
      setSlotsLoading(true);
      setSlotsError(null);
      setSlots(null);
      try {
        const res = await fetch(
          `/api/paciente/appointments/${cita.id}/slots?date=${encodeURIComponent(d)}`,
          { credentials: "same-origin" }
        );
        let body: any = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (reqId !== reqIdRef.current) return;
        if (res.ok) {
          setSlots(Array.isArray(body?.slots) ? body.slots : []);
        } else if (res.status === 422 && body?.error === "window") {
          setSlotsError({ message: mensajeWindow(body?.minHours), retryable: false });
        } else if (res.status === 422 && body?.error === "not_changeable") {
          setSlotsError({ message: MSG_NOT_CHANGEABLE, retryable: false });
        } else if (res.status === 400) {
          setSlotsError({ message: "La fecha no es válida. Elige otra fecha.", retryable: false });
        } else if (res.status === 401) {
          setSlotsError({ message: MSG_SESION, retryable: false });
        } else if (res.status === 404) {
          setSlotsError({ message: MSG_NOT_FOUND, retryable: false });
        } else {
          setSlotsError({
            message: "No pudimos cargar los horarios. Inténtalo de nuevo.",
            retryable: true,
          });
        }
      } catch {
        if (reqId !== reqIdRef.current) return;
        setSlotsError({
          message: "No pudimos cargar los horarios. Revisa tu conexión e inténtalo de nuevo.",
          retryable: true,
        });
      } finally {
        if (reqId === reqIdRef.current) setSlotsLoading(false);
      }
    },
    [cita.id]
  );

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setDate(v);
    setSelectedSlot(null);
    setSubmitError(null);
    if (!v) {
      reqIdRef.current += 1;
      setSlots(null);
      setSlotsLoading(false);
      setSlotsError(null);
      return;
    }
    if (v < hoy) {
      reqIdRef.current += 1;
      setSlots(null);
      setSlotsLoading(false);
      setSlotsError({ message: "Elige una fecha a partir de hoy.", retryable: false });
      return;
    }
    fetchSlots(v);
  }

  async function handleSubmit() {
    if (!date || !selectedSlot || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const motivo = reason.trim();
      const res = await fetch(`/api/paciente/appointments/${cita.id}/change-request`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "RESCHEDULE",
          date,
          startTime: selectedSlot,
          ...(motivo ? { reason: motivo } : {}),
        }),
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.ok && body?.ok) {
        setSuccess({ autoApproved: !!body.autoApproved });
      } else if (res.status === 409 && body?.error === "slot_taken") {
        setSubmitError("Ese horario se acaba de ocupar, elige otro.");
        fetchSlots(date); // refresca disponibilidad de esa fecha
      } else if (res.status === 409 && body?.error === "pending_exists") {
        setSubmitError("Ya tienes una solicitud en revisión. Espera la respuesta de la clínica.");
      } else if (res.status === 422 && body?.error === "window") {
        setSubmitError(mensajeWindow(body?.minHours));
      } else if (res.status === 422 && body?.error === "not_changeable") {
        setSubmitError(MSG_NOT_CHANGEABLE);
      } else if (res.status === 401) {
        setSubmitError(MSG_SESION);
      } else if (res.status === 404) {
        setSubmitError(MSG_NOT_FOUND);
      } else {
        setSubmitError("No pudimos enviar tu solicitud. Inténtalo de nuevo.");
      }
    } catch {
      setSubmitError("No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const canSubmit = !!date && !!selectedSlot && !submitting;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        // Solo cierra si el mousedown empezó en el overlay (no dentro del card).
        if (e.target === e.currentTarget) handleClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(5,5,10,0.72)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(10px, 3vw, 24px)",
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reagendar-modal-titulo"
        style={{
          width: "min(480px, 94vw)",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "#121020",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: "clamp(16px, 3.5vw, 22px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          outline: "none",
        }}
      >
        {success ? (
          // ── Pantalla de éxito ──────────────────────────────────────────
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              textAlign: "center",
              padding: "clamp(14px, 3vw, 26px) 2px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "rgba(52,211,153,0.14)",
                border: "1px solid rgba(52,211,153,0.45)",
                color: "#34d399",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              ✓
            </span>
            <p
              id="reagendar-modal-titulo"
              style={{ margin: 0, fontSize: 15.5, fontWeight: 600, color: TEXT, lineHeight: 1.45 }}
            >
              {success.autoApproved
                ? "Tu cita quedó reagendada ✅"
                : "Enviamos tu solicitud a la clínica. Te avisaremos cuando la revisen."}
            </p>
            {date && selectedSlot && (
              <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
                {success.autoApproved ? "Nueva fecha:" : "Fecha solicitada:"}{" "}
                {formatFecha(`${date}T12:00:00`)}, {selectedSlot}
              </p>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="transition-opacity hover:opacity-90"
              style={{ ...PRIMARY_BTN, width: "auto", minWidth: 150, cursor: "pointer" }}
            >
              Listo
            </button>
          </div>
        ) : (
          // ── Formulario ─────────────────────────────────────────────────
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <h2
                id="reagendar-modal-titulo"
                style={{
                  margin: 0,
                  fontSize: "clamp(16px, 2.2vw, 18px)",
                  fontWeight: 700,
                  color: TEXT,
                  letterSpacing: "-0.01em",
                }}
              >
                Reagendar cita
              </h2>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                aria-label="Cerrar"
                className="transition-colors hover:bg-white/[0.08]"
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 8,
                  border: BORDER,
                  color: MUTED,
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                ✕
              </button>
            </div>

            {/* Resumen compacto de la cita actual */}
            <p
              style={{
                margin: 0,
                padding: "9px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 13,
                color: MUTED,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              Actual:{" "}
              <strong style={{ color: "rgba(245,245,247,0.9)", fontWeight: 600 }}>
                {formatFechaHora(cita.startsAt)}
              </strong>{" "}
              · {cita.doctorName}
            </p>

            {/* Paso 1: fecha */}
            <div>
              <label htmlFor="reagendar-fecha" style={LABEL_STYLE}>
                Nueva fecha
              </label>
              <input
                id="reagendar-fecha"
                type="date"
                min={hoy}
                value={date}
                onChange={handleDateChange}
                disabled={submitting}
                style={FIELD_STYLE}
              />
            </div>

            {/* Paso 2: horarios */}
            <div aria-live="polite" style={{ minWidth: 0 }}>
              <span style={LABEL_STYLE}>Horario</span>
              {!date ? (
                <p style={HINT_STYLE}>Elige una fecha para ver los horarios disponibles.</p>
              ) : slotsLoading ? (
                <p
                  style={{
                    ...HINT_STYLE,
                    color: MUTED,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Spinner size={13} />
                  Buscando horarios…
                </p>
              ) : slotsError ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                  <p style={{ ...HINT_STYLE, color: ERROR_COLOR, padding: 0 }}>
                    {slotsError.message}
                  </p>
                  {slotsError.retryable && (
                    <button
                      type="button"
                      onClick={() => fetchSlots(date)}
                      className="transition-colors hover:bg-white/[0.08]"
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(139,92,246,0.5)",
                        background: "rgba(139,92,246,0.15)",
                        color: "#c4b5fd",
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      Reintentar
                    </button>
                  )}
                </div>
              ) : slots && slots.length === 0 ? (
                <p style={HINT_STYLE}>No hay horarios disponibles ese día, prueba otra fecha.</p>
              ) : slots ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                    gap: 8,
                  }}
                >
                  {slots.map((s) => {
                    const sel = s === selectedSlot;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={submitting}
                        aria-pressed={sel}
                        onClick={() => {
                          setSelectedSlot(s);
                          setSubmitError(null);
                        }}
                        className={
                          sel ? undefined : "bg-white/[0.06] transition-colors hover:bg-white/[0.12]"
                        }
                        style={{
                          padding: "9px 4px",
                          borderRadius: 10,
                          fontSize: 13,
                          fontWeight: 600,
                          fontFamily: "inherit",
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          cursor: submitting ? "not-allowed" : "pointer",
                          border: sel ? "1px solid #8b5cf6" : BORDER,
                          color: sel ? "#fff" : "rgba(245,245,247,0.85)",
                          background: sel ? "#7c3aed" : undefined,
                          boxShadow: sel ? "0 0 14px rgba(124,58,237,0.35)" : undefined,
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Paso 3: motivo opcional */}
            <div>
              <label htmlFor="reagendar-motivo" style={LABEL_STYLE}>
                Motivo (opcional)
              </label>
              <textarea
                id="reagendar-motivo"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={submitting}
                placeholder="Cuéntanos por qué necesitas el cambio"
                style={{ ...FIELD_STYLE, resize: "vertical", minHeight: 64, lineHeight: 1.45 }}
              />
              <div style={{ textAlign: "right", fontSize: 11, color: FAINT, marginTop: 2 }}>
                {reason.length}/500
              </div>
            </div>

            {submitError && (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: ERROR_COLOR, lineHeight: 1.45 }}>
                {submitError}
              </p>
            )}

            {/* Enviar + footer informativo */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="transition-opacity hover:opacity-90"
                style={{
                  ...PRIMARY_BTN,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  opacity: canSubmit ? undefined : 0.55,
                }}
              >
                {submitting ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="animate-spin"
                      style={{
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        display: "inline-block",
                        borderRadius: "50%",
                        border: "2px solid rgba(255,255,255,0.4)",
                        borderTopColor: "#fff",
                      }}
                    />
                    Enviando…
                  </>
                ) : autoApprove ? (
                  "Reagendar cita"
                ) : (
                  "Solicitar cambio"
                )}
              </button>
              <p style={{ margin: 0, fontSize: 12, color: FAINT, textAlign: "center", lineHeight: 1.45 }}>
                {autoApprove
                  ? "El cambio se aplica al instante."
                  : `${clinicNombre} revisará tu solicitud.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
