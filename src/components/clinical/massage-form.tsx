"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

const TIPOS_MASAJE = [
  "Sueco",
  "Tejido profundo",
  "Deportivo",
  "Drenaje linfatico",
  "Piedras calientes",
  "Thai",
  "Prenatal",
  "Miofascial",
  "Relajante",
];

const ZONAS = [
  "Cabeza/cuello",
  "Hombros",
  "Espalda alta",
  "Espalda baja",
  "Brazos",
  "Manos",
  "Gluteos",
  "Piernas",
  "Pies",
];

const CONTRAINDICACIONES = [
  "Fiebre",
  "Infeccion",
  "Trombosis",
  "Fracturas recientes",
  "Embarazo primer trimestre",
  "Heridas abiertas",
];

const TRIGGER_POINTS = [
  "Trapecio superior",
  "Trapecio medio",
  "Elevador de la escápula",
  "Infraespinoso",
  "Romboides",
  "Suboccipitales",
  "Esternocleidomastoideo",
  "Piriforme",
  "Psoas ilíaco",
  "Cuadrado lumbar",
  "Glúteo medio",
  "Tensor de la fascia lata",
];

const EVALUACION_POSTURAL = [
  "Cabeza adelantada",
  "Hombros desnivelados",
  "Hombros protruidos (redondeados)",
  "Hipercifosis dorsal",
  "Hiperlordosis lumbar",
  "Escoliosis funcional",
  "Pelvis en anteversión",
  "Pelvis desnivelada",
  "Genu valgum (rodillas en X)",
  "Pie plano/cavo",
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function MassageForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    tipo: "",
    presion: 3,
    zonasEnfoque: [] as string[],
    zonasDolor: [] as string[],
    tecnicas: "",
    contraindicaciones: [] as string[],
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    recomendaciones: "",
    dolorAntes: null as number | null,
    dolorDespues: null as number | null,
    triggerPoints: [] as string[],
    triggerPointTipo: {} as Record<string, string>,
    evaluacionPostural: [] as string[],
    notasPosturales: "",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const tipoLabels: Record<string, string> = {
    "Sueco": t("clinical.massageForm.typeSwedish"),
    "Tejido profundo": t("clinical.massageForm.typeDeepTissue"),
    "Deportivo": t("clinical.massageForm.typeSports"),
    "Drenaje linfatico": t("clinical.massageForm.typeLymphaticDrainage"),
    "Piedras calientes": t("clinical.massageForm.typeHotStones"),
    "Thai": t("clinical.massageForm.typeThai"),
    "Prenatal": t("clinical.massageForm.typePrenatal"),
    "Miofascial": t("clinical.massageForm.typeMyofascial"),
    "Relajante": t("clinical.massageForm.typeRelaxing"),
  };
  const zonaLabels: Record<string, string> = {
    "Cabeza/cuello": t("clinical.massageForm.zoneHeadNeck"),
    "Hombros": t("clinical.massageForm.zoneShoulders"),
    "Espalda alta": t("clinical.massageForm.zoneUpperBack"),
    "Espalda baja": t("clinical.massageForm.zoneLowerBack"),
    "Brazos": t("clinical.massageForm.zoneArms"),
    "Manos": t("clinical.massageForm.zoneHands"),
    "Gluteos": t("clinical.massageForm.zoneGlutes"),
    "Piernas": t("clinical.massageForm.zoneLegs"),
    "Pies": t("clinical.massageForm.zoneFeet"),
  };
  const contraindicacionLabels: Record<string, string> = {
    "Fiebre": t("clinical.massageForm.contraFever"),
    "Infeccion": t("clinical.massageForm.contraInfection"),
    "Trombosis": t("clinical.massageForm.contraThrombosis"),
    "Fracturas recientes": t("clinical.massageForm.contraRecentFractures"),
    "Embarazo primer trimestre": t("clinical.massageForm.contraFirstTrimester"),
    "Heridas abiertas": t("clinical.massageForm.contraOpenWounds"),
  };
  const triggerPointLabels: Record<string, string> = {
    "Trapecio superior": t("clinical.massageForm.tpUpperTrapezius"),
    "Trapecio medio": t("clinical.massageForm.tpMiddleTrapezius"),
    "Elevador de la escápula": t("clinical.massageForm.tpLevatorScapulae"),
    "Infraespinoso": t("clinical.massageForm.tpInfraspinatus"),
    "Romboides": t("clinical.massageForm.tpRhomboids"),
    "Suboccipitales": t("clinical.massageForm.tpSuboccipitals"),
    "Esternocleidomastoideo": t("clinical.massageForm.tpSternocleidomastoid"),
    "Piriforme": t("clinical.massageForm.tpPiriformis"),
    "Psoas ilíaco": t("clinical.massageForm.tpIliopsoas"),
    "Cuadrado lumbar": t("clinical.massageForm.tpQuadratusLumborum"),
    "Glúteo medio": t("clinical.massageForm.tpGluteusMedius"),
    "Tensor de la fascia lata": t("clinical.massageForm.tpTensorFasciaeLatae"),
  };
  const posturalLabels: Record<string, string> = {
    "Cabeza adelantada": t("clinical.massageForm.postForwardHead"),
    "Hombros desnivelados": t("clinical.massageForm.postUnevenShoulders"),
    "Hombros protruidos (redondeados)": t("clinical.massageForm.postRoundedShoulders"),
    "Hipercifosis dorsal": t("clinical.massageForm.postDorsalHyperkyphosis"),
    "Hiperlordosis lumbar": t("clinical.massageForm.postLumbarHyperlordosis"),
    "Escoliosis funcional": t("clinical.massageForm.postFunctionalScoliosis"),
    "Pelvis en anteversión": t("clinical.massageForm.postPelvicAnteversion"),
    "Pelvis desnivelada": t("clinical.massageForm.postUnevenPelvis"),
    "Genu valgum (rodillas en X)": t("clinical.massageForm.postGenuValgum"),
    "Pie plano/cavo": t("clinical.massageForm.postFlatCavusFoot"),
  };

  const toggleArr = (key: "zonasEnfoque" | "zonasDolor" | "contraindicaciones" | "triggerPoints" | "evaluacionPostural", val: string) => {
    setForm((f) => {
      const arr = f[key] as string[];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  };

  async function handleSave() {
    if (!form.tipo) {
      toast.error(t("clinical.massageForm.selectType"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          objective: form.objective,
          assessment: form.assessment,
          plan: form.plan,
          specialtyData: {
            type: "massage",
            tipo: form.tipo,
            presion: form.presion,
            zonasEnfoque: form.zonasEnfoque,
            zonasDolor: form.zonasDolor,
            tecnicas: form.tecnicas,
            contraindicaciones: form.contraindicaciones,
            recomendaciones: form.recomendaciones,
            dolorAntes: form.dolorAntes,
            dolorDespues: form.dolorDespues,
            triggerPoints: form.triggerPoints,
            triggerPointTipo: form.triggerPointTipo,
            evaluacionPostural: form.evaluacionPostural,
            notasPosturales: form.notasPosturales,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success(t("clinical.massageForm.saved"));
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const PRESION_LABELS = [
    t("clinical.massageForm.pressure1"),
    t("clinical.massageForm.pressure2"),
    t("clinical.massageForm.pressure3"),
    t("clinical.massageForm.pressure4"),
    t("clinical.massageForm.pressure5"),
  ];

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.massageForm.typeTitle")}>
        <div className="space-y-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.massageForm.type")}</label>
            <select
              className="input-new"
              value={form.tipo}
              onChange={(e) => set("tipo", e.target.value)}
            >
              <option value="">{t("clinical.massageForm.selectOption")}</option>
              {TIPOS_MASAJE.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipoLabels[tipo] ?? tipo}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.massageForm.preferredPressure")}</label>
            <div className="flex gap-4">
              {PRESION_LABELS.map((label, i) => (
                <label key={i} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="presion"
                    className="accent-brand-600"
                    checked={form.presion === i + 1}
                    onChange={() => set("presion", i + 1)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.focusZonesTitle")}>
        <div className="flex flex-wrap gap-2">
          {ZONAS.map((z) => (
            <label
              key={z}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.zonasEnfoque.includes(z)
                  ? "bg-brand-600/10 border-brand-600 text-brand-600"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={form.zonasEnfoque.includes(z)}
                onChange={() => toggleArr("zonasEnfoque", z)}
              />
              {zonaLabels[z] ?? z}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.triggerPointsTitle")}>
        <div className="flex flex-wrap gap-2">
          {TRIGGER_POINTS.map((tp) => (
            <label
              key={tp}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.triggerPoints.includes(tp)
                  ? "bg-purple-50 border-purple-400 text-purple-700 dark:bg-purple-900/30 dark:border-purple-500 dark:text-purple-300"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-purple-600"
                checked={form.triggerPoints.includes(tp)}
                onChange={() => toggleArr("triggerPoints", tp)}
              />
              {triggerPointLabels[tp] ?? tp}
            </label>
          ))}
        </div>
        {form.triggerPoints.length > 0 && (
          <div className="mt-3 space-y-2">
            {form.triggerPoints.map((tp) => (
              <div key={tp} className="flex items-center gap-3">
                <span className="text-sm min-w-[180px]">{triggerPointLabels[tp] ?? tp}</span>
                <select
                  className="input-new"
                  value={form.triggerPointTipo[tp] || "Activo"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      triggerPointTipo: { ...f.triggerPointTipo, [tp]: e.target.value },
                    }))
                  }
                >
                  <option value="Activo">{t("clinical.massageForm.tpActive")}</option>
                  <option value="Latente">{t("clinical.massageForm.tpLatent")}</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      <CardNew title={t("clinical.massageForm.posturalEvalTitle")}>
        <div className="flex flex-wrap gap-2">
          {EVALUACION_POSTURAL.map((ep) => (
            <label
              key={ep}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.evaluacionPostural.includes(ep)
                  ? "bg-sky-50 border-sky-400 text-sky-700 dark:bg-sky-900/30 dark:border-sky-500 dark:text-sky-300"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-sky-600"
                checked={form.evaluacionPostural.includes(ep)}
                onChange={() => toggleArr("evaluacionPostural", ep)}
              />
              {posturalLabels[ep] ?? ep}
            </label>
          ))}
        </div>
        <div className="field-new mt-3">
          <label className="field-new__label">{t("clinical.massageForm.posturalNotes")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.massageForm.posturalNotesPlaceholder")}
            value={form.notasPosturales}
            onChange={(e) => set("notasPosturales", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.painZonesTitle")}>
        <div className="flex flex-wrap gap-2">
          {ZONAS.map((z) => (
            <label
              key={z}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.zonasDolor.includes(z)
                  ? "bg-red-50 border-red-400 text-red-600"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-red-600"
                checked={form.zonasDolor.includes(z)}
                onChange={() => toggleArr("zonasDolor", z)}
              />
              {zonaLabels[z] ?? z}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.techniquesTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.massageForm.techniquesByZone")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.massageForm.techniquesPlaceholder")}
            value={form.tecnicas}
            onChange={(e) => set("tecnicas", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.contraindicationsTitle")}>
        <div className="flex flex-wrap gap-2">
          {CONTRAINDICACIONES.map((c) => (
            <label
              key={c}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.contraindicaciones.includes(c)
                  ? "bg-amber-50 border-amber-400 text-amber-700"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-amber-600"
                checked={form.contraindicaciones.includes(c)}
                onChange={() => toggleArr("contraindicaciones", c)}
              />
              {contraindicacionLabels[c] ?? c}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.painScaleTitle")}>
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.massageForm.painBefore")}</label>
            <div className="flex gap-1">
              {Array.from({ length: 11 }, (_, i) => {
                const hue = 120 - i * 12;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => set("dolorAntes", i)}
                    className={`w-9 h-9 rounded-lg text-xs font-bold border-2 transition-all ${
                      form.dolorAntes === i
                        ? "ring-2 ring-offset-2 ring-brand-600 scale-110 dark:ring-offset-gray-900"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: `hsl(${hue}, 80%, ${form.dolorAntes === i ? "45%" : "55%"})`,
                      borderColor: `hsl(${hue}, 80%, 35%)`,
                      color: "white",
                    }}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.massageForm.painAfter")}</label>
            <div className="flex gap-1">
              {Array.from({ length: 11 }, (_, i) => {
                const hue = 120 - i * 12;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => set("dolorDespues", i)}
                    className={`w-9 h-9 rounded-lg text-xs font-bold border-2 transition-all ${
                      form.dolorDespues === i
                        ? "ring-2 ring-offset-2 ring-brand-600 scale-110 dark:ring-offset-gray-900"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: `hsl(${hue}, 80%, ${form.dolorDespues === i ? "45%" : "55%"})`,
                      borderColor: `hsl(${hue}, 80%, 35%)`,
                      color: "white",
                    }}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </div>
          {form.dolorAntes !== null && form.dolorDespues !== null && (
            <div className={`text-sm font-semibold px-3 py-2 rounded-lg ${
              form.dolorAntes > form.dolorDespues
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : form.dolorAntes === form.dolorDespues
                  ? "bg-muted text-muted-foreground"
                  : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"
            }`}>
              {form.dolorAntes > form.dolorDespues
                ? t("clinical.massageForm.painReduction", { count: form.dolorAntes - form.dolorDespues })
                : form.dolorAntes === form.dolorDespues
                  ? t("clinical.massageForm.painNoChange")
                  : t("clinical.massageForm.painIncrease", { count: form.dolorDespues - form.dolorAntes })}
            </div>
          )}
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.soapTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", label: t("clinical.massageForm.soapSubjective"), ph: t("clinical.massageForm.soapSubjectivePlaceholder") },
            { key: "objective", label: t("clinical.massageForm.soapObjective"), ph: t("clinical.massageForm.soapObjectivePlaceholder") },
            { key: "assessment", label: t("clinical.massageForm.soapAssessment"), ph: t("clinical.massageForm.soapAssessmentPlaceholder") },
            { key: "plan", label: t("clinical.massageForm.soapPlan"), ph: t("clinical.massageForm.soapPlanPlaceholder") },
          ] as const).map((f) => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 80, resize: "vertical" }}
                placeholder={f.ph}
                value={(form as any)[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.massageForm.postMassageRecsTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.massageForm.postMassageRecsLabel")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.massageForm.postMassageRecsPlaceholder")}
            value={form.recomendaciones}
            onChange={(e) => set("recomendaciones", e.target.value)}
          />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.massageForm.saveConsult")}
        </ButtonNew>
      </div>
    </form>
  );
}
