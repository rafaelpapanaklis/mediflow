"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Play, Download, X, ChevronRight, Filter, ShieldAlert, Zap, Wrench, Database, Layout, type LucideIcon } from "lucide-react";
import type { BugItem, BugSeverity, BugSummary, ScannerSection } from "@/lib/bug-audit/types";

interface RunSummary {
  id: string;
  runAt: string;
  triggeredBy: string;
  durationMs: number | null;
  status: string;
  summary: BugSummary;
}

interface RunDetail extends RunSummary {
  items: BugItem[];
}

const SECTION_LABEL: Record<ScannerSection, string> = {
  backend: "Backend (DB)",
  security: "Seguridad",
  performance: "Rendimiento",
  quality: "Calidad",
  frontend: "Frontend",
};

const SECTION_ICON: Record<ScannerSection, LucideIcon> = {
  backend: Database,
  security: ShieldAlert,
  performance: Zap,
  quality: Wrench,
  frontend: Layout,
};

const SEVERITY_COLOR: Record<BugSeverity, { bg: string; fg: string; label: string }> = {
  critical: { bg: "rgba(239, 68, 68, 0.14)", fg: "#dc2626", label: "Crítico" },
  high:     { bg: "rgba(249, 115, 22, 0.14)", fg: "#ea580c", label: "Alto" },
  medium:   { bg: "rgba(234, 179, 8, 0.16)",  fg: "#a16207", label: "Medio" },
  low:      { bg: "rgba(100, 116, 139, 0.14)", fg: "#475569", label: "Bajo" },
};

