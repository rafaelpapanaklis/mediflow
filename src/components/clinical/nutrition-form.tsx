"use client";
import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { Activity, Flame, Zap } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { EvolutionChart } from "@/components/clinical/shared";

const ACTIVITY_LEVELS = [
  { id:"sedentary",   label:"Sedentario",             factor:1.2   },
  { id:"light",       label:"Ligera (1-3 días/sem)",  factor:1.375 },
  { id:"moderate",    label:"Moderada (3-5 días/sem)",factor:1.55  },
  { id:"active",      label:"Activa (6-7 días/sem)",  factor:1.725 },
  { id:"very_active", label:"Muy activa (doble)",     factor:1.9   },
];

function calcBMI(weight: number, height: number) {
  if (!weight || !height) return null;
  return (weight / ((height / 100) ** 2)).toFixed(1);
}
function bmiCategory(bmi: number): { label: string; tone: "info" | "success" | "warning" | "danger" } {
  if (bmi < 18.5) return { label: "Bajo peso", tone: "info" };
  if (bmi < 25)   return { label: "Normal",    tone: "success" };
  if (bmi < 30)   return { label: "Sobrepeso", tone: "warning" };
  return           { label: "Obesidad",        tone: "danger" };
}
function calcBMR(weight: number, height: number, age: number, gender: string) {
  if (!weight || !height || !age) return 0;
  if (gender === "M") return Math.round(10 * weight + 6.25 * height - 5 * age + 5);
  return Math.round(10 * weight + 6.25 * height - 5 * age - 161);
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
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/clinical?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patientId]);

  const weightData = useMemo(() =>
    history
      .filter(r => r?.specialtyData?.anthropometrics?.weight)
      .map(r => ({
        date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
        value: Number(r.specialtyData.anthropometrics.weight),
      }))
      .reverse(),
    [history]
  );
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
  const idealWeight = h > 0 ? Math.round(h - 100 - (h - 150) * 0.25) : 0;

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
            anthropometrics: { weight: w || undefined, height: h || undefined, bmi: bmi || undefined, bmr: bmr || undefined, tdee: tdee || undefined, bodyFat: form.bodyFat || undefined, muscleMass: form.muscleMass || undefined, waist: form.waist || undefined, hip: form.hip || undefined, waistHip: waistHipRatio || undefined },
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Motivo de consulta">
        <textarea
          className="input-new"
          style={{ minHeight: 70, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="¿Por qué viene hoy?"
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title="Antropometría">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px 14px", marginBottom: 16 }}>
          {[
            { key: "weight",     label: "Peso (kg)",        ph: "70.5" },
            { key: "height",     label: "Talla (cm)",       ph: "165"  },
            { key: "bodyFat",    label: "% Grasa",          ph: "25"   },
            { key: "muscleMass", label: "M. Muscular (kg)", ph: "30"   },
            { key: "waist",      label: "Cintura (cm)",     ph: "85"   },
            { key: "hip",        label: "Cadera (cm)",      ph: "98"   },
          ].map(f => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <input
                type="number" step="0.1"
                className="input-new mono"
                placeholder={f.ph}
                value={(form as any)[f.key]}
                onChange={e => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>

        {(bmi > 0 || bmr > 0) && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            padding: 14,
            borderRadius: 10,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
          }}>
            {/* IMC */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                <Activity size={10} /> IMC
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {bmi > 0 ? bmi : "—"}
              </div>
              {bmiCat && <div style={{ marginTop: 6 }}><BadgeNew tone={bmiCat.tone} dot>{bmiCat.label}</BadgeNew></div>}
            </div>
            {/* TMB */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                <Flame size={10} /> TMB
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {bmr > 0 ? `${bmr} kcal` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Harris-Benedict</div>
            </div>
            {/* GET */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                <Zap size={10} /> GET
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {tdee > 0 ? `${tdee} kcal` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Gasto total</div>
            </div>
            {/* ICC */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>ICC</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {waistHipRatio || "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Cintura/Cadera</div>
            </div>
            {/* Peso ideal */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Peso ideal</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {idealWeight > 0 ? `${idealWeight} kg` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Lorentz</div>
            </div>
          </div>
        )}
      </CardNew>

      <CardNew title="Evolución de peso" sub="Histórico de consultas">
        {weightData.length < 2 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: "12px 0" }}>
            Agrega 2+ consultas para ver evolución
          </div>
        ) : (
          <EvolutionChart
            data={weightData}
            metric="Peso"
            color="#fbbf24"
            unit="kg"
          />
        )}
      </CardNew>

      <CardNew title="Hábitos">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Nivel de actividad</label>
            <select className="input-new" value={form.activityLevel} onChange={e => set("activityLevel", e.target.value)}>
              {ACTIVITY_LEVELS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Dieta actual</label>
            <input className="input-new" placeholder="Mixta, vegetariana…" value={form.diet} onChange={e => set("diet", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Agua (L/día)</label>
            <input type="number" step="0.5" className="input-new mono" placeholder="1.5" value={form.waterIntake} onChange={e => set("waterIntake", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Horas de sueño</label>
            <input type="number" className="input-new mono" placeholder="7" value={form.sleepHours} onChange={e => set("sleepHours", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Comidas al día</label>
            <select className="input-new" value={form.mealsPerDay} onChange={e => set("mealsPerDay", e.target.value)}>
              {["1","2","3","4","5","6+"].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Alergias</label>
            <input className="input-new" placeholder="Gluten, lactosa…" value={form.allergies} onChange={e => set("allergies", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Intolerancias</label>
            <input className="input-new" placeholder="Lactosa, fructosa…" value={form.intolerances} onChange={e => set("intolerances", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Suplementos</label>
            <input className="input-new" placeholder="Proteína, vitaminas…" value={form.supplements} onChange={e => set("supplements", e.target.value)} />
          </div>
        </div>
        <div className="field-new" style={{ marginTop: 14 }}>
          <label className="field-new__label">Laboratorios recientes</label>
          <textarea
            className="input-new"
            style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder="Glucosa: 95 mg/dL…"
            value={form.labResults}
            onChange={e => set("labResults", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Frecuencia alimentaria semanal" sub="Porciones promedio por día">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
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
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <select className="input-new" value={form.foodFrequency[f.key]} onChange={e => setFF(f.key, e.target.value)}>
                <option value="">—</option>
                <option value="0">0</option>
                <option value="1-2">1-2</option>
                <option value="3-4">3-4</option>
                <option value="5-6">5-6</option>
                <option value="Diario">Diario</option>
              </select>
            </div>
          ))}
        </div>
      </CardNew>

      <CardNew title="Plan alimenticio" sub={tdee > 0 ? `GET: ${tdee} kcal/día` : undefined}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          {[
            { key:"breakfast",       label:"Desayuno" },
            { key:"morningSnack",    label:"Colación matutina" },
            { key:"lunch",           label:"Comida" },
            { key:"afternoonSnack",  label:"Colación vespertina" },
            { key:"dinner",          label:"Cena" },
          ].map(meal => (
            <div key={meal.key} className="field-new">
              <label className="field-new__label">{meal.label}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                placeholder="Avena con fruta…"
                value={(form.mealPlan as any)[meal.key]}
                onChange={e => setMP(meal.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </CardNew>

      <CardNew title="Diagnóstico y plan">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Diagnóstico nutricional</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Sobrepeso grado I…"
              value={form.assessment}
              onChange={e => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Objetivos</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Bajar 5kg en 2 meses…"
              value={form.goals}
              onChange={e => set("goals", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Plan e indicaciones</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Dieta hipocalórica…"
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew
        title="Objetivos SMART con seguimiento"
        action={<ButtonNew size="sm" variant="ghost" onClick={addSmartGoal}>+ Agregar</ButtonNew>}
      >
        {smartGoals.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            Sin objetivos SMART. Haz clic en &quot;+ Agregar&quot; para añadir.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {smartGoals.map((goal, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
                <div className="field-new">
                  <label className="field-new__label">Objetivo</label>
                  <input
                    className="input-new"
                    placeholder="Bajar 2kg por mes"
                    value={goal.objetivo}
                    onChange={e => updateSmartGoal(i, "objetivo", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Fecha meta</label>
                  <input
                    type="date"
                    className="input-new"
                    value={goal.fechaMeta}
                    onChange={e => updateSmartGoal(i, "fechaMeta", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Progreso</label>
                  <select
                    className="input-new"
                    value={goal.progreso}
                    onChange={e => updateSmartGoal(i, "progreso", e.target.value)}
                  >
                    {["0%","25%","50%","75%","100%"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Estado</label>
                  <select
                    className="input-new"
                    value={goal.estado}
                    onChange={e => updateSmartGoal(i, "estado", e.target.value)}
                  >
                    {["En progreso","Logrado","No logrado"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => removeSmartGoal(i)}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ padding: 0, width: 28, color: "var(--danger)", alignSelf: "flex-end" }}
                  aria-label="Eliminar"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta nutricional"}
        </ButtonNew>
      </div>
    </div>
  );
}
