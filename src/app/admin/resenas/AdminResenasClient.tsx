"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Flag, EyeOff, Eye, ExternalLink } from "lucide-react";
import { ReviewStars } from "@/components/reviews/ReviewStars";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { formatReviewDate, type AdminReviewDTO, type AdminReviewsResponse } from "@/lib/reviews/types";

// ─────────────────────────────────────────────────────────────────────────────
// Moderación de reseñas (admin DaleControl). Filtra reportadas/ocultas/todas;
// ocultar o re-publicar. GET /api/admin/reviews; POST .../moderate.
// ─────────────────────────────────────────────────────────────────────────────

type Filter = "reported" | "hidden" | "all";
const TABS: { id: Filter; label: string }[] = [
  { id: "reported", label: "Reportadas" },
  { id: "hidden", label: "Ocultas" },
  { id: "all", label: "Todas" },
];

export function AdminResenasClient() {
  const [filter, setFilter] = useState<Filter>("reported");
  const [data, setData] = useState<AdminReviewsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (f: Filter, p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reviews?filter=${f}&page=${p}`, { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setPage(p);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter, 1);
  }, [filter, load]);

  async function moderate(id: string, action: "hide" | "publish") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/reviews/${id}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await load(filter, page);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.02em" }}>Reseñas</h1>
        <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 2 }}>
          Modera las reseñas reportadas por usuarios. Ocultar la quita del perfil público.
        </p>
      </header>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="segment-new" style={{ display: "inline-flex", gap: 2, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`segment-new__btn ${filter === t.id ? "segment-new__btn--active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "40px 0", justifyContent: "center", color: "var(--text-3)" }}>
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 16px", color: "var(--text-3)", fontSize: 13 }}>
          No hay reseñas en esta vista.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.items.map((r) => (
            <AdminRow key={r.id} review={r} busy={busyId === r.id} onModerate={moderate} />
          ))}

          {data.totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 8 }}>
              <ButtonNew size="sm" variant="secondary" disabled={page <= 1} onClick={() => load(filter, page - 1)}>Anterior</ButtonNew>
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>{page} / {data.totalPages}</span>
              <ButtonNew size="sm" variant="secondary" disabled={page >= data.totalPages} onClick={() => load(filter, page + 1)}>Siguiente</ButtonNew>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminRow({
  review,
  busy,
  onModerate,
}: {
  review: AdminReviewDTO;
  busy: boolean;
  onModerate: (id: string, action: "hide" | "publish") => void;
}) {
  const hidden = review.status === "hidden";
  return (
    <article className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--text-1)", fontSize: 14 }}>{review.authorName}</span>
            {review.rating != null && <ReviewStars value={review.rating} size={14} />}
            <span style={{ fontSize: 12, color: "var(--text-3)", textTransform: "capitalize" }}>
              {formatReviewDate(review.submittedAt ?? review.createdAt)}
            </span>
          </div>
          <a
            href={`/descubre/clinica/${review.clinicSlug}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 12, color: "var(--brand)", fontWeight: 600 }}
          >
            {review.clinicName} <ExternalLink size={11} />
          </a>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {review.reported && <BadgeNew tone="warning"><Flag size={11} strokeWidth={1.75} />Reportada</BadgeNew>}
          {hidden && <BadgeNew tone="neutral"><EyeOff size={11} strokeWidth={1.75} />Oculta</BadgeNew>}
        </div>
      </div>

      {review.comment && (
        <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, color: "var(--text-2)" }}>{review.comment}</p>
      )}
      {review.reportedReason && (
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-2)" }}>Motivo del reporte: {review.reportedReason}</p>
      )}
      {review.response && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "var(--brand-soft)", borderLeft: "3px solid var(--brand)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", marginBottom: 3 }}>Respuesta de la clínica</div>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{review.response}</p>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {hidden ? (
          <ButtonNew
            size="sm"
            variant="secondary"
            onClick={() => onModerate(review.id, "publish")}
            disabled={busy}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} strokeWidth={1.75} />}
          >
            Re-publicar
          </ButtonNew>
        ) : (
          <ButtonNew
            size="sm"
            variant="secondary"
            onClick={() => onModerate(review.id, "hide")}
            disabled={busy}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} strokeWidth={1.75} />}
            style={{ color: "var(--danger)" }}
          >
            Ocultar
          </ButtonNew>
        )}
      </div>
    </article>
  );
}

// Badges (Reportada/Oculta), botones de acción (Ocultar/Re-publicar) y paginación
// usan el sistema de diseño (BadgeNew / ButtonNew) directo en el markup de arriba.
