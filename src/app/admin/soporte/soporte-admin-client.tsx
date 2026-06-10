"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /admin/soporte — bandeja global de tickets (DaleControl).
// KpiCards de métricas + segment de estado (pseudo-valor "OPEN" = abiertos) +
// selects de categoría/prioridad + búsqueda server (folio/asunto, debounce) +
// filtro de clínica CLIENT-SIDE + tabla .table-new con fila clicable.
// API: GET /api/admin/support/tickets?status=&category=&priority=&q=&metrics=1
// Contrato: src/lib/support/types.ts (AdminTicketSummary, SupportAdminMetrics).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, Building2, Clock, Inbox, LifeBuoy, Search, Star } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS_ADMIN,
  formatFolio,
} from "@/lib/support/types";
import type { AdminTicketSummary, SupportAdminMetrics } from "@/lib/support/types";

// "OPEN" es pseudo-valor del API (= todos los abiertos); "" = todos.
const STATUS_SEGMENTS: { value: string; label: string }[] = [
  { value: "OPEN", label: "Abiertos" },
  { value: "", label: "Todos" },
  ...SUPPORT_STATUSES.map(s => ({
    value: s as string,
    label: s === "ESPERANDO_RESPUESTA" ? "Esperando clínica" : SUPPORT_STATUS_LABELS_ADMIN[s],
  })),
];

const STATUS_TONES: Record<string, "brand" | "info" | "warning" | "success" | "neutral"> = {
  ABIERTO: "brand",          // violeta
  EN_PROGRESO: "info",       // azul
  ESPERANDO_RESPUESTA: "warning", // ámbar
  RESUELTO: "success",       // verde
  CERRADO: "neutral",        // gris
};

function priorityColor(p: string): string {
  if (p === "URGENTE") return "var(--danger)";
  if (p === "ALTA") return "var(--warning)";
  return "var(--text-2)";
}

/** Fecha corta es-MX ("08 jun", con año si no es el actual). */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "2-digit";
  return d.toLocaleDateString("es-MX", opts);
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Columnas: Folio · Clínica · Asunto · Categoría · Prioridad · Estado · Espera · Últ. actividad · ★
const COL_COUNT = 9;
// Anchos de skeleton por columna (las ocultas en móvil comparten índice con la tabla real).
const SKEL_WIDTHS = [64, 130, 220, 80, 56, 110, 48, 64, 24];
const HIDDEN_MD_COLS = [3, 8]; // Categoría y ★ se ocultan en pantallas angostas

