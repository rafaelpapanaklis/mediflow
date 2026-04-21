"use client";
import { useState } from "react";
import { X } from "lucide-react";

export interface CalculatorResult { score: number | string; category?: string; risk?: string; recommendation?: string }

interface Props { onClose?: () => void }

const CLASSES = [
  {
    id: "I",
    title: "Clase I",
    desc: "Sin limitación de la actividad física. La actividad ordinaria no causa disnea, fatiga ni palpitaciones.",
    treatment: "Manejo con IECA/ARA II + beta-bloqueador. Modificaciones del estilo de vida.",
    tone: "var(--success, #34d399)",
  },
  {
    id: "II",
    title: "Clase II",
    desc: "Limitación leve. Cómodo en reposo; la actividad física ordinaria causa síntomas.",
    treatment: "IECA/ARA II + beta-bloqueador + diurético si congestión. Considerar ARNI.",
    tone: "var(--info, #38bdf8)",
  },
  {
    id: "III",
    title: "Clase III",
    desc: "Limitación marcada. Cómodo en reposo, pero actividad menor a la ordinaria causa síntomas.",
    treatment: "ARNI + beta-bloqueador + antagonista de mineralocorticoides + iSGLT2. Considerar dispositivos.",
    tone: "var(--warning, #fbbf24)",
  },
  {
    id: "IV",
    title: "Clase IV",
    desc: "Incapacidad para realizar cualquier actividad sin molestias. Síntomas en reposo.",
    treatment: "Terapia máxima tolerada. Evaluar trasplante cardíaco, dispositivo de asistencia ventricular o cuidados paliativos.",
    tone: "var(--danger, #ef4444)",
  },
];

export function NyhaClassificationCalculator({ onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = CLASSES.find(c => c.id === selected);

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>NYHA</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>Clasificación funcional en insuficiencia cardíaca</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 6 }} aria-label="Volver">
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
                <span style={{ fontSize: 14, fontWeight: 700, color: c.tone }}>{c.title}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.4 }}>{c.desc}</div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>CLASIFICACIÓN</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: sel.tone, marginBottom: 8 }}>{sel.title}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>TRATAMIENTO SUGERIDO</div>
          <div style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.5 }}>{sel.treatment}</div>
        </div>
      )}
    </div>
  );
}
