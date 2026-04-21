"use client";
import { useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

function calcMeld(bili: number, inr: number, creat: number): number {
  const b = Math.max(bili, 1);
  const i = Math.max(inr, 1);
  const c = Math.min(Math.max(creat, 1), 4);
  const raw = 3.78 * Math.log(b) + 11.2 * Math.log(i) + 9.57 * Math.log(c) + 6.43;
  return Math.min(Math.max(Math.round(raw), 6), 40);
}

function calcMeldNa(meld: number, sodium: number): number {
  const na = Math.min(Math.max(sodium, 125), 137);
  const adj = meld + 1.32 * (137 - na) - 0.033 * meld * (137 - na);
  return Math.min(Math.max(Math.round(adj), 6), 40);
}

export function MeldCalculator({ onClose }: Props) {
  const [bili, setBili] = useState("1.0");
  const [inr, setInr] = useState("1.0");
  const [creat, setCreat] = useState("1.0");
  const [sodium, setSodium] = useState("");

  const meld = calcMeld(Number(bili) || 1, Number(inr) || 1, Number(creat) || 1);
  const naNum = Number(sodium);
  const hasNa = sodium !== "" && !Number.isNaN(naNum);
  const meldNa = hasNa ? calcMeldNa(meld, naNum) : null;

  const finalScore = meldNa ?? meld;
  const info =
    finalScore < 10 ? { label: "Baja mortalidad a 3 meses", tone: "var(--success, #34d399)" }
    : finalScore < 20 ? { label: "Mortalidad moderada", tone: "var(--warning, #fbbf24)" }
    : finalScore < 30 ? { label: "Mortalidad alta", tone: "var(--danger, #ef4444)" }
    : { label: "Mortalidad muy alta", tone: "var(--danger, #ef4444)" };

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>MELD / MELD-Na</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Severidad de enfermedad hepática terminal</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field-new">
          <label className="field-new__label">Bilirrubina total (mg/dL)</label>
          <input type="number" step="0.1" min="0" className="input-new mono" value={bili} onChange={e => setBili(e.target.value)} />
        </div>
        <div className="field-new">
          <label className="field-new__label">INR</label>
          <input type="number" step="0.1" min="0" className="input-new mono" value={inr} onChange={e => setInr(e.target.value)} />
        </div>
        <div className="field-new">
          <label className="field-new__label">Creatinina (mg/dL)</label>
          <input type="number" step="0.1" min="0" className="input-new mono" value={creat} onChange={e => setCreat(e.target.value)} />
        </div>
        <div className="field-new">
          <label className="field-new__label">Sodio (mEq/L) — opcional</label>
          <input type="number" step="1" className="input-new mono" placeholder="p.ej. 135" value={sodium} onChange={e => setSodium(e.target.value)} />
        </div>
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>MELD</span>
          <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: info.tone }}>{meld}</span>
          {hasNa && (
            <>
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginLeft: 12 }}>MELD-Na</span>
              <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: info.tone }}>{meldNa}</span>
            </>
          )}
        </div>
        <div style={{ fontSize: 13, color: info.tone, fontWeight: 600 }}>{info.label}</div>
      </div>
    </div>
  );
}
