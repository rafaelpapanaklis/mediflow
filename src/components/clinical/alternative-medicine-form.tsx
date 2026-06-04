"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

const MODALIDADES: { value: string; labelKey: string }[] = [
  { value: "acupuntura",        labelKey: "clinical.altMedForm.modalityAcupuncture" },
  { value: "ventosas/cupping",  labelKey: "clinical.altMedForm.modalityCupping" },
  { value: "moxibustión",       labelKey: "clinical.altMedForm.modalityMoxibustion" },
  { value: "electroacupuntura", labelKey: "clinical.altMedForm.modalityElectroacupuncture" },
  { value: "quiropráctica",     labelKey: "clinical.altMedForm.modalityChiropractic" },
  { value: "naturopatía",       labelKey: "clinical.altMedForm.modalityNaturopathy" },
  { value: "herbolaria",        labelKey: "clinical.altMedForm.modalityHerbalism" },
  { value: "homeopatía",        labelKey: "clinical.altMedForm.modalityHomeopathy" },
];

const PROFUNDIDADES: { value: string; labelKey: string }[] = [
  { value: "superficial", labelKey: "clinical.altMedForm.depthSuperficial" },
  { value: "media",       labelKey: "clinical.altMedForm.depthMedium" },
  { value: "profunda",    labelKey: "clinical.altMedForm.depthDeep" },
];

