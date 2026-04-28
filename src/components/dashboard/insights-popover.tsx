"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface InsightItem {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string;
  insights: Array<{ tone: string; title: string; detail: string }>;
  read: boolean;
  createdAt: string;
}

interface ApiResponse {
  insights: InsightItem[];
  unreadCount: number;
}

const TONE_COLORS: Record<string, { bg: string; border: string; fg: string }> = {
  success: { bg: "rgba(16, 185, 129, 0.10)", border: "rgba(16, 185, 129, 0.25)", fg: "#10b981" },
  warning: { bg: "rgba(217, 119, 6, 0.10)",  border: "rgba(217, 119, 6, 0.25)",  fg: "#d97706" },
  danger:  { bg: "rgba(220, 38, 38, 0.10)",  border: "rgba(220, 38, 38, 0.25)",  fg: "#dc2626" },
  info:    { bg: "var(--brand-softer)",       border: "rgba(124, 58, 237, 0.20)", fg: "var(--brand)" },
  neutral: { bg: "var(--bg-elev-2)",          border: "var(--border-soft)",       fg: "var(--text-2)" },
};

/**
 * InsightsPopover — campanita Sparkles con badge unread + dropdown.
 * Pollea /api/notifications/insights cada 60s con visibility pause.
 * Multi-tenant: el endpoint usa clinicId desde getCurrentUser.
 *
 * Pensado para ir junto a NotificationsPopover en el topbar (reusable).
 */
export function InsightsPopover() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selected, setSelected] = useState<InsightItem | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Polling con visibility pause.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchData = async () => {
      try {
        const res = await fetch("/api/notifications/insights", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {/* silent */}
    };

    const start = () => {
      if (interval !== null) return;
      interval = setInterval(fetchData, 60_000);
    };
    const stop = () => {
      if (interval !== null) { clearInterval(interval); interval = null; }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") { fetchData(); start(); }
      else stop();
    };

    fetchData();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Click outside cierra dropdown (no el modal de insight).
  useEffect(() => {
    if (!open || selected) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, selected]);

  // Esc cierra modal.
  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  async function handleToggleOpen() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && data && data.unreadCount > 0) {
      // Marca todos como read al abrir el dropdown.
      try {
        await fetch("/api/notifications/insights", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        setData((prev) => prev ? { ...prev, unreadCount: 0, insights: prev.insights.map((i) => ({ ...i, read: true })) } : prev);
      } catch {/* silent */}
    }
  }

  const unreadCount = data?.unreadCount ?? 0;
  const insights = data?.insights ?? [];

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={handleToggleOpen}
        className="icon-btn-new"
        title="Insights semanales"
        aria-label={`Insights semanales${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ""}`}
        style={{ position: "relative" }}
      >
        <Sparkles size={14} />
        {unreadCount > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 14,
              height: 14,
              padding: "0 3px",
              background: "var(--brand)",
              color: "#fff",
              borderRadius: 999,
              fontSize: 9,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              border: "1px solid var(--bg-elev)",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 380,
            maxHeight: 500,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 16px 40px -8px rgba(0, 0, 0, 0.55)",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-1)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={13} style={{ color: "var(--brand)" }} aria-hidden /> Insights semanales
            </span>
            {insights.length > 0 && (
              <Link
                href="/dashboard/analytics"
                onClick={() => setOpen(false)}
                style={{ fontSize: 11, color: "var(--brand)", textDecoration: "none", fontWeight: 600 }}
              >
                Ver Analytics →
              </Link>
            )}
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {insights.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
                Aún no hay insights. Los recibirás cada domingo a las 22:00.
              </div>
            ) : (
              insights.map((ins) => (
                <button
                  key={ins.id}
                  type="button"
                  onClick={() => { setSelected(ins); setOpen(false); }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "12px 14px",
                    width: "100%",
                    border: "none",
                    background: ins.read ? "transparent" : "var(--brand-softer)",
                    borderBottom: "1px solid var(--border-soft)",
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "background 0.12s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>
                      Semana del {new Date(ins.weekStart).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    </strong>
                    {!ins.read && (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }} aria-hidden />
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                    {ins.summary}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                    {formatDistanceToNow(new Date(ins.createdAt), { addSuffix: true, locale: es })} · {ins.insights.length} bullets
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal con detalle del insight */}
      {selected && (
        <InsightDetailModal insight={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function InsightDetailModal({ insight, onClose }: { insight: InsightItem; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 5, 10, 0.72)",
        WebkitBackdropFilter: "blur(6px)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 200,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-soft)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <h3 id="insight-modal-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
              <Sparkles size={14} style={{ color: "var(--brand)", display: "inline", marginRight: 6 }} aria-hidden />
              Insight semanal
            </h3>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
              {new Date(insight.weekStart).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
              {" → "}
              {new Date(insight.weekEnd).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: 28, height: 28, display: "grid", placeItems: "center",
              background: "transparent", border: "1px solid var(--border-soft)",
              borderRadius: 7, color: "var(--text-3)", cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
        <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              color: "var(--text-1)",
              lineHeight: 1.6,
              marginBottom: 18,
              fontWeight: 500,
            }}
          >
            {insight.summary}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insight.insights.map((b, i) => {
              const tone = TONE_COLORS[b.tone] ?? TONE_COLORS.neutral;
              return (
                <div
                  key={i}
                  style={{
                    padding: 12,
                    background: tone.bg,
                    border: `1px solid ${tone.border}`,
                    borderRadius: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: tone.fg }}>{b.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{b.detail}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
