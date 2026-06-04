"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const RISK_BY_SCORE: Record<number, string> = {
  0: "0%", 1: "1.3%", 2: "2.2%", 3: "3.2%", 4: "4.0%",
  5: "6.7%", 6: "9.8%", 7: "9.6%", 8: "6.7%", 9: "15.2%",
};

export function Cha2ds2VascCalculator({ onClose }: Props) {
  const t = useT();
  const [age, setAge] = useState<number>(65);
  const [sex, setSex] = useState<"M" | "F">("M");
  const [chf, setChf] = useState(false);
  const [hta, setHta] = useState(false);
  const [stroke, setStroke] = useState(false);
  const [dm, setDm] = useState(false);
  const [vascular, setVascular] = useState(false);

  let score = 0;
  if (age >= 75) score += 2;
  else if (age >= 65) score += 1;
  if (sex === "F") score += 1;
  if (chf) score += 1;
  if (hta) score += 1;
  if (stroke) score += 2;
  if (dm) score += 1;
  if (vascular) score += 1;

  const risk = RISK_BY_SCORE[score] ?? "—";
  const recommendation =
    score === 0 ? t("clinical.cha2ds2vasc.recNone")
    : score === 1 ? t("clinical.cha2ds2vasc.recConsider")
    : t("clinical.cha2ds2vasc.recIndicated");
  const tone = score === 0 ? "var(--success, #34d399)" : score === 1 ? "var(--warning, #fbbf24)" : "var(--danger, #ef4444)";

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>CHA₂DS₂-VASc</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("clinical.cha2ds2vasc.subtitle")}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label={t("common.back")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.cha2ds2vasc.age")}</label>
          <input type="number" min={0} max={120} className="input-new mono" value={age} onChange={e => setAge(Number(e.target.value))} />
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.cha2ds2vasc.sex")}</label>
          <select className="input-new" value={sex} onChange={e => setSex(e.target.value as "M" | "F")}>
            <option value="M">{t("clinical.cha2ds2vasc.male")}</option>
            <option value="F">{t("clinical.cha2ds2vasc.female")}</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { k: "chf", v: chf, set: setChf, lKey: "clinical.cha2ds2vasc.chf" },
          { k: "hta", v: hta, set: setHta, lKey: "clinical.cha2ds2vasc.hta" },
          { k: "stroke", v: stroke, set: setStroke, lKey: "clinical.cha2ds2vasc.stroke" },
          { k: "dm", v: dm, set: setDm, lKey: "clinical.cha2ds2vasc.dm" },
          { k: "vascular", v: vascular, set: setVascular, lKey: "clinical.cha2ds2vasc.vascular" },
        ].map(c => (
          <label key={c.k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}>
            <input type="checkbox" checked={c.v} onChange={e => c.set(e.target.checked)} />
            {t(c.lKey)}
          </label>
        ))}
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SCORE</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: tone }}>{score}</span>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>/ 9</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-1)", marginBottom: 4 }}>{t("clinical.cha2ds2vasc.annualRisk")}: <span className="mono" style={{ fontWeight: 600 }}>{risk}</span></div>
        <div style={{ fontSize: 13, color: tone, fontWeight: 600 }}>{recommendation}</div>
      </div>
    </div>
  );
}