const TIPOS_PULSO: { value: string; labelKey: string }[] = [
  { value: "superficial",  labelKey: "clinical.altMedForm.pulseSuperficial" },
  { value: "profundo",     labelKey: "clinical.altMedForm.pulseDeep" },
  { value: "rápido",       labelKey: "clinical.altMedForm.pulseRapid" },
  { value: "lento",        labelKey: "clinical.altMedForm.pulseSlow" },
  { value: "resbaladizo",  labelKey: "clinical.altMedForm.pulseSlippery" },
  { value: "áspero",       labelKey: "clinical.altMedForm.pulseRough" },
  { value: "de cuerda",    labelKey: "clinical.altMedForm.pulseWiry" },
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function AlternativeMedicineForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    modalidad: "",
    // Acupuntura fields
    puntosAplicados: "",
    profundidad: "",
    tiempoRetencion: "",
    // Herbolaria fields
    formulaHerbal: "",
    // TCM diagnosis
    observacionLengua: "",
    tipoPulso: "",
    tipoConstitucional: "",
    notasSesion: "",
    planTratamiento: "",
    // Evaluación constitucional TCM
    constitucionPredominante: "",
    excesoDeficiencia: "",
    frioCalor: "",
    humedad: "",
    estancamientoQi: "",
    // Mapa de puntos de acupuntura
    puntosDetallados: [{ punto: "", meridiano: "", lateralidad: "", tecnica: "" }] as { punto: string; meridiano: string; lateralidad: string; tecnica: string }[],
    // Interacciones hierba-medicamento
    medicamentosConvencionales: "",
    formulaHerbalPrescrita: "",
    interaccionesConocidas: [] as string[],
    notasSeguridad: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const isAcupuntura = form.modalidad === "acupuntura";
  const isHerbolaria = form.modalidad === "herbolaria";

  const MERIDIANOS = [
    "Pulmón (LU)", "Intestino Grueso (LI)", "Estómago (ST)", "Bazo (SP)",
    "Corazón (HT)", "Intestino Delgado (SI)", "Vejiga (BL)", "Riñón (KI)",
    "Pericardio (PC)", "Triple Calentador (TE)", "Vesícula Biliar (GB)",
    "Hígado (LR)", "Du Mai (GV)", "Ren Mai (CV)", "Extra",
  ];

  const INTERACCIONES_COMUNES: { value: string; labelKey: string }[] = [
    { value: "Anticoagulantes + Ginkgo/Ginseng/Dong Quai", labelKey: "clinical.altMedForm.interactionAnticoagulants" },
    { value: "Antidepresivos ISRS + Hierba de San Juan",   labelKey: "clinical.altMedForm.interactionSsri" },
    { value: "Antidiabéticos + Ginseng/Aloe vera",         labelKey: "clinical.altMedForm.interactionAntidiabetics" },
    { value: "Antihipertensivos + Regaliz (Glycyrrhiza)",  labelKey: "clinical.altMedForm.interactionAntihypertensives" },
    { value: "Inmunosupresores + Echinacea/Astrágalo",     labelKey: "clinical.altMedForm.interactionImmunosuppressants" },
  ];

  function addPuntoDetallado() {
    set("puntosDetallados", [
      ...form.puntosDetallados,
      { punto: "", meridiano: "", lateralidad: "", tecnica: "" },
    ]);
  }

  function removePuntoDetallado(i: number) {
    set("puntosDetallados", form.puntosDetallados.filter((_: any, idx: number) => idx !== i));
  }

  function updatePuntoDetallado(i: number, field: string, value: string) {
    const pts = [...form.puntosDetallados];
    (pts[i] as any)[field] = value;
    set("puntosDetallados", pts);
  }

  function toggleInteraccion(interaccion: string) {
    const current = form.interaccionesConocidas;
    if (current.includes(interaccion)) {
      set("interaccionesConocidas", current.filter((i: string) => i !== interaccion));
    } else {
      set("interaccionesConocidas", [...current, interaccion]);
    }
  }

  async function handleSave() {
    if (!form.modalidad) {
      toast.error(t("clinical.altMedForm.errSelectModality"));
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
            type: "alternative_medicine",
            modalidad: form.modalidad,
            acupuntura: isAcupuntura
              ? {
                  puntosAplicados: form.puntosAplicados,
                  profundidad: form.profundidad,
                  tiempoRetencion: form.tiempoRetencion,
                }
              : null,
            formulaHerbal: isHerbolaria ? form.formulaHerbal : null,
            diagnosticoTCM: {
              observacionLengua: form.observacionLengua,
              tipoPulso: form.tipoPulso,
            },
            tipoConstitucional: form.tipoConstitucional,
            notasSesion: form.notasSesion,
            planTratamiento: form.planTratamiento,
            evaluacionConstitucional: {
              constitucionPredominante: form.constitucionPredominante,
              excesoDeficiencia: form.excesoDeficiencia,
              frioCalor: form.frioCalor,
              humedad: form.humedad,
              estancamientoQi: form.estancamientoQi,
            },
            puntosDetallados: form.puntosDetallados,
            interaccionesHierbaMedicamento: {
              medicamentosConvencionales: form.medicamentosConvencionales,
              formulaHerbalPrescrita: form.formulaHerbalPrescrita,
              interaccionesConocidas: form.interaccionesConocidas,
              notasSeguridad: form.notasSeguridad,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();

      // Save herbal formula separately if applicable
      if (isHerbolaria && form.formulaHerbal) {
        await fetch("/api/formulas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            type: "herbal",
            formula: { ingredients: form.formulaHerbal },
            notes: form.notasSesion,
          }),
        }).catch(() => {
          /* endpoint may not exist yet */
        });
      }

      onSaved(record);
      toast.success(t("clinical.altMedForm.saved"));
    } catch (err: any) {
      toast.error(err.message ?? t("clinical.altMedForm.errSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="SOAP">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.reasonLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.reasonPlaceholder")}
              value={form.subjective}
              onChange={(e) => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.examLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.examPlaceholder")}
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.altMedForm.modalityCardTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.altMedForm.modalityLabel")}</label>
          <select
            className="input-new"
            value={form.modalidad}
            onChange={(e) => set("modalidad", e.target.value)}
          >
            <option value="">{t("clinical.altMedForm.selectOption")}</option>
            {MODALIDADES.map((m) => (
              <option key={m.value} value={m.value}>
                {t(m.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </CardNew>

      {isAcupuntura && (
        <CardNew title={t("clinical.altMedForm.acupunctureTitle")}>
          <div className="space-y-4">
            <div className="field-new">
              <label className="field-new__label">{t("clinical.altMedForm.pointsAppliedLabel")}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 80, resize: "vertical" }}
                placeholder="Ej. LI4, ST36, SP6, LR3…"
                value={form.puntosAplicados}
                onChange={(e) => set("puntosAplicados", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="field-new">
                <label className="field-new__label">{t("clinical.altMedForm.depthLabel")}</label>
                <select
                  className="input-new"
                  value={form.profundidad}
                  onChange={(e) => set("profundidad", e.target.value)}
                >
                  <option value="">{t("clinical.altMedForm.selectOption")}</option>
                  {PROFUNDIDADES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.altMedForm.retentionTimeLabel")}</label>
                <input
                  type="number"
                  className="input-new"
                  placeholder="Ej. 20"
                  value={form.tiempoRetencion}
                  onChange={(e) => set("tiempoRetencion", e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardNew>
      )}

      {isHerbolaria && (
        <CardNew title={t("clinical.altMedForm.herbalismTitle")}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.herbalFormulaLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.herbalFormulaPlaceholder")}
              value={form.formulaHerbal}
              onChange={(e) => set("formulaHerbal", e.target.value)}
            />
          </div>
        </CardNew>
      )}

      <CardNew title={t("clinical.altMedForm.tcmDiagnosisTitle")}>
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.tongueObservationLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.tongueObservationPlaceholder")}
              value={form.observacionLengua}
              onChange={(e) => set("observacionLengua", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="field-new">
              <label className="field-new__label">{t("clinical.altMedForm.pulseTypeLabel")}</label>
              <select
                className="input-new"
                value={form.tipoPulso}
                onChange={(e) => set("tipoPulso", e.target.value)}
              >
                <option value="">{t("clinical.altMedForm.selectOption")}</option>
                {TIPOS_PULSO.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.altMedForm.constitutionalTypeLabel")}</label>
              <input
                className="input-new"
                placeholder={t("clinical.altMedForm.constitutionalTypePlaceholder")}
                value={form.tipoConstitucional}
                onChange={(e) => set("tipoConstitucional", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.altMedForm.constitutionalEvalTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.predominantConstitutionLabel")}</label>
            <select
              className="input-new"
              value={form.constitucionPredominante}
              onChange={(e) => set("constitucionPredominante", e.target.value)}
            >
              <option value="">{t("clinical.altMedForm.selectOption")}</option>
              <option value="madera">{t("clinical.altMedForm.constWood")}</option>
              <option value="fuego">{t("clinical.altMedForm.constFire")}</option>
              <option value="tierra">{t("clinical.altMedForm.constEarth")}</option>
              <option value="metal">{t("clinical.altMedForm.constMetal")}</option>
              <option value="agua">{t("clinical.altMedForm.constWater")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.excessDeficiencyLabel")}</label>
            <select
              className="input-new"
              value={form.excesoDeficiencia}
              onChange={(e) => set("excesoDeficiencia", e.target.value)}
            >
              <option value="">{t("clinical.altMedForm.selectOption")}</option>
              <option value="exceso">{t("clinical.altMedForm.excessShi")}</option>
              <option value="deficiencia">{t("clinical.altMedForm.deficiencyXu")}</option>
              <option value="mixto">{t("clinical.altMedForm.mixed")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.coldHeatLabel")}</label>
            <select
              className="input-new"
              value={form.frioCalor}
              onChange={(e) => set("frioCalor", e.target.value)}
            >
              <option value="">{t("clinical.altMedForm.selectOption")}</option>
              <option value="frio">{t("clinical.altMedForm.coldPattern")}</option>
              <option value="calor">{t("clinical.altMedForm.heatPattern")}</option>
              <option value="mixto">{t("clinical.altMedForm.mixed")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.dampnessLabel")}</label>
            <select
              className="input-new"
              value={form.humedad}
              onChange={(e) => set("humedad", e.target.value)}
            >
              <option value="">{t("clinical.altMedForm.selectOption")}</option>
              <option value="sin_humedad">{t("clinical.altMedForm.dampnessNone")}</option>
              <option value="leve">{t("clinical.altMedForm.dampnessMild")}</option>
              <option value="severa">{t("clinical.altMedForm.dampnessSevere")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.qiStagnationLabel")}</label>
            <select
              className="input-new"
              value={form.estancamientoQi}
              onChange={(e) => set("estancamientoQi", e.target.value)}
            >
              <option value="">{t("clinical.altMedForm.selectOption")}</option>
              <option value="sin_estancamiento">{t("clinical.altMedForm.stagnationNone")}</option>
              <option value="leve">{t("clinical.altMedForm.stagnationMild")}</option>
              <option value="moderado">{t("clinical.altMedForm.stagnationModerate")}</option>
              <option value="severo">{t("clinical.altMedForm.stagnationSevere")}</option>
            </select>
          </div>
        </div>
      </CardNew>

      {isAcupuntura && (
        <CardNew title={t("clinical.altMedForm.pointsRegistryTitle")} action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {t("clinical.altMedForm.totalNeedles")} <span className="font-bold text-foreground">{form.puntosDetallados.filter((p: any) => p.punto).length}</span>
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-brand-600 hover:underline"
              onClick={addPuntoDetallado}
            >
              {t("clinical.altMedForm.addPoint")}
            </button>
          </div>
        }>
          <div className="space-y-2">
            {form.puntosDetallados.map((p: any, i: number) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end">
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.altMedForm.pointLabel")}</label>
                  <input
                    className="input-new"
                    placeholder="Ej. LI4 Hegu"
                    value={p.punto}
                    onChange={(e) => updatePuntoDetallado(i, "punto", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.altMedForm.meridianLabel")}</label>
                  <select
                    className="input-new"
                    value={p.meridiano}
                    onChange={(e) => updatePuntoDetallado(i, "meridiano", e.target.value)}
                  >
                    <option value="">{t("clinical.altMedForm.meridianPlaceholder")}</option>
                    {MERIDIANOS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.altMedForm.lateralityLabel")}</label>
                  <select
                    className="input-new"
                    value={p.lateralidad}
                    onChange={(e) => updatePuntoDetallado(i, "lateralidad", e.target.value)}
                  >
                    <option value="">{t("clinical.altMedForm.lateralityPlaceholder")}</option>
                    <option value="izq">{t("clinical.altMedForm.lateralityLeft")}</option>
                    <option value="der">{t("clinical.altMedForm.lateralityRight")}</option>
                    <option value="bilateral">{t("clinical.altMedForm.lateralityBilateral")}</option>
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.altMedForm.techniqueLabel")}</label>
                  <select
                    className="input-new"
                    value={p.tecnica}
                    onChange={(e) => updatePuntoDetallado(i, "tecnica", e.target.value)}
                  >
                    <option value="">{t("clinical.altMedForm.techniquePlaceholder")}</option>
                    <option value="tonificacion">{t("clinical.altMedForm.techniqueTonification")}</option>
                    <option value="sedacion">{t("clinical.altMedForm.techniqueSedation")}</option>
                    <option value="neutra">{t("clinical.altMedForm.techniqueNeutral")}</option>
                  </select>
                </div>
                {form.puntosDetallados.length > 1 && (
                  <button
                    type="button"
                    className="h-9 px-2 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    onClick={() => removePuntoDetallado(i)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardNew>
      )}

      <CardNew title={t("clinical.altMedForm.notesPlanTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.sessionNotesLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.sessionNotesPlaceholder")}
              value={form.notasSesion}
              onChange={(e) => set("notasSesion", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.treatmentPlanLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.treatmentPlanPlaceholder")}
              value={form.planTratamiento}
              onChange={(e) => set("planTratamiento", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.altMedForm.diagnosisTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.altMedForm.diagnosisLabel")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.altMedForm.diagnosisPlaceholder")}
            value={form.assessment}
            onChange={(e) => set("assessment", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.altMedForm.interactionsAlertTitle")}>
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.conventionalMedsLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.conventionalMedsPlaceholder")}
              value={form.medicamentosConvencionales}
              onChange={(e) => set("medicamentosConvencionales", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.prescribedFormulaLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.prescribedFormulaPlaceholder")}
              value={form.formulaHerbalPrescrita || form.formulaHerbal}
              onChange={(e) => set("formulaHerbalPrescrita", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="field-new__label">{t("clinical.altMedForm.knownInteractionsLabel")}</label>
            <div className="space-y-2">
              {INTERACCIONES_COMUNES.map((interaccion) => (
                <label key={interaccion.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-600/20"
                    checked={form.interaccionesConocidas.includes(interaccion.value)}
                    onChange={() => toggleInteraccion(interaccion.value)}
                  />
                  <span className="text-sm">{t(interaccion.labelKey)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.altMedForm.safetyNotesLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.altMedForm.safetyNotesPlaceholder")}
              value={form.notasSeguridad}
              onChange={(e) => set("notasSeguridad", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.altMedForm.saveConsult")}
        </ButtonNew>
      </div>
    </form>
  );
}
