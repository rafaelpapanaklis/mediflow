"use client";
import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { Activity, Flame, Zap } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { EvolutionChart } from "@/components/clinical/shared";
import { DateField } from "@/components/ui/date-field";
import { useT } from "@/i18n/i18n-provider";

const ACTIVITY_LEVELS = [
  { id:"sedentary",   labelKey:"clinical.nutritionForm.activitySedentary",  factor:1.2   },
  { id:"light",       labelKey:"clinical.nutritionForm.activityLight",      factor:1.375 },
  { id:"moderate",    labelKey:"clinical.nutritionForm.activityModerate",   factor:1.55  },
  { id:"active",      labelKey:"clinical.nutritionForm.activityActive",     factor:1.725 },
  { id:"very_active", labelKey:"clinical.nutritionForm.activityVeryActive", factor:1.9   },
];

function calcBMI(weight: number, height: number) {
  if (!weight || !height) return null;
  return (weight / ((height / 100) ** 2)).toFixed(1);
}
function bmiCategory(bmi: number): { labelKey: string; tone: "info" | "success" | "warning" | "danger" } {
  if (bmi < 18.5) return { labelKey: "clinical.nutritionForm.bmiUnderweight", tone: "info" };
  if (bmi < 25)   return { labelKey: "clinical.nutritionForm.bmiNormal",      tone: "success" };
  if (bmi < 30)   return { labelKey: "clinical.nutritionForm.bmiOverweight",  tone: "warning" };
  return           { labelKey: "clinical.nutritionForm.bmiObesity",          tone: "danger" };
}
function calcBMR(weight: number, height: number, age: number, gender: string) {
  if (!weight || !height || !age) return 0;
  if (gender === "M") return Math.round(10 * weight + 6.25 * height - 5 * age + 5);
  return Math.round(10 * weight + 6.25 * height - 5 * age - 161);
}

interface Props { patientId: string; patient?: any; onSaved: (record: any) => void }

