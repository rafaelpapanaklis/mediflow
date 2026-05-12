"use client";
// DrawerConfigRetention — configurar el régimen de retención (Sección G).
// Persiste vía updateRetentionRegimenConfig.

import { useState } from "react";
import { Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

const RETAINERS_UP = [
  { v: "HAWLEY_SUP", l: "Hawley superior" },
  { v: "ESSIX_SUP", l: "Essix superior" },
  { v: "NONE", l: "Sin retenedor" },
] as const;
const RETAINERS_DOWN = [
  { v: "HAWLEY_INF", l: "Hawley inferior" },
  { v: "ESSIX_INF", l: "Essix inferior" },
  { v: "NONE", l: "Sin retenedor" },
] as const;

const GAUGES = [
  { v: "G_0175", l: ".0175" },
  { v: "G_0195", l: ".0195" },
  { v: "G_021", l: ".021" },
] as const;

export interface DrawerConfigRetentionProps {
  current: {
    upperRetainer: string | null;
    upperDescription: string | null;
    lowerRetainer: string | null;
    lowerDescription: string | null;
    fixedLingualPresent: boolean;
    fixedLingualGauge: string | null;
    regimenDescription: string;
    preSurveyEnabled: boolean;
  } | null;
  onClose: () => void;
  onConfirm: (payload: {
    upperRetainer: string | null;
    upperDescription: string | null;
    lowerRetainer: string | null;
    lowerDescription: string | null;
    fixedLingualPresent: boolean;
    fixedLingualGauge: string | null;
    regimenDescription: string;
    preSurveyEnabled: boolean;
  }) => Promise<void> | void;
}

export function DrawerConfigRetention(props: DrawerConfigRetentionProps) {
  const c = props.current;
  const [upper, setUpper] = useState<string>(c?.upperRetainer ?? "HAWLEY_SUP");
  const [upperDesc, setUpperDesc] = useState(c?.upperDescription ?? "Acrílico + arco vestibular");
  const [lower, setLower] = useState<string>(c?.lowerRetainer ?? "ESSIX_INF");
  const [lowerDesc, setLowerDesc] = useState(c?.lowerDescription ?? "Termoformado transparente");
  const [fixedPresent, setFixedPresent] = useState(c?.fixedLingualPresent ?? true);
  const [fixedGauge, setFixedGauge] = useState<string>(c?.fixedLingualGauge ?? "G_0195");
  const [regimen, setRegimen] = useState(c?.regimenDescription ?? "24/7 año 1 · nocturno años 2-5");
  const [preSurvey, setPreSurvey] = useState(c?.preSurveyEnabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        upperRetainer: upper,
        upperDescription: upperDesc || null,
        lowerRetainer: lower,
        lowerDescription: lowerDesc || null,
        fixedLingualPresent: fixedPresent,
        fixedLingualGauge: fixedPresent ? fixedGauge : null,
        regimenDescription: regimen.trim(),
        preSurveyEnabled: preSurvey,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800" role="dialog" aria-modal="true">
        <header className="px-6 py-4 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-emerald-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-300">Régimen de retención · G9</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">Configurar tipo de retenedor + uso</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Retenedor superior">
              <select value={upper} onChange={(e) => setUpper(e.target.value)} className={inputCls}>
                {RETAINERS_UP.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
            <Field label="Retenedor inferior">
              <select value={lower} onChange={(e) => setLower(e.target.value)} className={inputCls}>
                {RETAINERS_DOWN.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Descripción superior"><input type="text" value={upperDesc} onChange={(e) => setUpperDesc(e.target.value)} className={inputCls} /></Field>
          <Field label="Descripción inferior"><input type="text" value={lowerDesc} onChange={(e) => setLowerDesc(e.target.value)} className={inputCls} /></Field>
          <div className="border border-slate-200 rounded-md p-3 dark:border-slate-700">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={fixedPresent} onChange={(e) => setFixedPresent(e.target.checked)} />
              Retenedor fijo lingual 3-3
            </label>
            {fixedPresent ? (
              <div className="mt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">Calibre</label>
                <select value={fixedGauge} onChange={(e) => setFixedGauge(e.target.value)} className={inputCls}>
                  {GAUGES.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
                </select>
              </div>
            ) : null}
          </div>
          <Field label="Régimen de uso">
            <input type="text" value={regimen} onChange={(e) => setRegimen(e.target.value)} className={inputCls} required />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={preSurvey} onChange={(e) => setPreSurvey(e.target.checked)} />
            Pre-encuesta WhatsApp 24h antes de cada control
          </label>
          {error ? <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div> : null}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 flex justify-between items-center dark:border-slate-800">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 dark:text-slate-400"><Shield className="w-3 h-3" aria-hidden />Audit trail</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={submitting || !regimen.trim()}>{submitting ? "Guardando..." : "Guardar régimen"}</Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">{label}</label>
      {children}
    </div>
  );
}
