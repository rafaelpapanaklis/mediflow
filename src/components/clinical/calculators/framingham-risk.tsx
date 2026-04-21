"use client";
import { useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

function agePoints(age: number, sex: "M" | "F"): number {
  if (sex === "M") {
    if (age < 35) return -1;
    if (age < 40) return 0;
    if (age < 45) return 1;
    if (age < 50) return 2;
    if (age < 55) return 3;
    if (age < 60) return 4;
    if (age < 65) return 5;
    if (age < 70) return 6;
    if (age < 75) return 7;
    return 8;
  }
  if (age < 35) return -7;
  if (age < 40) return -3;
  if (age < 45) return 0;
  if (age < 50) return 3;
  if (age < 55) return 6;
  if (age < 60) return 8;
  if (age < 65) return 10;
  if (age < 70) return 12;
  if (age < 75) return 14;
  return 16;
}

function cholPoints(chol: number, sex: "M" | "F"): number {
  if (chol < 160) return 0;
  if (chol < 200) return sex === "M" ? 1 : 1;
  if (chol < 240) return sex === "M" ? 2 : 3;
  if (chol < 280) return sex === "M" ? 3 : 4;
  return sex === "M" ? 4 : 5;
}
function hdlPoints(hdl: number): number {
  if (hdl >= 60) return -1;
  if (hdl >= 50) return 0;
  if (hdl >= 40) return 1;
  return 2;
}
function sbpPoints(sbp: number, treated: boolean, sex: "M" | "F"): number {
  const base =
    sbp < 120 ? 0
    : sbp < 130 ? 1
    : sbp < 140 ? 2
    : sbp < 160 ? 3
    : 4;
  return treated ? base + (sex === "M" ? 1 : 2) : base;
}

function riskFromPoints(pts: number, sex: "M" | "F"): string {
  const table: Record<"M" | "F", Array<[number, string]>> = {
    M: [
      [-3, "< 1%"], [-2, "< 1%"], [-1, "< 1%"], [0, "1%"], [1, "1%"], [2, "1%"],
      [3, "1%"], [4, "1%"], [5, "2%"], [6, "2%"], [7, "3%"], [8, "4%"], [9, "5%"],
      [10, "6%"], [11, "8%"], [12, "10%"], [13, "12%"], [14, "16%"], [15, "20%"],
      [16, "25%"], [17, "> 30%"],
    ],
    F: [
      [-3, "< 1%"], [-2, "< 1%"], [-1, "< 1%"], [0, "< 1%"], [1, "1%"], [2, "1%"],
      [3, "1%"], [4, "1%"], [5, "2%"], [6, "2%"], [7, "3%"], [8, "4%"], [9, "5%"],
      [10, "6%"], [11, "8%"], [12, "11%"], [13, "14%"], [14, "17%"], [15, "22%"],
      [16, "27%"], [17, "> 30%"],
    ],
  };
  const rows = table[sex];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (pts >= rows[i][0]) return rows[i][1];
  }
  return "< 1%";
}

export function FraminghamRiskCalculator({ onClose }: Props) {
  const [sex, setSex] = useState<"M" | "F">("M");
  const [age, setAge] = useState(50);
  const [chol, setChol] = useState(200);
  const [hdl, setHdl] = useState(50);
  const [sbp, setSbp] = useState(120);
  const [treated, setTreated] = useState(false);
  const [smoker, setSmoker] = useState(false);
  const [diabetes, setDiabetes] = useState(false);

  let points = 0;
  points += agePoints(age, sex);
  points += cholPoints(chol, sex);
  points += hdlPoints(hdl);
  points += sbpPoints(sbp, treated, sex);
  if (smoker) points += sex === "M" ? 4 : 3;
  if (diabetes) points += sex === "M" ? 3 : 4;

  const risk = riskFromPoints(points, sex);
  const numeric = parseFloat(risk.replace(/[^0-9.]/g, "")) || 0;
  const tone =
    numeric < 10 ? "var(--success, #34d399)"
    : numeric < 20 ? "var(--warning, #fbbf24)"
    : "var(--danger, #ef4444)";
  const category =
    numeric < 10 ? "Riesgo bajo"
    : numeric < 20 ? "Riesgo moderado"
    : "Riesgo alto";

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Framingham</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Riesgo cardiovascular a 10 años</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field-new">
          <label className="field-new__label">Sexo</label>
          <select className="input-new" value={sex} onChange={e => setSex(e.target.value as "M" | "F")}>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </div>
        <div className="field-new">
          <label className="field-new__label">Edad (30-79)</label>
          <input type="number" min={30} max={79} className="input-new mono" value={age} onChange={e => setAge(Number(e.target.value))} />
        </div>
        <div className="field-new">
          <label className="field-new__label">Colesterol total (mg/dL)</label>
          <input type="number" className="input-new mono" value={chol} onChange={e => setChol(Number(e.target.value))} />
        </div>
        <div className="field-new">
          <label className="field-new__label">HDL (mg/dL)</label>
          <input type="number" className="input-new mono" value={hdl} onChange={e => setHdl(Number(e.target.value))} />
        </div>
        <div className="field-new">
          <label className="field-new__label">TA sistólica (mmHg)</label>
          <input type="number" className="input-new mono" value={sbp} onChange={e => setSbp(Number(e.target.value))} />
        </div>
        <div className="field-new">
          <label className="field-new__label">Tratamiento para HTA</label>
          <select className="input-new" value={treated ? "1" : "0"} onChange={e => setTreated(e.target.value === "1")}>
            <option value="0">No</option>
            <option value="1">Sí</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}>
          <input type="checkbox" checked={smoker} onChange={e => setSmoker(e.target.checked)} />
          Fumador activo
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}>
          <input type="checkbox" checked={diabetes} onChange={e => setDiabetes(e.target.checked)} />
          Diabetes mellitus
        </label>
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>RIESGO CV 10 AÑOS</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: tone }}>{risk}</span>
        </div>
        <div style={{ fontSize: 13, color: tone, fontWeight: 600, marginBottom: 6 }}>{category}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>Cálculo estimativo (modelo simplificado por puntos).</div>
      </div>
    </div>
  );
}
