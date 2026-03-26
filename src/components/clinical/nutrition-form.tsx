"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const FOOD_GROUPS = ["Cereales","Leguminosas","Verduras","Frutas","Lácteos","Carnes","Grasas","Azúcares"];
const ACTIVITY_LEVELS = [
  { value: "sedentary",    label: "Sedentario (sin ejercicio)",          factor: 1.2  },
  { value: "light",        label: "Actividad ligera (1-3 días/sem)",     factor: 1.375 },
  { value: "moderate",     label: "Actividad moderada (3-5 días/sem)",   factor: 1.55 },
  { value: "active",       label: "Muy activo (6-7 días/sem)",           factor: 1.725 },
  { value: "extra_active", label: "Extremadamente activo (2x/día)",      factor: 1.9  },
];
const DIETS = ["Normal","Hipocalórica","Hipercalórica","Baja en carbohidratos","Sin gluten","Vegetariana","Vegana","DASH","Mediterránea","Diabética","Renal","Otro"];

function calcBMI(weight: number, height: number) {
  if (!weight || !height) return 0;
  return weight / ((height / 100) ** 2);
}
function bmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: "Bajo peso", color: "text-blue-600" };
  if (bmi < 25)   return { label: "Normal", color: "text-emerald-600" };
  if (bmi < 30)   return { label: "Sobrepeso", color: "text-amber-600" };
  return { label: "Obesidad", color: "text-rose-600" };
}
function calcBMR(weight: number, height: number, age: number, gender: string) {
  if (!weight || !height || !age) return 0;
  if (gender === "M") return 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age);
  return 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age);
}

interface Props {
  patientId: string;
  patient:   { dob?: string | null; gender: string };
  onSaved:   (record: any) => void;
}

