"use client";

import { useState } from "react";
import { Sparkles, AlertTriangle, CheckCircle2, X, RefreshCw, Loader2, Info } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────── */
/*  Tipos que devuelve POST /api/xrays/[id]/analyze                 */
/* ──────────────────────────────────────────────────────────────── */

type Severity = "alta" | "media" | "baja" | "informativo";

interface Finding {
  id: number;
  title: string;
  description: string;
  tooth?: string;
  severity: Severity;
  confidence: number;
}

interface AnalysisResult {
  summary: string;
  findings: Finding[];
  /** El endpoint puede devolver string o array — manejamos ambos */
  recommendations: string | string[];
}

interface AnalyzeResponse {
  analysis: AnalysisResult;
  tokensUsed: number;
  tokensRemaining: number;
  tokensLimit: number;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Mapas estáticos (Tailwind JIT los detecta)                      */
/* ──────────────────────────────────────────────────────────────── */

const severityStyle: Record<Severity, { bg: string; text: string; border: string; label: string }> = {
  alta:         { bg: "bg-rose-500/15",   text: "text-rose-400",   border: "border-rose-500/30",   label: "Severidad alta"   },
  media:        { bg: "bg-amber-500/15",  text: "text-amber-400",  border: "border-amber-500/30",  label: "Severidad media"  },
  baja:         { bg: "bg-emerald-500/15",text: "text-emerald-400",border: "border-emerald-500/30",label: "Severidad baja"   },
  informativo:  { bg: "bg-slate-500/15",  text: "text-slate-300",  border: "border-slate-500/30",  label: "Informativo"       },
};

function pickMaxSeverity(findings: Finding[]): Severity {
  const order: Severity[] = ["alta", "media", "baja", "informativo"];
  for (const s of order) if (findings.some((f) => f.severity === s)) return s;
  return "informativo";
}

function formatNumber(n: number): string {
  return n.toLocaleString("es-MX");
}

function tokenBarStyle(remaining: number, limit: number): { color: string; warn: string | null } {
  if (limit <= 0) return { color: "bg-slate-500", warn: null };
  const pct = remaining / limit;
  if (pct <= 0)    return { color: "bg-slate-600", warn: "Sin créditos de IA" };
  if (pct < 0.05)  return { color: "bg-rose-500",  warn: "Contacta a tu administrador para recargar" };
  if (pct < 0.20)  return { color: "bg-amber-500", warn: null };
  return { color: "bg-emerald-500", warn: null };
}

/* ──────────────────────────────────────────────────────────────── */
/*  Componente                                                       */
/* ──────────────────────────────────────────────────────────────── */

interface Props {
  fileId: string;
  mimeType: string;
  initialTokensRemaining: number;
  tokensLimit: number;
}

export function XrayAiPanel({ fileId, mimeType, initialTokensRemaining, tokensLimit }: Props) {
  const [remaining, setRemaining] = useState(initialTokensRemaining);
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<AnalysisResult | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<Date | null>(null);

  const isImage    = mimeType.startsWith("image/");
  const bar        = tokenBarStyle(remaining, tokensLimit);
  const disabled   = !isImage || loading || remaining <= 0;
  const pct        = tokensLimit > 0 ? Math.min(100, Math.max(0, (remaining / tokensLimit) * 100)) : 0;

  async function runAnalysis() {
    if (!isImage) {
      toast.error("Solo se pueden analizar imágenes");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/xrays/${fileId}/analyze`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          toast.error("Sin créditos de IA. Contacta a tu administrador para recargar");
          if (typeof data.tokensLimit === "number") setRemaining(0);
        } else if (res.status === 401 || res.status === 403) {
          toast.error("No tienes permiso para usar este feature");
        } else if (res.status === 502 || res.status === 503) {
          toast.error("Claude está temporalmente no disponible. Intenta en un momento");
        } else {
          toast.error(data?.error ?? "No se pudo analizar la radiografía. Intenta de nuevo");
        }
        return;
      }

      const payload = data as AnalyzeResponse;
      setResult(payload.analysis);
      setRemaining(payload.tokensRemaining);
      setAnalyzedAt(new Date());
      toast.success(`Análisis completado · ${formatNumber(payload.tokensUsed)} tokens`);
    } catch {
      toast.error("No se pudo analizar la radiografía. Intenta de nuevo");
    } finally {
      setLoading(false);
    }
  }

  function closeResult() {
    setResult(null);
    setAnalyzedAt(null);
  }

  /* Antes del análisis: solo botón + saldo */
  if (!result) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-foreground">Análisis de IA</h3>
              <p className="text-xs text-muted-foreground">
                Claude Sonnet revisa la imagen y propone hallazgos clínicos orientativos.
              </p>
            </div>
          </div>

          <Button
            onClick={runAnalysis}
            disabled={disabled}
            className="shrink-0 gap-2"
            aria-label="Analizar radiografía con IA"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Analizando..." : "Analizar con IA"}
          </Button>
        </div>

        {/* Barra de saldo */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">
              Saldo IA: {formatNumber(remaining)} / {formatNumber(tokensLimit)} tokens
            </span>
            {bar.warn && (
              <span
                className="flex items-center gap-1 text-rose-400"
                title={bar.warn}
              >
                <Info className="h-3 w-3" />
                {bar.warn}
              </span>
            )}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={cn("h-full transition-all", bar.color)}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {!isImage && (
          <p className="mt-3 text-xs text-amber-400">
            Este archivo no es una imagen — el análisis solo funciona con radiografías o fotos.
          </p>
        )}
      </div>
    );
  }

  /* Después del análisis */
  const maxSev   = pickMaxSeverity(result.findings);
  const severSty = severityStyle[maxSev];
  const recsArray =
    Array.isArray(result.recommendations)
      ? result.recommendations
      : result.recommendations
        ? [result.recommendations]
        : [];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
      {/* Sección 1 — Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-foreground">Análisis de IA</h3>
            {analyzedAt && (
              <p className="text-[11px] text-muted-foreground">
                {analyzedAt.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold", severSty.bg, severSty.text, severSty.border)}>
            <AlertTriangle className="h-3 w-3" />
            {severSty.label}
          </span>
          {result.findings.length > 0 && (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
              {result.findings.length} hallazgo{result.findings.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Sección 2 — Resumen general */}
      {result.summary && (
        <div className="mt-5">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Resumen</h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{result.summary}</p>
        </div>
      )}

      {/* Sección 3 — Hallazgos */}
      {result.findings.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hallazgos</h4>
          <ul className="space-y-2">
            {result.findings.map((f) => {
              const s = severityStyle[f.severity] ?? severityStyle.informativo;
              return (
                <li
                  key={f.id}
                  className={cn("flex gap-3 rounded-xl border p-3", s.border, "bg-white/[0.02]")}
                >
                  <AlertTriangle className={cn("h-4 w-4 shrink-0 translate-y-0.5", s.text)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{f.title}</p>
                      {f.tooth && (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                          {f.tooth}
                        </span>
                      )}
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", s.bg, s.text)}>
                        {f.severity}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Confianza: {f.confidence}%
                      </span>
                    </div>
                    {f.description && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.description}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Sección 4 — Recomendaciones */}
      {recsArray.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recomendaciones</h4>
          <ul className="space-y-1.5">
            {recsArray.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm text-foreground/90">
                <CheckCircle2 className="h-4 w-4 shrink-0 translate-y-0.5 text-emerald-400" />
                <span className="whitespace-pre-wrap leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sección 5 — Disclaimer */}
      <p className="mt-5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mr-1 inline h-3 w-3" />
        Este análisis es orientativo y no reemplaza el criterio profesional del doctor.
      </p>

      {/* Sección 6 — Acciones */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] text-muted-foreground">
          Saldo restante: {formatNumber(remaining)} / {formatNumber(tokensLimit)}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={closeResult}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            Cerrar análisis
          </Button>
          <Button
            size="sm"
            onClick={runAnalysis}
            disabled={disabled}
            className="gap-1.5"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Nuevo análisis
          </Button>
        </div>
      </div>
    </div>
  );
}
