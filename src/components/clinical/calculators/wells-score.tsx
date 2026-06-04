"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

interface Criterion { key: string; labelKey: string; points: number }

const PE_CRITERIA: Criterion[] = [
  { key: "dvt_signs", labelKey: "clinical.wells.peDvtSigns", points: 3 },
  { key: "alt_dx", labelKey: "clinical.wells.peAltDx", points: 3 },
  { key: "hr", labelKey: "clinical.wells.peHr", points: 1.5 },
  { key: "immob", labelKey: "clinical.wells.peImmob", points: 1.5 },
  { key: "prev", labelKey: "clinical.wells.pePrev", points: 1.5 },
  { key: "hemo", labelKey: "clinical.wells.peHemo", points: 1 },
  { key: "cancer", labelKey: "clinical.wells.peCancer", points: 1 },
];

const DVT_CRITERIA: Criterion[] = [
  { key: "cancer", labelKey: "clinical.wells.dvtCancer", points: 1 },
  { key: "paralysis", labelKey: "clinical.wells.dvtParalysis", points: 1 },
  { key: "bedrest", labelKey: "clinical.wells.dvtBedrest", points: 1 },
  { key: "tender", labelKey: "clinical.wells.dvtTender", points: 1 },
  { key: "swelling", labelKey: "clinical.wells.dvtSwelling", points: 1 },
  { key: "calf", labelKey: "clinical.wells.dvtCalf", points: 1 },
  { key: "pitting", labelKey: "clinical.wells.dvtPitting", points: 1 },
  { key: "veins", labelKey: "clinical.wells.dvtVeins", points: 1 },
  { key: "prev_dvt", labelKey: "clinical.wells.dvtPrevDvt", points: 1 },
  { key: "alt_dx", labelKey: "clinical.wells.dvtAltDx", points: -2 },
];

function CriteriaList({ criteria, selected, onToggle }: {
  criteria: Criterion[];
  selected: Record<string, boolean>;
  onToggle: (k: string) => void;
}) {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {criteria.map(c => (
        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}>
          <input type="checkbox" checked={!!selected[c.key]} onChange={() => onToggle(c.key)} />
          <span>{t(c.labelKey)}</span>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>
            {c.points > 0 ? `+${c.points}` : c.points}
          </span>
        </label>
      ))}
    </div>
  );
}

export function WellsScoreCalculator({ onClose }: Props) {
  const t = useT();
  const [tab, setTab] = useState<"pe" | "dvt">("pe");
  const [peSel, setPeSel] = useState<Record<string, boolean>>({});
  const [dvtSel, setDvtSel] = useState<Record<string, boolean>>({});

  const peScore = PE_CRITERIA.reduce((acc, c) => acc + (peSel[c.key] ? c.points : 0), 0);
  const dvtScore = DVT_CRITERIA.reduce((acc, c) => acc + (dvtSel[c.key] ? c.points : 0), 0);

  const peResult =
    peScore > 4
      ? { label: t("clinical.wells.peLikely"), tone: "var(--danger, #ef4444)" }
      : { label: t("clinical.wells.peUnlikely"), tone: "var(--success, #34d399)" };

  const dvtResult =
    dvtScore >= 2 ? { label: t("clinical.wells.dvtLikely"), tone: "var(--danger, #ef4444)" }
    : dvtScore === 1 ? { label: t("clinical.wells.dvtModerate"), tone: "var(--warning, #fbbf24)" }
    : { label: t("clinical.wells.dvtLow"), tone: "var(--success, #34d399)" };

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Wells Score</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t("clinical.wells.subtitle")}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label={t("common.back")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, padding: 4, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.04))", border: "1px solid var(--border)" }}>
        {[
          { id: "pe", labelKey: "clinical.wells.tabPe" },
          { id: "dvt", labelKey: "clinical.wells.tabDvt" },
        ].map(tabItem => {
          const active = tab === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setTab(tabItem.id as "pe" | "dvt")}
              style={{
                flex: 1,
                padding: "8px 10px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: active ? "var(--brand, #7c3aed)" : "transparent",
                color: active ? "#fff" : "var(--text-2)",
              }}
            >
              {t(tabItem.labelKey)}
            </button>
          );
        })}
      </div>

      {tab === "pe" ? (
        <>
          <CriteriaList
            criteria={PE_CRITERIA}
            selected={peSel}
            onToggle={k => setPeSel(s => ({ ...s, [k]: !s[k] }))}
          />
          <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{t("clinical.wells.scorePe")}</span>
              <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: peResult.tone }}>{peScore}</span>
            </div>
            <div style={{ fontSize: 13, color: peResult.tone, fontWeight: 600 }}>{peResult.label}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{t("clinical.wells.peCutoff")}</div>
          </div>
        </>
      ) : (
        <>
          <CriteriaList
            criteria={DVT_CRITERIA}
            selected={dvtSel}
            onToggle={k => setDvtSel(s => ({ ...s, [k]: !s[k] }))}
          />
          <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{t("clinical.wells.scoreDvt")}</span>
              <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: dvtResult.tone }}>{dvtScore}</span>
            </div>
            <div style={{ fontSize: 13, color: dvtResult.tone, fontWeight: 600 }}>{dvtResult.label}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{t("clinical.wells.dvtCutoff")}</div>
          </div>
        </>
      )}
    </div>
  );
}
