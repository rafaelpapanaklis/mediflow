"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Star, Flag, EyeOff } from "lucide-react";
import { ReviewStars } from "@/components/reviews/ReviewStars";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import {
  REVIEW_MAX_RESPONSE_CHARS,
  formatReviewDate,
  type ClinicReviewDTO,
  type ClinicReviewsResponse,
} from "@/lib/reviews/types";

// ─────────────────────────────────────────────────────────────────────────────
// Panel de la clínica: ver sus reseñas verificadas y responder (una respuesta
// por reseña). GET /api/reviews — multi-tenant por sesión. Theme-aware (vars
// del design system del dashboard). Responsive.
// ─────────────────────────────────────────────────────────────────────────────

export function ResenasClient() {
  const [data, setData] = useState<ClinicReviewsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/reviews?page=${p}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setPage(p);
    } catch {
      setError("No pudimos cargar tus reseñas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  function patchItem(updated: ClinicReviewDTO) {
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === updated.id ? updated : i)) } : d));
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.02em" }}>
          Reseñas
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 2 }}>
          Opiniones verificadas de pacientes que tuvieron una cita contigo.
        </p>
      </header>

      {data && data.summary.count > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
          <div className="kpi kpi--hero">
            <div className="kpi__top">
              <span className="kpi__label">Calificación promedio</span>
              <div className="kpi__icon"><Star size={18} strokeWidth={1.75} aria-hidden /></div>
            </div>
            <div className="kpi__value">{data.summary.avg.toFixed(1)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <ReviewStars value={data.summary.avg} size={14} />
              <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>de 5</span>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi__top">
              <span className="kpi__label">{data.summary.count === 1 ? "Reseña publicada" : "Reseñas publicadas"}</span>
              <div className="kpi__icon"><MessageSquare size={18} strokeWidth={1.75} aria-hidden /></div>
            </div>
            <div className="kpi__value">{data.summary.count}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>
              opiniones verificadas de pacientes
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "40px 0", justifyContent: "center", color: "var(--text-3)" }}>
          <Loader2 size={18} strokeWidth={1.75} className="animate-spin" /> Cargando…
        </div>
      ) : error ? (
        <div style={{ padding: 16, borderRadius: "var(--radius)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13.5 }}>
          {error}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.items.map((r) => (
            <ReviewRow key={r.id} review={r} onResponded={patchItem} />
          ))}

          {data.totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 8 }}>
              <PagerBtn disabled={page <= 1} onClick={() => load(page - 1)}>Anterior</PagerBtn>
              <span style={{ fontSize: 13, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                {page} / {data.totalPages}
              </span>
              <PagerBtn disabled={page >= data.totalPages} onClick={() => load(page + 1)}>Siguiente</PagerBtn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  review,
  onResponded,
}: {
  review: ClinicReviewDTO;
  onResponded: (r: ClinicReviewDTO) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (saving || !text.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/reviews/${review.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: text.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? "No se pudo guardar.");
        setSaving(false);
        return;
      }
      onResponded(body.review as ClinicReviewDTO);
      setOpen(false);
    } catch {
      setErr("No se pudo guardar.");
      setSaving(false);
    }
  }

  const hidden = review.status === "hidden";

  return (
    <article className="card" style={{ opacity: hidden ? 0.7 : 1 }}>
      <div className="card__body">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <AvatarNew name={review.authorName} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 14 }}>{review.authorName}</span>
              {review.rating != null && <ReviewStars value={review.rating} size={14} />}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "capitalize", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
              {formatReviewDate(review.submittedAt ?? review.createdAt)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {review.reported && (
            <span className="badge-new badge-new--warning">
              <Flag size={11} strokeWidth={1.75} aria-hidden /> Reportada
            </span>
          )}
          {hidden && (
            <span className="badge-new badge-new--neutral">
              <EyeOff size={11} strokeWidth={1.75} aria-hidden /> Oculta
            </span>
          )}
          {review.response && <span className="badge-new badge-new--info">Respondida</span>}
        </div>
      </div>

      {review.comment && (
        <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-2)" }}>{review.comment}</p>
      )}

      {review.response ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: "var(--radius)", background: "var(--brand-soft)", borderLeft: "3px solid var(--brand)" }}>
          <span className="badge-new badge-new--brand" style={{ marginBottom: 6 }}>Tu respuesta</span>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text-2)" }}>{review.response}</p>
        </div>
      ) : open ? (
        <div style={{ marginTop: 12 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, REVIEW_MAX_RESPONSE_CHARS))}
            rows={3}
            placeholder="Responde con amabilidad y profesionalismo…"
            autoFocus
            className="input-new"
            style={{ height: "auto", minHeight: 88, resize: "none", padding: "10px 12px", fontSize: 13.5, fontFamily: "inherit" }}
          />
          {err && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={send}
              disabled={saving || !text.trim()}
              className="btn-new btn-new--primary"
            >
              {saving && <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />} Publicar respuesta
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(""); }}
              className="btn-new btn-new--ghost"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-new btn-new--secondary btn-new--sm"
          style={{ marginTop: 12 }}
        >
          <MessageSquare size={16} strokeWidth={1.75} aria-hidden /> Responder
        </button>
      )}
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 16px" }}>
      <div style={{ display: "inline-flex", padding: 14, borderRadius: "var(--radius-lg)", background: "var(--brand-soft)", color: "var(--brand)", marginBottom: 12 }}>
        <Star size={20} strokeWidth={1.75} aria-hidden />
      </div>
      <p style={{ fontWeight: 700, color: "var(--text-1)" }}>Todavía no tienes reseñas</p>
      <p style={{ fontSize: 13.5, color: "var(--text-3)", marginTop: 4, maxWidth: 360, marginInline: "auto" }}>
        Cuando marques una cita como completada, el paciente recibirá una invitación para calificarte.
      </p>
    </div>
  );
}

function PagerBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn-new btn-new--secondary btn-new--sm"
    >
      {children}
    </button>
  );
}
