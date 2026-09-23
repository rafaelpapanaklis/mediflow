"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useT } from "@/i18n/i18n-provider";
import { useSondeo } from "@/hooks/use-sondeo";
import { avisarCambioArmazon, conFresco, escucharCambioArmazon } from "@/lib/armazon/refrescar";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { vestidor, type AparienciaTopbar } from "@/components/dashboard/topbar-rediseno/apariencia";
import c from "@/components/dashboard/topbar-rediseno/piezas-topbar.module.css";

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

/** El mismo tono con la ropa nueva: semáforo de globals + marca del menú. */
const TONO_NUEVO: Record<string, string> = {
  success: c.tonoExito,
  warning: c.tonoAlerta,
  danger: c.tonoPeligro,
  info: c.tonoInfo,
  neutral: c.tonoNeutro,
};

/**
 * InsightsPopover — campanita Sparkles con badge unread + dropdown.
 * Pollea /api/notifications/insights cada 5 min, solo con la pestaña
 * visible (useSondeo). Antes era cada 60 s, para un dato que un cron crea
 * UNA vez por semana (lunes 04:00 UTC): lo único que cambia entre semana es
 * el «leído», y ese lo cambia quien abre el popover —que ve el 0 en el acto—.
 * Multi-tenant: el endpoint usa clinicId desde getCurrentUser.
 *
 * Pensado para ir junto a NotificationsPopover en el topbar (reusable).
 *
 * `apariencia`: la ropa (topbar-rediseno/apariencia.ts). Sin ella —la barra
 * de siempre— cada elemento recibe EXACTAMENTE los `style` de antes; con
 * "nueva" —la barra del menú de dos niveles— se pinta con las clases del
 * rediseño. La lógica (sondeo, marcar leído, abrir el detalle) es una.
 */
