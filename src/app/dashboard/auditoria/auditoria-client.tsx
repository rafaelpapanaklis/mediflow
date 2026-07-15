"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ScrollText, Search, ChevronLeft, ChevronRight, X, RotateCcw,
  User as UserIcon, Tag, Clock, Globe,
  Plus, Pencil, Trash, Trash2, Ban, Archive, Eye, KeyRound, FileText, Activity,
} from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { useTOptional } from "@/i18n/i18n-provider";
import {
  AUDIT_ACTION_OPTIONS, AUDIT_ENTITY_OPTIONS, ROLE_OPTIONS, ROLE_LABELS,
  actionMeta, entityLabel, normalizeChanges, formatAuditValue,
  QUICK_RANGE_KEYS, QUICK_RANGE_LABELS, quickRangeValues, matchQuickRange,
  type QuickRangeKey, type AuditTone, type AuditLogRow, type AuditQueryResult,
} from "@/lib/admin/audit-core";

const PAGE_SIZE = 50;

// Icono lucide por acción del catálogo de audit-core (fallback Activity).
const ACTION_ICONS: Record<string, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  void: Ban,
  soft_delete: Trash,
  archive: Archive,
  view: Eye,
  password_reset: KeyRound,
  XRAY_NOTES_UPDATED: FileText,
  FILE_NOTES_UPDATED: FileText,
};

// Tinta del icono por tono (variantes *-strong = contraste AA en light y dark).
const TONE_ICON_COLORS: Record<AuditTone, string> = {
  success: "var(--success-strong)",
  info: "var(--info-strong)",
  danger: "var(--danger)",
  warning: "var(--warning-strong)",
  brand: "var(--brand)",
  neutral: "var(--text-3)",
};

/** Icono según acción + badge semántico del sistema (create=success, update=info, delete=danger…). */
function ActionCell({ action }: { action: string }) {
  const am = actionMeta(action);
  const Icon = ACTION_ICONS[action] || Activity;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Icon size={16} strokeWidth={1.75} style={{ color: TONE_ICON_COLORS[am.tone], flexShrink: 0 }} aria-hidden />
      <BadgeNew tone={am.tone}>{am.label}</BadgeNew>
    </span>
  );
}

const fetcher = async (url: string): Promise<AuditQueryResult> => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error((await r.text()) || "Error");
  return r.json();
};

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface Filters {
  role: string; action: string; entityType: string;
  userId: string; entityId: string; dateFrom: string; dateTo: string;
}
const EMPTY: Filters = {
  role: "", action: "", entityType: "", userId: "", entityId: "", dateFrom: "", dateTo: "",
};

const SELECT_CLS = "input-new";

const RANGE_I18N: Record<QuickRangeKey, string> = {
  today: "auditoria.rangeToday",
  "7d": "auditoria.range7d",
  "30d": "auditoria.range30d",
  "3m": "auditoria.range3m",
};

