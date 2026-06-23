"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ScrollText, Search, ChevronLeft, ChevronRight, X, RotateCcw,
  User as UserIcon, Tag, Clock, Globe,
} from "lucide-react";
import { useTOptional } from "@/i18n/i18n-provider";
import {
  AUDIT_ACTION_OPTIONS, AUDIT_ENTITY_OPTIONS, ROLE_OPTIONS, ROLE_LABELS,
  actionMeta, entityLabel, normalizeChanges, formatAuditValue,
  type AuditTone, type AuditLogRow, type AuditQueryResult,
} from "@/lib/admin/audit-core";

const PAGE_SIZE = 50;

const TONE_CLASSES: Record<AuditTone, string> = {
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  danger: "bg-red-500/15 text-red-600 dark:text-red-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  brand: "bg-brand-500/15 text-brand-600 dark:text-brand-400",
  neutral: "bg-muted text-muted-foreground",
};

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

const SELECT_CLS =
  "text-xs px-2 py-2 bg-background border border-border rounded-lg text-foreground";

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

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ScrollText size={20} className="text-brand-600 dark:text-brand-400" />
        <div>
          <h1 className="text-xl font-bold">{tr("auditoria.title", "Bitácora de actividad")}</h1>
          <p className="text-xs text-muted-foreground">
            {tr("auditoria.subtitleClinic", "Quién hizo qué en tu clínica, cuándo y desde dónde.")}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder={tr("auditoria.searchPlaceholder", "Buscar (ID, IP, navegador)…")}
            className="w-full text-xs pl-8 pr-2 py-2 bg-background border border-border rounded-lg text-foreground"
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
        {hasActiveFilters && (
          <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-2 bg-card border border-border rounded-lg hover:bg-muted/50">
            <RotateCcw size={13} /> {tr("auditoria.clear", "Limpiar")}
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
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-3 font-semibold">{tr("auditoria.colDate", "Fecha")}</th>
                <th className="p-3 font-semibold">{tr("auditoria.colUser", "Usuario")}</th>
                <th className="p-3 font-semibold">{tr("auditoria.colAction", "Acción")}</th>
                <th className="p-3 font-semibold">{tr("auditoria.colEntity", "Entidad")}</th>
                <th className="p-3 font-semibold">{tr("auditoria.colIp", "IP")}</th>
                <th className="p-3 font-semibold text-right">{tr("auditoria.colDetail", "Detalle")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const am = actionMeta(r.action);
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
                    <td className="p-3">
                      <button type="button" onClick={() => patch({ userId: r.userId })} title={tr("auditoria.filterByUser", "Filtrar por este usuario")} className="text-left hover:underline">
                        <div className="font-medium text-foreground">{r.userName}</div>
                        {r.userRole && <div className="text-[10px] text-muted-foreground">{ROLE_LABELS[r.userRole] ?? r.userRole}</div>}
                      </button>
                    </td>
                    <td className="p-3">
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${TONE_CLASSES[am.tone]}`}>{am.label}</span>
                    </td>
                    <td className="p-3">
                      <button type="button" onClick={() => patch({ entityId: r.entityId })} title={tr("auditoria.filterByEntity", "Filtrar por esta entidad")} className="text-left hover:underline">
                        <div className="text-foreground">{entityLabel(r.entityType)}</div>
                        <div className="text-[10px] text-muted-foreground max-w-[160px] truncate">{r.entityId}</div>
                      </button>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-muted-foreground">{r.ipAddress ?? "—"}</td>
                    <td className="p-3 text-right">
                      <button type="button" onClick={() => setDetail(r)} className="text-xs font-semibold px-2 py-1 bg-card border border-border rounded hover:bg-muted/50">
                        {tr("auditoria.view", "Ver")}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">
                  {error ? tr("auditoria.loadError", "No se pudo cargar la bitácora.") : tr("auditoria.empty", "Sin eventos para estos filtros.")}
                </td></tr>
              )}
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">{tr("auditoria.loading", "Cargando…")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {tr("auditoria.pageOf", "Página")} {page} {tr("auditoria.of", "de")} {totalPages} · {total.toLocaleString("es-MX")} {tr("auditoria.events", "eventos")}
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 bg-card border border-border rounded-lg hover:bg-muted/50 disabled:opacity-50">
            <ChevronLeft size={14} /> {tr("auditoria.prev", "Anterior")}
          </button>
          <button type="button" disabled={page >= totalPages || isLoading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 bg-card border border-border rounded-lg hover:bg-muted/50 disabled:opacity-50">
            {tr("auditoria.next", "Siguiente")} <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} tr={tr} />}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-brand-500/10 border border-border text-foreground max-w-[320px]">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label="Quitar filtro" className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
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
    <div className="fixed inset-0 z-[100] grid place-items-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-card border border-border rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${TONE_CLASSES[am.tone]}`}>{am.label}</span>
            <span className="text-sm font-bold">{entityLabel(row.entityType)}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={tr("auditoria.close", "Cerrar")} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Meta icon={Clock} label={tr("auditoria.colDate", "Fecha")} value={fmtDateTime(row.createdAt)} />
            <Meta icon={UserIcon} label={tr("auditoria.user", "Usuario")} value={`${row.userName}${row.userRole ? ` · ${ROLE_LABELS[row.userRole] ?? row.userRole}` : ""}`} sub={row.userEmail ?? undefined} />
            <Meta icon={Globe} label={tr("auditoria.colIp", "IP")} value={row.ipAddress ?? "—"} mono />
            <Meta icon={Tag} label={tr("auditoria.entity", "Entidad")} value={entityLabel(row.entityType)} sub={row.entityId} mono />
          </div>
          {row.userAgent && (
            <div className="text-[11px] text-muted-foreground break-words">
              <span className="font-semibold">{tr("auditoria.browser", "Navegador")}:</span> {row.userAgent}
            </div>
          )}

          <div>
            <div className="text-xs font-semibold mb-2">
              {norm.kind === "created" ? tr("auditoria.created", "Datos creados")
                : norm.kind === "deleted" ? tr("auditoria.deleted", "Datos eliminados")
                : norm.kind === "updated" ? tr("auditoria.updated", "Campos modificados")
                : tr("auditoria.changes", "Cambios")}
            </div>
            {norm.fields.length === 0 ? (
              <div className="text-xs text-muted-foreground">{tr("auditoria.noChanges", "Sin detalle de cambios registrado.")}</div>
            ) : (
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="p-2 font-semibold">{tr("auditoria.field", "Campo")}</th>
                      <th className="p-2 font-semibold">{tr("auditoria.before", "Antes")}</th>
                      <th className="p-2 font-semibold">{tr("auditoria.after", "Después")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {norm.fields.map((f) => (
                      <tr key={f.field} className="border-b border-border last:border-0 align-top">
                        <td className="p-2 font-medium whitespace-nowrap">{f.field}</td>
                        <td className="p-2 text-muted-foreground max-w-[240px] break-words">{formatAuditValue(f.before)}</td>
                        <td className={`p-2 max-w-[240px] break-words ${norm.kind === "deleted" ? "text-muted-foreground" : "text-foreground"}`}>{formatAuditValue(f.after)}</td>
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
      <Icon size={14} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-[13px] text-foreground break-words ${mono ? "font-mono" : ""}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground break-words">{sub}</div>}
      </div>
    </div>
  );
}
