"use client";
import { useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const EYE = [
  { v: 4, l: "Espontánea" },
  { v: 3, l: "Al estímulo verbal" },
  { v: 2, l: "Al dolor" },
  { v: 1, l: "No abre" },
];
const VERBAL = [
  { v: 5, l: "Orientada" },
  { v: 4, l: "Confusa" },
  { v: 3, l: "Palabras inapropiadas" },
  { v: 2, l: "Sonidos incomprensibles" },
  { v: 1, l: "Sin respuesta" },
];
const MOTOR = [
  { v: 6, l: "Obedece órdenes" },
  { v: 5, l: "Localiza dolor" },
  { v: 4, l: "Retira al dolor" },
  { v: 3, l: "Flexión anormal (decorticación)" },
  { v: 2, l: "Extensión anormal (descerebración)" },
  { v: 1, l: "Sin respuesta" },
];

export function GlasgowComaScaleCalculator({ onClose }: Props) {
  const [eye, setEye] = useState(4);
  const [verbal, setVerbal] = useState(5);
  const [motor, setMotor] = useState(6);

  const score = eye + verbal + motor;
  const category =
    score >= 13 ? "Leve"
    : score >= 9 ? "Moderado"
    : "Severo (considerar intubación)";
  const tone =
    score >= 13 ? "var(--success, #34d399)"
    : score >= 9 ? "var(--warning, #fbbf24)"
    : "var(--danger, #ef4444)";

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Escala de Glasgow (GCS)</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Nivel de conciencia</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="field-new">
        <label className="field-new__label">Apertura ocular (1-4)</label>
        <select className="input-new" value={eye} onChange={e => setEye(Number(e.target.value))}>
          {EYE.map(o => <option key={o.v} value={o.v}>{o.v} — {o.l}</option>)}
        </select>
      </div>
      <div className="field-new">
        <label className="field-new__label">Respuesta verbal (1-5)</label>
        <select className="input-new" value={verbal} onChange={e => setVerbal(Number(e.target.value))}>
          {VERBAL.map(o => <option key={o.v} value={o.v}>{o.v} — {o.l}</option>)}
        </select>
      </div>
      <div className="field-new">
        <label className="field-new__label">Respuesta motora (1-6)</label>
        <select className="input-new" value={motor} onChange={e => setMotor(Number(e.target.value))}>
          {MOTOR.map(o => <option key={o.v} value={o.v}>{o.v} — {o.l}</option>)}
        </select>
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SCORE</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: tone }}>{score}</span>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>/ 15</span>
        </div>
        <div style={{ fontSize: 13, color: tone, fontWeight: 600 }}>{category}</div>
      </div>
    </div>
  );
}
