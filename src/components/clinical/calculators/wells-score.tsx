"use client";
import { useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

interface Criterion { key: string; label: string; points: number }

const PE_CRITERIA: Criterion[] = [
  { key: "dvt_signs", label: "Signos clínicos de TVP", points: 3 },
  { key: "alt_dx", label: "Diagnóstico alternativo menos probable que TEP", points: 3 },
  { key: "hr", label: "Frecuencia cardíaca > 100 lpm", points: 1.5 },
  { key: "immob", label: "Inmovilización ≥ 3 días o cirugía en las últimas 4 semanas", points: 1.5 },
  { key: "prev", label: "TVP o TEP previos", points: 1.5 },
  { key: "hemo", label: "Hemoptisis", points: 1 },
  { key: "cancer", label: "Cáncer activo (tratamiento en los últimos 6 meses)", points: 1 },
];

const DVT_CRITERIA: Criterion[] = [
  { key: "cancer", label: "Cáncer activo", points: 1 },
  { key: "paralysis", label: "Parálisis, paresia o inmovilización de extremidad", points: 1 },
  { key: "bedrest", label: "Encamamiento > 3 días o cirugía mayor en 12 semanas", points: 1 },
  { key: "tender", label: "Dolor localizado en trayecto venoso profundo", points: 1 },
  { key: "swelling", label: "Hinchazón de toda la pierna", points: 1 },
  { key: "calf", label: "Pantorrilla hinchada > 3 cm vs contralateral", points: 1 },
  { key: "pitting", label: "Edema con fóvea en pierna sintomática", points: 1 },
  { key: "veins", label: "Venas superficiales colaterales dilatadas (no varicosas)", points: 1 },
  { key: "prev_dvt", label: "TVP previa documentada", points: 1 },
  { key: "alt_dx", label: "Diagnóstico alternativo igual o más probable que TVP", points: -2 },
];

function CriteriaList({ criteria, selected, onToggle }: {
  criteria: Criterion[];
  selected: Record<string, boolean>;
  onToggle: (k: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {criteria.map(c => (
        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}>
          <input type="checkbox" checked={!!selected[c.key]} onChange={() => onToggle(c.key)} />
          <span>{c.label}</span>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>
            {c.points > 0 ? `+${c.points}` : c.points}
          </span>
        </label>
      ))}
    </div>
  );
}

export function WellsScoreCalculator({ onClose }: Props) {
  const [tab, setTab] = useState<"pe" | "dvt">("pe");
  const [peSel, setPeSel] = useState<Record<string, boolean>>({});
  const [dvtSel, setDvtSel] = useState<Record<string, boolean>>({});

  const peScore = PE_CRITERIA.reduce((acc, c) => acc + (peSel[c.key] ? c.points : 0), 0);
  const dvtScore = DVT_CRITERIA.reduce((acc, c) => acc + (dvtSel[c.key] ? c.points : 0), 0);

  const peResult =
    peScore > 4
      ? { label: "TEP probable", tone: "var(--danger, #ef4444)" }
      : { label: "TEP poco probable", tone: "var(--success, #34d399)" };

  const dvtResult =
    dvtScore >= 2 ? { label: "TVP probable", tone: "var(--danger, #ef4444)" }
    : dvtScore === 1 ? { label: "Riesgo moderado", tone: "var(--warning, #fbbf24)" }
    : { label: "Baja probabilidad de TVP", tone: "var(--success, #34d399)" };

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>Wells Score</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Probabilidad clínica de TEP / TVP</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
            <X size={16} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, padding: 4, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.04))", border: "1px solid var(--border)" }}>
        {[
          { id: "pe", label: "TEP (Tromboembolismo pulmonar)" },
          { id: "dvt", label: "TVP (Trombosis venosa profunda)" },
        ].map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as "pe" | "dvt")}
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
              {t.label}
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
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SCORE TEP</span>
              <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: peResult.tone }}>{peScore}</span>
            </div>
            <div style={{ fontSize: 13, color: peResult.tone, fontWeight: 600 }}>{peResult.label}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Corte: ≤4 poco probable, &gt;4 probable.</div>
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
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>SCORE TVP</span>
              <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: dvtResult.tone }}>{dvtScore}</span>
            </div>
            <div style={{ fontSize: 13, color: dvtResult.tone, fontWeight: 600 }}>{dvtResult.label}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Corte: ≥2 probable, 1 moderado, ≤0 baja.</div>
          </div>
        </>
      )}
    </div>
  );
}