export function InsightsPopover({ apariencia }: { apariencia?: AparienciaTopbar }) {
  const t = useT();
  const nueva = apariencia === "nueva";
  const vestir = vestidor(apariencia);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selected, setSelected] = useState<InsightItem | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sondeo (ver el comentario de arriba). `cancelado` protege el setData de
  // una respuesta que llega con el componente ya desmontado.
  const cancelado = useRef(false);
  useEffect(() => {
    cancelado.current = false;
    return () => { cancelado.current = true; };
  }, []);
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(conFresco("/api/notifications/insights", "insights"), { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!cancelado.current) setData(json);
    } catch {/* silent */}
  }, []);
  const refrescar = useSondeo(fetchData, 5 * 60_000);
  useEffect(() => escucharCambioArmazon("insights", refrescar), [refrescar]);

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
        // Las siguientes lecturas de este navegador saltan la caché del
        // servidor: si cayeran en otra instancia, volvería el punto.
        avisarCambioArmazon("insights");
      } catch {/* silent */}
    }
  }

  const unreadCount = data?.unreadCount ?? 0;
  const insights = data?.insights ?? [];

  return (
    <div ref={wrapperRef} {...vestir({ position: "relative" }, c.ancla)}>
      <button
        type="button"
        onClick={handleToggleOpen}
        className={nueva ? c.botonIcono : "icon-btn-new"}
        title={t("shell.insights.title")}
        aria-label={unreadCount > 0 ? t("shell.insights.ariaUnread", { count: unreadCount }) : t("shell.insights.title")}
        style={nueva ? undefined : { position: "relative" }}
      >
        <Sparkles size={nueva ? 17 : 14} />
        {unreadCount > 0 && (
          <span
            aria-hidden
            {...vestir({
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
              fontFamily: "var(--font-mono, monospace)",
              border: "1px solid var(--bg-elev)",
            }, c.contador)}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          {...vestir({
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
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
          }, `${CLASES_MENU} ${c.piel} ${c.panel} ${c.panelAncho}`)}
        >
          <div
            {...vestir({
              padding: "12px 14px",
              borderBottom: "1px solid var(--border-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-1)",
            }, c.cabecera)}
          >
            <span {...vestir({ display: "inline-flex", alignItems: "center", gap: 6 }, c.cabeceraTitulo)}>
              <Sparkles size={13} {...vestir({ color: "var(--brand)" }, c.cabeceraIcono)} aria-hidden /> {t("shell.insights.title")}
            </span>
            {insights.length > 0 && (
              <Link
                href="/dashboard/analytics"
                onClick={() => setOpen(false)}
                {...vestir({ fontSize: 11, color: "var(--brand)", textDecoration: "none", fontWeight: 600 }, c.enlace)}
              >
                {t("shell.insights.viewAnalytics")} →
              </Link>
            )}
          </div>
          <div {...vestir({ overflowY: "auto", flex: 1 }, c.lista)}>
            {insights.length === 0 ? (
              <div {...vestir({ padding: 32, textAlign: "center", fontSize: 12, color: "var(--text-3)" }, c.vacio)}>
                {t("shell.insights.empty")}
              </div>
            ) : (
              insights.map((ins) => (
                <button
                  key={ins.id}
                  type="button"
                  onClick={() => { setSelected(ins); setOpen(false); }}
                  {...vestir({
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
                  }, `${c.fila} ${c.filaBoton}${ins.read ? "" : ` ${c.filaNoLeida}`}`)}
                >
                  <div {...vestir({ display: "flex", justifyContent: "space-between", alignItems: "center" }, c.filaEncabezado)}>
                    <strong {...vestir({ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }, c.filaTitulo)}>
                      {t("shell.insights.weekOf", { date: new Date(ins.weekStart).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) })}
                    </strong>
                    {!ins.read && (
                      <span {...vestir({ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }, c.puntoNoLeido)} aria-hidden />
                    )}
                  </div>
                  <div {...vestir({ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }, c.filaResumen)}>
                    {ins.summary}
                  </div>
                  <div {...vestir({ fontSize: 10, color: "var(--text-3)" }, c.filaCuando)}>
                    {formatDistanceToNow(new Date(ins.createdAt), { addSuffix: true, locale: es })} · {t("shell.insights.bullets", { count: ins.insights.length })}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal con detalle del insight */}
      {selected && (
        <InsightDetailModal insight={selected} onClose={() => setSelected(null)} apariencia={apariencia} />
      )}
    </div>
  );
}

function InsightDetailModal({ insight, onClose, apariencia }: { insight: InsightItem; onClose: () => void; apariencia?: AparienciaTopbar }) {
  const t = useT();
  const nueva = apariencia === "nueva";
  const vestir = vestidor(apariencia);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      {...vestir({
        position: "fixed",
        inset: 0,
        background: "rgba(5, 5, 10, 0.72)",
        WebkitBackdropFilter: "blur(6px)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 200,
        padding: 24,
      }, `${c.velo} ${c.veloCentrado}`)}
    >
      <div
        {...vestir({
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
        }, `${CLASES_MENU} ${c.piel} ${c.dialogoEstatico}`)}
      >
        <div
          {...vestir({
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-soft)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }, c.dialogoCabeza)}
        >
          <div {...vestir(undefined, c.dialogoTextos)}>
            <h3 id="insight-modal-title" {...vestir({ fontSize: 15, fontWeight: 700, color: "var(--text-1)", margin: 0 }, c.dialogoTitulo)}>
              <Sparkles size={14} {...vestir({ color: "var(--brand)", display: "inline", marginRight: 6 }, c.dialogoTituloIcono)} aria-hidden />
              {t("shell.insights.modalTitle")}
            </h3>
            <div {...vestir({ fontSize: 11, color: "var(--text-3)", marginTop: 4 }, c.dialogoSub)}>
              {new Date(insight.weekStart).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
              {" → "}
              {new Date(insight.weekEnd).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            {...vestir({
              width: 28, height: 28, display: "grid", placeItems: "center",
              background: "transparent", border: "1px solid var(--border-soft)",
              borderRadius: 7, color: "var(--text-3)", cursor: "pointer",
              flexShrink: 0,
            }, c.cerrar)}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
        <div {...vestir({ padding: "18px 20px", overflowY: "auto", flex: 1 }, c.cuerpoInsight)}>
          <div
            {...vestir({
              fontSize: 14,
              color: "var(--text-1)",
              lineHeight: 1.6,
              marginBottom: 18,
              fontWeight: 500,
            }, c.resumen)}
          >
            {insight.summary}
          </div>
          <div {...vestir({ display: "flex", flexDirection: "column", gap: 10 }, c.tarjetas)}>
            {insight.insights.map((b, i) => {
              const tone = TONE_COLORS[b.tone] ?? TONE_COLORS.neutral;
              return (
                <div
                  key={i}
                  {...vestir({
                    padding: 12,
                    background: tone.bg,
                    border: `1px solid ${tone.border}`,
                    borderRadius: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }, `${c.tarjetaTono} ${TONO_NUEVO[b.tone] ?? c.tonoNeutro}`)}
                >
                  <div {...vestir({ fontSize: 13, fontWeight: 700, color: tone.fg }, c.tarjetaTonoTitulo)}>{b.title}</div>
                  <div {...vestir({ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }, c.tarjetaTonoDetalle)}>{b.detail}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
