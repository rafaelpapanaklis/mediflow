"use client";

import { useState } from "react";
import { Loader2, MessageSquare, ShieldCheck, Flag } from "lucide-react";
import { ReviewStars } from "./ReviewStars";
import {
  DIRECTORY_REVIEWS_API,
  formatReviewDate,
  type PublicReviewDTO,
  type PublicReviewsResponse,
} from "@/lib/reviews/types";

// ─────────────────────────────────────────────────────────────────────────────
// Bloque de reseñas del perfil público (client). Resumen (promedio +
// distribución), lista paginada con respuesta de la clínica, "cargar más" y
// reportar. Datos de la 1ª página llegan SSR (initial) para SEO; el resto se
// pide a GET /api/directory/reviews. Blanco + violeta, responsive.
// ─────────────────────────────────────────────────────────────────────────────

const INK = "var(--ink, #0f172a)";
const MUTED = "var(--muted, #64748b)";
const BODY = "var(--body, #475569)";
const LINE = "var(--line, #e9e7f3)";

export function ProfileReviews({
  clinicSlug,
  initial,
  theme,
}: {
  clinicSlug: string;
  initial: PublicReviewsResponse;
  theme: string;
}) {
  const [items, setItems] = useState<PublicReviewDTO[]>(initial.items);
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const summary = initial.summary;
  const total = initial.total;
  const hasMore = items.length < total;

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${DIRECTORY_REVIEWS_API}?slug=${encodeURIComponent(clinicSlug)}&page=${page + 1}`);
      if (res.ok) {
        const data: PublicReviewsResponse = await res.json();
        setItems((prev) => dedupe([...prev, ...data.items]));
        setPage(data.page);
      }
    } catch {
      /* silencioso — el botón sigue disponible para reintentar */
    } finally {
      setLoading(false);
    }
  }

  if (summary.count === 0) {
    return (
      <div
        className="rounded-2xl border bg-white p-8 text-center"
        style={{ borderColor: LINE }}
      >
        <div
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "var(--v50, #f5f3ff)", color: theme }}
        >
          <MessageSquare size={24} aria-hidden="true" />
        </div>
        <p className="font-bold" style={{ color: INK }}>
          Aún no hay reseñas
        </p>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          Sé el primero en compartir tu experiencia después de tu cita.
        </p>
      </div>
    );
  }

  const maxBar = Math.max(...[1, 2, 3, 4, 5].map((s) => summary.distribution[s as 1 | 2 | 3 | 4 | 5]), 1);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Resumen + distribución */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border bg-white p-5" style={{ borderColor: LINE }}>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-4xl font-extrabold leading-none" style={{ color: INK }}>
                {summary.avg.toFixed(1)}
              </div>
              <div className="mt-1.5">
                <ReviewStars value={summary.avg} size={15} />
              </div>
              <div className="mt-1 text-xs" style={{ color: MUTED }}>
                {summary.count} {summary.count === 1 ? "reseña" : "reseñas"}
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = summary.distribution[star as 1 | 2 | 3 | 4 | 5];
              return (
                <div key={star} className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                  <span className="w-3 text-right tabular-nums">{star}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "#f1f5f9" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(n / maxBar) * 100}%`, background: "#f59e0b" }}
                    />
                  </div>
                  <span className="w-6 tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Lista */}
      <div className="space-y-3">
        {items.map((r) => (
          <ReviewItem key={r.id} review={r} theme={theme} />
        ))}
        {hasMore && (
          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-2.5 text-sm font-semibold transition hover:bg-[var(--tint2,#faf8ff)] disabled:opacity-60"
              style={{ borderColor: LINE, color: INK }}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : null}
              {loading ? "Cargando…" : "Ver más reseñas"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ review, theme }: { review: PublicReviewDTO; theme: string }) {
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  async function report() {
    if (reporting || reported) return;
    setReporting(true);
    try {
      await fetch("/api/directory/reviews/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: review.id }),
      });
      setReported(true);
    } catch {
      /* noop */
    } finally {
      setReporting(false);
    }
  }

  const initial = review.authorName.trim().charAt(0).toUpperCase() || "P";

  return (
    <article className="rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: LINE }}>
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
          style={{ background: theme }}
          aria-hidden="true"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold" style={{ color: INK }}>
              {review.authorName}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: "var(--v50, #f5f3ff)", color: "var(--b-ink, #5b21b6)" }}
            >
              <ShieldCheck size={11} aria-hidden="true" /> Cita verificada
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <ReviewStars value={review.rating} size={14} />
            <span className="text-xs capitalize" style={{ color: MUTED }}>
              {formatReviewDate(review.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {review.comment && (
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: BODY }}>
          {review.comment}
        </p>
      )}

      {review.response && (
        <div
          className="mt-3 rounded-xl p-3.5"
          style={{ background: "var(--tint2, #faf8ff)", borderLeft: `3px solid ${theme}` }}
        >
          <div className="mb-1 text-xs font-bold" style={{ color: theme }}>
            Respuesta de la clínica
          </div>
          <p className="text-sm leading-relaxed" style={{ color: BODY }}>
            {review.response}
          </p>
        </div>
      )}

      <div className="mt-2 text-right">
        <button
          type="button"
          onClick={report}
          disabled={reporting || reported}
          className="inline-flex items-center gap-1 px-1 py-1.5 text-[11px] transition hover:opacity-70 disabled:opacity-50"
          style={{ color: MUTED }}
          aria-label="Reportar reseña"
        >
          <Flag size={11} aria-hidden="true" />
          {reported ? "Reportada" : "Reportar"}
        </button>
      </div>
    </article>
  );
}

function dedupe(list: PublicReviewDTO[]): PublicReviewDTO[] {
  const seen = new Set<string>();
  const out: PublicReviewDTO[] = [];
  for (const r of list) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
