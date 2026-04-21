"use client";
import { Fragment, useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const PARAMS = [
  { key: "fc", label: "Frecuencia cardíaca", options: [
    { v: 0, l: "Ausente" }, { v: 1, l: "< 100 lpm" }, { v: 2, l: "> 100 lpm" },
  ] },
  { key: "resp", label: "Respiración", options: [
    { v: 0, l: "Ausente" }, { v: 1, l: "Lenta, irregular" }, { v: 2, l: "Llanto vigoroso" },
  ] },
  { key: "tono", label: "Tono muscular", options: [
    { v: 0, l: "Flácido" }, { v: 1, l: "Flexión de extremidades" }, { v: 2, l: "Movimiento activo" },
  ] },
  { key: "refl", label: "Reflejos / irritabilidad", options: [
    { v: 0, l: "Sin respuesta" }, { v: 1, l: "Mueca" }, { v: 2, l: "Tos / estornudo" },
  ] },
  { key: "color", label: "Color", options: [
    { v: 0, l: "Azul / pálido" }, { v: 1, l: "Cuerpo rosado, extremidades azules" }, { v: 2, l: "Totalmente rosado" },
  ] },
] as const;

type ParamKey = typeof PARAMS[number]["key"];

function interpret(score: number) {
  if (score >= 7) return { label: "Normal", tone: "var(--success, #34d399)" };
  if (score >= 4) return { label: "Depresión moderada", tone: "var(--warning, #fbbf24)" };
  return { label: "Depresión severa", tone: "var(--danger, #ef4444)" };
}

export function ApgarCalculator({ onClose }: Props) {
  const [min1, setMin1] = useState<Record<ParamKey, number>>({ fc: 2, resp: 2, tono: 2, refl: 2, color: 2 });
  const [min5, setMin5] = useState<Record<ParamKey, number>>({ fc: 2, resp: 2, tono: 2, refl: 2, color: 2 });

  const score1 = PARAMS.reduce((acc, p) => acc + min1[p.key], 0);
  const score5 = PARAMS.reduce((acc, p) => acc + min5[p.key], 0);

  const r1 = interpret(score1);
  const r5 = interpret(score5);

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>APGAR</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Vitalidad del recién nacido</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>PARÁMETRO</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>1 MIN</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>5 MIN</div>

        {PARAMS.map(p => (
          <Fragment key={p.key}>
            <div style={{ fontSize: 13, color: "var(--text-1)" }}>{p.label}</div>
            <select className="input-new" value={min1[p.key]} onChange={e => setMin1(s => ({ ...s, [p.key]: Number(e.target.value) }))}>
              {p.options.map(o => <option key={o.v} value={o.v}>{o.v} — {o.l}</option>)}
            </select>
            <select className="input-new" value={min5[p.key]} onChange={e => setMin5(s => ({ ...s, [p.key]: Number(e.target.value) }))}>
              {p.options.map(o => <option key={o.v} value={o.v}>{o.v} — {o.l}</option>)}
            </select>
          </Fragment>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>APGAR 1 MIN</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: r1.tone }}>{score1}</span>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>/ 10</span>
          </div>
          <div style={{ fontSize: 12, color: r1.tone, fontWeight: 600 }}>{r1.label}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>APGAR 5 MIN</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: r5.tone }}>{score5}</span>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>/ 10</span>
          </div>
          <div style={{ fontSize: 12, color: r5.tone, fontWeight: 600 }}>{r5.label}</div>
        </div>
      </div>
    </div>
  );
}