export function NutritionForm({ patientId, patient, onSaved }: Props) {
  const t = useT();
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
    const ctrl = new AbortController();
    fetch(`/api/clinical?patientId=${patientId}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : [])
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(err => { if (err.name !== "AbortError") toast.error(t("clinical.nutritionForm.errorLoadHistory")); });
    return () => ctrl.abort();
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
    if (!form.weight && !form.assessment) { toast.error(t("clinical.nutritionForm.errorWeightOrDx")); return; }
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
      toast.success(t("clinical.nutritionForm.savedToast"));
    } catch (err: any) { toast.error(err.message ?? t("common.genericError")); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.nutritionForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 70, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.nutritionForm.reasonPlaceholder")}
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title={t("clinical.nutritionForm.anthropometryTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px 14px", marginBottom: 16 }}>
          {[
            { key: "weight",     label: t("clinical.nutritionForm.anthWeight"),     ph: "70.5" },
            { key: "height",     label: t("clinical.nutritionForm.anthHeight"),     ph: "165"  },
            { key: "bodyFat",    label: t("clinical.nutritionForm.anthBodyFat"),    ph: "25"   },
            { key: "muscleMass", label: t("clinical.nutritionForm.anthMuscleMass"), ph: "30"   },
            { key: "waist",      label: t("clinical.nutritionForm.anthWaist"),      ph: "85"   },
            { key: "hip",        label: t("clinical.nutritionForm.anthHip"),        ph: "98"   },
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
                <Activity size={10} /> {t("clinical.nutritionForm.metricBmi")}
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {bmi > 0 ? bmi : "—"}
              </div>
              {bmiCat && <div style={{ marginTop: 6 }}><BadgeNew tone={bmiCat.tone} dot>{t(bmiCat.labelKey)}</BadgeNew></div>}
            </div>
            {/* TMB */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                <Flame size={10} /> {t("clinical.nutritionForm.metricBmr")}
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {bmr > 0 ? `${bmr} kcal` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Harris-Benedict</div>
            </div>
            {/* GET */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                <Zap size={10} /> {t("clinical.nutritionForm.metricTdee")}
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {tdee > 0 ? `${tdee} kcal` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{t("clinical.nutritionForm.metricTdeeSub")}</div>
            </div>
            {/* ICC */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{t("clinical.nutritionForm.metricWhr")}</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {waistHipRatio || "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{t("clinical.nutritionForm.metricWhrSub")}</div>
            </div>
            {/* Peso ideal */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{t("clinical.nutritionForm.metricIdealWeight")}</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
                {idealWeight > 0 ? `${idealWeight} kg` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Lorentz</div>
            </div>
          </div>
        )}
      </CardNew>

      <CardNew title={t("clinical.nutritionForm.weightEvolutionTitle")} sub={t("clinical.nutritionForm.weightEvolutionSub")}>
        {weightData.length < 2 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: "12px 0" }}>
            {t("clinical.nutritionForm.add2Consults")}
          </div>
        ) : (
          <EvolutionChart
            data={weightData}
            metric={t("clinical.nutritionForm.weightMetric")}
            color="#fbbf24"
            unit="kg"
          />
        )}
      </CardNew>

      <CardNew title={t("clinical.nutritionForm.habitsTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.activityLevel")}</label>
            <select className="input-new" value={form.activityLevel} onChange={e => set("activityLevel", e.target.value)}>
              {ACTIVITY_LEVELS.map(a => <option key={a.id} value={a.id}>{t(a.labelKey)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.currentDiet")}</label>
            <input className="input-new" placeholder={t("clinical.nutritionForm.currentDietPlaceholder")} value={form.diet} onChange={e => set("diet", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.water")}</label>
            <input type="number" step="0.5" className="input-new mono" placeholder="1.5" value={form.waterIntake} onChange={e => set("waterIntake", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.sleepHours")}</label>
            <input type="number" className="input-new mono" placeholder="7" value={form.sleepHours} onChange={e => set("sleepHours", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.mealsPerDay")}</label>
            <select className="input-new" value={form.mealsPerDay} onChange={e => set("mealsPerDay", e.target.value)}>
              {["1","2","3","4","5","6+"].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.allergies")}</label>
            <input className="input-new" placeholder={t("clinical.nutritionForm.allergiesPlaceholder")} value={form.allergies} onChange={e => set("allergies", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.intolerances")}</label>
            <input className="input-new" placeholder={t("clinical.nutritionForm.intolerancesPlaceholder")} value={form.intolerances} onChange={e => set("intolerances", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.supplements")}</label>
            <input className="input-new" placeholder={t("clinical.nutritionForm.supplementsPlaceholder")} value={form.supplements} onChange={e => set("supplements", e.target.value)} />
          </div>
        </div>
        <div className="field-new" style={{ marginTop: 14 }}>
          <label className="field-new__label">{t("clinical.nutritionForm.recentLabs")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder={t("clinical.nutritionForm.recentLabsPlaceholder")}
            value={form.labResults}
            onChange={e => set("labResults", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.nutritionForm.foodFreqTitle")} sub={t("clinical.nutritionForm.foodFreqSub")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
          {[
            { key:"frutas", label:t("clinical.nutritionForm.foodFruits") },
            { key:"verduras", label:t("clinical.nutritionForm.foodVegetables") },
            { key:"carnesRojas", label:t("clinical.nutritionForm.foodRedMeat") },
            { key:"pollosPavo", label:t("clinical.nutritionForm.foodPoultry") },
            { key:"pescadoMariscos", label:t("clinical.nutritionForm.foodFishSeafood") },
            { key:"lacteos", label:t("clinical.nutritionForm.foodDairy") },
            { key:"legumbres", label:t("clinical.nutritionForm.foodLegumes") },
            { key:"cerealesIntegrales", label:t("clinical.nutritionForm.foodWholeGrains") },
            { key:"ultraprocesados", label:t("clinical.nutritionForm.foodUltraprocessed") },
            { key:"bebidasAzucaradas", label:t("clinical.nutritionForm.foodSugaryDrinks") },
            { key:"comidaRapida", label:t("clinical.nutritionForm.foodFastFood") },
            { key:"snacksDulces", label:t("clinical.nutritionForm.foodSnacksSweets") },
          ].map(f => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <select className="input-new" value={form.foodFrequency[f.key]} onChange={e => setFF(f.key, e.target.value)}>
                <option value="">—</option>
                <option value="0">0</option>
                <option value="1-2">1-2</option>
                <option value="3-4">3-4</option>
                <option value="5-6">5-6</option>
                <option value="Diario">{t("clinical.nutritionForm.foodDaily")}</option>
              </select>
            </div>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.nutritionForm.mealPlanTitle")} sub={tdee > 0 ? t("clinical.nutritionForm.mealPlanSub", { tdee }) : undefined}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          {[
            { key:"breakfast",       label:t("clinical.nutritionForm.mealBreakfast") },
            { key:"morningSnack",    label:t("clinical.nutritionForm.mealMorningSnack") },
            { key:"lunch",           label:t("clinical.nutritionForm.mealLunch") },
            { key:"afternoonSnack",  label:t("clinical.nutritionForm.mealAfternoonSnack") },
            { key:"dinner",          label:t("clinical.nutritionForm.mealDinner") },
          ].map(meal => (
            <div key={meal.key} className="field-new">
              <label className="field-new__label">{meal.label}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                placeholder={t("clinical.nutritionForm.mealPlaceholder")}
                value={(form.mealPlan as any)[meal.key]}
                onChange={e => setMP(meal.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.nutritionForm.dxPlanTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.nutritionalDx")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.nutritionForm.nutritionalDxPlaceholder")}
              value={form.assessment}
              onChange={e => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.goals")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.nutritionForm.goalsPlaceholder")}
              value={form.goals}
              onChange={e => set("goals", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nutritionForm.planIndications")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.nutritionForm.planPlaceholder")}
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew
        title={t("clinical.nutritionForm.smartGoalsTitle")}
        action={<ButtonNew size="sm" variant="ghost" onClick={addSmartGoal}>{t("clinical.nutritionForm.addShort")}</ButtonNew>}
      >
        {smartGoals.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            {t("clinical.nutritionForm.smartGoalsEmpty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {smartGoals.map((goal, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.nutritionForm.goal")}</label>
                  <input
                    className="input-new"
                    placeholder={t("clinical.nutritionForm.goalPlaceholder")}
                    value={goal.objetivo}
                    onChange={e => updateSmartGoal(i, "objetivo", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.nutritionForm.targetDate")}</label>
                  <DateField
                    className="input-new"
                    value={goal.fechaMeta}
                    onChange={e => updateSmartGoal(i, "fechaMeta", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.nutritionForm.progress")}</label>
                  <select
                    className="input-new"
                    value={goal.progreso}
                    onChange={e => updateSmartGoal(i, "progreso", e.target.value)}
                  >
                    {["0%","25%","50%","75%","100%"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("common.status")}</label>
                  <select
                    className="input-new"
                    value={goal.estado}
                    onChange={e => updateSmartGoal(i, "estado", e.target.value)}
                  >
                    <option value="En progreso">{t("clinical.nutritionForm.statusInProgress")}</option>
                    <option value="Logrado">{t("clinical.nutritionForm.statusAchieved")}</option>
                    <option value="No logrado">{t("clinical.nutritionForm.statusNotAchieved")}</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => removeSmartGoal(i)}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ padding: 0, width: 28, color: "var(--danger)", alignSelf: "flex-end" }}
                  aria-label={t("common.delete")}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.nutritionForm.saveButton")}
        </ButtonNew>
      </div>
    </div>
  );
}
