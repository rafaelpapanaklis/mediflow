"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const TEETH_UPPER = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
const TEETH_LOWER = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

const TOOTH_CONDITIONS: Record<string, { label: string; color: string }> = {
  healthy:    { label: "Sano",        color: "bg-white border-slate-300" },
  caries:     { label: "Caries",      color: "bg-red-400 border-red-500 text-white" },
  filled:     { label: "Obturado",    color: "bg-blue-400 border-blue-500 text-white" },
  crown:      { label: "Corona",      color: "bg-yellow-400 border-yellow-500" },
  missing:    { label: "Ausente",     color: "bg-slate-400 border-slate-500 text-white" },
  extracted:  { label: "Extraído",    color: "bg-slate-600 border-slate-700 text-white" },
  implant:    { label: "Implante",    color: "bg-violet-400 border-violet-500 text-white" },
  fracture:   { label: "Fractura",    color: "bg-orange-400 border-orange-500 text-white" },
  root_canal: { label: "Endodoncia",  color: "bg-pink-400 border-pink-500 text-white" },
  bridge:     { label: "Puente",      color: "bg-emerald-400 border-emerald-500 text-white" },
};

const DENTAL_PROCEDURES = [
  "Extracción simple","Extracción quirúrgica","Obturación resina","Obturación amalgama",
  "Endodoncia anterior","Endodoncia posterior","Corona metal-porcelana","Corona zirconia",
  "Limpieza/Profilaxis","Raspado y alisado","Implante dental","Puente fijo",
  "Blanqueamiento","Ortodoncia brackets","Ortodoncia invisible","Carilla de porcelana",
  "Radiografía periapical","Radiografía panorámica","Cirugía de encías","Otro",
];

