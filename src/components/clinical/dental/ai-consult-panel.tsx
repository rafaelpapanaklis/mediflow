"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import styles from "./ai-consult-panel.module.css";

export interface AiConsultResult {
  hallazgos: string;
  puntosAlerta: string[];
  plan: string;
  resumen: string;
}
export interface AiAssistValue {
  applied?: boolean;
  appliedAt?: string;
  generatedAt?: string;
  result?: AiConsultResult;
  disclaimer?: string;
}
interface AnalyzeResponse {
  result: AiConsultResult;
  disclaimer: string;
  model: string;
  generatedAt: string;
}

interface Props {
  patientId: string;
  currentInput: { subjective?: string; objective?: string };
  value: AiAssistValue | null;
  onApply: (a: AnalyzeResponse) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  disabled?: boolean;
}

export function AiConsultPanel({ patientId, currentInput, value, onApply, onRemove, disabled }: Props) {
  const t = useT();
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    setLoading(true);
    setError(null);
    // Al re-analizar, soltamos el resultado previo para caer al branch idle (que sí
    // muestra spinner y error); si no, el card neutro se queda mudo ante 429/503/5xx.
    setAnalysis(null);
    try {
      const res = await fetch("/api/consult/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, currentInput }),
      });
      if (res.status === 503) { setError(t("clinical.aiConsult.notConfigured")); return; }
      if (res.status === 429) { setError(t("clinical.aiConsult.monthlyLimit")); return; }
      if (!res.ok) { setError(t("clinical.aiConsult.genericError")); return; }
      setAnalysis((await res.json()) as AnalyzeResponse);
    } catch {
      setError(t("clinical.aiConsult.genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!analysis) return;
    setBusy(true);
    // Solo limpiamos el análisis si onApply tuvo ÉXITO. Si falla (lanza), lo dejamos
    // en pantalla para re-Aplicar sin re-analizar (no re-gastar tokens); el handler ya
    // mostró el toast de error.
    try { await onApply(analysis); setAnalysis(null); }
    catch { /* dejar el análisis visible para reintentar */ }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await onRemove(); }
    catch { /* el handler ya mostró el toast de error */ }
    finally { setBusy(false); }
  }

  function Sections({ r }: { r: AiConsultResult }) {
    return (
      <>
        <div className={styles.section}>
          <h4>🔍 {t("clinical.aiConsult.sectionFindings")}</h4>
          <p>{r.hallazgos || "—"}</p>
        </div>
        {r.puntosAlerta?.length > 0 && (
          <div className={styles.section}>
            <h4>⚠️ {t("clinical.aiConsult.sectionAlerts")}</h4>
            <ul className={styles.alerts}>{r.puntosAlerta.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
        <div className={styles.section}>
          <h4>💊 {t("clinical.aiConsult.sectionPlan")}</h4>
          <p>{r.plan || "—"}</p>
        </div>
      </>
    );
  }

  // Estado APLICADO → cajita morada (también en historial)
  if (value?.applied && value.result) {
    const when = value.appliedAt || value.generatedAt;
    return (
      <div className={styles.wrap}>
        <div className={styles.magic}>
          <div className={styles.head}>
            <span className={styles.chip}>✨ {t("clinical.aiConsult.generatedWithAi")}{when ? ` · ${new Date(when).toLocaleDateString("es-MX")}` : ""}</span>
            <button className={styles.remove} onClick={remove} disabled={busy || disabled}>
              {t("clinical.aiConsult.remove")}
            </button>
          </div>
          <Sections r={value.result} />
          <div className={styles.disclaimer}>{value.disclaimer || t("clinical.aiConsult.disclaimer")}</div>
        </div>
      </div>
    );
  }

  // Resultado sin aplicar → cajita neutra
  if (analysis) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <Sections r={analysis.result} />
          <div className={styles.disclaimer}>{analysis.disclaimer || t("clinical.aiConsult.disclaimer")}</div>
          <div className={styles.actions}>
            <button className={styles.apply} onClick={apply} disabled={busy || disabled}>
              {t("clinical.aiConsult.applyToConsult")}
            </button>
            <button className={styles.retry} onClick={analyze} disabled={loading || busy}>
              {t("clinical.aiConsult.reanalyze")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Idle / loading / error
  return (
    <div className={styles.wrap}>
      <button className={styles.trigger} onClick={analyze} disabled={loading || disabled}>
        {loading ? <span className={styles.spinner} /> : <Sparkles size={16} />}
        {loading ? t("clinical.aiConsult.analyzing") : t("clinical.aiConsult.analyze")}
      </button>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
