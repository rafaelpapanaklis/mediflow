"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Star, Flag, EyeOff } from "lucide-react";
import { ReviewStars } from "@/components/reviews/ReviewStars";
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
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", marginBottom: 16,
            background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14,
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--text-1)", lineHeight: 1 }}>
            {data.summary.avg.toFixed(1)}
          </div>
          <div>
            <ReviewStars value={data.summary.avg} size={16} />
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              {data.summary.count} {data.summary.count === 1 ? "reseña publicada" : "reseñas publicadas"}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "40px 0", justifyContent: "center", color: "var(--text-3)" }}>
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : error ? (
        <div style={{ padding: 16, borderRadius: 12, background: "rgba(220,38,38,0.08)", color: "#dc2626", fontSize: 14 }}>
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
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>
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
    <article
      style={{
        padding: 16, background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14,
        opacity: hidden ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 14 }}>{review.authorName}</span>
            {review.rating != null && <ReviewStars value={review.rating} size={14} />}
            <span style={{ fontSize: 12, color: "var(--text-3)", textTransform: "capitalize" }}>
              {formatReviewDate(review.submittedAt ?? review.createdAt)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {review.reported && <Badge color="#b45309" bg="rgba(245,158,11,0.14)" icon={<Flag size={11} />}>Reportada</Badge>}
          {hidden && <Badge color="var(--text-3)" bg="var(--bg-hover)" icon={<EyeOff size={11} />}>Oculta</Badge>}
        </div>
      </div>

      {review.comment && (
        <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, color: "var(--text-2)" }}>{review.comment}</p>
      )}

      {review.response ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--brand-soft)", borderLeft: "3px solid var(--brand)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", marginBottom: 3 }}>Tu respuesta</div>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{review.response}</p>
        </div>
      ) : open ? (
        <div style={{ marginTop: 12 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, REVIEW_MAX_RESPONSE_CHARS))}
            rows={3}
            placeholder="Responde con amabilidad y profesionalismo…"
            autoFocus
            style={{
              width: "100%", resize: "none", borderRadius: 10, padding: "10px 12px", fontSize: 14,
              border: "1px solid var(--border-soft)", background: "var(--bg-base, #fff)", color: "var(--text-1)",
              fontFamily: "inherit", outline: "none",
            }}
          />
          {err && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={send}
              disabled={saving || !text.trim()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                background: "var(--brand)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none",
                cursor: saving ? "default" : "pointer", opacity: saving || !text.trim() ? 0.6 : 1,
              }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />} Publicar respuesta
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(""); }}
              style={{
                padding: "8px 14px", borderRadius: 9, background: "transparent", color: "var(--text-2)",
                fontSize: 13, fontWeight: 600, border: "1px solid var(--border-soft)", cursor: "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9,
            background: "transparent", color: "var(--brand)", fontSize: 13, fontWeight: 600,
            border: "1px solid var(--border-soft)", cursor: "pointer",
          }}
        >
          <MessageSquare size={14} /> Responder
        </button>
      )}
    </article>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "48px 16px", background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14 }}>
      <div style={{ display: "inline-flex", padding: 14, borderRadius: 16, background: "var(--brand-soft)", color: "var(--brand)", marginBottom: 12 }}>
        <Star size={24} />
      </div>
      <p style={{ fontWeight: 700, color: "var(--text-1)" }}>Todavía no tienes reseñas</p>
      <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 4, maxWidth: 360, marginInline: "auto" }}>
        Cuando marques una cita como completada, el paciente recibirá una invitación para calificarte.
      </p>
    </div>
  );
}

function Badge({ children, color, bg, icon }: { children: React.ReactNode; color: string; bg: string; icon?: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, background: bg, color, fontSize: 11, fontWeight: 700 }}>
      {icon}{children}
    </span>
  );
}

function PagerBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 14px", borderRadius: 9, background: "var(--bg-elev)", color: "var(--text-1)",
        fontSize: 13, fontWeight: 600, border: "1px solid var(--border-soft)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
