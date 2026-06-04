"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const BILI = [
  { v: 1, lKey: "clinical.childPugh.bili1" }, { v: 2, lKey: "clinical.childPugh.bili2" }, { v: 3, lKey: "clinical.childPugh.bili3" },
];
const ALB = [
  { v: 1, lKey: "clinical.childPugh.alb1" }, { v: 2, lKey: "clinical.childPugh.alb2" }, { v: 3, lKey: "clinical.childPugh.alb3" },
];
const INR = [
  { v: 1, lKey: "clinical.childPugh.inr1" }, { v: 2, lKey: "clinical.childPugh.inr2" }, { v: 3, lKey: "clinical.childPugh.inr3" },
];
const ASC = [
  { v: 1, lKey: "clinical.childPugh.ascAbsent" }, { v: 2, lKey: "clinical.childPugh.ascMild" }, { v: 3, lKey: "clinical.childPugh.ascModerate" },
];
const ENC = [
  { v: 1, lKey: "clinical.childPugh.encAbsent" }, { v: 2, lKey: "clinical.childPugh.encGrade12" }, { v: 3, lKey: "clinical.childPugh.encGrade34" },
];

export function ChildPughCalculator({ onClose }: Props) {
  const t = useT();
  const [bili, setBili] = useState(1);
  const [alb, setAlb] = useState(1);
  const [inr, setInr] = useState(1);
  const [asc, setAsc] = useState(1);
  const [enc, setEnc] = useState(1);

  const score = bili + alb + inr + asc + enc;
  const info =
    score <= 6 ? { cls: "A", survival: t("clinical.childPugh.survivalA"), tone: "var(--success, #34d399)" }
    : score <= 9 ? { cls: "B", survival: t("clinical.childPugh.survivalB"), tone: "var(--warning, #fbbf24)" }
    : { cls: "C", survival: t("clinical.childPugh.survivalC"), tone: "var(--danger, #ef4444)" };

  const rows: Array<{ label: string; value: number; set: (n: number) => void; opts: { v: number; lKey: string }[] }> = [
    { label: t("clinical.childPugh.bilirubin"), value: bili, set: setBili, opts: BILI },
    { label: t("clinical.childPugh.albumin"), value: alb, set: setAlb, opts: ALB },
    { label: "INR", value: inr, set: setInr, opts: INR },
    { label: t("clinical.childPugh.ascites"), value: asc, set: setAsc, opts: ASC },
    { label: t("clinical.childPugh.encephalopathy"), value: enc, set: setEnc, opts: ENC },
  ];

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Child-Pugh</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("clinical.childPugh.subtitle")}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label={t("common.back")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => (
          <div key={r.label} className="field-new">
            <label className="field-new__label">{r.label}</label>
            <select className="input-new" value={r.value} onChange={e => r.set(Number(e.target.value))}>
              {r.opts.map(o => <option key={o.v} value={o.v}>{o.v} {t("clinical.childPugh.pt")} — {t(o.lKey)}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SCORE</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: info.tone }}>{score}</span>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>/ 15</span>
          <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700, color: info.tone }}>{t("clinical.childPugh.class")} {info.cls}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-1)" }}>{info.survival}</div>
      </div>
    </div>
  );
}
