"use client";

// Tarjeta "Califica tu visita" del inicio del portal. Para cada cita COMPLETADA
// del paciente sin reseña enviada muestra estrellas 1-5 + comentario y publica
// vía POST /api/paciente/resenas (reusa el modelo ClinicReview existente).
// Estilo dark del portal (inline styles, acento violeta), responsive, es-MX (tú).
import { useState } from "react";
import { Star, Loader2, Check } from "lucide-react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import { REVIEW_MAX_COMMENT_CHARS } from "@/lib/reviews/types";
import type {
  PatientReviewItemDTO,
  PatientReviewablesResponse,
} from "@/lib/reviews/types";
import { PacienteCard, formatFecha } from "@/components/paciente/ui";

const RATING_LABELS = ["", "Muy mala", "Mala", "Regular", "Buena", "Excelente"];
const STAR_FILLED = "#fbbf24";
const STAR_EMPTY = "rgba(255,255,255,0.2)";
const ACCENT = "#7c3aed";

const ITEM_BOX: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "clamp(12px, 1.8vw, 16px)",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.03)",
};

function ReviewItem({ item, multiClinic }: { item: PatientReviewItemDTO; multiClinic: boolean }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const shown = hover || rating;

  async function submit() {
    if (submitting) return;
    if (rating < 1) {
      setError("Selecciona una calificación.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/paciente/resenas", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: item.appointmentId,
          rating,
          comment: comment.trim() || undefined,
        }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        setError(data.error ?? "Ya calificaste esta visita.");
      } else if (res.status === 429) {
        setError("Demasiados intentos. Espera un momento e intenta de nuevo.");
      } else {
        setError(data.error ?? "No pudimos enviar tu reseña. Intenta de nuevo.");
      }
      setSubmitting(false);
    } catch {
      setError("No pudimos enviar tu reseña. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ ...ITEM_BOX, alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(52,211,153,0.15)",
          }}
        >
          <Check size={24} strokeWidth={3} style={{ color: "#34d399" }} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>¡Gracias por tu reseña!</div>
        <div style={{ fontSize: 13, color: "rgba(245,245,247,0.6)", lineHeight: 1.5 }}>
          Tu opinión ayuda a otras personas a elegir mejor.
        </div>
      </div>
    );
  }

  return (
    <div style={ITEM_BOX}>
      <div>
        <div style={{ fontWeight: 600, fontSize: "clamp(14px, 1.5vw, 15px)" }}>
          Tu visita del {formatFecha(item.date)}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(245,245,247,0.65)",
            marginTop: 2,
            overflowWrap: "anywhere",
          }}
        >
          Dr(a). {item.doctorName} · {item.type}
          {multiClinic && item.clinicName ? ` · ${item.clinicName}` : ""}
        </div>
      </div>

      {/* Estrellas */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 4 }}
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRating(s)}
              onMouseEnter={() => setHover(s)}
              aria-label={`${s} ${s === 1 ? "estrella" : "estrellas"}`}
              aria-pressed={rating === s}
              style={{
                background: "transparent",
                border: "none",
                padding: 2,
                margin: 0,
                cursor: "pointer",
                lineHeight: 0,
                borderRadius: 6,
              }}
            >
              <Star
                size={34}
                strokeWidth={1.5}
                fill={s <= shown ? STAR_FILLED : "transparent"}
                style={{ color: s <= shown ? STAR_FILLED : STAR_EMPTY }}
              />
            </button>
          ))}
        </div>
        <div style={{ height: 16, fontSize: 13, fontWeight: 600, color: "#c4b5fd" }}>
          {shown > 0 ? RATING_LABELS[shown] : ""}
        </div>
      </div>

      {/* Comentario (opcional) */}
      <div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, REVIEW_MAX_COMMENT_CHARS))}
          rows={3}
          placeholder="Cuéntanos cómo fue tu experiencia (opcional)"
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 64,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            color: "#f5f5f7",
            fontSize: 14,
            fontFamily: "inherit",
            padding: "10px 12px",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#8b5cf6";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          }}
        />
        <div
          style={{
            marginTop: 4,
            textAlign: "right",
            fontSize: 11,
            color: "rgba(245,245,247,0.45)",
          }}
        >
          {comment.length}/{REVIEW_MAX_COMMENT_CHARS}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: "#f87171" }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          alignSelf: "flex-start",
          padding: "10px 18px",
          borderRadius: 10,
          border: "1px solid #8b5cf6",
          background: ACCENT,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? (
          <>
            <Loader2 size={16} style={{ animation: "resenaSpin 0.8s linear infinite" }} /> Enviando…
          </>
        ) : (
          "Enviar reseña"
        )}
      </button>
    </div>
  );
}

/**
 * Sección de inicio: solo se renderiza cuando hay ≥1 visita por calificar
 * (no satura el panel). Lee /api/paciente/resenas con el hook SWR del portal.
 */
export function ResenaPostcita() {
  const { data, isLoading } = usePacienteData<PatientReviewablesResponse>("/api/paciente/resenas");

  if (isLoading || !data) return null;
  const pending = data.pending ?? [];
  if (pending.length === 0) return null;

  const multiClinic =
    new Set([...pending, ...(data.done ?? [])].map((i) => i.clinicId)).size > 1;

  return (
    <PacienteCard title="Califica tu visita">
      <style>{`@keyframes resenaSpin { to { transform: rotate(360deg); } }`}</style>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 13.5,
          color: "rgba(245,245,247,0.7)",
          lineHeight: 1.5,
        }}
      >
        {pending.length === 1
          ? "Tienes una visita reciente por calificar. Tu reseña será pública y verificada."
          : `Tienes ${pending.length} visitas por calificar. Tus reseñas serán públicas y verificadas.`}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pending.map((item) => (
          <ReviewItem key={item.appointmentId} item={item} multiClinic={multiClinic} />
        ))}
      </div>
    </PacienteCard>
  );
}