export function AuditoriaClient() {
  const tt = useTOptional();
  const tr = (k: string, fb: string) => { const v = tt?.(k); return !v || v === k ? fb : v; };

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [qInput, setQInput] = useState("");
  const q = useDebounce(qInput, 350);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  useEffect(() => { setPage(1); }, [filters, q]);

  const key = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.role) p.set("role", filters.role);
    if (filters.action) p.set("action", filters.action);
    if (filters.entityType) p.set("entityType", filters.entityType);
    if (filters.userId) p.set("userId", filters.userId);
    if (filters.entityId) p.set("entityId", filters.entityId);
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) p.set("dateTo", filters.dateTo);
    if (q.trim()) p.set("q", q.trim());
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return `/api/auditoria?${p.toString()}`;
  }, [filters, q, page]);

  const { data, error, isLoading } = useSWR<AuditQueryResult>(key, fetcher, { keepPreviousData: true });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters = Object.values(filters).some(Boolean) || q.trim().length > 0;

  function patch(p: Partial<Filters>) { setFilters((f) => ({ ...f, ...p })); }
  function clearAll() { setFilters(EMPTY); setQInput(""); }

  // Rango rápido: rellena Desde/Hasta y dispara la búsqueda al instante (SWR re-fetch por cambio de key).
  const activeRange = matchQuickRange(filters.dateFrom, filters.dateTo);
  function applyQuickRange(k: QuickRangeKey) { patch(quickRangeValues(k)); }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ScrollText size={20} strokeWidth={1.75} style={{ color: "var(--brand)" }} aria-hidden />
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}>{tr("auditoria.title", "Bitácora de actividad")}</h1>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            {tr("auditoria.subtitleClinic", "Quién hizo qué en tu clínica, cuándo y desde dónde.")}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div
        className="flex flex-wrap items-center gap-2"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)", padding: 12 }}
      >
        <div className="search-field" style={{ flex: 1, minWidth: 200, width: "auto" }}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder={tr("auditoria.searchPlaceholder", "Buscar (ID, IP, navegador)…")}
            aria-label={tr("auditoria.search", "Búsqueda libre")}
          />
        </div>
        <select className={SELECT_CLS} value={filters.role} onChange={(e) => patch({ role: e.target.value })} aria-label={tr("auditoria.role", "Rol")}>
          <option value="">{tr("auditoria.allRoles", "Todos los roles")}</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
        </select>
        <select className={SELECT_CLS} value={filters.action} onChange={(e) => patch({ action: e.target.value })} aria-label={tr("auditoria.action", "Acción")}>
          <option value="">{tr("auditoria.allActions", "Todas las acciones")}</option>
          {AUDIT_ACTION_OPTIONS.map((a) => <option key={a} value={a}>{actionMeta(a).label}</option>)}
        </select>
        <select className={SELECT_CLS} value={filters.entityType} onChange={(e) => patch({ entityType: e.target.value })} aria-label={tr("auditoria.entity", "Entidad")}>
          <option value="">{tr("auditoria.allEntities", "Todas las entidades")}</option>
          {AUDIT_ENTITY_OPTIONS.map((en) => <option key={en} value={en}>{entityLabel(en)}</option>)}
        </select>
        <input type="date" className={SELECT_CLS} value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} aria-label={tr("auditoria.dateFrom", "Fecha desde")} />
        <input type="date" className={SELECT_CLS} value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} aria-label={tr("auditoria.dateTo", "Fecha hasta")} />
        <div className="segment-new" role="group" aria-label={tr("auditoria.quickRange", "Rango rápido")}>
          {QUICK_RANGE_KEYS.map((k) => {
            const active = activeRange === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onClick={() => applyQuickRange(k)}
                className={`segment-new__btn${active ? " segment-new__btn--active" : ""}`}
              >
                {tr(RANGE_I18N[k], QUICK_RANGE_LABELS[k])}
              </button>
            );
          })}
        </div>
        {hasActiveFilters && (
          <button type="button" onClick={clearAll} className="btn-new btn-new--ghost btn-new--sm">
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden /> {tr("auditoria.clear", "Limpiar")}
          </button>
        )}
      </div>

      {/* Chips */}
      {(filters.userId || filters.entityId) && (
        <div className="flex flex-wrap gap-2">
          {filters.userId && <Chip label={`${tr("auditoria.user", "Usuario")}: ${filters.userId}`} onClear={() => patch({ userId: "" })} />}
          {filters.entityId && <Chip label={`${tr("auditoria.entity", "Entidad")}: ${filters.entityId}`} onClear={() => patch({ entityId: "" })} />}
        </div>
      )}

      {/* Tabla */}
      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>{tr("auditoria.colDate", "Fecha")}</th>
                <th>{tr("auditoria.colUser", "Usuario")}</th>
                <th>{tr("auditoria.colAction", "Acción")}</th>
                <th>{tr("auditoria.colEntity", "Entidad")}</th>
                <th>{tr("auditoria.colIp", "IP")}</th>
                <th style={{ textAlign: "right" }}>{tr("auditoria.colDetail", "Detalle")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap" style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(r.createdAt)}</td>
                  <td>
                    <button type="button" onClick={() => patch({ userId: r.userId })} title={tr("auditoria.filterByUser", "Filtrar por este usuario")} className="inline-flex items-center gap-2 text-left hover:underline">
                      <AvatarNew name={r.userName} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate" style={{ fontWeight: 600, color: "var(--text-1)" }}>{r.userName}</span>
                        {r.userRole && <span className="block" style={{ fontSize: 10, color: "var(--text-3)" }}>{ROLE_LABELS[r.userRole] ?? r.userRole}</span>}
                      </span>
                    </button>
                  </td>
                  <td><ActionCell action={r.action} /></td>
                  <td>
                    <button type="button" onClick={() => patch({ entityId: r.entityId })} title={tr("auditoria.filterByEntity", "Filtrar por esta entidad")} className="text-left hover:underline">
                      <span className="block" style={{ color: "var(--text-2)" }}>{entityLabel(r.entityType)}</span>
                      <span className="block max-w-[160px] truncate mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{r.entityId}</span>
                    </button>
                  </td>
                  <td className="mono whitespace-nowrap" style={{ fontSize: 11, color: "var(--text-3)" }}>{r.ipAddress ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" onClick={() => setDetail(r)} className="btn-new btn-new--secondary btn-new--sm">
                      {tr("auditoria.view", "Ver")}
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6}>
                  <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ padding: "40px 16px" }}>
                    <ScrollText size={20} strokeWidth={1.75} style={{ color: "var(--text-4)" }} aria-hidden />
                    <span style={{ fontSize: 13, color: "var(--text-3)" }}>
                      {error ? tr("auditoria.loadError", "No se pudo cargar la bitácora.") : tr("auditoria.empty", "Sin eventos para estos filtros.")}
                    </span>
                  </div>
                </td></tr>
              )}
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={6}>
                  <div className="text-center" style={{ padding: "40px 16px", fontSize: 13, color: "var(--text-3)" }}>{tr("auditoria.loading", "Cargando…")}</div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      <div
        className="pagination"
        style={{ borderTop: "none", background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-1)" }}
      >
        <div className="pagination__info">
          {tr("auditoria.pageOf", "Página")} {page} {tr("auditoria.of", "de")} {totalPages} · {total.toLocaleString("es-MX")} {tr("auditoria.events", "eventos")}
        </div>
        <div className="pagination__pages">
          <button type="button" className="btn-new btn-new--secondary btn-new--sm" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden /> {tr("auditoria.prev", "Anterior")}
          </button>
          <button type="button" className="btn-new btn-new--secondary btn-new--sm" disabled={page >= totalPages || isLoading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            {tr("auditoria.next", "Siguiente")} <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} tr={tr} />}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 max-w-[320px]"
      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 999, background: "var(--brand-soft)", border: "1px solid var(--border-soft)", color: "var(--text-1)" }}
    >
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label="Quitar filtro" className="text-[color:var(--text-3)] hover:text-[color:var(--text-1)]"><X size={14} strokeWidth={1.75} aria-hidden /></button>
    </span>
  );
}

