"use client";
import { Fragment, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const PARAMS = [
  { key: "fc", labelKey: "clinical.apgar.paramHeartRate", options: [
    { v: 0, lKey: "clinical.apgar.hrAbsent" }, { v: 1, lKey: "clinical.apgar.hrUnder100" }, { v: 2, lKey: "clinical.apgar.hrOver100" },
  ] },
  { key: "resp", labelKey: "clinical.apgar.paramRespiration", options: [
    { v: 0, lKey: "clinical.apgar.respAbsent" }, { v: 1, lKey: "clinical.apgar.respSlow" }, { v: 2, lKey: "clinical.apgar.respVigorous" },
  ] },
  { key: "tono", labelKey: "clinical.apgar.paramMuscleTone", options: [
    { v: 0, lKey: "clinical.apgar.toneFlaccid" }, { v: 1, lKey: "clinical.apgar.toneFlexion" }, { v: 2, lKey: "clinical.apgar.toneActive" },
  ] },
  { key: "refl", labelKey: "clinical.apgar.paramReflexes", options: [
    { v: 0, lKey: "clinical.apgar.reflNone" }, { v: 1, lKey: "clinical.apgar.reflGrimace" }, { v: 2, lKey: "clinical.apgar.reflCough" },
  ] },
  { key: "color", labelKey: "clinical.apgar.paramColor", options: [
    { v: 0, lKey: "clinical.apgar.colorBlue" }, { v: 1, lKey: "clinical.apgar.colorBodyPink" }, { v: 2, lKey: "clinical.apgar.colorFullyPink" },
  ] },
] as const;

type ParamKey = typeof PARAMS[number]["key"];

function interpret(score: number, t: TFunction) {
  if (score >= 7) return { label: t("clinical.apgar.interpNormal"), tone: "var(--success, #34d399)" };
  if (score >= 4) return { label: t("clinical.apgar.interpModerate"), tone: "var(--warning, #fbbf24)" };
  return { label: t("clinical.apgar.interpSevere"), tone: "var(--danger, #ef4444)" };
}

export function ApgarCalculator({ onClose }: Props) {
  const t = useT();
  const [min1, setMin1] = useState<Record<ParamKey, number>>({ fc: 2, resp: 2, tono: 2, refl: 2, color: 2 });
  const [min5, setMin5] = useState<Record<ParamKey, number>>({ fc: 2, resp: 2, tono: 2, refl: 2, color: 2 });

  const score1 = PARAMS.reduce((acc, p) => acc + min1[p.key], 0);
  const score5 = PARAMS.reduce((acc, p) => acc + min5[p.key], 0);

  const r1 = interpret(score1, t);
  const r5 = interpret(score5, t);

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>APGAR</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("clinical.apgar.subtitle")}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label={t("common.back")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{t("clinical.apgar.colParameter")}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{t("clinical.apgar.col1Min")}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{t("clinical.apgar.col5Min")}</div>

        {PARAMS.map(p => (
          <Fragment key={p.key}>
            <div style={{ fontSize: 13, color: "var(--text-1)" }}>{t(p.labelKey)}</div>
            <select className="input-new" value={min1[p.key]} onChange={e => setMin1(s => ({ ...s, [p.key]: Number(e.target.value) }))}>
              {p.options.map(o => <option key={o.v} value={o.v}>{o.v} — {t(o.lKey)}</option>)}
            </select>
            <select className="input-new" value={min5[p.key]} onChange={e => setMin5(s => ({ ...s, [p.key]: Number(e.target.value) }))}>
              {p.options.map(o => <option key={o.v} value={o.v}>{o.v} — {t(o.lKey)}</option>)}
            </select>
          </Fragment>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{t("clinical.apgar.result1Min")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: r1.tone }}>{score1}</span>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>/ 10</span>
          </div>
          <div style={{ fontSize: 12, color: r1.tone, fontWeight: 600 }}>{r1.label}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{t("clinical.apgar.result5Min")}</div>
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
