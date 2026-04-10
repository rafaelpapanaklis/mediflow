"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const ACTIVITY_LEVELS = [
  { id:"sedentary",   label:"Sedentario",            factor:1.2   },
  { id:"light",       label:"Ligera (1-3 días/sem)", factor:1.375 },
  { id:"moderate",    label:"Moderada (3-5 días/sem)",factor:1.55 },
  { id:"active",      label:"Activa (6-7 días/sem)", factor:1.725 },
  { id:"very_active", label:"Muy activa (doble)",    factor:1.9   },
];

function calcBMI(weight: number, height: number) {
  if (!weight || !height) return null;
  return (weight / ((height/100) ** 2)).toFixed(1);
}
function bmiCategory(bmi: number) {
  if (bmi < 18.5) return { label:"Bajo peso", color:"text-blue-600" };
  if (bmi < 25)   return { label:"Normal",    color:"text-emerald-600" };
  if (bmi < 30)   return { label:"Sobrepeso", color:"text-amber-600" };
  return           { label:"Obesidad",        color:"text-rose-600" };
}
function calcBMR(weight: number, height: number, age: number, gender: string) {
  if (!weight || !height || !age) return 0;
  if (gender === "M") return Math.round(10*weight + 6.25*height - 5*age + 5);
  return Math.round(10*weight + 6.25*height - 5*age - 161);
}

interface Props { patientId: string; patient?: any; onSaved: (record: any) => void }

