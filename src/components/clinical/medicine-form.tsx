"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const ICD10_COMMON = [
  "J00 - Resfriado común","J06.9 - IRAS","J18.9 - Neumonía","J45 - Asma",
  "K29.7 - Gastritis","K59.0 - Estreñimiento","K21.0 - ERGE","K92.1 - Melena",
  "E11 - Diabetes mellitus tipo 2","E10 - Diabetes mellitus tipo 1",
  "I10 - Hipertensión esencial","I25.1 - Cardiopatía isquémica",
  "M54.5 - Lumbalgia","M25.5 - Dolor articular","M79.3 - Fibromialgia",
  "N39.0 - ITU","N18 - ERC","N40 - HBP",
  "F32 - Episodio depresivo","F41.1 - Ansiedad generalizada",
  "B34.9 - Infección viral","L30.9 - Dermatitis","Otro",
];

interface Props {
  patientId: string;
  onSaved:   (record: any) => void;
}

export function GeneralMedicineForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [medications, setMedications] = useState([{ drug: "", dose: "", frequency: "", duration: "", instructions: "" }]);

  const [vitals, setVitals] = useState({
    bloodPressure: "", heartRate: "", temperature: "", respiratoryRate: "",
    oxygenSat: "", weight: "", height: "", bloodGlucose: "",
  });

  const [form, setForm] = useState({
    chiefComplaint: "",
    hpi: "",
    reviewOfSystems: "",
    physicalExam: "",
    diagnosis: "",
    customDiagnosis: "",
    labs: "",
    imaging: "",
    assessment: "",
    plan: "",
    referral: "",
    followUp: "",
    sicLeave: "no",
    sicLeaveDays: "",
  });

  function addMedication() {
    setMedications(m => [...m, { drug: "", dose: "", frequency: "", duration: "", instructions: "" }]);
  }
  function removeMedication(i: number) {
    setMedications(m => m.filter((_, idx) => idx !== i));
  }
  function updateMed(i: number, key: string, value: string) {
    setMedications(m => m.map((med, idx) => idx === i ? { ...med, [key]: value } : med));
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
          subjective: `${form.chiefComplaint}\n\nHPI: ${form.hpi}\n\nRevisión por sistemas: ${form.reviewOfSystems}`,
          objective:  `Exploración física: ${form.physicalExam}\n\nLabs: ${form.labs}\n\nImagen: ${form.imaging}`,
          assessment: form.diagnosis || form.customDiagnosis,
          plan:       form.plan,
          vitals,
          specialtyData: {
            type: "medicine",
            diagnosis: form.diagnosis || form.customDiagnosis,
            medications: medications.filter(m => m.drug),
            referral: form.referral,
            followUp: form.followUp,
            sicLeave: form.sicLeave === "si" ? { granted: true, days: form.sicLeaveDays } : { granted: false },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      toast.success("Consulta guardada");
      onSaved(record);
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Subjetivo */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🗣️ Subjetivo</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Motivo de consulta *</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Cefalea de 3 días de evolución, fiebre, tos…"
              value={form.chiefComplaint} onChange={e => setForm(f => ({ ...f, chiefComplaint: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Historia de la enfermedad actual (HEA)</Label>
            <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
              placeholder="Paciente masculino de 45 años que refiere cuadro de 3 días de evolución caracterizado por…"
              value={form.hpi} onChange={e => setForm(f => ({ ...f, hpi: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Revisión por sistemas</Label>
            <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
              placeholder="Cardiorrespiratorio: sin disnea. GI: náusea leve. Neurológico: sin focalidad…"
              value={form.reviewOfSystems} onChange={e => setForm(f => ({ ...f, reviewOfSystems: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* Objetivo - Signos vitales */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📊 Objetivo — Signos vitales</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: "bloodPressure",   label: "Presión arterial",    placeholder: "120/80 mmHg" },
            { key: "heartRate",       label: "Frec. cardíaca",       placeholder: "72 lpm" },
            { key: "temperature",     label: "Temperatura",          placeholder: "36.5 °C" },
            { key: "respiratoryRate", label: "Frec. respiratoria",   placeholder: "16 rpm" },
            { key: "oxygenSat",       label: "Sat. O₂",              placeholder: "98%" },
            { key: "bloodGlucose",    label: "Glucemia",             placeholder: "90 mg/dL" },
            { key: "weight",          label: "Peso (kg)",            placeholder: "70" },
            { key: "height",          label: "Talla (cm)",           placeholder: "170" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                placeholder={f.placeholder} value={(vitals as any)[f.key]}
                onChange={e => setVitals(v => ({ ...v, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>Exploración física</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="General: consciente, orientado, buen estado general. Cabeza: normocéfala. Cuello: sin adenopatías. Cardiopulmonar: ruidos cardíacos normales, murmullo vesicular conservado…"
            value={form.physicalExam} onChange={e => setForm(f => ({ ...f, physicalExam: e.target.value }))} />
        </div>
      </div>

      {/* Labs e imagen */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Estudios de laboratorio</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="BH: Hb 14.2, Leu 9,800, Plt 285,000. QS: Glu 95, Cr 0.9, BUN 12. EGO: normal…"
            value={form.labs} onChange={e => setForm(f => ({ ...f, labs: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Imagen / Gabinete</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="Rx tórax: sin infiltrados. ECG: ritmo sinusal normal. USG abdominal: hígado homogéneo…"
            value={form.imaging} onChange={e => setForm(f => ({ ...f, imaging: e.target.value }))} />
        </div>
      </div>

      {/* Diagnóstico */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico CIE-10</Label>
          <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))}>
            <option value="">Seleccionar…</option>
            {ICD10_COMMON.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Diagnóstico adicional / Comentarios</Label>
          <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            placeholder="Diagnóstico diferencial, notas…"
            value={form.customDiagnosis} onChange={e => setForm(f => ({ ...f, customDiagnosis: e.target.value }))} />
        </div>
      </div>

      {/* Prescripción */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">💊 Prescripción médica</h3>
          <button onClick={addMedication} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar medicamento</button>
        </div>
        <div className="space-y-3">
          {medications.map((med, i) => (
            <div key={i} className="grid grid-cols-2 lg:grid-cols-5 gap-2 p-3 bg-muted/20 rounded-xl border border-border">
              <div className="space-y-1 col-span-2 lg:col-span-1">
                <Label>Medicamento</Label>
                <input className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs focus:outline-none"
                  placeholder="Amoxicilina 500mg" value={med.drug} onChange={e => updateMed(i, "drug", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Dosis</Label>
                <input className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs focus:outline-none"
                  placeholder="1 tableta" value={med.dose} onChange={e => updateMed(i, "dose", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Frecuencia</Label>
                <select className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs focus:outline-none"
                  value={med.frequency} onChange={e => updateMed(i, "frequency", e.target.value)}>
                  <option value="">…</option>
                  {["Cada 6h","Cada 8h","Cada 12h","Cada 24h","Al despertar","Al dormir","Con alimentos","SOS"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Duración</Label>
                <input className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs focus:outline-none"
                  placeholder="7 días" value={med.duration} onChange={e => updateMed(i, "duration", e.target.value)} />
              </div>
              <div className="space-y-1 flex items-end gap-1">
                <div className="flex-1">
                  <Label>Indicaciones</Label>
                  <input className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs focus:outline-none"
                    placeholder="Con alimentos…" value={med.instructions} onChange={e => updateMed(i, "instructions", e.target.value)} />
                </div>
                {medications.length > 1 && (
                  <button onClick={() => removeMedication(i)} className="mb-0.5 text-rose-500 hover:text-rose-700 text-lg leading-none">×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Plan */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Plan / Indicaciones generales</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="Reposo relativo 3 días, hidratación oral, dieta blanda. Regresar si fiebre > 38.5°C o dificultad respiratoria…"
            value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Referencia / Interconsulta</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Cardiología, reumatología, urgencias…"
              value={form.referral} onChange={e => setForm(f => ({ ...f, referral: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Seguimiento / Próxima cita</Label>
            <input type="date" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              value={form.followUp} onChange={e => setForm(f => ({ ...f, followUp: e.target.value }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label>Incapacidad médica</Label>
            <select className="flex h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              value={form.sicLeave} onChange={e => setForm(f => ({ ...f, sicLeave: e.target.value }))}>
              <option value="no">No</option>
              <option value="si">Sí</option>
            </select>
            {form.sicLeave === "si" && (
              <input type="number" className="flex h-9 w-20 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                placeholder="días" value={form.sicLeaveDays} onChange={e => setForm(f => ({ ...f, sicLeaveDays: e.target.value }))} />
            )}
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full" size="lg">
        {saving ? "Guardando consulta…" : "💾 Guardar consulta médica"}
      </Button>
    </div>
  );
}
