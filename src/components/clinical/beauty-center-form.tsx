"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

const TREATMENTS = ["facial", "body wrap", "radiofrecuencia", "cavitación", "LED", "microdermoabrasión", "otro"] as const;
const TREATMENT_KEYS: Record<string, string> = {
  "facial": "clinical.beautyCenterForm.txFacial",
  "body wrap": "clinical.beautyCenterForm.txBodyWrap",
  "radiofrecuencia": "clinical.beautyCenterForm.txRadiofrequency",
  "cavitación": "clinical.beautyCenterForm.txCavitation",
  "LED": "clinical.beautyCenterForm.txLed",
  "microdermoabrasión": "clinical.beautyCenterForm.txMicrodermabrasion",
  "otro": "clinical.beautyCenterForm.txOther",
};
const BODY_ZONES = ["rostro", "cuello", "brazos", "abdomen", "piernas", "glúteos", "espalda", "cuerpo completo"] as const;
const BODY_ZONE_KEYS: Record<string, string> = {
  "rostro": "clinical.beautyCenterForm.zoneFace",
  "cuello": "clinical.beautyCenterForm.zoneNeck",
  "brazos": "clinical.beautyCenterForm.zoneArms",
  "abdomen": "clinical.beautyCenterForm.zoneAbdomen",
  "piernas": "clinical.beautyCenterForm.zoneLegs",
  "glúteos": "clinical.beautyCenterForm.zoneGlutes",
  "espalda": "clinical.beautyCenterForm.zoneBack",
  "cuerpo completo": "clinical.beautyCenterForm.zoneFullBody",
};
const CONTRAINDICATIONS = ["embarazo", "marcapasos", "medicamentos fotosensibles", "enfermedades autoinmunes", "heridas abiertas"] as const;
const CONTRA_KEYS: Record<string, string> = {
  "embarazo": "clinical.beautyCenterForm.contraPregnancy",
  "marcapasos": "clinical.beautyCenterForm.contraPacemaker",
  "medicamentos fotosensibles": "clinical.beautyCenterForm.contraPhotosensitive",
  "enfermedades autoinmunes": "clinical.beautyCenterForm.contraAutoimmune",
  "heridas abiertas": "clinical.beautyCenterForm.contraOpenWounds",
};

interface Props { patientId: string; onSaved: (record: any) => void; }

