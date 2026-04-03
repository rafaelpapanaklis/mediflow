"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const DIAGNOSES_CIE10 = ["J00 - Resfriado común","J06 - IRA superior","J18 - Neumonía","K29 - Gastritis","K57 - Diverticulosis","K92 - Hemorragia GI","E11 - Diabetes tipo 2","E14 - Diabetes NE","I10 - Hipertensión esencial","I50 - Insuficiencia cardíaca","J45 - Asma","F32 - Depresión","F41 - Ansiedad","M54 - Dorsalgia","N39 - ITU","Otro"];
const SPECIALTIES = ["Cardiología","Neurología","Dermatología","Gastroenterología","Ortopedia","Ginecología","Urología","Psiquiatría","Oftalmología","ORL","Endocrinología","Reumatología","Oncología"];

interface Props { patientId: string; onSaved: (record: any) => void }

export function GeneralMedicineForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "", objective: "", assessment: "", plan: "",
    vitals: { bloodPressure:"", heartRate:"", temperature:"", respiratoryRate:"", oxygenSat:"", bloodGlucose:"", weight:"", height:"" },
    diagnosis: "",
    medications: [{ drug:"", dose:"", frequency:"", duration:"", route:"oral", instructions:"" }],
    referral: { needed: false, specialty:"", reason:"" },
    labs: "", studies: "",
    sicLeave: { granted: false, days:"" },
    returnDate: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setV = (k: string, v: string) => setForm(f => ({ ...f, vitals: { ...f.vitals, [k]: v } }));

  function addMed() { set("medications", [...form.medications, { drug:"", dose:"", frequency:"", duration:"", route:"oral", instructions:"" }]); }
  function removeMed(i: number) { set("medications", form.medications.filter((_,j) => j !== i)); }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega el motivo de consulta o diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective, objective: form.objective,
          assessment: form.assessment || form.diagnosis, plan: form.plan,
          vitals: form.vitals,
          specialtyData: {
            type: "medicine",
            vitals: form.vitals,
            diagnosis: form.diagnosis,
            medications: form.medications.filter(m => m.drug),
            referral: form.referral.needed ? form.referral : undefined,
            labs: form.labs, studies: form.studies,
            sicLeave: form.sicLeave.granted ? form.sicLeave : undefined,
            returnDate: form.returnDate,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Consulta médica guardada");
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* SUBJETIVO */}
      <div className="space-y-1.5">
        <Label>Motivo de consulta / Historia de la enfermedad actual (HEA)</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Paciente de X años que acude por… Inicio: … Evolución: … Síntomas acompañantes: …" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
      </div>

      {/* SIGNOS VITALES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🩺 Signos vitales</h3>
        <div className="grid grid-cols-4 gap-3">
          {[
            { key:"bloodPressure", label:"T/A (mmHg)",      ph:"120/80" },
            { key:"heartRate",     label:"FC (lpm)",         ph:"72"     },
            { key:"temperature",   label:"Temp (°C)",        ph:"36.5"   },
            { key:"respiratoryRate",label:"FR (rpm)",        ph:"16"     },
            { key:"oxygenSat",     label:"Sat O₂ (%)",      ph:"98"     },
            { key:"bloodGlucose",  label:"Glucemia (mg/dL)", ph:"100"    },
            { key:"weight",        label:"Peso (kg)",        ph:"70"     },
            { key:"height",        label:"Talla (cm)",       ph:"170"    },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder={f.ph} value={(form.vitals as any)[f.key]} onChange={e => setV(f.key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* EXPLORACIÓN Y LAB */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Exploración física / Laboratorios</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="BH: Hb 13.5, Leuco 7,500…&#10;EGO: Normal&#10;Tórax: sin alteraciones…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Estudios solicitados</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="BH, QS, RX tórax…" value={form.studies} onChange={e => set("studies", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Diagnóstico CIE-10</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.diagnosis} onChange={e => set("diagnosis", e.target.value)}>
              <option value="">Seleccionar diagnóstico…</option>
              {DIAGNOSES_CIE10.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Diagnóstico libre / Complementario</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Describe el diagnóstico…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
        </div>
      </div>

      {/* PRESCRIPCIÓN */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">💊 Prescripción médica</h3>
          <button onClick={addMed} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar medicamento</button>
        </div>
        <div className="space-y-3">
          {form.medications.map((med, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 items-end">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Medicamento</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                  placeholder="Amoxicilina 500mg" value={med.drug}
                  onChange={e => { const m=[...form.medications]; m[i].drug=e.target.value; set("medications",m); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dosis</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                  placeholder="500mg" value={med.dose}
                  onChange={e => { const m=[...form.medications]; m[i].dose=e.target.value; set("medications",m); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Frecuencia</Label>
                <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
                  value={med.frequency} onChange={e => { const m=[...form.medications]; m[i].frequency=e.target.value; set("medications",m); }}>
                  <option value="">…</option>
                  {["c/4h","c/6h","c/8h","c/12h","c/24h","c/48h","Semanal","Según necesidad"].map(f=><option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duración</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                  placeholder="7 días" value={med.duration}
                  onChange={e => { const m=[...form.medications]; m[i].duration=e.target.value; set("medications",m); }} />
              </div>
              <div className="flex items-end">
                {form.medications.length > 1 && (
                  <button onClick={() => removeMed(i)} className="h-9 px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors text-lg">×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* REFERIDO */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <input type="checkbox" id="referral" checked={form.referral.needed} onChange={e => set("referral", { ...form.referral, needed: e.target.checked })} className="w-4 h-4 accent-brand-600" />
          <label htmlFor="referral" className="text-sm font-bold">Referir a especialidad</label>
        </div>
        {form.referral.needed && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Especialidad</Label>
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                value={form.referral.specialty} onChange={e => set("referral", { ...form.referral, specialty: e.target.value })}>
                <option value="">Seleccionar…</option>
                {SPECIALTIES.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Motivo del referido</Label>
              <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                placeholder="Evaluación por…" value={form.referral.reason} onChange={e => set("referral", { ...form.referral, reason: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      {/* PLAN E INCAPACIDAD */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Plan / Indicaciones al paciente</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Reposo relativo 3 días, hidratación abundante, dieta blanda…&#10;Regresar si: fiebre >38.5°C, dificultad respiratoria…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Próxima cita / Control</Label>
            <input type="date" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.returnDate} onChange={e => set("returnDate", e.target.value)} />
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="sicleave" checked={form.sicLeave.granted} onChange={e => set("sicLeave", { ...form.sicLeave, granted: e.target.checked })} className="w-4 h-4 accent-amber-600" />
              <label htmlFor="sicleave" className="text-sm font-bold text-amber-700">Incapacidad médica</label>
            </div>
            {form.sicLeave.granted && (
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="180" placeholder="3" className="w-16 h-8 rounded-lg border border-amber-300 bg-white px-2 text-sm font-bold text-center focus:outline-none"
                  value={form.sicLeave.days} onChange={e => set("sicLeave", { ...form.sicLeave, days: e.target.value })} />
                <span className="text-sm text-amber-700 font-medium">días de incapacidad</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "💾 Guardar consulta médica"}
        </Button>
      </div>
    </div>
  );
}