export function BugAuditClient() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [activeSection, setActiveSection] = useState<ScannerSection | "all">("all");
  const [activeSeverity, setActiveSeverity] = useState<BugSeverity | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/bug-audit/runs", { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { runs: RunSummary[] };
      setRuns(data.runs);
    } catch (e) {
      toast.error("No se pudo cargar el historial");
    }
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  async function runAudit(sections?: ScannerSection[]) {
    if (running) return;
    setRunning(true);
    setActiveRun(null);
    const id = toast.loading(
      sections && sections.length > 0
        ? `Ejecutando auditoría parcial (${sections.join(", ")})…`
        : "Ejecutando auditoría completa (puede tomar 60–180s)…",
    );
    try {
      const r = await fetch("/api/admin/bug-audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sections ?? [] }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as RunDetail;
      setActiveRun(data);
      toast.success(`Auditoría completa: ${data.summary.total} hallazgos · score ${data.summary.healthScore}/100`, { id });
      await loadRuns();
    } catch (e) {
      toast.error(`Falló la auditoría: ${(e as Error).message}`, { id });
    } finally {
      setRunning(false);
    }
  }

  async function loadRun(runId: string) {
    try {
      const r = await fetch(`/api/admin/bug-audit/runs/${runId}`);
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as RunDetail;
      setActiveRun(data);
      setExpanded(new Set());
    } catch (e) {
      toast.error("No se pudo cargar el run");
    }
  }

  async function dismissItem(item: BugItem) {
    if (!activeRun) return;
    const reason = window.prompt("Motivo (opcional):") ?? "";
    try {
      const r = await fetch("/api/admin/bug-audit/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: item.fingerprint, reason: reason || null }),
      });
      if (!r.ok) throw new Error(await r.text());
      setActiveRun({
        ...activeRun,
        items: activeRun.items.filter((i) => i.fingerprint !== item.fingerprint),
      });
      toast.success("Marcado como falso positivo");
    } catch (e) {
      toast.error("No se pudo marcar");
    }
  }

  const filtered = useMemo(() => {
    if (!activeRun) return [];
    return activeRun.items.filter((it) => {
      if (activeSeverity !== "all" && it.severity !== activeSeverity) return false;
      if (activeSection !== "all") {
        // Mapeo categoría → sección.
        const sec = sectionForCategory(it.category);
        if (sec !== activeSection) return false;
      }
      return true;
    });
  }, [activeRun, activeSeverity, activeSection]);

  function exportJSON() {
    if (!activeRun) return;
    const blob = new Blob([JSON.stringify(activeRun, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bug-audit-${activeRun.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    if (!activeRun) return;
    const rows = [
      ["severity", "category", "file", "line", "title", "description", "suggestion"],
      ...activeRun.items.map((it) => [
        it.severity,
        it.category,
        it.file,
        it.line ?? "",
        it.title,
        it.description.replace(/\n/g, " "),
        it.suggestion.replace(/\n/g, " "),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bug-audit-${activeRun.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Auditoría de bugs</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Escaneo profundo: seguridad, rendimiento, calidad de código y frontend roto.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => runAudit()}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60"
          >
            <Play size={14} aria-hidden />
            {running ? "Ejecutando…" : "Ejecutar auditoría completa"}
          </button>
        </div>
      </div>

      {/* Botones de auditoría parcial */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mr-2">
          Solo:
        </span>
        {(["backend", "security", "performance", "quality", "frontend"] as ScannerSection[]).map((s) => {
          const Icon = SECTION_ICON[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => runAudit([s])}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-card border border-border rounded-lg hover:bg-muted/50 disabled:opacity-60"
            >
              <Icon size={11} />
              {SECTION_LABEL[s]}
            </button>
          );
        })}
      </div>

      {/* Resumen ejecutivo */}
      {activeRun && <SummaryHeader summary={activeRun.summary} run={activeRun} />}

      {/* Layout 2 cols: detail + sidebar de runs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Detail */}
        <div className="space-y-3">
          {activeRun ? (
            <>
              {/* Filters */}
              <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-2 flex-wrap">
                <Filter size={12} className="text-muted-foreground" />
                <select
                  value={activeSeverity}
                  onChange={(e) => setActiveSeverity(e.target.value as BugSeverity | "all")}
                  className="text-xs px-2 py-1 bg-background border border-border rounded"
                >
                  <option value="all">Todas las severidades</option>
                  <option value="critical">Crítico</option>
                  <option value="high">Alto</option>
                  <option value="medium">Medio</option>
                  <option value="low">Bajo</option>
                </select>
                <select
                  value={activeSection}
                  onChange={(e) => setActiveSection(e.target.value as ScannerSection | "all")}
                  className="text-xs px-2 py-1 bg-background border border-border rounded"
                >
                  <option value="all">Todas las secciones</option>
                  <option value="backend">Backend</option>
                  <option value="security">Seguridad</option>
                  <option value="performance">Rendimiento</option>
                  <option value="quality">Calidad</option>
                  <option value="frontend">Frontend</option>
                </select>
                <span className="text-xs text-muted-foreground ml-auto">
                  {filtered.length} de {activeRun.items.length} items
                </span>
                <button
                  type="button"
                  onClick={exportJSON}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-card border border-border rounded hover:bg-muted/50"
                >
                  <Download size={11} /> JSON
                </button>
                <button
                  type="button"
                  onClick={exportCSV}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-card border border-border rounded hover:bg-muted/50"
                >
                  <Download size={11} /> CSV
                </button>
              </div>

              {/* Items */}
              {filtered.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
                  Sin hallazgos en estos filtros.
                </div>
              ) : (
                filtered.map((it) => {
                  const isOpen = expanded.has(it.fingerprint);
                  const sev = SEVERITY_COLOR[it.severity];
                  return (
                    <div key={it.fingerprint} className="bg-card border border-border rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(expanded);
                          if (next.has(it.fingerprint)) next.delete(it.fingerprint);
                          else next.add(it.fingerprint);
                          setExpanded(next);
                        }}
                        className="w-full text-left p-3 flex items-center gap-3 hover:bg-muted/30"
                      >
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={{ background: sev.bg, color: sev.fg }}
                        >
                          {sev.label}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {it.category}
                        </span>
                        <span className="text-sm font-bold flex-1 truncate">{it.title}</span>
                        <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]">
                          {it.file}{it.line ? `:${it.line}` : ""}
                        </span>
                        <ChevronRight
                          size={14}
                          className="text-muted-foreground"
                          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                        />
                      </button>
                      {isOpen && (
                        <div className="border-t border-border p-3 space-y-2 bg-muted/20">
                          <div className="text-xs">
                            <strong className="text-foreground">Descripción:</strong>{" "}
                            <span className="text-muted-foreground">{it.description}</span>
                          </div>
                          <div className="text-xs">
                            <strong className="text-foreground">Sugerencia:</strong>{" "}
                            <span className="text-muted-foreground">{it.suggestion}</span>
                          </div>
                          {it.code_snippet && (
                            <pre className="text-[11px] font-mono bg-background p-2 rounded border border-border overflow-x-auto">
                              {it.code_snippet}
                            </pre>
                          )}
                          <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => dismissItem(it)}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-card border border-border rounded hover:bg-muted/50"
                            >
                              <X size={11} /> Marcar falso positivo
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          ) : (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <p className="text-sm font-semibold text-muted-foreground mb-1">
                Aún no hay run cargado
              </p>
              <p className="text-xs text-muted-foreground">
                Ejecuta una auditoría arriba o selecciona un run del historial.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar de runs anteriores */}
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Historial
          </h2>
          {runs.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sin runs aún.</div>
          ) : (
            runs.map((r) => {
              const isActive = activeRun?.id === r.id;
              const summary = r.summary;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => loadRun(r.id)}
                  className={`w-full text-left p-3 bg-card border rounded-lg hover:bg-muted/30 ${
                    isActive ? "border-brand-600 ring-1 ring-brand-600" : "border-border"
                  }`}
                >
                  <div className="text-xs font-semibold">
                    {new Date(r.runAt).toLocaleString("es-MX", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.triggeredBy}</div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[10px]">
                    <Pill count={summary.bySeverity.critical} color={SEVERITY_COLOR.critical} />
                    <Pill count={summary.bySeverity.high} color={SEVERITY_COLOR.high} />
                    <Pill count={summary.bySeverity.medium} color={SEVERITY_COLOR.medium} />
                    <Pill count={summary.bySeverity.low} color={SEVERITY_COLOR.low} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Score {summary.healthScore}/100 · {Math.round((r.durationMs ?? 0) / 1000)}s
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({ count, color }: { count: number; color: { bg: string; fg: string } }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded font-bold"
      style={{ background: color.bg, color: color.fg, opacity: count > 0 ? 1 : 0.4 }}
    >
      {count}
    </span>
  );
}

function SummaryHeader({ summary, run }: { summary: BugSummary; run: RunDetail }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Score de salud
        </div>
        <div className="text-2xl font-bold mt-1" style={{ color: scoreColor(summary.healthScore) }}>
          {summary.healthScore}<span className="text-sm text-muted-foreground">/100</span>
        </div>
      </div>
      {(["critical", "high", "medium", "low"] as BugSeverity[]).map((s) => {
        const c = SEVERITY_COLOR[s];
        return (
          <div key={s}>
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: c.fg }}>
              {c.label}
            </div>
            <div className="text-2xl font-bold mt-1" style={{ color: c.fg }}>
              {summary.bySeverity[s]}
            </div>
          </div>
        );
      })}
      <div className="col-span-2 md:col-span-5 text-[11px] text-muted-foreground border-t border-border pt-2 mt-1">
        Run {run.id} · {Math.round((run.durationMs ?? 0) / 1000)}s · {summary.total} hallazgos · {run.triggeredBy}
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 85) return "#16a34a";
  if (score >= 65) return "#a16207";
  if (score >= 40) return "#ea580c";
  return "#dc2626";
}

function sectionForCategory(category: BugItem["category"]): ScannerSection {
  // Backend (DB structural + jobs/migraciones de los extras).
  if (["rls", "schema-drift", "fk-orphans", "deps", "crons", "backups", "migrations"].includes(category)) return "backend";
  // Security (auth, AppSec + extras: webhooks, storage, IA, env, ARCO compliance).
  if (["auth", "idor", "mass-assignment", "sql-injection", "xss", "secrets", "ssrf", "rate-limit", "headers", "cors", "cookies", "passwords", "tokens", "uploads", "open-redirect", "pii-logging", "audit-log", "fiel", "webhooks", "storage", "ai", "env", "arco"].includes(category)) return "security";
  // Performance.
  if (["n-plus-one", "no-select", "indexes", "pool", "bundle", "images", "dynamic-imports", "cache", "useeffect-leak", "virtualization"].includes(category)) return "performance";
  // Quality (incluye tests/coverage de los extras).
  if (["ts-any", "fire-and-forget", "swallowed-error", "race-condition", "react-hooks", "console-log", "todo", "dead-code", "tests"].includes(category)) return "quality";
  // Frontend (broken-* + a11y de los extras).
  return "frontend";
}
