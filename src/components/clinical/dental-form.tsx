"use client";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

interface CatalogProcedure { id: string; name: string; basePrice: number; category: string }
interface SelectedProcedure { id: string; name: string; price: number; quantity: number }

const TOOTH_CONDITIONS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  healthy:      { label: "Sano",          color: "#94a3b8", bg: "#fff",    border: "#94a3b8" },
  caries:       { label: "Caries",        color: "#7f1d1d", bg: "#fca5a5", border: "#ef4444" },
  restoration:  { label: "Restauración",  color: "#1e3a8a", bg: "#bfdbfe", border: "#3b82f6" },
  crown:        { label: "Corona",        color: "#78350f", bg: "#fde68a", border: "#f59e0b" },
  endo:         { label: "Endodoncia",    color: "#4c1d95", bg: "#c4b5fd", border: "#7c3aed" },
  absent:       { label: "Ausente",       color: "#94a3b8", bg: "#f1f5f9", border: "#cbd5e1" },
  extraction:   { label: "Extracción",    color: "#7c2d12", bg: "#fed7aa", border: "#f97316" },
  implant:      { label: "Implante",      color: "#064e3b", bg: "#a7f3d0", border: "#10b981" },
};

const UPPER_TEETH = [18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28];
const LOWER_TEETH = [48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38];

// Dentición temporal (FDI notation for primary teeth)
const UPPER_PRIMARY = [55,54,53,52,51, 61,62,63,64,65];
const LOWER_PRIMARY = [85,84,83,82,81, 71,72,73,74,75];
// Procedures are now loaded from /api/procedures catalog per clinic

// Surface keys: O=Oclusal/Incisal, M=Mesial, D=Distal, V=Vestibular, L=Lingual/Palatino
const SURFACES = ["O","M","D","V","L"] as const;
type Surface = typeof SURFACES[number];
type ToothSurfaces = Partial<Record<Surface, string>>;
// Whole-tooth conditions (applied to entire tooth, not per-surface)
const WHOLE_TOOTH_CONDITIONS = ["absent","extraction","implant","endo","crown"];

interface Props { patientId: string; onSaved: (record: any) => void; isChild?: boolean }