interface ToothState {
  condition: string;
  notes: string;
}

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function DentalForm({ patientId, onSaved }: Props) {
  const [teeth, setTeeth]         = useState<Record<number, ToothState>>({});
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState("caries");
  const [saving, setSaving]       = useState(false);
  const [form, setForm] = useState({
    chiefComplaint: "",
    medicalHistory: "",
    lastVisit: "",
    procedures: [] as string[],
    periodontal: { plaque: "", calculus: "", gingival: "", pocketDepth: "" },
    vitals: { bloodPressure: "", heartRate: "", notes: "" },
    treatment: "",
    nextVisit: "",
    observations: "",
    xrays: "",
  });

  function paintTooth(toothNum: number) {
    setTeeth(prev => ({
      ...prev,
      [toothNum]: { condition: activeTool, notes: prev[toothNum]?.notes ?? "" },
    }));
  }

  function toggleProcedure(proc: string) {
    setForm(f => ({
      ...f,
      procedures: f.procedures.includes(proc)
        ? f.procedures.filter(p => p !== proc)
        : [...f.procedures, proc],
    }));
  }

  async function handleSave() {
    if (!form.chiefComplaint) { toast.error("Ingresa el motivo de consulta"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.chiefComplaint,
          objective:  form.medicalHistory,
          assessment: form.observations,
          plan:       form.treatment,
          vitals:     form.vitals,
          specialtyData: {
            type: "dental",
            odontogram: teeth,
            procedures: form.procedures,
            periodontal: form.periodontal,
            lastVisit: form.lastVisit,
            nextVisit: form.nextVisit,
            xrays: form.xrays,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      toast.success("Expediente dental guardado");
      onSaved(record);
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const ToothButton = ({ num }: { num: number }) => {
    const state = teeth[num];
    const cfg   = TOOTH_CONDITIONS[state?.condition ?? "healthy"];
    return (
      <button onClick={() => paintTooth(num)} title={`Diente ${num}`}
        className={`w-8 h-8 rounded border-2 text-[10px] font-bold transition-all hover:scale-110 ${cfg.color}`}>
        {num}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Motivo y antecedentes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de consulta *</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Dolor en molar superior derecho, sensibilidad al frío…"
            value={form.chiefComplaint} onChange={e => setForm(f => ({ ...f, chiefComplaint: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Antecedentes médicos relevantes</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Diabetes, hipertensión, alergias a anestesia…"
            value={form.medicalHistory} onChange={e => setForm(f => ({ ...f, medicalHistory: e.target.value }))} />
        </div>
      </div>

      {/* Signos vitales */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📊 Signos vitales</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Presión arterial</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="120/80 mmHg" value={form.vitals.bloodPressure}
              onChange={e => setForm(f => ({ ...f, vitals: { ...f.vitals, bloodPressure: e.target.value } }))} />
          </div>
          <div className="space-y-1">
            <Label>Frecuencia cardíaca</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="72 bpm" value={form.vitals.heartRate}
              onChange={e => setForm(f => ({ ...f, vitals: { ...f.vitals, heartRate: e.target.value } }))} />
          </div>
          <div className="space-y-1">
            <Label>Notas</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Observaciones…" value={form.vitals.notes}
              onChange={e => setForm(f => ({ ...f, vitals: { ...f.vitals, notes: e.target.value } }))} />
          </div>
        </div>
      </div>

      {/* Odontograma */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🦷 Odontograma</h3>

        {/* Tools */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Object.entries(TOOTH_CONDITIONS).map(([key, val]) => (
            <button key={key} onClick={() => setActiveTool(key)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all ${activeTool === key ? "ring-2 ring-brand-600 " + val.color : "bg-white border-border text-muted-foreground hover:border-brand-200"}`}>
              {val.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mb-3">Selecciona una condición y haz clic en el diente</p>

        {/* Upper teeth */}
        <div className="mb-1">
          <div className="text-[10px] text-muted-foreground text-center mb-1">Superior</div>
          <div className="flex justify-center gap-1">
            {TEETH_UPPER.map(n => <ToothButton key={n} num={n} />)}
          </div>
        </div>
        <div className="border-t border-dashed border-muted-foreground/20 my-2" />
        {/* Lower teeth */}
        <div>
          <div className="flex justify-center gap-1">
            {TEETH_LOWER.map(n => <ToothButton key={n} num={n} />)}
          </div>
          <div className="text-[10px] text-muted-foreground text-center mt-1">Inferior</div>
        </div>

        {/* Summary */}
        {Object.keys(teeth).length > 0 && (
          <div className="mt-4 p-3 bg-muted/30 rounded-lg">
            <div className="text-xs font-bold mb-2">Resumen del odontograma:</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(teeth).map(([num, state]) => (
                <span key={num} className="text-[10px] bg-white border border-border rounded px-2 py-0.5">
                  D{num}: {TOOTH_CONDITIONS[state.condition]?.label ?? state.condition}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Evaluación periodontal */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🔬 Evaluación periodontal</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: "plaque",      label: "Placa bacteriana" },
            { key: "calculus",    label: "Cálculo / Sarro" },
            { key: "gingival",    label: "Estado gingival" },
            { key: "pocketDepth", label: "Profundidad bolsas" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
                value={(form.periodontal as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, periodontal: { ...prev.periodontal, [f.key]: e.target.value } }))}>
                <option value="">Seleccionar…</option>
                {f.key === "plaque"      && ["Ausente","Leve","Moderada","Severa"].map(o => <option key={o}>{o}</option>)}
                {f.key === "calculus"    && ["Ausente","Supragingival leve","Supragingival moderado","Subgingival"].map(o => <option key={o}>{o}</option>)}
                {f.key === "gingival"    && ["Sana","Gingivitis leve","Gingivitis moderada","Periodontitis"].map(o => <option key={o}>{o}</option>)}
                {f.key === "pocketDepth" && ["< 3mm (normal)","3-4mm (leve)","4-6mm (moderada)","> 6mm (severa)"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Procedimientos */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🔧 Procedimientos realizados</h3>
        <div className="flex flex-wrap gap-2">
          {DENTAL_PROCEDURES.map(proc => (
            <button key={proc} onClick={() => toggleProcedure(proc)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                form.procedures.includes(proc)
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white border-border text-muted-foreground hover:border-brand-300"
              }`}>
              {proc}
            </button>
          ))}
        </div>
      </div>

      {/* Plan y observaciones */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Plan de tratamiento</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Extracción pieza 18, obturación pieza 36, profilaxis…"
            value={form.treatment} onChange={e => setForm(f => ({ ...f, treatment: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones clínicas</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Paciente con buena higiene oral, se recomienda…"
            value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Radiografías tomadas</Label>
          <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            placeholder="Periapical diente 36, panorámica…"
            value={form.xrays} onChange={e => setForm(f => ({ ...f, xrays: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Próxima cita recomendada</Label>
          <input type="date" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            value={form.nextVisit} onChange={e => setForm(f => ({ ...f, nextVisit: e.target.value }))} />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full" size="lg">
        {saving ? "Guardando expediente…" : "💾 Guardar expediente dental"}
      </Button>
    </div>
  );
}
