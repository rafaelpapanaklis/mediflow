"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const CLASSES = [
  {
    id: "I",
    titleKey: "clinical.nyha.classITitle",
    descKey: "clinical.nyha.classIDesc",
    treatmentKey: "clinical.nyha.classITreatment",
    tone: "var(--success, #34d399)",
  },
  {
    id: "II",
    titleKey: "clinical.nyha.classIITitle",
    descKey: "clinical.nyha.classIIDesc",
    treatmentKey: "clinical.nyha.classIITreatment",
    tone: "var(--info, #38bdf8)",
  },
  {
    id: "III",
    titleKey: "clinical.nyha.classIIITitle",
    descKey: "clinical.nyha.classIIIDesc",
    treatmentKey: "clinical.nyha.classIIITreatment",
    tone: "var(--warning, #fbbf24)",
  },
  {
    id: "IV",
    titleKey: "clinical.nyha.classIVTitle",
    descKey: "clinical.nyha.classIVDesc",
    treatmentKey: "clinical.nyha.classIVTreatment",
    tone: "var(--danger, #ef4444)",
  },
];

export function NyhaClassificationCalculator({ onClose }: Props) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const sel = CLASSES.find(c => c.id === selected);

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>NYHA</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("clinical.nyha.subtitle")}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label={t("common.back")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {CLASSES.map(c => {
          const active = selected === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: 10,
                background: active ? "rgba(124,58,237,0.12)" : "var(--bg-elev-2, rgba(255,255,255,0.03))",
                border: `1px solid ${active ? "var(--brand, #7c3aed)" : "var(--border)"}`,
                cursor: "pointer",
                color: "var(--text-1)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: c.tone }}>{t(c.titleKey)}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.4 }}>{t(c.descKey)}</div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{t("clinical.nyha.classificationLabel")}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: sel.tone, marginBottom: 8 }}>{t(sel.titleKey)}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{t("clinical.nyha.suggestedTreatment")}</div>
          <div style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.5 }}>{t(sel.treatmentKey)}</div>
        </div>
      )}
    </div>
  );
}
