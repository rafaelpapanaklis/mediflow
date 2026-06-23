"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ScrollText, Search, Filter, ChevronLeft, ChevronRight, X, RotateCcw,
  Building2, User as UserIcon, Tag, Clock, Globe, Layers,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  AUDIT_ACTION_OPTIONS, AUDIT_ENTITY_OPTIONS, ROLE_OPTIONS, ROLE_LABELS,
  actionMeta, entityLabel, normalizeChanges, formatAuditValue,
  QUICK_RANGE_KEYS, QUICK_RANGE_LABELS, quickRangeValues, matchQuickRange,
  type QuickRangeKey, type AuditLogRow, type AuditQueryResult,
} from "@/lib/admin/audit-core";

interface ClinicOpt { id: string; name: string }

const PAGE_SIZE = 50;

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
  clinicId: string; role: string; action: string; entityType: string;
  userId: string; entityId: string; dateFrom: string; dateTo: string;
}
const EMPTY: Filters = {
  clinicId: "", role: "", action: "", entityType: "",
  userId: "", entityId: "", dateFrom: "", dateTo: "",
};

export function AuditoriaClient({ clinics }: { clinics: ClinicOpt[] }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [qInput, setQInput] = useState("");
  const q = useDebounce(qInput, 350);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  // Cualquier cambio de filtro vuelve a la página 1.
  useEffect(() => { setPage(1); }, [filters, q]);

  const key = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.clinicId) p.set("clinicId", filters.clinicId);
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
    return `/api/admin/auditoria?${p.toString()}`;
  }, [filters, q, page]);

  const { data, error, isLoading } = useSWR<AuditQueryResult>(key, fetcher, { keepPreviousData: true });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasActiveFilters =
    Object.values(filters).some(Boolean) || q.trim().length > 0;

  function patch(p: Partial<Filters>) { setFilters((f) => ({ ...f, ...p })); }
  function clearAll() { setFilters(EMPTY); setQInput(""); }

  // Rango rápido: rellena Desde/Hasta y dispara la búsqueda al instante (SWR re-fetch por cambio de key).
  const activeRange = matchQuickRange(filters.dateFrom, filters.dateTo);
  function applyQuickRange(k: QuickRangeKey) { patch(quickRangeValues(k)); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ScrollText size={20} style={{ color: "var(--brand)" }} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--text-1)" }}>Auditoría</h1>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            Bitácora global de la plataforma — quién hizo qué, cuándo y desde dónde.
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <KpiCard label="Eventos (filtro)" value={total.toLocaleString("es-MX")} icon={Layers} />
        <KpiCard label="Página" value={`${page} / ${totalPages}`} icon={ScrollText} />
        <KpiCard label="Por página" value={String(PAGE_SIZE)} icon={Filter} />
      </div>

      {/* Filtros */}
      <CardNew>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input
              className="input-new"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Buscar (ID de entidad, IP, navegador)…"
              style={{ width: "100%", paddingLeft: 30 }}
              aria-label="Búsqueda libre"
            />
          </div>
          <select className="input-new" value={filters.clinicId} onChange={(e) => patch({ clinicId: e.target.value })} aria-label="Clínica">
            <option value="">Todas las clínicas</option>
            {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input-new" value={filters.role} onChange={(e) => patch({ role: e.target.value })} aria-label="Rol">
            <option value="">Todos los roles</option>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
          </select>
          <select className="input-new" value={filters.action} onChange={(e) => patch({ action: e.target.value })} aria-label="Acción">
            <option value="">Todas las acciones</option>
            {AUDIT_ACTION_OPTIONS.map((a) => <option key={a} value={a}>{actionMeta(a).label}</option>)}
          </select>
          <select className="input-new" value={filters.entityType} onChange={(e) => patch({ entityType: e.target.value })} aria-label="Entidad">
            <option value="">Todas las entidades</option>
            {AUDIT_ENTITY_OPTIONS.map((en) => <option key={en} value={en}>{entityLabel(en)}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
            Desde
            <input type="date" className="input-new" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} aria-label="Fecha desde" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
            Hasta
            <input type="date" className="input-new" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} aria-label="Fecha hasta" />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Rango rápido">
            {QUICK_RANGE_KEYS.map((k) => {
              const active = activeRange === k;
              return (
                <button
                  key={k}
                  type="button"
                  className={`btn-new btn-new--sm ${active ? "btn-new--primary" : "btn-new--secondary"}`}
                  aria-pressed={active}
                  onClick={() => applyQuickRange(k)}
                >
                  {QUICK_RANGE_LABELS[k]}
                </button>
              );
            })}
          </div>
          {hasActiveFilters && (
            <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={clearAll}>
              <RotateCcw size={13} /> Limpiar
            </button>
          )}
        </div>

        {/* Chips de filtros exactos (set al clicar celdas) */}
        {(filters.userId || filters.entityId) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {filters.userId && (
              <FilterChip label={`Usuario: ${filters.userId}`} onClear={() => patch({ userId: "" })} />
            )}
            {filters.entityId && (
              <FilterChip label={`Entidad: ${filters.entityId}`} onClear={() => patch({ entityId: "" })} />
            )}
          </div>
        )}
      </CardNew>

      {/* Tabla */}
      <CardNew noPad>
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Clínica</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>IP</th>
                <th style={{ textAlign: "right" }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const am = actionMeta(r.action);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-2)" }}>{fmtDateTime(r.createdAt)}</td>
                    <td style={{ color: "var(--text-2)" }}>{r.clinicName ?? <span style={{ color: "var(--text-4)" }}>—</span>}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => patch({ userId: r.userId })}
                        title="Filtrar por este usuario"
                        style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "var(--text-1)" }}
                      >
                        <div style={{ fontWeight: 500 }}>{r.userName}</div>
                        {r.userRole && (
                          <div style={{ fontSize: 10, color: "var(--text-3)" }}>{ROLE_LABELS[r.userRole] ?? r.userRole}</div>
                        )}
                      </button>
                    </td>
                    <td><BadgeNew tone={am.tone}>{am.label}</BadgeNew></td>
                    <td>
                      <button
                        type="button"
                        onClick={() => patch({ entityId: r.entityId })}
                        title="Filtrar por esta entidad"
                        style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "var(--text-2)" }}
                      >
                        <span>{entityLabel(r.entityType)}</span>
                        <span style={{ fontSize: 10, color: "var(--text-4)", display: "block", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.entityId}</span>
                      </button>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-3)" }}>{r.ipAddress ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={() => setDetail(r)}>Ver</button>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                    {error ? "No se pudo cargar la bitácora." : "Sin eventos para estos filtros."}
                  </td>
                </tr>
              )}
              {isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>Cargando…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardNew>

      {/* Paginación */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          {total.toLocaleString("es-MX")} evento{total === 1 ? "" : "s"} · página {page} de {totalPages}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn-new btn-new--secondary btn-new--sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <button
            type="button"
            className="btn-new btn-new--secondary btn-new--sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11,
      padding: "4px 8px", borderRadius: 999, background: "var(--brand-soft)",
      color: "var(--text-1)", border: "1px solid var(--border-soft)", maxWidth: 320,
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <button type="button" onClick={onClear} aria-label="Quitar filtro" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", display: "inline-flex" }}>
        <X size={12} />
      </button>
    </span>
  );
}

