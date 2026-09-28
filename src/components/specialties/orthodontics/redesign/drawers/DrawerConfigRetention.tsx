"use client";
// DrawerConfigRetention — configurar el régimen de retención (Sección G).
// Persiste vía updateRetentionRegimenConfig.

import { useState } from "react";
import { Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import orto from "../orto.module.css";

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
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside className={orto.cajon} role="dialog" aria-modal="true">
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Retención</div>
            <h3 className={orto.cajonTitulo}>Configurar tipo de retenedor + uso</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
          <div className="border border-[color:var(--pr-borde)] rounded-[8px] p-3">
            <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
              <input type="checkbox" checked={fixedPresent} onChange={(e) => setFixedPresent(e.target.checked)} />
              Retenedor fijo lingual 3-3
            </label>
            {fixedPresent ? (
              <div className="mt-2">
                <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">Calibre</label>
                <select value={fixedGauge} onChange={(e) => setFixedGauge(e.target.value)} className={inputCls}>
                  {GAUGES.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
                </select>
              </div>
            ) : null}
          </div>
          <Field label="Régimen de uso">
            <input type="text" value={regimen} onChange={(e) => setRegimen(e.target.value)} className={inputCls} required />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
            <input type="checkbox" checked={preSurvey} onChange={(e) => setPreSurvey(e.target.checked)} />
            Pre-encuesta WhatsApp 24h antes de cada control
          </label>
          {error ? <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">{error}</div> : null}
        </div>
        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1"><Shield className="w-3 h-3" aria-hidden />Cada cambio queda registrado</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={submitting || !regimen.trim()}>{submitting ? "Guardando..." : "Guardar régimen"}</Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

const inputCls = orto.entrada;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">{label}</label>
      {children}
    </div>
  );
}
