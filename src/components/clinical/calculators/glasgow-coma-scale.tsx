"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const EYE = [
  { v: 4, lKey: "clinical.glasgow.eye4" },
  { v: 3, lKey: "clinical.glasgow.eye3" },
  { v: 2, lKey: "clinical.glasgow.eye2" },
  { v: 1, lKey: "clinical.glasgow.eye1" },
];
const VERBAL = [
  { v: 5, lKey: "clinical.glasgow.verbal5" },
  { v: 4, lKey: "clinical.glasgow.verbal4" },
  { v: 3, lKey: "clinical.glasgow.verbal3" },
  { v: 2, lKey: "clinical.glasgow.verbal2" },
  { v: 1, lKey: "clinical.glasgow.verbal1" },
];
const MOTOR = [
  { v: 6, lKey: "clinical.glasgow.motor6" },
  { v: 5, lKey: "clinical.glasgow.motor5" },
  { v: 4, lKey: "clinical.glasgow.motor4" },
  { v: 3, lKey: "clinical.glasgow.motor3" },
  { v: 2, lKey: "clinical.glasgow.motor2" },
  { v: 1, lKey: "clinical.glasgow.motor1" },
];

export function GlasgowComaScaleCalculator({ onClose }: Props) {
  const t = useT();
  const [eye, setEye] = useState(4);
  const [verbal, setVerbal] = useState(5);
  const [motor, setMotor] = useState(6);

  const score = eye + verbal + motor;
  const category =
    score >= 13 ? t("clinical.glasgow.catMild")
    : score >= 9 ? t("clinical.glasgow.catModerate")
    : t("clinical.glasgow.catSevere");
  const tone =
    score >= 13 ? "var(--success, #34d399)"
    : score >= 9 ? "var(--warning, #fbbf24)"
    : "var(--danger, #ef4444)";

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>{t("clinical.glasgow.title")}</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("clinical.glasgow.subtitle")}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label={t("common.back")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="field-new">
        <label className="field-new__label">{t("clinical.glasgow.eyeOpening")}</label>
        <select className="input-new" value={eye} onChange={e => setEye(Number(e.target.value))}>
          {EYE.map(o => <option key={o.v} value={o.v}>{o.v} — {t(o.lKey)}</option>)}
        </select>
      </div>
      <div className="field-new">
        <label className="field-new__label">{t("clinical.glasgow.verbalResponse")}</label>
        <select className="input-new" value={verbal} onChange={e => setVerbal(Number(e.target.value))}>
          {VERBAL.map(o => <option key={o.v} value={o.v}>{o.v} — {t(o.lKey)}</option>)}
        </select>
      </div>
      <div className="field-new">
        <label className="field-new__label">{t("clinical.glasgow.motorResponse")}</label>
        <select className="input-new" value={motor} onChange={e => setMotor(Number(e.target.value))}>
          {MOTOR.map(o => <option key={o.v} value={o.v}>{o.v} — {t(o.lKey)}</option>)}
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