export function NutritionForm({ patientId, patient, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    weight: "", height: "", bodyFat: "", muscleMass: "", waist: "", hip: "",
    activityLevel: "moderate",
    diet: "", waterIntake: "", sleepHours: "", mealsPerDay: "3",
    labResults: "", allergies: "", intolerances: "", supplements: "",
    subjective: "", assessment: "", goals: "", plan: "",
    mealPlan: { breakfast:"", morningSnack:"", lunch:"", afternoonSnack:"", dinner:"" },
    foodFrequency: {
      frutas:"", verduras:"", carnesRojas:"", pollosPavo:"", pescadoMariscos:"",
      lacteos:"", legumbres:"", cerealesIntegrales:"", ultraprocesados:"",
      bebidasAzucaradas:"", comidaRapida:"", snacksDulces:"",
    } as Record<string, string>,
  });
  const [smartGoals, setSmartGoals] = useState<{ objetivo: string; fechaMeta: string; progreso: string; estado: string }[]>([]);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setMP = (k: string, v: string) => setForm(f => ({ ...f, mealPlan: { ...f.mealPlan, [k]: v } }));
  const setFF = (k: string, v: string) => setForm(f => ({ ...f, foodFrequency: { ...f.foodFrequency, [k]: v } }));
  const addSmartGoal = () => setSmartGoals(g => [...g, { objetivo:"", fechaMeta:"", progreso:"0%", estado:"En progreso" }]);
  const removeSmartGoal = (i: number) => setSmartGoals(g => g.filter((_, idx) => idx !== i));
  const updateSmartGoal = (i: number, k: string, v: string) => setSmartGoals(g => g.map((goal, idx) => idx === i ? { ...goal, [k]: v } : goal));

  const w   = parseFloat(form.weight) || 0;
  const h   = parseFloat(form.height) || 0;
  const age = patient?.dob ? new Date().getFullYear() - new Date(patient.dob).getFullYear() : 30;
  const gender = patient?.gender ?? "F";
  const bmi = w && h ? parseFloat(calcBMI(w, h) ?? "0") : 0;
  const bmr = calcBMR(w, h, age, gender);
  const actFactor = ACTIVITY_LEVELS.find(a => a.id === form.activityLevel)?.factor ?? 1.55;
  const tdee = bmr ? Math.round(bmr * actFactor) : 0;
  const waistHipRatio = form.waist && form.hip ? (parseFloat(form.waist) / parseFloat(form.hip)).toFixed(2) : "";
  const bmiCat = bmi ? bmiCategory(bmi) : null;

  async function handleSave() {
    if (!form.weight && !form.assessment) { toast.error("Agrega al menos el peso o el diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId, subjective: form.subjective, assessment: form.assessment, plan: form.plan,
          specialtyData: {
            type: "nutrition",
            anthropometrics: { weight: w||undefined, height: h||undefined, bmi: bmi||undefined, bmr: bmr||undefined, tdee: tdee||undefined, bodyFat: form.bodyFat||undefined, muscleMass: form.muscleMass||undefined, waist: form.waist||undefined, hip: form.hip||undefined, waistHip: waistHipRatio||undefined },
            activityLevel: form.activityLevel, diet: form.diet, waterIntake: form.waterIntake,
            sleepHours: form.sleepHours, mealsPerDay: form.mealsPerDay, labResults: form.labResults,
            allergies: form.allergies, intolerances: form.intolerances, supplements: form.supplements,
            goals: form.goals, mealPlan: form.mealPlan,
            foodFrequency: form.foodFrequency, smartGoals,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Consulta nutricional guardada");
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label>Motivo de consulta</Label>
        <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="¿Por qué viene hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
      </div>

      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📏 Antropometría</h3>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {[
            { key:"weight", label:"Peso (kg)", ph:"70.5" },
            { key:"height", label:"Talla (cm)", ph:"165" },
            { key:"bodyFat", label:"% Grasa", ph:"25" },
            { key:"muscleMass", label:"M. Muscular (kg)", ph:"30" },
            { key:"waist", label:"Cintura (cm)", ph:"85" },
            { key:"hip", label:"Cadera (cm)", ph:"98" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <input type="number" step="0.1" placeholder={f.ph}
                className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={(form as any)[f.key]} onChange={e => set(f.key, e.target.value)} />
            </div>
          ))}
        </div>
        {(bmi > 0 || bmr > 0) && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label:"IMC", val: bmi > 0 ? String(bmi) : "—", sub: bmiCat?.label ?? "", color: bmiCat?.color ?? "text-foreground" },
              { label:"TMB", val: bmr > 0 ? `${bmr} kcal` : "—", sub:"Harris-Benedict", color:"text-foreground" },
              { label:"GET", val: tdee > 0 ? `${tdee} kcal` : "—", sub:"Gasto total", color:"text-foreground" },
              { label:"ICC", val: waistHipRatio || "—", sub:"Cintura/Cadera", color:"text-foreground" },
              { label:"Peso ideal", val: h > 0 ? `${Math.round(h - 100 - (h-150)*0.25)} kg` : "—", sub:"Lorentz", color:"text-foreground" },
            ].map(k => (
              <div key={k.label} className="bg-slate-50 rounded-xl p-3 text-center">
                <div className={`text-xl font-extrabold ${k.color}`}>{k.val}</div>
                <div className="text-[10px] text-muted-foreground font-semibold">{k.label}</div>
                {k.sub && <div className={`text-[10px] ${k.color} font-bold`}>{k.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tracking de medidas entre sesiones */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-2">📈 Tracking de medidas entre sesiones</h3>
        <p className="text-xs text-muted-foreground mb-3">Evolución de medidas — los datos de hoy se guardan automáticamente para comparar con sesiones futuras</p>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-3">
          {[
            { label:"Peso", val: w ? `${w} kg` : "—" },
            { label:"% Grasa", val: form.bodyFat ? `${form.bodyFat}%` : "—" },
            { label:"Masa muscular", val: form.muscleMass ? `${form.muscleMass} kg` : "—" },
            { label:"IMC", val: bmi > 0 ? String(bmi) : "—" },
            { label:"Cintura", val: form.waist ? `${form.waist} cm` : "—" },
            { label:"Cadera", val: form.hip ? `${form.hip} cm` : "—" },
          ].map(m => (
            <div key={m.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-center">
              <div className="text-lg font-extrabold text-foreground">{m.val}</div>
              <div className="text-[10px] text-muted-foreground font-semibold">{m.label}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground text-center">📊 Estos datos se guardan para generar gráficas de evolución</p>
      </div>

      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🥗 Hábitos</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nivel de actividad</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              value={form.activityLevel} onChange={e => set("activityLevel", e.target.value)}>
              {ACTIVITY_LEVELS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dieta actual</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Mixta, vegetariana…" value={form.diet} onChange={e => set("diet", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Agua (L/día)</Label>
            <input type="number" step="0.5" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="1.5" value={form.waterIntake} onChange={e => set("waterIntake", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Horas de sueño</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="7" value={form.sleepHours} onChange={e => set("sleepHours", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Comidas al día</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              value={form.mealsPerDay} onChange={e => set("mealsPerDay", e.target.value)}>
              {["1","2","3","4","5","6+"].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alergias alimentarias</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Gluten, lactosa…" value={form.allergies} onChange={e => set("allergies", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Intolerancias</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Lactosa, fructosa…" value={form.intolerances} onChange={e => set("intolerances", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Suplementos</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
              placeholder="Proteína, vitaminas…" value={form.supplements} onChange={e => set("supplements", e.target.value)} />
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <Label className="text-xs">Laboratorios recientes</Label>
          <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Glucosa: 95 mg/dL…" value={form.labResults} onChange={e => set("labResults", e.target.value)} />
        </div>
      </div>

      {/* Frecuencia alimentaria semanal */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📋 Frecuencia alimentaria semanal</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key:"frutas", label:"Frutas" },
            { key:"verduras", label:"Verduras" },
            { key:"carnesRojas", label:"Carnes rojas" },
            { key:"pollosPavo", label:"Pollo/Pavo" },
            { key:"pescadoMariscos", label:"Pescado/Mariscos" },
            { key:"lacteos", label:"Lácteos" },
            { key:"legumbres", label:"Legumbres" },
            { key:"cerealesIntegrales", label:"Cereales integrales" },
            { key:"ultraprocesados", label:"Ultraprocesados" },
            { key:"bebidasAzucaradas", label:"Bebidas azucaradas" },
            { key:"comidaRapida", label:"Comida rápida" },
            { key:"snacksDulces", label:"Snacks/Dulces" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <select
                className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                value={form.foodFrequency[f.key]} onChange={e => setFF(f.key, e.target.value)}>
                <option value="">Seleccionar</option>
                <option value="0">0</option>
                <option value="1-2">1-2</option>
                <option value="3-4">3-4</option>
                <option value="5-6">5-6</option>
                <option value="Diario">Diario</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-1">🍽️ Plan alimenticio</h3>
        {tdee > 0 && <p className="text-xs text-muted-foreground mb-3">GET: <strong>{tdee} kcal/día</strong></p>}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { key:"breakfast", label:"Desayuno" },
            { key:"morningSnack", label:"Colación matutina" },
            { key:"lunch", label:"Comida" },
            { key:"afternoonSnack", label:"Colación vespertina" },
            { key:"dinner", label:"Cena" },
          ].map(meal => (
            <div key={meal.key} className="space-y-1">
              <Label className="text-xs">{meal.label}</Label>
              <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder="Avena con fruta…" value={(form.mealPlan as any)[meal.key]} onChange={e => setMP(meal.key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico nutricional</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Sobrepeso grado I…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Objetivos</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Bajar 5kg en 2 meses…" value={form.goals} onChange={e => set("goals", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan e indicaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Dieta hipocalórica…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      {/* Objetivos SMART con seguimiento */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🎯 Objetivos SMART con seguimiento</h3>
        <div className="space-y-3">
          {smartGoals.map((goal, i) => (
            <div key={i} className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div className="space-y-1 lg:col-span-1">
                <Label className="text-xs">Objetivo</Label>
                <input
                  className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Bajar 2kg por mes"
                  value={goal.objetivo} onChange={e => updateSmartGoal(i, "objetivo", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha meta</Label>
                <input type="date"
                  className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={goal.fechaMeta} onChange={e => updateSmartGoal(i, "fechaMeta", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Progreso</Label>
                <select
                  className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                  value={goal.progreso} onChange={e => updateSmartGoal(i, "progreso", e.target.value)}>
                  {["0%","25%","50%","75%","100%"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Estado</Label>
                <select
                  className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                  value={goal.estado} onChange={e => updateSmartGoal(i, "estado", e.target.value)}>
                  {["En progreso","Logrado","No logrado"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Button variant="outline" size="sm" onClick={() => removeSmartGoal(i)} className="text-rose-600 border-rose-300 hover:bg-rose-50">
                  Eliminar
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={addSmartGoal} className="mt-3">
          + Agregar objetivo
        </Button>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "💾 Guardar consulta nutricional"}
        </Button>
      </div>
    </div>
  );
}
