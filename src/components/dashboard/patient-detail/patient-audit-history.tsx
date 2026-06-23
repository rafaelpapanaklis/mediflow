"use client";

import { useState } from "react";
import useSWR from "swr";
import { History, ChevronRight, User as UserIcon, Globe, Clock } from "lucide-react";
import { useTOptional } from "@/i18n/i18n-provider";
import {
  actionMeta, normalizeChanges, formatAuditValue, ROLE_LABELS, type AuditTone,
} from "@/lib/admin/audit-core";

// Fila cruda devuelta por GET /api/audit-log (rows de Prisma con join a user).
interface RawAuditRow {
  id: string;
  action: string;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { firstName: string | null; lastName: string | null; role: string | null } | null;
}

const TONE_CLASSES: Record<AuditTone, string> = {
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  danger: "bg-red-500/15 text-red-600 dark:text-red-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  brand: "bg-brand-500/15 text-brand-600 dark:text-brand-400",
  neutral: "bg-muted text-muted-foreground",
};

const fetcher = async (url: string): Promise<RawAuditRow[]> => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error((await r.text()) || "Error");
  return r.json();
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function userName(u: RawAuditRow["user"]): string {
  if (!u) return "—";
  const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return n || "—";
}

export function PatientAuditHistory({ patientId }: { patientId: string }) {
  const tt = useTOptional();
  const tr = (k: string, fb: string) => { const v = tt?.(k); return !v || v === k ? fb : v; };

  const { data, error, isLoading } = useSWR<RawAuditRow[]>(
    `/api/audit-log?entityType=patient&entityId=${encodeURIComponent(patientId)}`,
    fetcher,
  );
  const [open, setOpen] = useState<Set<string>>(new Set());

  const rows = data ?? [];

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <History size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-bold">{tr("auditoria.patientTitle", "Historial de cambios")}</h2>
        <span className="text-xs text-muted-foreground">
          {tr("auditoria.patientSubtitle", "Quién editó este expediente, cuándo y desde dónde")}
        </span>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground py-4">{tr("auditoria.loading", "Cargando…")}</div>}
      {error && !isLoading && (
        <div className="text-xs text-muted-foreground py-4">{tr("auditoria.loadError", "No se pudo cargar el historial.")}</div>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <div className="text-xs text-muted-foreground py-4">{tr("auditoria.patientEmpty", "Sin cambios registrados todavía.")}</div>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const am = actionMeta(r.action);
          const norm = normalizeChanges(r.changes);
          const isOpen = open.has(r.id);
          const canExpand = norm.fields.length > 0;
          return (
            <div key={r.id} className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => canExpand && toggle(r.id)}
                className={`w-full text-left p-3 flex items-center gap-3 ${canExpand ? "hover:bg-muted/30 cursor-pointer" : "cursor-default"}`}
                aria-expanded={canExpand ? isOpen : undefined}
              >
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${TONE_CLASSES[am.tone]}`}>{am.label}</span>
                <span className="flex items-center gap-1.5 text-xs text-foreground min-w-0">
                  <UserIcon size={12} className="text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{userName(r.user)}</span>
                  {r.user?.role && <span className="text-[10px] text-muted-foreground">({ROLE_LABELS[r.user.role] ?? r.user.role})</span>}
                </span>
                <span className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground ml-auto shrink-0">
                  <Clock size={11} /> {fmtDateTime(r.createdAt)}
                </span>
                {r.ipAddress && (
                  <span className="hidden md:flex items-center gap-1 text-[11px] text-muted-foreground font-mono shrink-0">
                    <Globe size={11} /> {r.ipAddress}
                  </span>
                )}
                {canExpand && (
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                )}
              </button>

              {/* Fecha/IP en móvil (no caben en la fila) */}
              <div className="sm:hidden px-3 pb-2 -mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><Clock size={11} /> {fmtDateTime(r.createdAt)}</span>
                {r.ipAddress && <span className="flex items-center gap-1 font-mono"><Globe size={11} /> {r.ipAddress}</span>}
              </div>

              {isOpen && canExpand && (
                <div className="border-t border-border p-3 bg-muted/20 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-1 pr-3 font-semibold">{tr("auditoria.field", "Campo")}</th>
                        <th className="pb-1 pr-3 font-semibold">{tr("auditoria.before", "Antes")}</th>
                        <th className="pb-1 font-semibold">{tr("auditoria.after", "Después")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {norm.fields.map((f) => (
                        <tr key={f.field} className="align-top">
                          <td className="py-1 pr-3 font-medium whitespace-nowrap">{f.field}</td>
                          <td className="py-1 pr-3 text-muted-foreground max-w-[220px] break-words">{formatAuditValue(f.before)}</td>
                          <td className={`py-1 max-w-[220px] break-words ${norm.kind === "deleted" ? "text-muted-foreground" : "text-foreground"}`}>{formatAuditValue(f.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
