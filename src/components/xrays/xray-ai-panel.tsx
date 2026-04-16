"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles, AlertTriangle, CheckCircle2, RefreshCw, Loader2, Info, Archive, Coins,
} from "lucide-react";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────── */
/*  Tipos                                                            */
/* ──────────────────────────────────────────────────────────────── */

type SeverityCanonical = "low" | "medium" | "high" | "critical" | "informational";

/** Unión que acepta severity en inglés (nuevo, tool use) o español (viejo, pre-tool) */
type Severity =
  | SeverityCanonical
  | "alta" | "media" | "baja" | "informativo";

interface Finding {
  id: string | number;
  title: string;
  description: string;
  tooth?: string | null;
  severity: Severity;
  confidence: number;            // 0-1 (nuevo) o 0-100 (viejo) — normalizado al renderizar
  confidenceRationale?: string | null;
}

interface AnalysisResult {
  summary: string;
  findings: Finding[];
  recommendations: string | string[];
}

interface AnalyzeResponse {
  analysis: AnalysisResult;
  severity?: Severity;
  confidence?: number;
  tokensUsed: number;
  originalTokensUsed?: number;
  tokensRemaining: number;
  tokensLimit: number;
  cached: boolean;
  analyzedAt: string;
  modelUsed?: string;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Mapas estáticos (Tailwind JIT)                                   */
/* ──────────────────────────────────────────────────────────────── */

const severityStyle: Record<SeverityCanonical, { bg: string; text: string; border: string; icon: string; label: string }> = {
  low:           { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", icon: "text-emerald-400", label: "Leve"       },
  medium:        { bg: "bg-yellow-500/15",  text: "text-yellow-400",  border: "border-yellow-500/30",  icon: "text-yellow-400",  label: "Moderada"   },
  high:          { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/30",  icon: "text-orange-400",  label: "Alta"       },
  critical:      { bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30",     icon: "text-red-400",     label: "Crítica"    },
  informational: { bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/30",    icon: "text-blue-400",    label: "Informativo" },
};

/* ──────────────────────────────────────────────────────────────── */
/*  Normalizadores (tolerantes a formato viejo/nuevo)                */
/* ──────────────────────────────────────────────────────────────── */

function normalizeSeverity(s: Severity | string | undefined | null): SeverityCanonical {
  const lc = String(s ?? "").toLowerCase().trim();
  if (lc === "critical")                               return "critical";
  if (lc === "high"    || lc === "alta")               return "high";
  if (lc === "medium"  || lc === "media")              return "medium";
  if (lc === "low"     || lc === "baja")               return "low";
  if (lc === "informational" || lc === "informativo") return "informational";
  return "informational";
}

/** Devuelve siempre decimal 0-1 aunque el input sea 0-100 (records viejos) */
function normalizeConfidence(c: number | undefined | null): number {
  if (typeof c !== "number" || Number.isNaN(c)) return 0;
  if (c > 1) return Math.max(0, Math.min(1, c / 100));
  return Math.max(0, Math.min(1, c));
}

function confidencePercent(c: number | undefined | null): number {
  return Math.round(normalizeConfidence(c) * 100);
}

function pickMaxSeverity(findings: Finding[]): SeverityCanonical {
  const order: SeverityCanonical[] = ["critical", "high", "medium", "low", "informational"];
  const canonicals = findings.map((f) => normalizeSeverity(f.severity));
  for (const s of order) if (canonicals.includes(s)) return s;
  return "informational";
}

/* ──────────────────────────────────────────────────────────────── */
/*  Parser defensivo — recupera records viejos con JSON crudo en    */
/*  el campo summary. Solo se usa al leer del GET, no al guardar.   */
/* ──────────────────────────────────────────────────────────────── */

function looksLikeCrudeJson(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return true;
  if (trimmed.startsWith("```")) return true;
  if (/["']?(summary|findings|recommendations)["']?\s*:/.test(trimmed)) return true;
  return false;
}

function tryReparseBrokenAnalysis(input: AnalysisResult): {
  fixed: AnalysisResult;
  wasBroken: boolean;
  couldFix: boolean;
} {
  if (!looksLikeCrudeJson(input.summary)) {
    return { fixed: input, wasBroken: false, couldFix: true };
  }

  try {
    // Strip markdown fences
    let cleaned = input.summary
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    // Strip JS comments
    cleaned = cleaned.replace(/\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // Strip trailing commas antes de ] o }
    cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
    // Extract outer object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found");

    const parsed = JSON.parse(match[0]);
    if (typeof parsed.summary !== "string") {
      throw new Error("Parsed object has no summary string");
    }

    return {
      fixed: {
        summary:         parsed.summary,
        findings:        Array.isArray(parsed.findings) ? parsed.findings : [],
        recommendations: parsed.recommendations ?? "",
      },
      wasBroken: true,
      couldFix: true,
    };
  } catch {
    return { fixed: input, wasBroken: true, couldFix: false };
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString("es-MX");
}

function balanceColorClasses(remaining: number, limit: number): { text: string; tooltip: string | null } {
  if (limit <= 0) return { text: "text-muted-foreground", tooltip: null };
  const pct = remaining / limit;
  if (pct <= 0)   return { text: "text-muted-foreground", tooltip: "Sin créditos — contacta a tu administrador" };
  if (pct < 0.05) return { text: "text-rose-400",  tooltip: "Saldo crítico — contacta a tu administrador para recargar" };
  if (pct < 0.20) return { text: "text-amber-400", tooltip: null };
  return { text: "text-emerald-400", tooltip: null };
}

/* ──────────────────────────────────────────────────────────────── */
/*  Componente principal                                             */
/* ──────────────────────────────────────────────────────────────── */

interface Props {
  fileId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  initialTokensRemaining: number;
  tokensLimit: number;
}

export function XrayAiPanel({
  fileId, fileUrl, fileName, mimeType,
  initialTokensRemaining, tokensLimit,
}: Props) {
  const [open, setOpen]                       = useState(false);
  const [remaining, setRemaining]             = useState(initialTokensRemaining);
  const [loadingInitial, setLoadingInitial]   = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [result, setResult]                   = useState<AnalysisResult | null>(null);
  const [analyzedAt, setAnalyzedAt]           = useState<Date | null>(null);
  const [cached, setCached]                   = useState(false);
  const [originalTokens, setOriginalTokens]   = useState<number | null>(null);
  const [currentSpent, setCurrentSpent]       = useState<number | null>(null);
  const [brokenLegacy, setBrokenLegacy]       = useState(false); // record viejo con formato irrecuperable

  const isImage    = mimeType.startsWith("image/");
  const outOfCreds = remaining <= 0;
  const cls        = balanceColorClasses(remaining, tokensLimit);

  /* Carga inicial: GET cache de análisis al montar / cambiar fileId.
     Nota: las notas del doctor NO vienen de aquí — vienen como props del parent
     (leídas del PatientFile en el server component). */
  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    setResult(null);
    setAnalyzedAt(null);
    setCached(false);
    setOriginalTokens(null);
    setCurrentSpent(null);
    setBrokenLegacy(false);
    setRemaining(initialTokensRemaining);

    if (!isImage) {
      setLoadingInitial(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/xrays/${fileId}/analyze`, { method: "GET" });
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res.json()) as AnalyzeResponse;
        if (cancelled) return;

        const { fixed, wasBroken, couldFix } = tryReparseBrokenAnalysis(data.analysis);
        setResult(fixed);
        setBrokenLegacy(wasBroken && !couldFix);
        setAnalyzedAt(new Date(data.analyzedAt));
        setCached(true);
        setOriginalTokens(data.tokensUsed);
        setRemaining(data.tokensRemaining);
      } catch {
        /* silencioso — el usuario puede intentar con el botón */
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();

    return () => { cancelled = true; };
  }, [fileId, isImage, initialTokensRemaining]);

  const runAnalysis = useCallback(async (refresh: boolean) => {
    if (!isImage) {
      toast.error("Solo se pueden analizar imágenes");
      return;
    }
    if (refresh) {
      const ok = window.confirm("Esto consumirá tokens IA nuevamente. ¿Continuar?");
      if (!ok) return;
    }

    setLoadingAnalysis(true);
    try {
      const qs  = refresh ? "?refresh=true" : "";
      const res = await fetch(`/api/xrays/${fileId}/analyze${qs}`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          toast.error("Sin créditos de IA. Contacta a tu administrador para recargar");
          setRemaining(0);
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
      const { fixed, wasBroken, couldFix } = tryReparseBrokenAnalysis(payload.analysis);

      setResult(fixed);
      setBrokenLegacy(wasBroken && !couldFix);
      setRemaining(payload.tokensRemaining);
      setAnalyzedAt(new Date(payload.analyzedAt));
      setCached(payload.cached);
      setOriginalTokens(payload.cached ? (payload.originalTokensUsed ?? payload.tokensUsed) : payload.tokensUsed);
      setCurrentSpent(payload.cached ? 0 : payload.tokensUsed);

      if (payload.cached) {
        toast.success("Análisis cargado desde caché · 0 tokens");
      } else {
        toast.success(`Análisis completado · ${formatNumber(payload.tokensUsed)} tokens`);
      }
    } catch {
      toast.error("No se pudo analizar la radiografía. Intenta de nuevo");
    } finally {
      setLoadingAnalysis(false);
    }
  }, [fileId, isImage]);

  function handleButtonClick() {
    setOpen(true);
    if (!result && !loadingAnalysis && isImage && !outOfCreds) {
      runAnalysis(false);
    }
  }

  const buttonLabel = result ? "Ver análisis IA" : "Analizar con IA";
  const disabledBtn = !isImage || outOfCreds;
  const buttonTitle = !isImage
    ? "Solo imágenes"
    : outOfCreds
      ? "Sin créditos de IA, contacta a tu administrador"
      : buttonLabel;

  return (
    <>
      {/* ─────────── Botón compacto + saldo ─────────── */}
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
        <Button
          onClick={handleButtonClick}
          disabled={disabledBtn}
          size="sm"
          className="gap-2"
          aria-label={buttonTitle}
          title={buttonTitle}
        >
          <Sparkles className="h-4 w-4" />
          {buttonLabel}
          {result && cached && (
            <span className="ml-1 rounded-full bg-violet-500/25 px-1.5 py-0.5 text-[9px] font-bold text-violet-200">
              GUARDADO
            </span>
          )}
        </Button>

        <span
          className={cn("flex items-center gap-1 text-xs font-medium", cls.text)}
          title={cls.tooltip ?? `${formatNumber(remaining)} de ${formatNumber(tokensLimit)} tokens disponibles`}
        >
          <Coins className="h-3 w-3" />
          {formatNumber(remaining)} tokens restantes
        </span>
      </div>

      {/* ─────────── Dialog con el análisis ─────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden border-white/10 bg-[#0B0F1E] p-0 text-white"
          aria-describedby={undefined}
        >
          {/* Header sticky */}
          <DialogHeaderBar
            result={result}
            analyzedAt={analyzedAt}
            cached={cached}
            loading={loadingAnalysis && !result}
            brokenLegacy={brokenLegacy}
          />

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {/* Sección 1 — Imagen grande */}
            <div className="flex items-center justify-center bg-[#05070F] px-4 py-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fileUrl}
                alt={fileName}
                className="max-h-[60vh] w-auto rounded-xl object-contain shadow-2xl shadow-black/40"
              />
            </div>

            {loadingAnalysis && !result ? (
              <LoadingSection />
            ) : result ? (
              <AnalysisSections
                result={result}
                cached={cached}
                originalTokens={originalTokens}
                currentSpent={currentSpent}
                remaining={remaining}
                tokensLimit={tokensLimit}
                brokenLegacy={brokenLegacy}
                onRefresh={() => runAnalysis(true)}
                onClose={() => setOpen(false)}
                refreshing={loadingAnalysis}
                disabled={disabledBtn}
              />
            ) : (
              <EmptyState onAnalyze={() => runAnalysis(false)} disabled={disabledBtn} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/*  Subcomponentes                                                   */
/* ──────────────────────────────────────────────────────────────── */

function DialogHeaderBar({
  result, analyzedAt, cached, loading, brokenLegacy,
}: {
  result: AnalysisResult | null;
  analyzedAt: Date | null;
  cached: boolean;
  loading: boolean;
  brokenLegacy: boolean;
}) {
  const maxSev   = result && !brokenLegacy ? pickMaxSeverity(result.findings) : null;
  const severSty = maxSev ? severityStyle[maxSev] : null;
  const relativeTime = analyzedAt
    ? formatDistanceToNow(analyzedAt, { addSuffix: true, locale: es })
    : "";

  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#0B0F1E]/95 p-4 backdrop-blur">
      <div className="min-w-0 flex-1">
        <DialogTitle className="flex items-center gap-2 text-base font-semibold text-white">
          <Sparkles className="h-4 w-4 text-violet-400" />
          Análisis de radiografía con IA
        </DialogTitle>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {loading && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generando análisis...
            </span>
          )}
          {severSty && (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold", severSty.bg, severSty.text, severSty.border)}>
              <AlertTriangle className="h-3 w-3" />
              Severidad {severSty.label.toLowerCase()}
            </span>
          )}
          {result && !brokenLegacy && result.findings.length > 0 && (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-card/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
              {result.findings.length} hallazgo{result.findings.length === 1 ? "" : "s"}
            </span>
          )}
          {result && cached && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-300">
              <Archive className="h-3 w-3" />
              Guardado · {relativeTime}
            </span>
          )}
          {result && !cached && analyzedAt && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              Recién generado · {relativeTime}
            </span>
          )}
        </div>
      </div>

      <DialogClose
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        aria-label="Cerrar análisis"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </DialogClose>
    </div>
  );
}

function LoadingSection() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      <p className="text-sm font-semibold text-foreground">Analizando radiografía...</p>
      <p className="text-xs text-muted-foreground">Esto puede tardar entre 10 y 30 segundos</p>
    </div>
  );
}

function EmptyState({ onAnalyze, disabled }: { onAnalyze: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Sparkles className="h-8 w-8 text-violet-400" />
      <p className="text-sm font-semibold text-foreground">No hay análisis para esta imagen</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Genera un análisis orientativo con Claude para identificar hallazgos clínicos relevantes.
      </p>
      <Button onClick={onAnalyze} disabled={disabled} size="sm" className="mt-2 gap-2">
        <Sparkles className="h-4 w-4" />
        Analizar con IA
      </Button>
    </div>
  );
}

function AnalysisSections({
  result, cached, originalTokens, currentSpent, remaining, tokensLimit,
  brokenLegacy, onRefresh, onClose, refreshing, disabled,
}: {
  result: AnalysisResult;
  cached: boolean;
  originalTokens: number | null;
  currentSpent: number | null;
  remaining: number;
  tokensLimit: number;
  brokenLegacy: boolean;
  onRefresh: () => void;
  onClose: () => void;
  refreshing: boolean;
  disabled: boolean;
}) {
  const recsArray =
    Array.isArray(result.recommendations)
      ? result.recommendations
      : result.recommendations
        ? [result.recommendations]
        : [];

  return (
    <div className="space-y-5 p-5">
      {/* Banner de formato antiguo */}
      {brokenLegacy && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-200">Formato antiguo detectado</p>
              <p className="mt-1 text-xs text-amber-200/80">
                Este análisis se generó con una versión anterior del sistema y no pudo reconstruirse
                correctamente. Haz click en <strong>Re-analizar</strong> para obtener una versión mejorada
                con hallazgos y confianza calibrada.
              </p>
            </div>
            <Button size="sm" onClick={onRefresh} disabled={disabled || refreshing} className="gap-1.5">
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-analizar
            </Button>
          </div>
        </div>
      )}

      {/* Sección — RESUMEN */}
      {result.summary && !brokenLegacy && (
        <section className="rounded-2xl border border-white/10 bg-card/[0.02] p-6">
          <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Resumen</h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{result.summary}</p>
        </section>
      )}

      {/* Sección — HALLAZGOS */}
      {!brokenLegacy && (
        <section className="rounded-2xl border border-white/10 bg-card/[0.02] p-6">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Hallazgos</h4>
          {result.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin hallazgos significativos.</p>
          ) : (
            <ul className="space-y-3">
              {result.findings.map((f) => {
                const canonical = normalizeSeverity(f.severity);
                const s = severityStyle[canonical];
                const confPct = confidencePercent(f.confidence);
                return (
                  <li key={String(f.id)} className={cn("flex gap-3 rounded-xl border p-4 bg-card/[0.02]", s.border)}>
                    <span className={cn("mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", s.bg)}>
                      <AlertTriangle className={cn("h-4 w-4", s.icon)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{f.title}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", s.bg, s.text)}>
                            {s.label}
                          </span>
                          <span className="rounded-full border border-white/10 bg-card/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                            Confianza {confPct}%
                          </span>
                        </div>
                      </div>
                      {f.description && (
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.description}</p>
                      )}
                      {f.tooth && (
                        <span className="mt-2 inline-flex items-center rounded-full border border-white/15 bg-card/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-300">
                          Diente: {f.tooth}
                        </span>
                      )}
                      {f.confidenceRationale && (
                        <p className="mt-2 flex gap-1.5 text-[11px] italic leading-relaxed text-muted-foreground">
                          <Info className="mt-[2px] h-3 w-3 shrink-0" />
                          {f.confidenceRationale}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Sección — RECOMENDACIONES */}
      {!brokenLegacy && (
        <section className="rounded-2xl border border-white/10 bg-card/[0.02] p-6">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Recomendaciones</h4>
          {recsArray.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin recomendaciones adicionales.</p>
          ) : (
            <ul className="space-y-2">
              {recsArray.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-foreground/90">
                  <CheckCircle2 className="h-4 w-4 shrink-0 translate-y-0.5 text-emerald-400" />
                  <span className="whitespace-pre-wrap leading-relaxed">{r}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Sección — TOKENS GASTADOS */}
      <section className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.07] p-5">
        <div className="flex items-start gap-3">
          <Coins className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
          <div className="min-w-0 flex-1">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Tokens utilizados</h4>
            {cached ? (
              <p className="mt-1 text-sm text-foreground/90">
                Análisis cacheado — se gastaron{" "}
                <span className="font-semibold text-violet-200">{formatNumber(originalTokens ?? 0)} tokens</span>{" "}
                originalmente,{" "}
                <span className="font-semibold text-emerald-300">0 tokens ahora</span>.
              </p>
            ) : (
              <p className="mt-1 text-sm text-foreground/90">
                Este análisis gastó{" "}
                <span className="font-semibold text-violet-200">{formatNumber(currentSpent ?? originalTokens ?? 0)} tokens</span>.
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Saldo restante: {formatNumber(remaining)} / {formatNumber(tokensLimit)} tokens
            </p>
          </div>
        </div>
      </section>

      {/* Sección — Disclaimer + acciones */}
      <section className="rounded-lg border border-white/10 bg-card/[0.02] px-3 py-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mr-1 inline h-3 w-3" />
          Este análisis es orientativo y no reemplaza el criterio profesional del doctor.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
          Las notas del doctor se editan en la vista principal, no aquí.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={disabled || refreshing}
          className="gap-1.5"
          aria-label="Re-analizar (consume tokens nuevamente)"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-analizar
        </Button>
        <Button size="sm" onClick={onClose} className="gap-1.5">
          Cerrar
        </Button>
      </div>
    </div>
  );
}

