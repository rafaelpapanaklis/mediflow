"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

const SERVICIOS = [
  "corte",
  "color completo",
  "mechas/highlights",
  "balayage",
  "alisado keratina",
  "permanente",
  "tratamiento capilar",
  "barba",
  "corte + barba",
];

const TIPOS_CABELLO = [
  "liso fino",
  "liso grueso",
  "ondulado",
  "rizado",
  "crespo",
];

const VOLUMENES_REVELADOR = ["10", "20", "30", "40"];

const COLOR_SERVICES = ["color completo", "mechas/highlights", "balayage"];

const SCALP_TYPES: { value: string; labelKey: string }[] = [
  { value: "normal", labelKey: "clinical.hairSalonForm.scalpNormal" },
  { value: "graso", labelKey: "clinical.hairSalonForm.scalpOily" },
  { value: "seco", labelKey: "clinical.hairSalonForm.scalpDry" },
  { value: "mixto", labelKey: "clinical.hairSalonForm.scalpCombination" },
  { value: "con caspa", labelKey: "clinical.hairSalonForm.scalpDandruff" },
  { value: "con dermatitis", labelKey: "clinical.hairSalonForm.scalpDermatitis" },
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function HairSalonForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    servicio: "",
    tipoCabello: "",
    colors: [{ marca: "", tono: "", proporcion: "", reveladorVolumen: "20" }],
    processingTime: "",
    productosAplicados: "",
    estilista: "",
    notasProximaVisita: "",
    // Diagnóstico capilar
    porosidad: "",
    nivelDano: 0,
    tipoCueroCabelludo: "",
    elasticidad: "",
    grosorCabello: "",
    // Preferencias del cliente
    estiloPreferido: "",
    largoIdeal: "",
    frecuenciaVisita: "",
    productosFavoritos: "",
    alergias: "",
    // Recomendaciones para casa
    champuRecomendado: "",
    acondicionador: "",
    tratamientoMascarilla: "",
    frecuenciaLavado: "",
    notasCuidado: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const showColorFormula = COLOR_SERVICES.includes(form.servicio);

  function addColor() {
    set("colors", [
      ...form.colors,
      { marca: "", tono: "", proporcion: "", reveladorVolumen: "20" },
    ]);
  }

  function updateColor(i: number, field: string, value: string) {
    const colors = [...form.colors];
    (colors[i] as any)[field] = value;
    set("colors", colors);
  }

  async function handleSave() {
    if (!form.servicio) {
      toast.error(t("clinical.hairSalonForm.errSelectService"));
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
            type: "hair_salon",
            servicio: form.servicio,
            tipoCabello: form.tipoCabello,
            colorFormula: showColorFormula
              ? { colors: form.colors, processingTime: form.processingTime }
              : null,
            productosAplicados: form.productosAplicados,
            estilista: form.estilista,
            notasProximaVisita: form.notasProximaVisita,
            diagnosticoCapilar: {
              porosidad: form.porosidad,
              nivelDano: form.nivelDano,
              tipoCueroCabelludo: form.tipoCueroCabelludo,
              elasticidad: form.elasticidad,
              grosorCabello: form.grosorCabello,
            },
            preferenciasCliente: {
              estiloPreferido: form.estiloPreferido,
              largoIdeal: form.largoIdeal,
              frecuenciaVisita: form.frecuenciaVisita,
              productosFavoritos: form.productosFavoritos,
              alergias: form.alergias,
            },
            recomendacionesCasa: {
              champuRecomendado: form.champuRecomendado,
              acondicionador: form.acondicionador,
              tratamientoMascarilla: form.tratamientoMascarilla,
              frecuenciaLavado: form.frecuenciaLavado,
              notasCuidado: form.notasCuidado,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();

      // Save color formula separately if applicable
      if (showColorFormula) {
        await fetch("/api/formulas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            type: "hair_color",
            formula: {
              colors: form.colors,
              processingTime: form.processingTime,
            },
            notes: form.notasProximaVisita,
          }),
        }).catch(() => {
          /* endpoint may not exist yet */
        });
      }

      onSaved(record);
      toast.success(t("clinical.hairSalonForm.savedSuccess"));
    } catch (err: any) {
      toast.error(err.message ?? t("clinical.hairSalonForm.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.hairSalonForm.reasonObsTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.visitReason")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.hairSalonForm.visitReasonPlaceholder")}
              value={form.subjective}
              onChange={(e) => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.hairObservations")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.hairSalonForm.hairObservationsPlaceholder")}
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.hairSalonForm.serviceTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.service")}</label>
            <select
              className="input-new"
              value={form.servicio}
              onChange={(e) => set("servicio", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              {SERVICIOS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.hairType")}</label>
            <select
              className="input-new"
              value={form.tipoCabello}
              onChange={(e) => set("tipoCabello", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              {TIPOS_CABELLO.map((ty) => (
                <option key={ty} value={ty}>
                  {ty.charAt(0).toUpperCase() + ty.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      {showColorFormula && (
        <CardNew
          title={t("clinical.hairSalonForm.colorFormulaTitle")}
          action={
            <button
              type="button"
              className="text-xs font-semibold text-brand-600 hover:underline"
              onClick={addColor}
            >
              {t("clinical.hairSalonForm.addColor")}
            </button>
          }
        >
          <div className="space-y-2">
            {form.colors.map((c, i) => (
              <div key={i} className="grid grid-cols-4 gap-2">
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.hairSalonForm.brand")}</label>
                  <input
                    className="input-new"
                    placeholder={t("clinical.hairSalonForm.brandPlaceholder")}
                    value={c.marca}
                    onChange={(e) => updateColor(i, "marca", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.hairSalonForm.shade")}</label>
                  <input
                    className="input-new"
                    placeholder={t("clinical.hairSalonForm.shadePlaceholder")}
                    value={c.tono}
                    onChange={(e) => updateColor(i, "tono", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.hairSalonForm.ratio")}</label>
                  <input
                    className="input-new"
                    placeholder={t("clinical.hairSalonForm.ratioPlaceholder")}
                    value={c.proporcion}
                    onChange={(e) =>
                      updateColor(i, "proporcion", e.target.value)
                    }
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.hairSalonForm.developerVolume")}</label>
                  <select
                    className="input-new"
                    value={c.reveladorVolumen}
                    onChange={(e) =>
                      updateColor(i, "reveladorVolumen", e.target.value)
                    }
                  >
                    {VOLUMENES_REVELADOR.map((v) => (
                      <option key={v} value={v}>
                        {t("clinical.hairSalonForm.volValue", { value: v })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.processingTime")}</label>
            <input
              type="number"
              className="input-new"
              placeholder={t("clinical.hairSalonForm.processingTimePlaceholder")}
              value={form.processingTime}
              onChange={(e) => set("processingTime", e.target.value)}
            />
          </div>
        </CardNew>
      )}

      <CardNew title={t("clinical.hairSalonForm.additionalDetailsTitle")}>
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.productsApplied")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.hairSalonForm.productsAppliedPlaceholder")}
              value={form.productosAplicados}
              onChange={(e) => set("productosAplicados", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="field-new">
              <label className="field-new__label">{t("clinical.hairSalonForm.stylist")}</label>
              <input
                className="input-new"
                placeholder={t("clinical.hairSalonForm.stylistPlaceholder")}
                value={form.estilista}
                onChange={(e) => set("estilista", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.hairSalonForm.hairDiagnosisTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.porosity")}</label>
            <select
              className="input-new"
              value={form.porosidad}
              onChange={(e) => set("porosidad", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              <option value="baja">{t("clinical.hairSalonForm.porosityLow")}</option>
              <option value="media">{t("clinical.hairSalonForm.porosityMedium")}</option>
              <option value="alta">{t("clinical.hairSalonForm.porosityHigh")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.scalpType")}</label>
            <select
              className="input-new"
              value={form.tipoCueroCabelludo}
              onChange={(e) => set("tipoCueroCabelludo", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              {SCALP_TYPES.map((scalp) => (
                <option key={scalp.value} value={scalp.value}>{t(scalp.labelKey)}</option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.elasticity")}</label>
            <select
              className="input-new"
              value={form.elasticidad}
              onChange={(e) => set("elasticidad", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              <option value="buena">{t("clinical.hairSalonForm.elasticityGood")}</option>
              <option value="media">{t("clinical.hairSalonForm.elasticityMedium")}</option>
              <option value="baja">{t("clinical.hairSalonForm.elasticityLow")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.hairThickness")}</label>
            <select
              className="input-new"
              value={form.grosorCabello}
              onChange={(e) => set("grosorCabello", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              <option value="fino">{t("clinical.hairSalonForm.thicknessFine")}</option>
              <option value="medio">{t("clinical.hairSalonForm.thicknessMedium")}</option>
              <option value="grueso">{t("clinical.hairSalonForm.thicknessThick")}</option>
            </select>
          </div>
        </div>
        <div className="mt-4 field-new">
          <label className="field-new__label">{t("clinical.hairSalonForm.damageLevel")}</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const colors = [
                "bg-green-500 hover:bg-green-600",
                "bg-lime-500 hover:bg-lime-600",
                "bg-yellow-500 hover:bg-yellow-600",
                "bg-orange-500 hover:bg-orange-600",
                "bg-red-500 hover:bg-red-600",
              ];
              return (
                <button
                  key={n}
                  type="button"
                  className={`h-10 w-10 rounded-lg text-sm font-bold text-white transition-all ${
                    form.nivelDano === n
                      ? colors[n - 1] + " ring-2 ring-offset-2 ring-brand-600 dark:ring-offset-gray-900"
                      : "bg-muted text-muted-foreground hover:opacity-80"
                  }`}
                  onClick={() => set("nivelDano", n)}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.hairSalonForm.clientPrefsTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.preferredStyle")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.hairSalonForm.preferredStylePlaceholder")}
              value={form.estiloPreferido}
              onChange={(e) => set("estiloPreferido", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.idealLength")}</label>
            <select
              className="input-new"
              value={form.largoIdeal}
              onChange={(e) => set("largoIdeal", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              <option value="muy_corto">{t("clinical.hairSalonForm.lengthVeryShort")}</option>
              <option value="corto">{t("clinical.hairSalonForm.lengthShort")}</option>
              <option value="medio">{t("clinical.hairSalonForm.lengthMedium")}</option>
              <option value="largo">{t("clinical.hairSalonForm.lengthLong")}</option>
              <option value="muy_largo">{t("clinical.hairSalonForm.lengthVeryLong")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.visitFrequency")}</label>
            <select
              className="input-new"
              value={form.frecuenciaVisita}
              onChange={(e) => set("frecuenciaVisita", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              <option value="3_semanas">{t("clinical.hairSalonForm.freqEvery3Weeks")}</option>
              <option value="mensual">{t("clinical.hairSalonForm.freqMonthly")}</option>
              <option value="6_semanas">{t("clinical.hairSalonForm.freqEvery6Weeks")}</option>
              <option value="2_meses">{t("clinical.hairSalonForm.freqEvery2Months")}</option>
              <option value="3_meses">{t("clinical.hairSalonForm.freqEvery3Months")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.favoriteProducts")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.hairSalonForm.favoriteProductsPlaceholder")}
              value={form.productosFavoritos}
              onChange={(e) => set("productosFavoritos", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 field-new">
          <label className="field-new__label">{t("clinical.hairSalonForm.allergies")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.hairSalonForm.allergiesPlaceholder")}
            value={form.alergias}
            onChange={(e) => set("alergias", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.hairSalonForm.homeCareTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.recommendedShampoo")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.hairSalonForm.recommendedShampooPlaceholder")}
              value={form.champuRecomendado}
              onChange={(e) => set("champuRecomendado", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.conditioner")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.hairSalonForm.conditionerPlaceholder")}
              value={form.acondicionador}
              onChange={(e) => set("acondicionador", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.treatmentMask")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.hairSalonForm.treatmentMaskPlaceholder")}
              value={form.tratamientoMascarilla}
              onChange={(e) => set("tratamientoMascarilla", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.washFrequency")}</label>
            <select
              className="input-new"
              value={form.frecuenciaLavado}
              onChange={(e) => set("frecuenciaLavado", e.target.value)}
            >
              <option value="">{t("clinical.hairSalonForm.select")}</option>
              <option value="diario">{t("clinical.hairSalonForm.washDaily")}</option>
              <option value="cada_2_dias">{t("clinical.hairSalonForm.washEvery2Days")}</option>
              <option value="cada_3_dias">{t("clinical.hairSalonForm.washEvery3Days")}</option>
              <option value="2_por_semana">{t("clinical.hairSalonForm.washTwiceWeek")}</option>
              <option value="1_por_semana">{t("clinical.hairSalonForm.washOnceWeek")}</option>
            </select>
          </div>
        </div>
        <div className="mt-4 field-new">
          <label className="field-new__label">{t("clinical.hairSalonForm.careNotes")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.hairSalonForm.careNotesPlaceholder")}
            value={form.notasCuidado}
            onChange={(e) => set("notasCuidado", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.hairSalonForm.dxPlanTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.resultObservations")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.hairSalonForm.resultPlaceholder")}
              value={form.assessment}
              onChange={(e) => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.hairSalonForm.nextVisitNotes")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.hairSalonForm.nextVisitNotesPlaceholder")}
              value={form.notasProximaVisita}
              onChange={(e) => set("notasProximaVisita", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.hairSalonForm.saveConsult")}
        </ButtonNew>
      </div>
    </form>
  );
}