function DetailModal({ row, onClose, tr }: { row: AuditLogRow; onClose: () => void; tr: (k: string, fb: string) => string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const am = actionMeta(row.action);
  const norm = normalizeChanges(row.changes);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="flex items-center gap-2 min-w-0">
            <BadgeNew tone={am.tone}>{am.label}</BadgeNew>
            <span className="modal__title truncate">{entityLabel(row.entityType)}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={tr("auditoria.close", "Cerrar")} className="btn-new btn-new--ghost btn-new--sm"><X size={16} strokeWidth={1.75} aria-hidden /></button>
        </div>

        <div className="modal__body space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Meta icon={Clock} label={tr("auditoria.colDate", "Fecha")} value={fmtDateTime(row.createdAt)} />
            <Meta icon={UserIcon} label={tr("auditoria.user", "Usuario")} value={`${row.userName}${row.userRole ? ` · ${ROLE_LABELS[row.userRole] ?? row.userRole}` : ""}`} sub={row.userEmail ?? undefined} />
            <Meta icon={Globe} label={tr("auditoria.colIp", "IP")} value={row.ipAddress ?? "—"} mono />
            <Meta icon={Tag} label={tr("auditoria.entity", "Entidad")} value={entityLabel(row.entityType)} sub={row.entityId} mono />
          </div>
          {row.userAgent && (
            <div className="break-words" style={{ fontSize: 11, color: "var(--text-3)" }}>
              <span className="font-semibold">{tr("auditoria.browser", "Navegador")}:</span> {row.userAgent}
            </div>
          )}

          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-1)" }}>
              {norm.kind === "created" ? tr("auditoria.created", "Datos creados")
                : norm.kind === "deleted" ? tr("auditoria.deleted", "Datos eliminados")
                : norm.kind === "updated" ? tr("auditoria.updated", "Campos modificados")
                : tr("auditoria.changes", "Cambios")}
            </div>
            {norm.fields.length === 0 ? (
              <div className="text-xs" style={{ color: "var(--text-3)" }}>{tr("auditoria.noChanges", "Sin detalle de cambios registrado.")}</div>
            ) : (
              <div style={{ overflowX: "auto", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)" }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>{tr("auditoria.field", "Campo")}</th>
                      <th>{tr("auditoria.before", "Antes")}</th>
                      <th>{tr("auditoria.after", "Después")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {norm.fields.map((f) => (
                      <tr key={f.field} className="align-top">
                        <td className="font-medium whitespace-nowrap">{f.field}</td>
                        <td className="max-w-[240px] break-words" style={{ color: "var(--text-3)" }}>{formatAuditValue(f.before)}</td>
                        <td className="max-w-[240px] break-words" style={{ color: norm.kind === "deleted" ? "var(--text-3)" : "var(--text-1)" }}>{formatAuditValue(f.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ icon: Icon, label, value, sub, mono }: {
  icon: typeof Clock; label: string; value: string; sub?: string; mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{label}</div>
        <div className={`text-[13px] break-words ${mono ? "mono" : ""}`} style={{ color: "var(--text-1)" }}>{value}</div>
        {sub && <div className="text-[11px] break-words" style={{ color: "var(--text-3)" }}>{sub}</div>}
      </div>
    </div>
  );
}