export function DentalForm({ patientId, onSaved, isChild = false }: Props) {
  const [saving,     setSaving]     = useState(false);
  const [activeTool, setActiveTool] = useState<keyof typeof TOOTH_CONDITIONS>("caries");
  // NEW: per-surface odontogram — Record<toothNumber, { O?: condition, M?: condition, ... }>
  const [odontogram, setOdontogram] = useState<Record<number, ToothSurfaces>>({});
  const upperTeeth = isChild ? UPPER_PRIMARY : UPPER_TEETH;
  const lowerTeeth = isChild ? LOWER_PRIMARY : LOWER_TEETH;
  const [catalog, setCatalog] = useState<CatalogProcedure[]>([]);
  const [selectedProcs, setSelectedProcs] = useState<SelectedProcedure[]>([]);
  const [procSearch, setProcSearch] = useState("");
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);

  // Load procedure catalog on mount
  useEffect(() => {
    fetch("/api/procedures")
      .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); })
      .then((data: CatalogProcedure[]) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  const filteredCatalog = useMemo(() => {
    const q = procSearch.toLowerCase().trim();
    if (!q) return catalog;
    return catalog.filter(p => p.name.toLowerCase().includes(q));
  }, [catalog, procSearch]);

  const proceduresTotal = useMemo(
    () => selectedProcs.reduce((sum, p) => sum + (p.price * p.quantity), 0),
    [selectedProcs]
  );
  const [form, setForm] = useState({
    subjective:  "",
    objective:   "",
    assessment:  "",
    plan:        "",
    periodontal: { plaque: "", calculus: "", gingival: "", pocketDepth: "", bleeding: false },
    occlusal: { molarClass: "", bite: [] as string[], overbite: "", overjet: "" },
    tmj: { opening: "", clicking: "", pain: "", guard: "" },
    hygieneInstructions: [] as string[],
    xrays:       "",
    nextVisit:   "",
    medications: [{ drug: "", dose: "", duration: "" }],
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function clickSurface(num: number, surface: Surface) {
    setSelectedTooth(num);
    if (WHOLE_TOOTH_CONDITIONS.includes(activeTool)) {
      // Whole-tooth conditions apply to all surfaces at once
      const all: ToothSurfaces = {};
      SURFACES.forEach(s => { all[s] = activeTool; });
      setOdontogram(o => ({ ...o, [num]: all }));
    } else {
      // Per-surface condition (caries, restoration)
      setOdontogram(o => {
        const prev = o[num] ?? {};
        const current = prev[surface];
        // Toggle: if already same condition, clear it
        const next = current === activeTool ? undefined : activeTool;
        const updated = { ...prev, [surface]: next };
        // Clean up undefined
        if (!next) delete updated[surface];
        return { ...o, [num]: updated };
      });
    }
  }

  function toggleProc(cat: CatalogProcedure) {
    setSelectedProcs(prev => {
      const exists = prev.find(p => p.id === cat.id);
      if (exists) return prev.filter(p => p.id !== cat.id);
      return [...prev, { id: cat.id, name: cat.name, price: cat.basePrice, quantity: 1 }];
    });
  }

  function updateProcPrice(id: string, price: number) {
    setSelectedProcs(prev => prev.map(p => p.id === id ? { ...p, price: Math.max(0, price) } : p));
  }

  function updateProcQty(id: string, qty: number) {
    setSelectedProcs(prev => prev.map(p => p.id === id ? { ...p, quantity: Math.max(1, qty) } : p));
  }

  function removeProc(id: string) {
    setSelectedProcs(prev => prev.filter(p => p.id !== id));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega al menos el motivo de consulta o diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective, objective: form.objective,
          assessment: form.assessment, plan: form.plan,
          // When procedures have prices, also auto-create a draft invoice
          autoInvoice: selectedProcs.length > 0,
          specialtyData: {
            type: "dental", odontogram,
            procedures: selectedProcs, // now array of {id, name, price, quantity}
            proceduresTotal,
            periodontal: form.periodontal,
            occlusal: form.occlusal,
            tmj: form.tmj,
            hygieneInstructions: form.hygieneInstructions,
            xrays: form.xrays, nextVisit: form.nextVisit,
            medications: form.medications.filter(m => m.drug),
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      if (selectedProcs.length > 0) {
        toast.success(`✅ Expediente guardado y factura borrador creada por ${formatCurrency(proceduresTotal)}`);
      } else {
        toast.success("Expediente dental guardado");
      }
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  function getSurfaceColor(num: number, surface: Surface): string {
    const cond = odontogram[num]?.[surface];
    return cond ? (TOOTH_CONDITIONS[cond]?.bg ?? "#fff") : "#fff";
  }
  function getSurfaceBorder(num: number, surface: Surface): string {
    const cond = odontogram[num]?.[surface];
    return cond ? (TOOTH_CONDITIONS[cond]?.border ?? "#94a3b8") : "#94a3b8";
  }
  function isWholeTooth(num: number): string | null {
    const t = odontogram[num];
    if (!t) return null;
    const vals = Object.values(t);
    if (vals.length === 5 && WHOLE_TOOTH_CONDITIONS.includes(vals[0]!) && vals.every(v => v === vals[0])) return vals[0]!;
    return null;
  }

  // Classic 5-surface tooth diagram (cross pattern)
  //        ┌──V──┐
  //        │╲   ╱│
  //        │M│O│D│
  //        │╱   ╲│
  //        └──L──┘
  const SZ = 48;       // total size — large enough to click comfortably
  const INNER = 18;    // center oclusal square
  const PAD = (SZ - INNER) / 2; // = 15
  // Centroids for surface labels
  const LABEL: Record<Surface, { x: number; y: number }> = {
    V: { x: SZ / 2,          y: PAD / 2 },
    L: { x: SZ / 2,          y: SZ - PAD / 2 },
    M: { x: PAD / 2,         y: SZ / 2 },
    D: { x: SZ - PAD / 2,    y: SZ / 2 },
    O: { x: SZ / 2,          y: SZ / 2 },
  };

  const renderTooth = (num: number) => {
    const isSelected = selectedTooth === num;
    const wholeCond = isWholeTooth(num);
    const wholeStyle = wholeCond ? TOOTH_CONDITIONS[wholeCond] : null;

    return (
      <div key={num} className="flex flex-col items-center gap-1">
        <span className="text-[10px] text-muted-foreground font-mono font-bold leading-none">{num}</span>
        {wholeCond && wholeStyle ? (
          /* Whole-tooth condition — single colored block */
          <div
            className="flex items-center justify-center rounded-lg border-2 cursor-pointer transition-all hover:scale-105"
            style={{ width: SZ, height: SZ, background: wholeStyle.bg, borderColor: isSelected ? "#2563eb" : wholeStyle.border, color: wholeStyle.color, boxShadow: isSelected ? "0 0 0 3px rgba(37,99,235,0.4)" : "none" }}
            onClick={() => clickSurface(num, "O")}
            title={`#${num} — ${wholeStyle.label}`}
          >
            <span className="text-sm font-bold">
              {wholeCond === "absent" ? "✕" : wholeCond === "implant" ? "I" : wholeCond === "endo" ? "E" : wholeCond === "crown" ? "C" : "EX"}
            </span>
          </div>
        ) : (
          /* Per-surface SVG diagram */
          <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`}
            className={`cursor-pointer transition-all hover:scale-105 rounded-lg ${isSelected ? "ring-2 ring-brand-600 ring-offset-1" : ""}`}
            style={{ filter: isSelected ? "drop-shadow(0 0 4px rgba(37,99,235,0.35))" : "none" }}>
            {/* Outer border */}
            <rect x="0" y="0" width={SZ} height={SZ} rx="6" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />

            {/* V - Vestibular (top) */}
            <polygon
              points={`1,1 ${SZ-1},1 ${PAD+INNER},${PAD} ${PAD},${PAD}`}
              fill={getSurfaceColor(num,"V")}
              stroke={getSurfaceBorder(num,"V")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"V")}
              className="hover:brightness-90 transition-all"
            ><title>V (Vestibular) #{num}</title></polygon>

            {/* L - Lingual (bottom) */}
            <polygon
              points={`${PAD},${PAD+INNER} ${PAD+INNER},${PAD+INNER} ${SZ-1},${SZ-1} 1,${SZ-1}`}
              fill={getSurfaceColor(num,"L")}
              stroke={getSurfaceBorder(num,"L")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"L")}
              className="hover:brightness-90 transition-all"
            ><title>L (Lingual) #{num}</title></polygon>

            {/* M - Mesial (left) */}
            <polygon
              points={`1,1 ${PAD},${PAD} ${PAD},${PAD+INNER} 1,${SZ-1}`}
              fill={getSurfaceColor(num,"M")}
              stroke={getSurfaceBorder(num,"M")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"M")}
              className="hover:brightness-90 transition-all"
            ><title>M (Mesial) #{num}</title></polygon>

            {/* D - Distal (right) */}
            <polygon
              points={`${PAD+INNER},${PAD} ${SZ-1},1 ${SZ-1},${SZ-1} ${PAD+INNER},${PAD+INNER}`}
              fill={getSurfaceColor(num,"D")}
              stroke={getSurfaceBorder(num,"D")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"D")}
              className="hover:brightness-90 transition-all"
            ><title>D (Distal) #{num}</title></polygon>

            {/* O - Oclusal (center) */}
            <rect
              x={PAD} y={PAD} width={INNER} height={INNER}
              fill={getSurfaceColor(num,"O")}
              stroke={getSurfaceBorder(num,"O")}
              strokeWidth="1"
              onClick={() => clickSurface(num,"O")}
              className="hover:brightness-90 transition-all"
            ><title>O (Oclusal) #{num}</title></rect>

            {/* Surface labels */}
            {SURFACES.map(s => (
              <text key={s} x={LABEL[s].x} y={LABEL[s].y} textAnchor="middle" dominantBaseline="central"
                fontSize="8" fontWeight="700" fill={odontogram[num]?.[s] ? TOOTH_CONDITIONS[odontogram[num]![s]!]?.color ?? "#94a3b8" : "#94a3b8"}
                pointerEvents="none" className="select-none">
                {s}
              </text>
            ))}
          </svg>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* ANAMNESIS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de consulta / HEA</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Antecedentes médicos relevantes</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diabetes, hipertensión, medicamentos actuales…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* ODONTOGRAMA */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🦷 Odontograma</h3>
          <span className="text-xs text-muted-foreground">{selectedTooth ? `Diente #${selectedTooth} seleccionado` : "Haz clic en una cara del diente (O=oclusal, M=mesial, D=distal, V=vestibular, L=lingual)"}</span>
        </div>

        {/* Tool selector */}
        <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-border">
          {Object.entries(TOOTH_CONDITIONS).map(([key, val]) => (
            <button key={key} onClick={() => setActiveTool(key as keyof typeof TOOTH_CONDITIONS)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${activeTool === key ? "ring-2 ring-brand-600 scale-105" : ""}`}
              style={{ background: val.bg, borderColor: val.border, color: val.color }}>
              {val.label}
            </button>
          ))}
          <button onClick={() => { setOdontogram({}); setSelectedTooth(null); }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 ml-auto">
            Limpiar todo
          </button>
        </div>

        {/* Upper arch */}
        <div className="text-[10px] text-center text-muted-foreground mb-2 font-bold uppercase tracking-wider">Arcada Superior</div>
        <div className="flex justify-center gap-1.5 flex-wrap mb-2">{upperTeeth.map(renderTooth)}</div>
        <div className="border-t-2 border-dashed border-muted/50 my-3 mx-8" />
        <div className="flex justify-center gap-1.5 flex-wrap mb-2">{lowerTeeth.map(renderTooth)}</div>
        <div className="text-[10px] text-center text-muted-foreground mt-2 font-bold uppercase tracking-wider">Arcada Inferior</div>

        {/* Selected tooth detail */}
        {selectedTooth && odontogram[selectedTooth] && Object.keys(odontogram[selectedTooth]!).length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-foreground">Diente #{selectedTooth}:</span>
              {SURFACES.map(s => {
                const cond = odontogram[selectedTooth!]?.[s];
                if (!cond) return null;
                const style = TOOTH_CONDITIONS[cond];
                const surfaceLabels: Record<Surface, string> = { O:"Oclusal", M:"Mesial", D:"Distal", V:"Vestibular", L:"Lingual" };
                return (
                  <span key={s} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                    style={{ background: style.bg, borderColor: style.border, color: style.color }}>
                    {surfaceLabels[s]}: {style.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
          {Object.entries(TOOTH_CONDITIONS).map(([, val]) => (
            <div key={val.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="w-3 h-3 rounded border" style={{ background: val.bg, borderColor: val.border }} />
              {val.label}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-muted-foreground">
          <span className="font-semibold">Caras:</span>
          <span>O = Oclusal</span>
          <span>M = Mesial</span>
          <span>D = Distal</span>
          <span>V = Vestibular</span>
          <span>L = Lingual/Palatino</span>
          <span className="ml-2 italic">Ausente, Corona, Endodoncia, Implante y Extracción aplican al diente completo</span>
        </div>
      </div>

      {/* PERIODONTAL */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación periodontal</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: "plaque",     label: "Índice de placa",  placeholder: "Ej. 35%" },
            { key: "calculus",   label: "Cálculo dental",   placeholder: "Leve / Moderado / Severo" },
            { key: "gingival",   label: "Estado gingival",  placeholder: "Sana / Inflamada" },
            { key: "pocketDepth",label: "Bolsas periodontales", placeholder: "Ej. 2-3mm" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <input className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder={f.placeholder}
                value={(form.periodontal as any)[f.key] ?? ""}
                onChange={e => set("periodontal", { ...form.periodontal, [f.key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input type="checkbox" id="bleeding" checked={form.periodontal.bleeding}
            onChange={e => set("periodontal", { ...form.periodontal, bleeding: e.target.checked })}
            className="w-4 h-4 accent-brand-600" />
          <label htmlFor="bleeding" className="text-sm font-medium">Sangrado al sondeo presente</label>
        </div>
      </div>

      {/* EVALUACIÓN OCLUSAL */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación Oclusal</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Clase molar</Label>
            <select
              className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.occlusal.molarClass}
              onChange={e => set("occlusal", { ...form.occlusal, molarClass: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              <option value="Clase I">Clase I</option>
              <option value="Clase II div 1">Clase II div 1</option>
              <option value="Clase II div 2">Clase II div 2</option>
              <option value="Clase III">Clase III</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sobremordida (mm)</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 3" value={form.occlusal.overbite}
              onChange={e => set("occlusal", { ...form.occlusal, overbite: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Overjet (mm)</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 2" value={form.occlusal.overjet}
              onChange={e => set("occlusal", { ...form.occlusal, overjet: e.target.value })} />
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Mordida</Label>
          <div className="flex flex-wrap gap-3 mt-1.5">
            {["Abierta anterior", "Cruzada posterior", "Cruzada anterior", "Profunda", "Normal"].map(opt => (
              <label key={opt} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="w-4 h-4 accent-brand-600"
                  checked={form.occlusal.bite.includes(opt)}
                  onChange={e => {
                    const bite = e.target.checked
                      ? [...form.occlusal.bite, opt]
                      : form.occlusal.bite.filter((b: string) => b !== opt);
                    set("occlusal", { ...form.occlusal, bite });
                  }} />
                {opt}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* EVALUACIÓN ATM / BRUXISMO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación ATM / Bruxismo</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Apertura bucal (mm)</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 42" value={form.tmj.opening}
              onChange={e => set("tmj", { ...form.tmj, opening: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Chasquido</Label>
            <select
              className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tmj.clicking}
              onChange={e => set("tmj", { ...form.tmj, clicking: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              <option value="Ninguno">Ninguno</option>
              <option value="Clic derecho">Clic derecho</option>
              <option value="Clic izquierdo">Clic izquierdo</option>
              <option value="Bilateral">Bilateral</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dolor ATM</Label>
            <select
              className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tmj.pain}
              onChange={e => set("tmj", { ...form.tmj, pain: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              <option value="Sin dolor">Sin dolor</option>
              <option value="Leve">Leve</option>
              <option value="Moderado">Moderado</option>
              <option value="Severo">Severo</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Guarda oclusal</Label>
            <select
              className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tmj.guard}
              onChange={e => set("tmj", { ...form.tmj, guard: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              <option value="No usa">No usa</option>
              <option value="Usa — buen estado">Usa — buen estado</option>
              <option value="Usa — desgastada">Usa — desgastada</option>
              <option value="Recomendada">Recomendada</option>
            </select>
          </div>
        </div>
      </div>

      {/* INSTRUCCIONES DE HIGIENE ORAL */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Instrucciones de higiene oral</h3>
        <div className="flex flex-wrap gap-3">
          {[
            "Técnica de cepillado enseñada (Bass modificada)",
            "Uso de hilo dental instruido",
            "Enjuague con fluoruro recomendado",
            "Dieta baja en azúcares refinados discutida",
            "Cepillo interdental recomendado",
            "Profilaxis con pasta fluorada aplicada",
          ].map(opt => (
            <label key={opt} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="w-4 h-4 accent-brand-600"
                checked={form.hygieneInstructions.includes(opt)}
                onChange={e => {
                  const updated = e.target.checked
                    ? [...form.hygieneInstructions, opt]
                    : form.hygieneInstructions.filter((h: string) => h !== opt);
                  set("hygieneInstructions", updated);
                }} />
              {opt}
            </label>
          ))}
        </div>
      </div>

      {/* PROCEDIMIENTOS Y FACTURACIÓN */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">💰 Procedimientos realizados</h3>
          {selectedProcs.length > 0 && (
            <div className="text-sm font-bold text-brand-700 dark:text-brand-400">
              Total: {formatCurrency(proceduresTotal)}
            </div>
          )}
        </div>

        {/* Selected procedures table */}
        {selectedProcs.length > 0 && (
          <div className="mb-3 rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Procedimiento</th>
                  <th className="text-center px-2 py-2 font-bold w-16">Cant.</th>
                  <th className="text-right px-2 py-2 font-bold w-24">Precio</th>
                  <th className="text-right px-3 py-2 font-bold w-24">Subtotal</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {selectedProcs.map(p => (
                  <tr key={p.id} className="border-t border-border/50">
                    <td className="px-3 py-1.5 font-semibold">{p.name}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="1" value={p.quantity}
                        onChange={e => updateProcQty(p.id, parseInt(e.target.value) || 1)}
                        className="w-14 h-7 text-center rounded border border-border bg-white dark:bg-slate-800 text-xs" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" value={p.price}
                        onChange={e => updateProcPrice(p.id, parseFloat(e.target.value) || 0)}
                        className="w-20 h-7 text-right rounded border border-border bg-white dark:bg-slate-800 text-xs" />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">{formatCurrency(p.price * p.quantity)}</td>
                    <td className="pr-2">
                      <button onClick={() => removeProc(p.id)} className="text-rose-500 hover:text-rose-700 text-sm">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-50 dark:bg-brand-950/30">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-bold">TOTAL</td>
                  <td className="px-3 py-2 text-right font-mono font-extrabold text-brand-700 dark:text-brand-400">{formatCurrency(proceduresTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Catalog search */}
        <div className="mb-2">
          <input
            type="text"
            placeholder="🔍 Buscar procedimiento del catálogo..."
            className="w-full h-9 rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            value={procSearch}
            onChange={e => setProcSearch(e.target.value)}
          />
        </div>

        {/* Available procedures */}
        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
          {filteredCatalog.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              {catalog.length === 0
                ? "No hay procedimientos en el catálogo. Ve a Configuración → Procedimientos para agregar."
                : "Sin resultados"}
            </div>
          ) : filteredCatalog.map(p => {
            const isSelected = selectedProcs.some(sp => sp.id === p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggleProc(p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${isSelected ? "bg-brand-600 text-white border-brand-600" : "bg-white dark:bg-slate-900 text-muted-foreground border-border hover:border-brand-300 hover:text-brand-600"}`}>
                {isSelected && "✓"} {p.name}
                <span className={`text-[10px] ${isSelected ? "text-white/80" : "text-brand-600"}`}>
                  {formatCurrency(p.basePrice)}
                </span>
              </button>
            );
          })}
        </div>

        {selectedProcs.length > 0 && (
          <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
            💡 Al guardar el expediente se creará automáticamente una factura borrador con estos procedimientos. Podrás editarla en la sección de Facturación antes de confirmar.
          </div>
        )}
      </div>

      {/* PRESCRIPCIÓN */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">💊 Prescripción médica</h3>
          <button className="text-xs font-semibold text-brand-600 hover:underline"
            onClick={() => set("medications", [...form.medications, { drug:"", dose:"", duration:"" }])}>+ Agregar</button>
        </div>
        <div className="space-y-2">
          {form.medications.map((med, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input className="flex h-9 rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none" placeholder="Medicamento" value={med.drug}
                onChange={e => { const m = [...form.medications]; m[i].drug = e.target.value; set("medications", m); }} />
              <input className="flex h-9 rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none" placeholder="Dosis (ej. 500mg c/8h)" value={med.dose}
                onChange={e => { const m = [...form.medications]; m[i].dose = e.target.value; set("medications", m); }} />
              <input className="flex h-9 rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none" placeholder="Duración (ej. 7 días)" value={med.duration}
                onChange={e => { const m = [...form.medications]; m[i].duration = e.target.value; set("medications", m); }} />
            </div>
          ))}
        </div>
      </div>

      {/* DIAGNÓSTICO Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Observaciones clínicas / Diagnóstico</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico, hallazgos clínicos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan de tratamiento futuro</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Próximos procedimientos a realizar…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Radiografías tomadas</Label>
          <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Rx panorámica, periapical #26…" value={form.xrays} onChange={e => set("xrays", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Próxima cita recomendada</Label>
          <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="En 3 meses, urgente, etc." value={form.nextVisit} onChange={e => set("nextVisit", e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "💾 Guardar expediente dental"}
        </Button>
      </div>
    </div>
  );
}
