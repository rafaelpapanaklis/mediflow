"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Flag, EyeOff, Eye, ExternalLink } from "lucide-react";
import { ReviewStars } from "@/components/reviews/ReviewStars";
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
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            style={{
              padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "1px solid var(--border-soft)",
              background: filter === t.id ? "var(--brand)" : "transparent",
              color: filter === t.id ? "#fff" : "var(--text-2)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "40px 0", justifyContent: "center", color: "var(--text-3)" }}>
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14, color: "var(--text-3)" }}>
          No hay reseñas en esta vista.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.items.map((r) => (
            <AdminRow key={r.id} review={r} busy={busyId === r.id} onModerate={moderate} />
          ))}

          {data.totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 8 }}>
              <PagerBtn disabled={page <= 1} onClick={() => load(filter, page - 1)}>Anterior</PagerBtn>
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>{page} / {data.totalPages}</span>
              <PagerBtn disabled={page >= data.totalPages} onClick={() => load(filter, page + 1)}>Siguiente</PagerBtn>
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
    <article style={{ padding: 16, background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 14 }}>
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
        <div style={{ display: "flex", gap: 6 }}>
          {review.reported && <Badge color="#b45309" bg="rgba(245,158,11,0.14)" icon={<Flag size={11} />}>Reportada</Badge>}
          {hidden && <Badge color="var(--text-3)" bg="var(--bg-hover)" icon={<EyeOff size={11} />}>Oculta</Badge>}
        </div>
      </div>

      {review.comment && (
        <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, color: "var(--text-2)" }}>{review.comment}</p>
      )}
      {review.reportedReason && (
        <p style={{ marginTop: 6, fontSize: 12, color: "#b45309" }}>Motivo del reporte: {review.reportedReason}</p>
      )}
      {review.response && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "var(--brand-soft)", borderLeft: "3px solid var(--brand)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", marginBottom: 3 }}>Respuesta de la clínica</div>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{review.response}</p>
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {hidden ? (
          <ActionBtn onClick={() => onModerate(review.id, "publish")} busy={busy} icon={<Eye size={14} />}>
            Re-publicar
          </ActionBtn>
        ) : (
          <ActionBtn onClick={() => onModerate(review.id, "hide")} busy={busy} icon={<EyeOff size={14} />} danger>
            Ocultar
          </ActionBtn>
        )}
      </div>
    </article>
  );
}

function ActionBtn({
  children, onClick, busy, icon, danger,
}: {
  children: React.ReactNode; onClick: () => void; busy?: boolean; icon?: React.ReactNode; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, fontSize: 13,
        fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        border: "1px solid var(--border-soft)",
        background: danger ? "rgba(220,38,38,0.08)" : "var(--brand-soft)",
        color: danger ? "#dc2626" : "var(--brand)",
      }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
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
        padding: "7px 14px", borderRadius: 9, background: "var(--bg-elev)", color: "var(--text-1)", fontSize: 13,
        fontWeight: 600, border: "1px solid var(--border-soft)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
