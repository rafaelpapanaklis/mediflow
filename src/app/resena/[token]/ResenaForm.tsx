"use client";

import { useState } from "react";
import { Star, Loader2, Check } from "lucide-react";
import { REVIEW_MAX_COMMENT_CHARS } from "@/lib/reviews/types";

// ─────────────────────────────────────────────────────────────────────────────
// Formulario público para dejar una reseña (sin login). Estrellas interactivas
// + comentario opcional. Envía a POST /api/resena/[token]. Blanco + violeta.
// ─────────────────────────────────────────────────────────────────────────────

const RATING_LABELS = ["", "Muy mala", "Mala", "Regular", "Buena", "Excelente"];

export function ResenaForm({
  token,
  clinicName,
  themeColor,
}: {
  token: string;
  clinicName: string;
  themeColor: string;
}) {
  const theme = themeColor || "#7c3aed";
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
      const res = await fetch(`/api/resena/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 410) {
        setError(data.error ?? "Este enlace ya no está disponible.");
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
      <div className="text-center">
        <div
          className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: `${theme}14` }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: theme }}>
            <Check size={30} className="text-white" strokeWidth={3} />
          </div>
        </div>
        <h2 className="text-2xl font-bold" style={{ color: "#0f172a" }}>
          ¡Gracias por tu reseña!
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[15px]" style={{ color: "#64748b" }}>
          Tu opinión ayuda a otras personas a elegir mejor. Que tengas un excelente día.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-5 text-center text-[15px]" style={{ color: "#475569" }}>
        ¿Cómo fue tu experiencia en <strong style={{ color: "#0f172a" }}>{clinicName}</strong>?
      </p>

      {/* Estrellas interactivas */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRating(s)}
              onMouseEnter={() => setHover(s)}
              aria-label={`${s} ${s === 1 ? "estrella" : "estrellas"}`}
              aria-pressed={rating === s}
              className="rounded-md p-1 transition-transform hover:scale-110"
            >
              <Star
                size={40}
                strokeWidth={1.5}
                fill={s <= shown ? "#f59e0b" : "transparent"}
                style={{ color: s <= shown ? "#f59e0b" : "#cbd5e1" }}
              />
            </button>
          ))}
        </div>
        <div className="h-5 text-sm font-semibold" style={{ color: theme }}>
          {shown > 0 ? RATING_LABELS[shown] : ""}
        </div>
      </div>

      {/* Comentario */}
      <div className="mt-5">
        <label className="mb-1.5 block text-xs font-semibold" style={{ color: "#64748b" }}>
          Cuéntanos más (opcional)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, REVIEW_MAX_COMMENT_CHARS))}
          rows={4}
          placeholder="¿Qué te gustó? ¿Cómo fue la atención?"
          className="w-full resize-none rounded-xl border-2 px-3.5 py-3 text-[15px] outline-none transition-colors"
          style={{ borderColor: "#f1f5f9", color: "#0f172a", background: "#fff" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = theme)}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#f1f5f9")}
        />
        <div className="mt-1 text-right text-[11px]" style={{ color: "#94a3b8" }}>
          {comment.length}/{REVIEW_MAX_COMMENT_CHARS}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition-all disabled:opacity-60"
        style={{ background: theme, boxShadow: `0 8px 24px ${theme}40` }}
      >
        {submitting ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Enviando…
          </>
        ) : (
          "Enviar mi reseña"
        )}
      </button>
      <p className="mt-3 text-center text-[11px]" style={{ color: "#94a3b8" }}>
        Tu reseña será pública en el perfil de la clínica. Sé respetuoso y honesto.
      </p>
    </div>
  );
}