function DetailModal({ row, onClose }: { row: AuditLogRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const am = actionMeta(row.action);
  const norm = normalizeChanges(row.changes);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Detalle del evento">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BadgeNew tone={am.tone}>{am.label}</BadgeNew>
            <span className="modal__title">{entityLabel(row.entityType)}</span>
          </div>
          <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Metadatos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <MetaItem icon={Clock} label="Fecha" value={fmtDateTime(row.createdAt)} />
            <MetaItem icon={Building2} label="Clínica" value={row.clinicName ?? "—"} />
            <MetaItem icon={UserIcon} label="Usuario" value={`${row.userName}${row.userRole ? ` · ${ROLE_LABELS[row.userRole] ?? row.userRole}` : ""}`} sub={row.userEmail ?? undefined} />
            <MetaItem icon={Globe} label="IP" value={row.ipAddress ?? "—"} mono />
            <MetaItem icon={Tag} label="Entidad" value={`${entityLabel(row.entityType)}`} sub={row.entityId} mono />
          </div>
          {row.userAgent && (
            <div style={{ fontSize: 11, color: "var(--text-4)", wordBreak: "break-word" }}>
              <strong style={{ color: "var(--text-3)" }}>Navegador:</strong> {row.userAgent}
            </div>
          )}

          {/* Cambios */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
              {norm.kind === "created" ? "Datos creados"
                : norm.kind === "deleted" ? "Datos eliminados"
                : norm.kind === "updated" ? "Campos modificados"
                : "Cambios"}
            </div>
            {norm.fields.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>Sin detalle de cambios registrado.</div>
            ) : (
              <div style={{ overflowX: "auto", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Antes</th>
                      <th>Después</th>
                    </tr>
                  </thead>
                  <tbody>
                    {norm.fields.map((f) => (
                      <tr key={f.field}>
                        <td style={{ fontWeight: 500, color: "var(--text-1)", whiteSpace: "nowrap" }}>{f.field}</td>
                        <td style={{ color: "var(--text-3)", maxWidth: 240, wordBreak: "break-word" }}>{formatAuditValue(f.before)}</td>
                        <td style={{ color: norm.kind === "deleted" ? "var(--text-3)" : "var(--text-1)", maxWidth: 240, wordBreak: "break-word" }}>{formatAuditValue(f.after)}</td>
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

function MetaItem({ icon: Icon, label, value, sub, mono }: {
  icon: typeof Clock; label: string; value: string; sub?: string; mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Icon size={14} style={{ color: "var(--text-3)", marginTop: 2, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: 13, color: "var(--text-1)", fontFamily: mono ? "var(--font-mono, monospace)" : undefined, wordBreak: "break-word" }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-4)", wordBreak: "break-word" }}>{sub}</div>}
      </div>
    </div>
  );
}