export function BeautyCenterForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    tipoPiel: "",
    tratamiento: "",
    zonaTratada: "",
    productos: "",
    contraindicaciones: [] as string[],
    observaciones: "",
    planSiguiente: "",
    // Baumann skin type
    baumannHidratacion: "" as "" | "O" | "D",
    baumannSensibilidad: "" as "" | "S" | "R",
    baumannPigmentacion: "" as "" | "P" | "N",
    baumannArrugas: "" as "" | "W" | "T",
    // Equipment parameters
    equipoUtilizado: "",
    energia: "",
    frecuencia: "",
    profundidad: "",
    tiempoExposicion: "",
    modoPrograma: "",
    // Post-treatment reactions
    reaccionEritema: 0,
    reaccionEdema: 0,
    reaccionSensibilidad: 0,
    reaccionDescamacion: 0,
    tiempoResolucion: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function toggleContra(c: string) {
    setForm(f => ({
      ...f,
      contraindicaciones: f.contraindicaciones.includes(c)
        ? f.contraindicaciones.filter(x => x !== c)
        : [...f.contraindicaciones, c],
    }));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error(t("clinical.beautyCenterForm.errReason")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          objective: form.objective,
          assessment: form.assessment,
          plan: form.plan,
          specialtyData: {
            type: "beauty_center",
            tipoPiel: form.tipoPiel,
            tratamiento: form.tratamiento,
            zonaTratada: form.zonaTratada,
            productos: form.productos,
            contraindicaciones: form.contraindicaciones,
            observaciones: form.observaciones,
            planSiguiente: form.planSiguiente,
            baumannType: `${form.baumannHidratacion}${form.baumannSensibilidad}${form.baumannPigmentacion}${form.baumannArrugas}`,
            baumannHidratacion: form.baumannHidratacion,
            baumannSensibilidad: form.baumannSensibilidad,
            baumannPigmentacion: form.baumannPigmentacion,
            baumannArrugas: form.baumannArrugas,
            equipoUtilizado: form.equipoUtilizado,
            energia: form.energia,
            frecuencia: form.frecuencia,
            profundidad: form.profundidad,
            tiempoExposicion: form.tiempoExposicion,
            modoPrograma: form.modoPrograma,
            reacciones: {
              eritema: form.reaccionEritema,
              edema: form.reaccionEdema,
              sensibilidad: form.reaccionSensibilidad,
              descamacion: form.reaccionDescamacion,
            },
            tiempoResolucion: form.tiempoResolucion,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success(t("clinical.beautyCenterForm.savedToast"));
    } catch (err: any) { toast.error(err.message ?? t("clinical.beautyCenterForm.errSave")); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.beautyCenterForm.anamnesis")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.reasonLabel")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.beautyCenterForm.reasonPlaceholder")} value={form.subjective} onChange={e => set("subjective", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.physicalExamLabel")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.beautyCenterForm.physicalExamPlaceholder")} value={form.objective} onChange={e => set("objective", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.skinTypeTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.beautyCenterForm.skinTypeLabel")}</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.beautyCenterForm.skinTypePlaceholder")} value={form.tipoPiel} onChange={e => set("tipoPiel", e.target.value)} />
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.treatmentTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.treatmentLabel")}</label>
            <select className="input-new"
              value={form.tratamiento} onChange={e => set("tratamiento", e.target.value)}>
              <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
              {TREATMENTS.map(ty => <option key={ty} value={ty}>{t(TREATMENT_KEYS[ty] ?? "")}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.treatedZoneLabel")}</label>
            <select className="input-new"
              value={form.zonaTratada} onChange={e => set("zonaTratada", e.target.value)}>
              <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
              {BODY_ZONES.map(z => <option key={z} value={z}>{t(BODY_ZONE_KEYS[z] ?? "")}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.productsTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.beautyCenterForm.productsLabel")}</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.beautyCenterForm.productsPlaceholder")} value={form.productos} onChange={e => set("productos", e.target.value)} />
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.contraTitle")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CONTRAINDICATIONS.map(c => (
            <label key={c} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.contraindicaciones.includes(c)} onChange={() => toggleContra(c)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{t(CONTRA_KEYS[c])}</span>
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.diagnosisTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.diagnosisLabel")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.beautyCenterForm.diagnosisPlaceholder")} value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.observationsLabel")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.beautyCenterForm.observationsPlaceholder")} value={form.observaciones} onChange={e => set("observaciones", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.baumannTitle")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.baumannHydration")}</label>
            <select className="input-new"
              value={form.baumannHidratacion} onChange={e => set("baumannHidratacion", e.target.value)}>
              <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
              <option value="O">{t("clinical.beautyCenterForm.baumannOily")}</option>
              <option value="D">{t("clinical.beautyCenterForm.baumannDry")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.baumannSensitivity")}</label>
            <select className="input-new"
              value={form.baumannSensibilidad} onChange={e => set("baumannSensibilidad", e.target.value)}>
              <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
              <option value="S">{t("clinical.beautyCenterForm.baumannSensitive")}</option>
              <option value="R">{t("clinical.beautyCenterForm.baumannResistant")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.baumannPigmentation")}</label>
            <select className="input-new"
              value={form.baumannPigmentacion} onChange={e => set("baumannPigmentacion", e.target.value)}>
              <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
              <option value="P">{t("clinical.beautyCenterForm.baumannPigmented")}</option>
              <option value="N">{t("clinical.beautyCenterForm.baumannNonPigmented")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.baumannWrinkles")}</label>
            <select className="input-new"
              value={form.baumannArrugas} onChange={e => set("baumannArrugas", e.target.value)}>
              <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
              <option value="W">{t("clinical.beautyCenterForm.baumannWrinkled")}</option>
              <option value="T">{t("clinical.beautyCenterForm.baumannTight")}</option>
            </select>
          </div>
        </div>
        {(form.baumannHidratacion || form.baumannSensibilidad || form.baumannPigmentacion || form.baumannArrugas) && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("clinical.beautyCenterForm.baumannTypeLabel")}</span>
            <span className="inline-flex items-center rounded-full bg-brand-500/15 px-3 py-0.5 text-sm font-bold text-brand-700 dark:text-brand-300">
              {form.baumannHidratacion || "–"}{form.baumannSensibilidad || "–"}{form.baumannPigmentacion || "–"}{form.baumannArrugas || "–"}
            </span>
          </div>
        )}
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.equipmentTitle")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.equipmentUsedLabel")}</label>
            <input className="input-new"
              placeholder={t("clinical.beautyCenterForm.equipmentUsedPlaceholder")} value={form.equipoUtilizado} onChange={e => set("equipoUtilizado", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.energyLabel")}</label>
            <input type="number" min={0} step="0.1" className="input-new"
              placeholder="0" value={form.energia} onChange={e => set("energia", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.frequencyLabel")}</label>
            <input type="number" min={0} step="0.1" className="input-new"
              placeholder="0" value={form.frecuencia} onChange={e => set("frecuencia", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.depthLabel")}</label>
            <input type="number" min={0} step="0.1" className="input-new"
              placeholder="0" value={form.profundidad} onChange={e => set("profundidad", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.exposureTimeLabel")}</label>
            <input type="number" min={0} step="1" className="input-new"
              placeholder="0" value={form.tiempoExposicion} onChange={e => set("tiempoExposicion", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.beautyCenterForm.modeProgramLabel")}</label>
            <input className="input-new"
              placeholder={t("clinical.beautyCenterForm.modeProgramPlaceholder")} value={form.modoPrograma} onChange={e => set("modoPrograma", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.reactionsTitle")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {([
            { key: "reaccionEritema", labelKey: "clinical.beautyCenterForm.reactionErythema" },
            { key: "reaccionEdema", labelKey: "clinical.beautyCenterForm.reactionEdema" },
            { key: "reaccionSensibilidad", labelKey: "clinical.beautyCenterForm.reactionSensitivity" },
            { key: "reaccionDescamacion", labelKey: "clinical.beautyCenterForm.reactionDesquamation" },
          ] as const).map(item => (
            <div key={item.key} className="field-new">
              <label className="field-new__label">{t(item.labelKey)}</label>
              <select className="input-new"
                value={(form as any)[item.key]} onChange={e => set(item.key, Number(e.target.value))}>
                <option value={0}>{t("clinical.beautyCenterForm.reactionLevel0")}</option>
                <option value={1}>{t("clinical.beautyCenterForm.reactionLevel1")}</option>
                <option value={2}>{t("clinical.beautyCenterForm.reactionLevel2")}</option>
                <option value={3}>{t("clinical.beautyCenterForm.reactionLevel3")}</option>
              </select>
            </div>
          ))}
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.beautyCenterForm.resolutionTimeLabel")}</label>
          <select className="input-new"
            value={form.tiempoResolucion} onChange={e => set("tiempoResolucion", e.target.value)}>
            <option value="">{t("clinical.beautyCenterForm.selectOption")}</option>
            <option value="Inmediata">{t("clinical.beautyCenterForm.resolutionImmediate")}</option>
            <option value="24h">24h</option>
            <option value="48h">48h</option>
            <option value="72h">72h</option>
            <option value="1 semana">{t("clinical.beautyCenterForm.resolution1Week")}</option>
            <option value="> 1 semana">{t("clinical.beautyCenterForm.resolutionMoreThan1Week")}</option>
          </select>
        </div>
      </CardNew>

      <CardNew title={t("clinical.beautyCenterForm.nextSessionTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.beautyCenterForm.nextSessionLabel")}</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.beautyCenterForm.nextSessionPlaceholder")} value={form.planSiguiente} onChange={e => set("planSiguiente", e.target.value)} />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.beautyCenterForm.saveConsultation")}
        </ButtonNew>
      </div>
    </form>
  );
}
