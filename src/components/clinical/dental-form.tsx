"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

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
const PROCEDURES = ["Profilaxis","Tartrectomía","Extracción simple","Extracción quirúrgica","Restauración resina","Amalgama","Corona porcelana","Corona metal-porcelana","Endodoncia unirradicular","Endodoncia birradicular","Endodoncia multirradicular","Implante dental","Ortodoncia brackets","Ortodoncia invisible","Carilla dental","Blanqueamiento","Periodoncia","Cirugía periodontal","Injerto óseo"];

interface Props { patientId: string; onSaved: (record: any) => void; isChild?: boolean }

export function DentalForm({ patientId, onSaved, isChild = false }: Props) {
  const [saving,     setSaving]     = useState(false);
  const [activeTool, setActiveTool] = useState<keyof typeof TOOTH_CONDITIONS>("caries");
  const [odontogram, setOdontogram] = useState<Record<number, string>>({});
  const upperTeeth = isChild ? UPPER_PRIMARY : UPPER_TEETH;
  const lowerTeeth = isChild ? LOWER_PRIMARY : LOWER_TEETH;
  const [selectedProcs, setSelectedProcs] = useState<string[]>([]);
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [form, setForm] = useState({
    subjective:  "",
    objective:   "",
    assessment:  "",
    plan:        "",
    periodontal: { plaque: "", calculus: "", gingival: "", pocketDepth: "", bleeding: false },
    xrays:       "",
    nextVisit:   "",
    medications: [{ drug: "", dose: "", duration: "" }],
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function clickTooth(num: number) {
    setSelectedTooth(num);
    setOdontogram(o => ({ ...o, [num]: activeTool }));
  }

  function toggleProc(p: string) {
    setSelectedProcs(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
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
          specialtyData: {
            type: "dental", odontogram,
            procedures: selectedProcs,
            periodontal: form.periodontal,
            xrays: form.xrays, nextVisit: form.nextVisit,
            medications: form.medications.filter(m => m.drug),
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente dental guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  const renderTooth = (num: number) => {
    const condition = odontogram[num] ?? "healthy";
    const style = TOOTH_CONDITIONS[condition];
    const isSelected = selectedTooth === num;
    return (
      <div key={num} className="flex flex-col items-center gap-0.5 cursor-pointer" onClick={() => clickTooth(num)}>
        <span className="text-[9px] text-muted-foreground font-mono">{num}</span>
        <div className="w-7 h-8 rounded-md flex items-center justify-center text-[9px] font-bold border-2 transition-all hover:scale-110"
          style={{ background: style.bg, borderColor: isSelected ? "#2563eb" : style.border, color: style.color, boxShadow: isSelected ? "0 0 0 2px #2563eb" : "none" }}>
          {condition === "absent" ? "X" : condition === "implant" ? "I" : condition === "endo" ? "E" : ""}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* ANAMNESIS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de consulta / HEA</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Antecedentes médicos relevantes</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diabetes, hipertensión, medicamentos actuales…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* ODONTOGRAMA */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🦷 Odontograma</h3>
          <span className="text-xs text-muted-foreground">{selectedTooth ? `Diente #${selectedTooth} seleccionado` : "Haz clic en un diente para marcarlo"}</span>
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
          <button onClick={() => { setOdontogram({}); setSelectedTooth(null); }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-300 text-slate-600 hover:bg-slate-50 ml-auto">
            Limpiar
          </button>
        </div>

        {/* Upper arch */}
        <div className="text-[10px] text-center text-muted-foreground mb-1 font-semibold">SUPERIOR</div>
        <div className="flex justify-center gap-1 mb-1">{upperTeeth.map(renderTooth)}</div>
        <div className="border-t-2 border-b-2 border-dashed border-muted my-2" />
        <div className="flex justify-center gap-1 mb-1">{lowerTeeth.map(renderTooth)}</div>
        <div className="text-[10px] text-center text-muted-foreground mt-1 font-semibold">INFERIOR</div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
          {Object.entries(TOOTH_CONDITIONS).map(([, val]) => (
            <div key={val.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="w-3 h-3 rounded border" style={{ background: val.bg, borderColor: val.border }} />
              {val.label}
            </div>
          ))}
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
              <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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

      {/* PROCEDIMIENTOS */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Procedimientos realizados en esta visita</h3>
        <div className="flex flex-wrap gap-2">
          {PROCEDURES.map(p => (
            <button key={p} onClick={() => toggleProc(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${selectedProcs.includes(p) ? "bg-brand-600 text-white border-brand-600" : "bg-white text-muted-foreground border-border hover:border-brand-300 hover:text-brand-600"}`}>
              {p}
            </button>
          ))}
        </div>
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
              <input className="flex h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Medicamento" value={med.drug}
                onChange={e => { const m = [...form.medications]; m[i].drug = e.target.value; set("medications", m); }} />
              <input className="flex h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Dosis (ej. 500mg c/8h)" value={med.dose}
                onChange={e => { const m = [...form.medications]; m[i].dose = e.target.value; set("medications", m); }} />
              <input className="flex h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Duración (ej. 7 días)" value={med.duration}
                onChange={e => { const m = [...form.medications]; m[i].duration = e.target.value; set("medications", m); }} />
            </div>
          ))}
        </div>
      </div>

      {/* DIAGNÓSTICO Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Observaciones clínicas / Diagnóstico</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico, hallazgos clínicos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan de tratamiento futuro</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Próximos procedimientos a realizar…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Radiografías tomadas</Label>
          <input className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Rx panorámica, periapical #26…" value={form.xrays} onChange={e => set("xrays", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Próxima cita recomendada</Label>
          <input className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
