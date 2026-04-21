"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";

// FDI notation - 6 measurement points per tooth (buccal: distobuccal, buccal, mesiobuccal; lingual: distolingual, lingual, mesiolingual)
const UPPER_TEETH = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const LOWER_TEETH = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

type ToothData = {
  buccal:   [number,number,number];
  lingual:  [number,number,number];
  bleeding: [boolean,boolean,boolean,boolean,boolean,boolean];
  furcation: 0|1|2|3;
  recession: number;
  mobility:  0|1|2|3;
};

function defaultTooth(): ToothData {
  return { buccal:[2,2,2], lingual:[2,2,2], bleeding:[false,false,false,false,false,false], furcation:0, recession:0, mobility:0 };
}

function initTeeth(): Record<number, ToothData> {
  const t: Record<number, ToothData> = {};
  [...UPPER_TEETH, ...LOWER_TEETH].forEach(n => { t[n] = defaultTooth(); });
  return t;
}

interface Props { patientId: string; clinicId: string; onSaved?: () => void }

export function PeriodontalForm({ patientId, clinicId, onSaved }: Props) {
  const [teeth, setTeeth]         = useState<Record<number, ToothData>>(initTeeth);
  const [selected, setSelected]   = useState<number | null>(null);
  const [saving, setSaving]       = useState(false);
  const [notes, setNotes]         = useState("");
  const [history, setHistory]     = useState<any[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  function updateTooth(num: number, field: keyof ToothData, value: any) {
    setTeeth(prev => ({ ...prev, [num]: { ...prev[num], [field]: value } }));
  }

  function updatePocket(num: number, side: "buccal"|"lingual", idx: 0|1|2, val: number) {
    setTeeth(prev => {
      const arr = [...prev[num][side]] as [number,number,number];
      arr[idx] = Math.max(0, Math.min(12, val));
      return { ...prev, [num]: { ...prev[num], [side]: arr } };
    });
  }

  function toggleBleeding(num: number, idx: number) {
    setTeeth(prev => {
      const b = [...prev[num].bleeding] as [boolean,boolean,boolean,boolean,boolean,boolean];
      b[idx] = !b[idx];
      return { ...prev, [num]: { ...prev[num], bleeding: b } };
    });
  }

  function getPocketColor(val: number) {
    if (val <= 3) return "#10b981";
    if (val <= 5) return "#f59e0b";
    return "#ef4444";
  }

  const allTeeth = [...UPPER_TEETH, ...LOWER_TEETH];
  const totalPoints = allTeeth.length * 6;
  const bleedingPoints = allTeeth.reduce((s, n) => s + teeth[n].bleeding.filter(Boolean).length, 0);
  const bleedingIndex  = Math.round((bleedingPoints / totalPoints) * 100);
  const avgPocket      = allTeeth.reduce((s, n) => {
    const t = teeth[n];
    return s + t.buccal.reduce((a,b)=>a+b,0) + t.lingual.reduce((a,b)=>a+b,0);
  }, 0) / (allTeeth.length * 6);
  const plaqIndex = bleedingIndex;

  const bleedTone: "success" | "warning" | "danger" = bleedingIndex <= 10 ? "success" : bleedingIndex <= 20 ? "warning" : "danger";
  const pocketTone: "success" | "warning" | "danger" = avgPocket <= 3 ? "success" : avgPocket <= 5 ? "warning" : "danger";

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/periodontal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, clinicId, measurements: teeth, notes, bleedingIndex, plaquIndex: plaqIndex }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Periodontograma guardado");
      onSaved?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function loadHistory() {
    setLoadingHist(true);
    const res = await fetch(`/api/periodontal?patientId=${patientId}`);
    if (res.ok) setHistory(await res.json());
    setLoadingHist(false);
    setShowHistory(true);
  }

  function renderToothBar(num: number) {
    const t = teeth[num];
    const isSelected = selected === num;
    const hasBleed   = t.bleeding.some(Boolean);
    return (
      <button
        key={num}
        type="button"
        onClick={() => setSelected(isSelected ? null : num)}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          padding: 4,
          borderRadius: 6,
          minWidth: 32,
          cursor: "pointer",
          background: isSelected ? "var(--brand-soft)" : "transparent",
          border: isSelected ? "1px solid rgba(124,58,237,0.3)" : "1px solid transparent",
          transition: "all .12s",
        }}
      >
        <div className="mono" style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600 }}>{num}</div>
        <div style={{ display: "flex", gap: 1 }}>
          {t.buccal.map((v, i) => (
            <div
              key={i}
              style={{
                width: 6,
                borderRadius: 2,
                height: Math.max(4, v * 3),
                background: getPocketColor(v),
              }}
            />
          ))}
        </div>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: hasBleed ? "var(--danger)" : "rgba(255,255,255,0.06)",
            boxShadow: hasBleed ? "0 0 6px var(--danger)" : "none",
          }}
        />
        {t.furcation > 0 && (
          <div className="mono" style={{ fontSize: 8, color: "var(--warning)", fontWeight: 700 }}>F{t.furcation}</div>
        )}
      </button>
    );
  }

  const sel = selected ? teeth[selected] : null;

  // Input común para los puntos de sondaje
  const pocketInputStyle: React.CSSProperties = {
    width: 42,
    height: 30,
    textAlign: "center",
    fontSize: 12,
    fontFamily: "var(--font-jetbrains-mono, monospace)",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-soft)",
    borderRadius: 6,
    padding: 0,
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Índices */}
      <CardNew title="Índices periodontales">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          <div style={{
            padding: 14,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Índice de sangrado
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: "var(--text-1)" }}>{bleedingIndex}</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>%</span>
            </div>
            <div style={{ marginTop: 6 }}><BadgeNew tone={bleedTone} dot>{bleedTone === "success" ? "Óptimo" : bleedTone === "warning" ? "Moderado" : "Alto"}</BadgeNew></div>
          </div>
          <div style={{
            padding: 14,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Bolsa promedio
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600, color: "var(--text-1)" }}>{avgPocket.toFixed(1)}</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>mm</span>
            </div>
            <div style={{ marginTop: 6 }}><BadgeNew tone={pocketTone} dot>{pocketTone === "success" ? "Sano" : pocketTone === "warning" ? "Moderado" : "Severo"}</BadgeNew></div>
          </div>
          <div style={{
            padding: 14,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Puntos con sangrado
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: "var(--text-1)" }}>
              {bleedingPoints}<span style={{ color: "var(--text-3)", fontSize: 14 }}>/{totalPoints}</span>
            </div>
          </div>
        </div>

        {/* Leyenda */}
        <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 11, color: "var(--text-3)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#10b981" }} /> ≤3mm sano
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f59e0b" }} /> 4-5mm moderado
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#ef4444" }} /> ≥6mm severo
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)" }} /> Sangrado
          </span>
        </div>
      </CardNew>

      {/* Sondaje periodontal */}
      <CardNew title="Sondaje periodontal" sub="FDI — 32 dientes · 6 puntos cada uno">
        <div style={{
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
        }}>
          <div style={{
            fontSize: 11, color: "var(--text-3)",
            textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
            marginBottom: 10,
          }}>
            Maxilar superior
          </div>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center", marginBottom: 14 }}>
            {UPPER_TEETH.map(n => renderToothBar(n))}
          </div>

          <div style={{ borderTop: "2px dashed var(--border-soft)", margin: "4px 32px 14px" }} />

          <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center", marginBottom: 10 }}>
            {LOWER_TEETH.map(n => renderToothBar(n))}
          </div>
          <div style={{
            fontSize: 11, color: "var(--text-3)",
            textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
            textAlign: "left",
          }}>
            Maxilar inferior
          </div>
        </div>

        {/* Editor del diente seleccionado */}
        {selected && sel && (
          <div style={{
            marginTop: 14,
            padding: 16,
            background: "var(--brand-softer)",
            border: "1px solid rgba(124,58,237,0.25)",
            borderRadius: "var(--radius)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>Diente</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "#c4b5fd" }}>#{selected}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {/* Vestibular */}
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Vestibular (D-C-M)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {sel.buccal.map((v, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <input
                        type="number" min="0" max="12"
                        value={v}
                        onChange={e => updatePocket(selected, "buccal", i as 0|1|2, parseInt(e.target.value) || 0)}
                        style={{ ...pocketInputStyle, color: getPocketColor(v), fontWeight: 600 }}
                      />
                      <button
                        type="button"
                        onClick={() => toggleBleeding(selected, i)}
                        style={{
                          width: 18, height: 18, borderRadius: "50%",
                          background: sel.bleeding[i] ? "var(--danger)" : "transparent",
                          border: `2px solid ${sel.bleeding[i] ? "var(--danger)" : "var(--border-soft)"}`,
                          cursor: "pointer",
                          boxShadow: sel.bleeding[i] ? "0 0 6px var(--danger)" : "none",
                        }}
                        aria-label="Sangrado"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Lingual */}
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Lingual (D-C-M)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {sel.lingual.map((v, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <input
                        type="number" min="0" max="12"
                        value={v}
                        onChange={e => updatePocket(selected, "lingual", i as 0|1|2, parseInt(e.target.value) || 0)}
                        style={{ ...pocketInputStyle, color: getPocketColor(v), fontWeight: 600 }}
                      />
                      <button
                        type="button"
                        onClick={() => toggleBleeding(selected, i + 3)}
                        style={{
                          width: 18, height: 18, borderRadius: "50%",
                          background: sel.bleeding[i + 3] ? "var(--danger)" : "transparent",
                          border: `2px solid ${sel.bleeding[i + 3] ? "var(--danger)" : "var(--border-soft)"}`,
                          cursor: "pointer",
                          boxShadow: sel.bleeding[i + 3] ? "0 0 6px var(--danger)" : "none",
                        }}
                        aria-label="Sangrado"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">Furcación</label>
                <select
                  className="input-new"
                  value={sel.furcation}
                  onChange={e => updateTooth(selected, "furcation", parseInt(e.target.value) as 0|1|2|3)}
                >
                  <option value="0">Sin compromiso</option>
                  <option value="1">Clase I</option>
                  <option value="2">Clase II</option>
                  <option value="3">Clase III</option>
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">Recesión (mm)</label>
                <input
                  type="number" min="0" max="10"
                  className="input-new mono"
                  value={sel.recession}
                  onChange={e => updateTooth(selected, "recession", parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Movilidad</label>
                <select
                  className="input-new"
                  value={sel.mobility}
                  onChange={e => updateTooth(selected, "mobility", parseInt(e.target.value) as 0|1|2|3)}
                >
                  <option value="0">Sin movilidad</option>
                  <option value="1">Grado I</option>
                  <option value="2">Grado II</option>
                  <option value="3">Grado III</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </CardNew>

      {/* Notas + historial */}
      <CardNew title="Notas clínicas y plan periodontal">
        <div className="field-new">
          <label className="field-new__label">Observaciones, diagnóstico y plan</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
            placeholder="Observaciones, diagnóstico, plan de tratamiento periodontal…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <ButtonNew variant="secondary" onClick={loadHistory} disabled={loadingHist}>
            {loadingHist ? "Cargando…" : "Ver historial"}
          </ButtonNew>
          <ButtonNew variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar periodontograma"}
          </ButtonNew>
        </div>

        {showHistory && history.length > 0 && (
          <div style={{
            marginTop: 14,
            padding: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
              Historial de periodontogramas
            </div>
            <div>
              {history.map((h: any) => (
                <div
                  key={h.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--border-soft)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "var(--text-1)" }}>
                    {new Date(h.recordedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-3)" }}>
                    <span>Sangrado: <strong className="mono" style={{ color: "var(--text-2)" }}>{h.bleedingIndex}%</strong></span>
                    <span>Placa: <strong className="mono" style={{ color: "var(--text-2)" }}>{Math.round(h.plaquIndex)}%</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardNew>
    </div>
  );
}
