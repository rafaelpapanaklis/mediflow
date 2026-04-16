"use client";
import { useState } from "react";
import toast from "react-hot-toast";

// FDI notation - 6 measurement points per tooth (buccal: distobuccal, buccal, mesiobuccal; lingual: distolingual, lingual, mesiolingual)
const UPPER_TEETH = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const LOWER_TEETH = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

type ToothData = {
  buccal:   [number,number,number]; // dist, center, mes
  lingual:  [number,number,number];
  bleeding: [boolean,boolean,boolean,boolean,boolean,boolean]; // 6 points
  furcation: 0|1|2|3; // 0=none, 1=class I, 2=II, 3=III
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
    if (val <= 3) return "#10b981"; // healthy
    if (val <= 5) return "#f59e0b"; // moderate
    return "#ef4444";               // severe
  }

  // Calculate indices
  const allTeeth = [...UPPER_TEETH, ...LOWER_TEETH];
  const totalPoints = allTeeth.length * 6;
  const bleedingPoints = allTeeth.reduce((s, n) => s + teeth[n].bleeding.filter(Boolean).length, 0);
  const bleedingIndex  = Math.round((bleedingPoints / totalPoints) * 100);
  const avgPocket      = allTeeth.reduce((s, n) => {
    const t = teeth[n];
    return s + t.buccal.reduce((a,b)=>a+b,0) + t.lingual.reduce((a,b)=>a+b,0);
  }, 0) / (allTeeth.length * 6);
  const plaqIndex = bleedingIndex; // simplified

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/periodontal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, clinicId, measurements: teeth, notes, bleedingIndex, plaquIndex: plaqIndex }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("✅ Periodontograma guardado");
      onSaved?.();
    } catch(e: any) { toast.error(e.message); }
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
    const maxPocket  = Math.max(...t.buccal, ...t.lingual);
    const hasBleed   = t.bleeding.some(Boolean);
    return (
      <button key={num} onClick={() => setSelected(isSelected ? null : num)}
        className={`flex flex-col items-center gap-0.5 p-1 rounded-lg transition-all ${isSelected ? "bg-brand-100 dark:bg-brand-900/40 ring-2 ring-brand-500" : "hover:bg-muted/50"}`}
        style={{ minWidth: 32 }}>
        <div className="text-[9px] font-bold text-muted-foreground">{num}</div>
        {/* Pocket depth bars */}
        <div className="flex gap-px">
          {t.buccal.map((v, i) => (
            <div key={i} className="w-1.5 rounded-sm" style={{ height: Math.max(4, v * 3), background: getPocketColor(v) }} />
          ))}
        </div>
        {/* Bleeding indicator */}
        <div className={`w-2 h-2 rounded-full ${hasBleed ? "bg-red-500" : "bg-muted"}`} />
        {t.furcation > 0 && <div className="text-[8px] text-amber-500 font-bold">F{t.furcation}</div>}
      </button>
    );
  }

  const sel = selected ? teeth[selected] : null;

  return (
    <div className="space-y-4">
      {/* Summary indices */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Índice de sangrado</div>
          <div className={`text-2xl font-bold ${bleedingIndex > 20 ? "text-red-500" : bleedingIndex > 10 ? "text-amber-500" : "text-emerald-500"}`}>
            {bleedingIndex}%
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Bolsa promedio</div>
          <div className={`text-2xl font-bold ${avgPocket > 5 ? "text-red-500" : avgPocket > 3 ? "text-amber-500" : "text-emerald-500"}`}>
            {avgPocket.toFixed(1)} mm
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Puntos con sangrado</div>
          <div className="text-2xl font-bold text-foreground">{bleedingPoints}/{totalPoints}</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"/>≤3mm sano</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block"/>4-5mm moderado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block"/>≥6mm severo</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>Sangrado</span>
      </div>

      {/* Upper teeth */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1">Superior</div>
        <div className="flex gap-1 flex-wrap justify-center bg-muted/30 rounded-xl p-2">
          {UPPER_TEETH.map(n => renderToothBar(n))}
        </div>
      </div>

      {/* Lower teeth */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-1">Inferior</div>
        <div className="flex gap-1 flex-wrap justify-center bg-muted/30 rounded-xl p-2">
          {LOWER_TEETH.map(n => renderToothBar(n))}
        </div>
      </div>

      {/* Selected tooth editor */}
      {selected && sel && (
        <div className="border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/20 rounded-xl p-4 space-y-4">
          <div className="font-bold text-sm">Diente {selected}</div>

          <div className="grid grid-cols-2 gap-4">
            {/* Buccal */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2">Vestibular (D-C-M)</div>
              <div className="flex gap-2">
                {sel.buccal.map((v, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <input type="number" min="0" max="12" value={v}
                      onChange={e => updatePocket(selected, "buccal", i as 0|1|2, parseInt(e.target.value)||0)}
                      className="w-12 text-center text-sm border border-border rounded-lg py-1 bg-background font-mono"
                      style={{ color: getPocketColor(v) }} />
                    <button onClick={() => toggleBleeding(selected, i)}
                      className={`w-5 h-5 rounded-full border-2 ${sel.bleeding[i] ? "bg-red-500 border-red-500" : "border-border"}`} />
                  </div>
                ))}
              </div>
            </div>
            {/* Lingual */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-2">Lingual (D-C-M)</div>
              <div className="flex gap-2">
                {sel.lingual.map((v, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <input type="number" min="0" max="12" value={v}
                      onChange={e => updatePocket(selected, "lingual", i as 0|1|2, parseInt(e.target.value)||0)}
                      className="w-12 text-center text-sm border border-border rounded-lg py-1 bg-background font-mono"
                      style={{ color: getPocketColor(v) }} />
                    <button onClick={() => toggleBleeding(selected, i+3)}
                      className={`w-5 h-5 rounded-full border-2 ${sel.bleeding[i+3] ? "bg-red-500 border-red-500" : "border-border"}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Furca</label>
              <select value={sel.furcation}
                onChange={e => updateTooth(selected, "furcation", parseInt(e.target.value) as 0|1|2|3)}
                className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background">
                <option value="0">Sin compromiso</option>
                <option value="1">Clase I</option>
                <option value="2">Clase II</option>
                <option value="3">Clase III</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Recesión (mm)</label>
              <input type="number" min="0" max="10" value={sel.recession}
                onChange={e => updateTooth(selected, "recession", parseInt(e.target.value)||0)}
                className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Movilidad</label>
              <select value={sel.mobility}
                onChange={e => updateTooth(selected, "mobility", parseInt(e.target.value) as 0|1|2|3)}
                className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-background">
                <option value="0">Sin movilidad</option>
                <option value="1">Grado I</option>
                <option value="2">Grado II</option>
                <option value="3">Grado III</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-xs font-semibold text-muted-foreground block mb-1">Notas clínicas</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Observaciones, diagnóstico, plan de tratamiento periodontal..."
          className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-background resize-none" />
      </div>

      <div className="flex gap-2">
        <button onClick={loadHistory} disabled={loadingHist}
          className="text-sm border border-border rounded-xl px-4 py-2 hover:bg-muted font-semibold">
          {loadingHist ? "..." : "📋 Ver historial"}
        </button>
        <button onClick={save} disabled={saving}
          className="flex-1 bg-brand-600 text-white rounded-xl py-2 text-sm font-bold hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Guardando..." : "💾 Guardar periodontograma"}
        </button>
      </div>

      {/* History */}
      {showHistory && history.length > 0 && (
        <div className="border border-border rounded-xl p-4 space-y-2">
          <div className="font-semibold text-sm">Historial periodontogramas</div>
          {history.map((h: any) => (
            <div key={h.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div className="text-sm">{new Date(h.recordedAt).toLocaleDateString("es-MX", {day:"numeric",month:"long",year:"numeric"})}</div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>Sangrado: <strong>{h.bleedingIndex}%</strong></span>
                <span>Placa: <strong>{Math.round(h.plaquIndex)}%</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