export function AdminSoporteClient() {
  const router = useRouter();

  // Filtros server-side (re-fetchean) + filtro de clínica client-side.
  const [status, setStatus] = useState("OPEN"); // default al entrar: abiertos
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [clinicQ, setClinicQ] = useState("");

  const [tickets, setTickets] = useState<AdminTicketSummary[]>([]);
  const [metrics, setMetrics] = useState<SupportAdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const fetchSeq = useRef(0);

  // Debounce ~300ms de la búsqueda; Enter la aplica al instante.
  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const seq = ++fetchSeq.current;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (category) params.set("category", category);
        if (priority) params.set("priority", priority);
        const term = appliedQ.trim();
        if (term) params.set("q", term);
        params.set("metrics", "1");
        const res = await fetch(`/api/admin/support/tickets?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (seq !== fetchSeq.current) return;
        if (res.status === 401) {
          setError(true);
          toast.error("Tu sesión de admin expiró. Vuelve a iniciar sesión.");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (seq !== fetchSeq.current) return;
        setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
        if (data?.metrics) setMetrics(data.metrics);
        setError(false);
      } catch (err: any) {
        if (err?.name === "AbortError" || seq !== fetchSeq.current) return;
        setError(true);
        toast.error("No se pudieron cargar los tickets");
      } finally {
        if (seq === fetchSeq.current) {
          setLoading(false);
          setLoadedOnce(true);
        }
      }
    })();
    return () => controller.abort();
  }, [status, category, priority, appliedQ, refreshKey]);

  // Filtro de clínica: client-side por clinicName contains.
  const visible = useMemo(() => {
    const cq = clinicQ.trim().toLowerCase();
    if (!cq) return tickets;
    return tickets.filter(t => (t.clinicName || "").toLowerCase().includes(cq));
  }, [tickets, clinicQ]);

  const hasExtraFilters = !!(category || priority || appliedQ.trim() || clinicQ.trim());
  // Vacío "global": sin filtros extra y el server no devolvió nada.
  const showGlobalEmpty =
    loadedOnce && !loading && !error && tickets.length === 0 && !hasExtraFilters;

  function goToTicket(id: string) {
    router.push(`/admin/soporte/${id}`);
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Soporte
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, margin: "4px 0 0" }}>
          Tickets de las clínicas
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4" style={{ gap: 14, marginBottom: 20 }}>
        <KpiCard
          label="Abiertos"
          value={metrics ? String(metrics.open) : "—"}
          icon={Inbox}
          delta={metrics ? { value: "Tickets activos", direction: "up" } : undefined}
        />
        <KpiCard
          label="Sin responder >24h"
          value={metrics ? String(metrics.unanswered24h) : "—"}
          icon={AlertTriangle}
          delta={
            metrics
              ? metrics.unanswered24h > 0
                ? { value: "Requieren atención", direction: "down" }
                : { value: "Todo al día", direction: "up" }
              : undefined
          }
        />
        <KpiCard
          label="1ª respuesta (prom)"
          value={
            metrics && metrics.avgFirstResponseHours != null
              ? `${round1(metrics.avgFirstResponseHours)} h`
              : "—"
          }
          icon={Clock}
          delta={metrics ? { value: "Últimos tickets", direction: "up" } : undefined}
        />
        <KpiCard
          label="Rating promedio"
          value={
            metrics && metrics.avgRating != null
              ? `${round1(metrics.avgRating)} ★ (${metrics.ratedCount})`
              : "—"
          }
          icon={Star}
          delta={metrics ? { value: "Encuestas al resolver", direction: "up" } : undefined}
        />
      </div>

      {/* Controles */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div className="segment-new" style={{ display: "inline-flex", gap: 2, flexWrap: "wrap" }}>
          {STATUS_SEGMENTS.map(s => (
            <button
              key={s.value || "ALL"}
              onClick={() => setStatus(s.value)}
              className={`segment-new__btn ${status === s.value ? "segment-new__btn--active" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select
          className="input-new"
          style={{ width: "auto", minWidth: 150 }}
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {SUPPORT_CATEGORIES.map(c => (
            <option key={c} value={c}>{SUPPORT_CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>

        <select
          className="input-new"
          style={{ width: "auto", minWidth: 150 }}
          value={priority}
          onChange={e => setPriority(e.target.value)}
          aria-label="Filtrar por prioridad"
        >
          <option value="">Todas las prioridades</option>
          {SUPPORT_PRIORITIES.map(p => (
            <option key={p} value={p}>{SUPPORT_PRIORITY_LABELS[p] ?? p}</option>
          ))}
        </select>

        <div className="search-field" style={{ flex: "1 1 200px", maxWidth: 280 }}>
          <Search size={14} />
          <input
            placeholder="Folio o asunto…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") setAppliedQ(q); }}
            aria-label="Buscar por folio o asunto"
          />
        </div>

        <div className="search-field" style={{ flex: "1 1 160px", maxWidth: 220 }}>
          <Building2 size={14} />
          <input
            placeholder="Clínica…"
            value={clinicQ}
            onChange={e => setClinicQ(e.target.value)}
            aria-label="Filtrar por clínica"
          />
        </div>
      </div>

      {/* Tabla / estados vacíos */}
      <CardNew noPad>
        {error && !loading ? (
          <div style={{ padding: "56px 24px", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--bg-elev)", border: "1px solid var(--border-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: "var(--danger)" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
              No se pudo cargar la bandeja
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 16 }}>
              Revisa tu conexión o tu sesión de admin e inténtalo de nuevo.
            </div>
            <ButtonNew size="sm" variant="secondary" onClick={() => setRefreshKey(k => k + 1)}>
              Reintentar
            </ButtonNew>
          </div>
        ) : showGlobalEmpty ? (
          <div style={{ padding: "56px 24px", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--bg-elev)", border: "1px solid var(--border-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <LifeBuoy size={20} style={{ color: "var(--text-3)" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
              {status === "OPEN" ? "No hay tickets abiertos" : "Aún no hay tickets"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: status === "OPEN" ? 16 : 0 }}>
              {status === "OPEN"
                ? "La bandeja está al día. Cuando una clínica abra un ticket aparecerá aquí."
                : "Cuando una clínica escriba a soporte, su ticket aparecerá aquí."}
            </div>
            {status === "OPEN" && (
              <ButtonNew size="sm" variant="secondary" onClick={() => setStatus("")}>
                Ver todos los tickets
              </ButtonNew>
            )}
          </div>
        ) : (
          // overflow-x SOLO aquí: en pantallas angostas la tabla se desplaza
          // dentro del card sin forzar scroll horizontal de toda la página.
          <div style={{ overflowX: "auto" }}>
            <table className="table-new" style={{ opacity: loading && loadedOnce ? 0.6 : 1, transition: "opacity .15s" }}>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Clínica</th>
                  <th>Asunto</th>
                  <th className="hidden md:table-cell">Categoría</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Espera</th>
                  <th>Última actividad</th>
                  <th className="hidden md:table-cell" style={{ textAlign: "center" }}>★</th>
                </tr>
              </thead>
              <tbody>
                {loading && !loadedOnce ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skel-${i}`}>
                      {SKEL_WIDTHS.map((w, j) => (
                        <td
                          key={j}
                          className={HIDDEN_MD_COLS.includes(j) ? "hidden md:table-cell" : undefined}
                          style={j === 0 ? { borderLeft: "3px solid transparent" } : undefined}
                        >
                          <span className="skel-new" style={{ width: w, maxWidth: "100%", height: 12 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <>
                    {visible.map(t => (
                      <tr
                        key={t.id}
                        onClick={() => goToTicket(t.id)}
                        onKeyDown={e => { if (e.key === "Enter") goToTicket(t.id); }}
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                      >
                        {/* Acento a la izquierda cuando la clínica espera respuesta */}
                        <td style={{ borderLeft: `3px solid ${t.needsReply ? "var(--danger)" : "transparent"}` }}>
                          <span className="mono" style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500, whiteSpace: "nowrap" }}>
                            {t.folioLabel || formatFolio(t.folio)}
                          </span>
                        </td>
                        <td>
                          <div style={{ minWidth: 0, maxWidth: 200 }}>
                            <div
                              style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={t.clinicName}
                            >
                              {t.clinicName}
                            </div>
                            {t.createdByName && (
                              <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {t.createdByName}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div
                            style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--text-2)" }}
                            title={t.subject}
                          >
                            {t.subject}
                          </div>
                        </td>
                        <td className="hidden md:table-cell" style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                          {SUPPORT_CATEGORY_LABELS[t.category] ?? t.category}
                        </td>
                        <td>
                          <span style={{ fontSize: 12, fontWeight: t.priority === "URGENTE" ? 600 : 500, color: priorityColor(t.priority), whiteSpace: "nowrap" }}>
                            {SUPPORT_PRIORITY_LABELS[t.priority] ?? t.priority}
                          </span>
                        </td>
                        <td>
                          <BadgeNew tone={STATUS_TONES[t.status] ?? "neutral"} dot>
                            {SUPPORT_STATUS_LABELS_ADMIN[t.status] ?? t.status}
                          </BadgeNew>
                        </td>
                        <td>
                          {t.needsReply ? (
                            <BadgeNew tone={t.waitingHours != null && t.waitingHours > 24 ? "danger" : "neutral"}>
                              {t.waitingHours != null ? `${Math.round(t.waitingHours)} h` : "—"}
                            </BadgeNew>
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }} title={fullDate(t.lastActivityAt)}>
                            {shortDate(t.lastActivityAt)}
                          </span>
                        </td>
                        <td className="hidden md:table-cell" style={{ textAlign: "center" }}>
                          {t.rating != null ? (
                            <span style={{ fontSize: 12, color: "var(--warning)", fontWeight: 500 }}>{t.rating}</span>
                          ) : (
                            <span style={{ color: "var(--text-3)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={COL_COUNT} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                          Sin tickets con estos filtros
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>
    </div>
  );
}
