"use client";
import { useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const BILI = [
  { v: 1, l: "< 2 mg/dL" }, { v: 2, l: "2 – 3 mg/dL" }, { v: 3, l: "> 3 mg/dL" },
];
const ALB = [
  { v: 1, l: "> 3.5 g/dL" }, { v: 2, l: "2.8 – 3.5 g/dL" }, { v: 3, l: "< 2.8 g/dL" },
];
const INR = [
  { v: 1, l: "< 1.7" }, { v: 2, l: "1.7 – 2.3" }, { v: 3, l: "> 2.3" },
];
const ASC = [
  { v: 1, l: "Ausente" }, { v: 2, l: "Leve / controlada con diuréticos" }, { v: 3, l: "Moderada a tensa" },
];
const ENC = [
  { v: 1, l: "Ausente" }, { v: 2, l: "Grado I-II" }, { v: 3, l: "Grado III-IV" },
];

export function ChildPughCalculator({ onClose }: Props) {
  const [bili, setBili] = useState(1);
  const [alb, setAlb] = useState(1);
  const [inr, setInr] = useState(1);
  const [asc, setAsc] = useState(1);
  const [enc, setEnc] = useState(1);

  const score = bili + alb + inr + asc + enc;
  const info =
    score <= 6 ? { cls: "A", survival: "95% sobrevida a 1 año", tone: "var(--success, #34d399)" }
    : score <= 9 ? { cls: "B", survival: "80% sobrevida a 1 año", tone: "var(--warning, #fbbf24)" }
    : { cls: "C", survival: "45% sobrevida a 1 año", tone: "var(--danger, #ef4444)" };

  const rows: Array<{ label: string; value: number; set: (n: number) => void; opts: { v: number; l: string }[] }> = [
    { label: "Bilirrubina total", value: bili, set: setBili, opts: BILI },
    { label: "Albúmina", value: alb, set: setAlb, opts: ALB },
    { label: "INR", value: inr, set: setInr, opts: INR },
    { label: "Ascitis", value: asc, set: setAsc, opts: ASC },
    { label: "Encefalopatía", value: enc, set: setEnc, opts: ENC },
  ];

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Child-Pugh</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Pronóstico en cirrosis hepática</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => (
          <div key={r.label} className="field-new">
            <label className="field-new__label">{r.label}</label>
            <select className="input-new" value={r.value} onChange={e => r.set(Number(e.target.value))}>
              {r.opts.map(o => <option key={o.v} value={o.v}>{o.v} pt — {o.l}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SCORE</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: info.tone }}>{score}</span>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>/ 15</span>
          <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700, color: info.tone }}>Clase {info.cls}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-1)" }}>{info.survival}</div>
      </div>
    </div>
  );
}