export function NutritionForm({ patientId, patient, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const age = patient.dob ? new Date().getFullYear() - new Date(patient.dob).getFullYear() : 0;

  const [anthro, setAnthro] = useState({
    weight: "", height: "", waist: "", hip: "", neck: "",
    bodyFat: "", muscleMass: "", visceralFat: "",
  });
  const [form, setForm] = useState({
    chiefComplaint: "",
    objective: "",
    activityLevel: "sedentary",
    diet: "Normal",
    allergies: "",
    intolerances: "",
    supplements: "",
    waterIntake: "",
    sleepHours: "",
    stressLevel: "3",
    bowelMovements: "",
    previousDiets: "",
    labResults: "",
    assessment: "",
    mealPlan: "",
    goals: "",
    nextVisit: "",
  });

  const bmi      = calcBMI(Number(anthro.weight), Number(anthro.height));
  const bmiCat   = bmiCategory(bmi);
  const bmr      = calcBMR(Number(anthro.weight), Number(anthro.height), age, patient.gender);
  const actFactor = ACTIVITY_LEVELS.find(a => a.value === form.activityLevel)?.factor ?? 1.2;
  const tdee     = Math.round(bmr * actFactor);
  const waistHip = anthro.waist && anthro.hip
    ? (Number(anthro.waist) / Number(anthro.hip)).toFixed(2)
    : "—";

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
          objective:  form.objective,
          assessment: form.assessment,
          plan:       form.mealPlan,
          vitals: { weight: anthro.weight, height: anthro.height, bmi: bmi.toFixed(1) },
          specialtyData: {
            type: "nutrition",
            anthropometrics: { ...anthro, bmi: bmi.toFixed(1), bmr: Math.round(bmr), tdee, waistHip },
            activityLevel: form.activityLevel,
            diet: form.diet,
            allergies: form.allergies,
            intolerances: form.intolerances,
            supplements: form.supplements,
            waterIntake: form.waterIntake,
            sleepHours: form.sleepHours,
            stressLevel: form.stressLevel,
            bowelMovements: form.bowelMovements,
            previousDiets: form.previousDiets,
            labResults: form.labResults,
            goals: form.goals,
            nextVisit: form.nextVisit,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      toast.success("Expediente nutricional guardado");
      onSaved(record);
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Motivo */}
      <div className="space-y-1.5">
        <Label>Motivo de consulta *</Label>
        <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Pérdida de peso, control de diabetes, mejora composición corporal…"
          value={form.chiefComplaint} onChange={e => setForm(f => ({ ...f, chiefComplaint: e.target.value }))} />
      </div>

      {/* Antropometría */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📏 Antropometría</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[
            { key: "weight",   label: "Peso (kg)",          placeholder: "70" },
            { key: "height",   label: "Talla (cm)",          placeholder: "170" },
            { key: "waist",    label: "Cintura (cm)",        placeholder: "80" },
            { key: "hip",      label: "Cadera (cm)",         placeholder: "95" },
            { key: "neck",     label: "Cuello (cm)",         placeholder: "35" },
            { key: "bodyFat",  label: "% Grasa corporal",   placeholder: "25" },
            { key: "muscleMass",label:"Masa muscular (kg)",  placeholder: "30" },
            { key: "visceralFat",label:"Grasa visceral (1-12)",placeholder: "5" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                placeholder={f.placeholder} value={(anthro as any)[f.key]}
                onChange={e => setAnthro(a => ({ ...a, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>

        {/* Calculated values */}
        {bmi > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 bg-muted/30 rounded-xl p-3">
            <div className="text-center">
              <div className={`text-2xl font-extrabold ${bmiCat.color}`}>{bmi.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">IMC</div>
              <div className={`text-xs font-bold ${bmiCat.color}`}>{bmiCat.label}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-extrabold text-brand-700">{Math.round(bmr)}</div>
              <div className="text-xs text-muted-foreground">TMB (kcal/día)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-extrabold text-violet-700">{tdee}</div>
              <div className="text-xs text-muted-foreground">GET (kcal/día)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-extrabold text-amber-700">{waistHip}</div>
              <div className="text-xs text-muted-foreground">ICC (cin/cad)</div>
            </div>
          </div>
        )}
      </div>

      {/* Hábitos y estilo de vida */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🌿 Hábitos y estilo de vida</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Nivel de actividad física</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
              value={form.activityLevel} onChange={e => setForm(f => ({ ...f, activityLevel: e.target.value }))}>
              {ACTIVITY_LEVELS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Tipo de dieta actual</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
              value={form.diet} onChange={e => setForm(f => ({ ...f, diet: e.target.value }))}>
              {DIETS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Consumo de agua (litros/día)</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="1.5" value={form.waterIntake} onChange={e => setForm(f => ({ ...f, waterIntake: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Horas de sueño</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="7" value={form.sleepHours} onChange={e => setForm(f => ({ ...f, sleepHours: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Nivel de estrés (1-10)</Label>
            <input type="range" min="1" max="10" className="w-full mt-2"
              value={form.stressLevel} onChange={e => setForm(f => ({ ...f, stressLevel: e.target.value }))} />
            <div className="text-xs text-center text-muted-foreground">{form.stressLevel}/10</div>
          </div>
          <div className="space-y-1">
            <Label>Evacuaciones (por semana)</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
              value={form.bowelMovements} onChange={e => setForm(f => ({ ...f, bowelMovements: e.target.value }))}>
              <option value="">Seleccionar…</option>
              {["1-2/semana","3-4/semana","1/día","2-3/día","4+/día"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="space-y-1.5">
            <Label>Alergias alimentarias</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Lactosa, gluten, mariscos…"
              value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Intolerancias</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Fructosa, histamina…"
              value={form.intolerances} onChange={e => setForm(f => ({ ...f, intolerances: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Suplementos actuales</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Vitamina D, Omega 3, Proteína…"
              value={form.supplements} onChange={e => setForm(f => ({ ...f, supplements: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Dietas previas</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Keto 2023, intermitente, Weight Watchers…"
              value={form.previousDiets} onChange={e => setForm(f => ({ ...f, previousDiets: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* Laboratorios */}
      <div className="space-y-1.5">
        <Label>Resultados de laboratorio</Label>
        <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Glucosa: 95 mg/dL, Colesterol total: 185, Triglicéridos: 120, HbA1c: 5.4%…"
          value={form.labResults} onChange={e => setForm(f => ({ ...f, labResults: e.target.value }))} />
      </div>

      {/* Plan nutricional */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico nutricional</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Sobrepeso grado I, resistencia a insulina, deficiencia de Vitamina D…"
            value={form.assessment} onChange={e => setForm(f => ({ ...f, assessment: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Objetivos del paciente</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Reducir 8 kg en 3 meses, mejorar glucosa, aumentar masa muscular…"
            value={form.goals} onChange={e => setForm(f => ({ ...f, goals: e.target.value }))} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Plan alimenticio / Recomendaciones</Label>
        <textarea className="flex min-h-[100px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="Desayuno: avena con fruta y nueces (350 kcal)&#10;Almuerzo: proteína + vegetales + carbohidrato complejo (500 kcal)&#10;Cena: ligera, sopa o ensalada con proteína (300 kcal)&#10;Colaciones: fruta o yogurt (150 kcal c/u)&#10;&#10;Restricciones: evitar azúcares simples, reducir sodio…"
          value={form.mealPlan} onChange={e => setForm(f => ({ ...f, mealPlan: e.target.value }))} />
      </div>

      <div className="space-y-1.5">
        <Label>Próxima cita de seguimiento</Label>
        <input type="date" className="flex h-9 w-64 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
          value={form.nextVisit} onChange={e => setForm(f => ({ ...f, nextVisit: e.target.value }))} />
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full" size="lg">
        {saving ? "Guardando expediente…" : "💾 Guardar expediente nutricional"}
      </Button>
    </div>
  );
}
