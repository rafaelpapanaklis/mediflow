"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Play, Download, X, ChevronRight, Filter, ShieldAlert, Zap, Wrench, Database, Layout, type LucideIcon } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
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

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const SEVERITY_LABEL: Record<BugSeverity, string> = {
  critical: "Crítico", high: "Alto", medium: "Medio", low: "Bajo",
};
// Tono semántico del badge por severidad (dark-mode correcto vía .badge-new).
const SEVERITY_TONE: Record<BugSeverity, BadgeTone> = {
  critical: "danger", high: "warning", medium: "info", low: "neutral",
};
// Color-token por severidad para números/acentos (adapta a light/dark).
const SEVERITY_TOKEN: Record<BugSeverity, string> = {
  critical: "var(--danger)", high: "var(--warning)", medium: "var(--info)", low: "var(--text-3)",
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
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Auditoría de bugs
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Escaneo profundo: seguridad, rendimiento, calidad de código y frontend roto.
          </p>
        </div>
        <ButtonNew
          variant="primary"
          onClick={() => runAudit()}
          disabled={running}
          icon={<Play size={16} strokeWidth={1.75} aria-hidden />}
        >
          {running ? "Ejecutando…" : "Ejecutar auditoría completa"}
        </ButtonNew>
      </div>

      {/* Botones de auditoría parcial */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
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
              className="btn-new btn-new--secondary btn-new--sm"
            >
              <Icon size={14} strokeWidth={1.75} />
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
              <div className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Filter size={14} strokeWidth={1.75} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <select
                  value={activeSeverity}
                  onChange={(e) => setActiveSeverity(e.target.value as BugSeverity | "all")}
                  className="input-new"
                  style={{ width: "auto", minWidth: 150 }}
                  aria-label="Filtrar por severidad"
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
                  className="input-new"
                  style={{ width: "auto", minWidth: 150 }}
                  aria-label="Filtrar por sección"
                >
                  <option value="all">Todas las secciones</option>
                  <option value="backend">Backend</option>
                  <option value="security">Seguridad</option>
                  <option value="performance">Rendimiento</option>
                  <option value="quality">Calidad</option>
                  <option value="frontend">Frontend</option>
                </select>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>
                  {filtered.length} de {activeRun.items.length} items
                </span>
                <button type="button" onClick={exportJSON} className="btn-new btn-new--secondary btn-new--sm">
                  <Download size={13} strokeWidth={1.75} /> JSON
                </button>
                <button type="button" onClick={exportCSV} className="btn-new btn-new--secondary btn-new--sm">
                  <Download size={13} strokeWidth={1.75} /> CSV
                </button>
              </div>

              {/* Items */}
              {filtered.length === 0 ? (
                <div className="card" style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                  Sin hallazgos en estos filtros.
                </div>
              ) : (
                filtered.map((it) => {
                  const isOpen = expanded.has(it.fingerprint);
                  return (
                    <div key={it.fingerprint} className="card">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(expanded);
                          if (next.has(it.fingerprint)) next.delete(it.fingerprint);
                          else next.add(it.fingerprint);
                          setExpanded(next);
                        }}
                        className="hover:bg-muted/30"
                        style={{ width: "100%", textAlign: "left", padding: 12, display: "flex", alignItems: "center", gap: 12, background: "transparent", border: "none", cursor: "pointer", transition: "background var(--dur-1) var(--ease)" }}
                      >
                        <BadgeNew tone={SEVERITY_TONE[it.severity]}>{SEVERITY_LABEL[it.severity]}</BadgeNew>
                        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                          {it.category}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-1)" }}>{it.title}</span>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                          {it.file}{it.line ? `:${it.line}` : ""}
                        </span>
                        <ChevronRight
                          size={16}
                          strokeWidth={1.75}
                          style={{ color: "var(--text-3)", flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform var(--dur-1) var(--ease)" }}
                        />
                      </button>
                      {isOpen && (
                        <div style={{ borderTop: "1px solid var(--border-soft)", padding: 12, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-elev-2)" }}>
                          <div style={{ fontSize: 12 }}>
                            <strong style={{ color: "var(--text-1)" }}>Descripción:</strong>{" "}
                            <span style={{ color: "var(--text-2)" }}>{it.description}</span>
                          </div>
                          <div style={{ fontSize: 12 }}>
                            <strong style={{ color: "var(--text-1)" }}>Sugerencia:</strong>{" "}
                            <span style={{ color: "var(--text-2)" }}>{it.suggestion}</span>
                          </div>
                          {it.code_snippet && (
                            <pre className="mono scrollbar-thin" style={{ fontSize: 11, background: "var(--bg-elev)", padding: 8, borderRadius: 8, border: "1px solid var(--border-soft)", overflowX: "auto", margin: 0, color: "var(--text-2)" }}>
                              {it.code_snippet}
                            </pre>
                          )}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
                            <button type="button" onClick={() => dismissItem(it)} className="btn-new btn-new--ghost btn-new--sm">
                              <X size={13} strokeWidth={1.75} /> Marcar falso positivo
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
            <div className="card" style={{ padding: 48, textAlign: "center" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", margin: "0 0 4px" }}>
                Aún no hay run cargado
              </p>
              <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
                Ejecuta una auditoría arriba o selecciona un run del historial.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar de runs anteriores */}
        <div className="space-y-2">
          <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", margin: 0 }}>
            Historial
          </h2>
          {runs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>Sin runs aún.</div>
          ) : (
            runs.map((r) => {
              const isActive = activeRun?.id === r.id;
              const summary = r.summary;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => loadRun(r.id)}
                  className="hover:bg-muted/30"
                  style={{
                    width: "100%", textAlign: "left", padding: 12,
                    background: "var(--bg-elev)",
                    border: isActive ? "1px solid var(--brand)" : "1px solid var(--border-soft)",
                    borderRadius: "var(--radius)",
                    boxShadow: isActive ? "var(--shadow-2)" : "var(--shadow-1)",
                    cursor: "pointer",
                    transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                    {new Date(r.runAt).toLocaleString("es-MX", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.triggeredBy}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <Pill count={summary.bySeverity.critical} severity="critical" />
                    <Pill count={summary.bySeverity.high} severity="high" />
                    <Pill count={summary.bySeverity.medium} severity="medium" />
                    <Pill count={summary.bySeverity.low} severity="low" />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
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

function Pill({ count, severity }: { count: number; severity: BugSeverity }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex", minWidth: 20, justifyContent: "center",
        padding: "1px 6px", borderRadius: 6, fontWeight: 700, fontSize: 10,
        background: "var(--bg-elev-2)", color: SEVERITY_TOKEN[severity],
        opacity: count > 0 ? 1 : 0.4,
      }}
    >
      {count}
    </span>
  );
}

function SummaryHeader({ summary, run }: { summary: BugSummary; run: RunDetail }) {
  return (
    <div className="card grid grid-cols-2 md:grid-cols-5 gap-3" style={{ padding: 16 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-3)" }}>
          Score de salud
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums", color: scoreColor(summary.healthScore) }}>
          {summary.healthScore}<span style={{ fontSize: 14, color: "var(--text-3)" }}>/100</span>
        </div>
      </div>
      {(["critical", "high", "medium", "low"] as BugSeverity[]).map((s) => (
        <div key={s}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: SEVERITY_TOKEN[s] }}>
            {SEVERITY_LABEL[s]}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums", color: SEVERITY_TOKEN[s] }}>
            {summary.bySeverity[s]}
          </div>
        </div>
      ))}
      <div className="col-span-2 md:col-span-5" style={{ fontSize: 11, color: "var(--text-3)", borderTop: "1px solid var(--border-soft)", paddingTop: 8, marginTop: 4 }}>
        Run {run.id} · {Math.round((run.durationMs ?? 0) / 1000)}s · {summary.total} hallazgos · {run.triggeredBy}
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 85) return "var(--success)";
  if (score >= 65) return "var(--warning)";
  if (score >= 40) return "var(--warning)";
  return "var(--danger)";
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
