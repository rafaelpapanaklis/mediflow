"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DateField } from "@/components/ui/date-field";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

const SERVICIOS = [
  "manicure",
  "pedicure",
  "gel",
  "acrílico",
  "dip powder",
  "nail art",
  "reparación",
  "parafina",
  "manicure + pedicure",
];

const MANO_PIE = ["manos", "pies", "ambos"];

const FORMAS = [
  "almendra",
  "cuadrada",
  "ovalada",
  "stiletto",
  "coffin",
  "squoval",
  "redonda",
];

const DEDOS = ["Pulgar", "Índice", "Medio", "Anular", "Meñique"] as const;
const CONDICIONES_UNA = ["Sana", "Hongos", "Estriada", "Manchada", "Frágil/Quebradiza", "Onicólisis", "Encarnada", "Engrosada"] as const;
const TIPOS_SERVICIO_PREF = ["Manicure clásico", "Gel", "Acrílico", "Dip powder", "Nail art", "Natural"] as const;
const LARGOS = ["Muy corto (natural)", "Corto", "Medio", "Largo", "Extra largo"] as const;
const TIPOS_REACCION = ["Enrojecimiento", "Descamación", "Ampollas", "Dolor", "Hinchazón", "Reacción alérgica"] as const;
const SEVERIDADES = ["Leve", "Moderada", "Severa"] as const;

interface AlergiaEntry {
  producto: string;
  tipoReaccion: string;
  severidad: string;
  fecha: string;
}

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function NailSalonForm({ patientId, onSaved }: Props) {
  const t = useT();
  const SERVICIO_KEYS: Record<string, string> = {
    "manicure": "clinical.nailSalonForm.svcManicure",
    "pedicure": "clinical.nailSalonForm.svcPedicure",
    "gel": "clinical.nailSalonForm.svcGel",
    "acrílico": "clinical.nailSalonForm.svcAcrylic",
    "dip powder": "clinical.nailSalonForm.svcDipPowder",
    "nail art": "clinical.nailSalonForm.svcNailArt",
    "reparación": "clinical.nailSalonForm.svcRepair",
    "parafina": "clinical.nailSalonForm.svcParaffin",
    "manicure + pedicure": "clinical.nailSalonForm.svcManiPedi",
  };
  const MANO_PIE_KEYS: Record<string, string> = {
    "manos": "clinical.nailSalonForm.handsLabel",
    "pies": "clinical.nailSalonForm.feetLabel",
    "ambos": "clinical.nailSalonForm.bothLabel",
  };
  const FORMA_KEYS: Record<string, string> = {
    "almendra": "clinical.nailSalonForm.shapeAlmond",
    "cuadrada": "clinical.nailSalonForm.shapeSquare",
    "ovalada": "clinical.nailSalonForm.shapeOval",
    "stiletto": "clinical.nailSalonForm.shapeStiletto",
    "coffin": "clinical.nailSalonForm.shapeCoffin",
    "squoval": "clinical.nailSalonForm.shapeSquoval",
    "redonda": "clinical.nailSalonForm.shapeRound",
  };
  const DEDO_KEYS: Record<string, string> = {
    "Pulgar": "clinical.nailSalonForm.fingerThumb",
    "Índice": "clinical.nailSalonForm.fingerIndex",
    "Medio": "clinical.nailSalonForm.fingerMiddle",
    "Anular": "clinical.nailSalonForm.fingerRing",
    "Meñique": "clinical.nailSalonForm.fingerPinky",
  };
  const CONDICION_KEYS: Record<string, string> = {
    "Sana": "clinical.nailSalonForm.condHealthy",
    "Hongos": "clinical.nailSalonForm.condFungus",
    "Estriada": "clinical.nailSalonForm.condRidged",
    "Manchada": "clinical.nailSalonForm.condStained",
    "Frágil/Quebradiza": "clinical.nailSalonForm.condBrittle",
    "Onicólisis": "clinical.nailSalonForm.condOnycholysis",
    "Encarnada": "clinical.nailSalonForm.condIngrown",
    "Engrosada": "clinical.nailSalonForm.condThickened",
  };
  const TIPO_SERVICIO_PREF_KEYS: Record<string, string> = {
    "Manicure clásico": "clinical.nailSalonForm.prefClassicManicure",
    "Gel": "clinical.nailSalonForm.prefGel",
    "Acrílico": "clinical.nailSalonForm.prefAcrylic",
    "Dip powder": "clinical.nailSalonForm.prefDipPowder",
    "Nail art": "clinical.nailSalonForm.prefNailArt",
    "Natural": "clinical.nailSalonForm.prefNatural",
  };
  const LARGO_KEYS: Record<string, string> = {
    "Muy corto (natural)": "clinical.nailSalonForm.lenVeryShort",
    "Corto": "clinical.nailSalonForm.lenShort",
    "Medio": "clinical.nailSalonForm.lenMedium",
    "Largo": "clinical.nailSalonForm.lenLong",
    "Extra largo": "clinical.nailSalonForm.lenExtraLong",
  };
  const REACCION_KEYS: Record<string, string> = {
    "Enrojecimiento": "clinical.nailSalonForm.reacRedness",
    "Descamación": "clinical.nailSalonForm.reacPeeling",
    "Ampollas": "clinical.nailSalonForm.reacBlisters",
    "Dolor": "clinical.nailSalonForm.reacPain",
    "Hinchazón": "clinical.nailSalonForm.reacSwelling",
    "Reacción alérgica": "clinical.nailSalonForm.reacAllergic",
  };
  const SEVERIDAD_KEYS: Record<string, string> = {
    "Leve": "clinical.nailSalonForm.sevMild",
    "Moderada": "clinical.nailSalonForm.sevModerate",
    "Severa": "clinical.nailSalonForm.sevSevere",
  };
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    servicio: "",
    manoPie: "",
    formaPreferida: "",
    materialProducto: "",
    colorDiseno: "",
    condicionUnas: "",
    tecnicoAsignado: "",
    notas: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Nail health evaluation state
  const createFingerMap = () => Object.fromEntries(DEDOS.map(d => [d, ""]));
  const [manoIzq, setManoIzq] = useState<Record<string, string>>(createFingerMap());
  const [manoDer, setManoDer] = useState<Record<string, string>>(createFingerMap());
  const [pieIzq, setPieIzq] = useState<Record<string, string>>(createFingerMap());
  const [pieDer, setPieDer] = useState<Record<string, string>>(createFingerMap());
  const [resumenSaludUngueal, setResumenSaludUngueal] = useState("");

  // Preferences state
  const [colorRecurrente, setColorRecurrente] = useState("");
  const [tipoServicioPref, setTipoServicioPref] = useState("");
  const [marcaFavorita, setMarcaFavorita] = useState("");
  const [largoPreferido, setLargoPreferido] = useState("");
  const [notasEstilo, setNotasEstilo] = useState("");

  // Allergies state
  const [alergias, setAlergias] = useState<AlergiaEntry[]>([]);
  const [alergiaMetacrilato, setAlergiaMetacrilato] = useState(false);

  function addAlergia() {
    setAlergias(prev => [...prev, { producto: "", tipoReaccion: "", severidad: "", fecha: "" }]);
  }
  function removeAlergia(idx: number) {
    setAlergias(prev => prev.filter((_, i) => i !== idx));
  }
  function updateAlergia(idx: number, field: keyof AlergiaEntry, value: string) {
    setAlergias(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  async function handleSave() {
    if (!form.servicio) {
      toast.error(t("clinical.nailSalonForm.errorSelectService"));
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
            type: "nail_salon",
            servicio: form.servicio,
            manoPie: form.manoPie,
            formaPreferida: form.formaPreferida,
            materialProducto: form.materialProducto,
            colorDiseno: form.colorDiseno,
            condicionUnas: form.condicionUnas,
            tecnicoAsignado: form.tecnicoAsignado,
            notas: form.notas,
            saludUngueal: { manoIzq, manoDer, pieIzq, pieDer, resumen: resumenSaludUngueal },
            preferencias: { colorRecurrente, tipoServicioPref, marcaFavorita, largoPreferido, notasEstilo, formaFavorita: form.formaPreferida },
            alergias: { lista: alergias, alergiaMetacrilato },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success(t("clinical.nailSalonForm.savedToast"));
    } catch (err: any) {
      toast.error(err.message ?? t("clinical.nailSalonForm.errorSaving"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.nailSalonForm.soapTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.visitReason")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.nailSalonForm.visitReasonPlaceholder")}
              value={form.subjective}
              onChange={(e) => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.previousObservations")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.nailSalonForm.previousObservationsPlaceholder")}
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.nailSalonForm.serviceTitle")}>
        <div className="grid grid-cols-3 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.service")}</label>
            <select
              className="input-new"
              value={form.servicio}
              onChange={(e) => set("servicio", e.target.value)}
            >
              <option value="">{t("clinical.nailSalonForm.selectPlaceholder")}</option>
              {SERVICIOS.map((s) => (
                <option key={s} value={s}>
                  {t(SERVICIO_KEYS[s])}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.handFoot")}</label>
            <select
              className="input-new"
              value={form.manoPie}
              onChange={(e) => set("manoPie", e.target.value)}
            >
              <option value="">{t("clinical.nailSalonForm.selectPlaceholder")}</option>
              {MANO_PIE.map((m) => (
                <option key={m} value={m}>
                  {t(MANO_PIE_KEYS[m])}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.preferredShape")}</label>
            <select
              className="input-new"
              value={form.formaPreferida}
              onChange={(e) => set("formaPreferida", e.target.value)}
            >
              <option value="">{t("clinical.nailSalonForm.selectPlaceholder")}</option>
              {FORMAS.map((f) => (
                <option key={f} value={f}>
                  {t(FORMA_KEYS[f])}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.nailSalonForm.serviceDetailsTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.materialUsed")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.nailSalonForm.materialUsedPlaceholder")}
              value={form.materialProducto}
              onChange={(e) => set("materialProducto", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.colorDesign")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.nailSalonForm.colorDesignPlaceholder")}
              value={form.colorDiseno}
              onChange={(e) => set("colorDiseno", e.target.value)}
            />
          </div>
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">{t("clinical.nailSalonForm.nailCondition")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.nailSalonForm.nailConditionPlaceholder")}
            value={form.condicionUnas}
            onChange={(e) => set("condicionUnas", e.target.value)}
          />
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">{t("clinical.nailSalonForm.assignedTech")}</label>
          <input
            className="input-new"
            placeholder={t("clinical.nailSalonForm.assignedTechPlaceholder")}
            value={form.tecnicoAsignado}
            onChange={(e) => set("tecnicoAsignado", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.nailSalonForm.nailHealthTitle")}>
        {/* Manos */}
        <p className="text-xs font-semibold mb-2">{t("clinical.nailSalonForm.hands")}</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {([[t("clinical.nailSalonForm.leftHand"), manoIzq, setManoIzq], [t("clinical.nailSalonForm.rightHand"), manoDer, setManoDer]] as const).map(([label, state, setter]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <div className="space-y-1">
                {DEDOS.map(dedo => (
                  <div key={dedo} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{t(DEDO_KEYS[dedo])}</span>
                    <select
                      className="input-new"
                      value={(state as Record<string, string>)[dedo]}
                      onChange={e => (setter as React.Dispatch<React.SetStateAction<Record<string, string>>>)(prev => ({ ...prev, [dedo]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {CONDICIONES_UNA.map(c => <option key={c} value={c}>{t(CONDICION_KEYS[c])}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pies */}
        <p className="text-xs font-semibold mb-2">{t("clinical.nailSalonForm.feet")}</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {([[t("clinical.nailSalonForm.leftFoot"), pieIzq, setPieIzq], [t("clinical.nailSalonForm.rightFoot"), pieDer, setPieDer]] as const).map(([label, state, setter]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <div className="space-y-1">
                {DEDOS.map(dedo => (
                  <div key={dedo} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{t(DEDO_KEYS[dedo])}</span>
                    <select
                      className="input-new"
                      value={(state as Record<string, string>)[dedo]}
                      onChange={e => (setter as React.Dispatch<React.SetStateAction<Record<string, string>>>)(prev => ({ ...prev, [dedo]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {CONDICIONES_UNA.map(c => <option key={c} value={c}>{t(CONDICION_KEYS[c])}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="field-new">
          <label className="field-new__label">{t("clinical.nailSalonForm.nailHealthSummary")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.nailSalonForm.nailHealthSummaryPlaceholder")}
            value={resumenSaludUngueal}
            onChange={e => setResumenSaludUngueal(e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.nailSalonForm.preferencesTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.favoriteShape")}</label>
            <input
              className="input-new"
              value={form.formaPreferida ? t(FORMA_KEYS[form.formaPreferida]) : t("clinical.nailSalonForm.notSelected")}
              readOnly
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.recurringColor")}</label>
            <div className="flex gap-2">
              <input
                className="input-new"
                placeholder={t("clinical.nailSalonForm.recurringColorPlaceholder")}
                value={colorRecurrente}
                onChange={e => setColorRecurrente(e.target.value)}
              />
              {colorRecurrente && (
                <div className="h-10 w-10 rounded-lg border border-border shrink-0" style={{ backgroundColor: colorRecurrente.toLowerCase().includes("roj") ? "#DC2626" : colorRecurrente.toLowerCase().includes("rosa") ? "#F9A8D4" : colorRecurrente.toLowerCase().includes("azul") ? "#3B82F6" : colorRecurrente.toLowerCase().includes("negro") ? "#000" : colorRecurrente.toLowerCase().includes("blanc") ? "#FFF" : colorRecurrente.toLowerCase().includes("morad") ? "#8B5CF6" : "#D1D5DB" }} />
              )}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.preferredServiceType")}</label>
            <select
              className="input-new"
              value={tipoServicioPref}
              onChange={e => setTipoServicioPref(e.target.value)}
            >
              <option value="">{t("clinical.nailSalonForm.selectPlaceholder")}</option>
              {TIPOS_SERVICIO_PREF.map(pref => <option key={pref} value={pref}>{t(TIPO_SERVICIO_PREF_KEYS[pref])}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.favoritePolishBrand")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.nailSalonForm.favoritePolishBrandPlaceholder")}
              value={marcaFavorita}
              onChange={e => setMarcaFavorita(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.preferredLength")}</label>
            <select
              className="input-new"
              value={largoPreferido}
              onChange={e => setLargoPreferido(e.target.value)}
            >
              <option value="">{t("clinical.nailSalonForm.selectPlaceholder")}</option>
              {LARGOS.map(l => <option key={l} value={l}>{t(LARGO_KEYS[l])}</option>)}
            </select>
          </div>
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">{t("clinical.nailSalonForm.styleNotes")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.nailSalonForm.styleNotesPlaceholder")}
            value={notasEstilo}
            onChange={e => setNotasEstilo(e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title={t("clinical.nailSalonForm.allergiesTitle")}>
        <label className={`flex items-center gap-2 mb-4 p-2 rounded-lg cursor-pointer ${alergiaMetacrilato ? "bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700" : "bg-muted border border-border"}`}>
          <input type="checkbox" checked={alergiaMetacrilato} onChange={e => setAlergiaMetacrilato(e.target.checked)} className="w-4 h-4 accent-red-600" />
          <span className={`text-sm font-medium ${alergiaMetacrilato ? "text-red-700 dark:text-red-400" : ""}`}>{t("clinical.nailSalonForm.methacrylateAllergy")}</span>
        </label>

        {alergias.map((a, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 mb-2 items-end">
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("clinical.nailSalonForm.productMaterial")}</label>}
              <input
                className="input-new"
                placeholder={t("clinical.nailSalonForm.productPlaceholder")}
                value={a.producto}
                onChange={e => updateAlergia(idx, "producto", e.target.value)}
              />
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("clinical.nailSalonForm.reactionType")}</label>}
              <select
                className="input-new"
                value={a.tipoReaccion}
                onChange={e => updateAlergia(idx, "tipoReaccion", e.target.value)}
              >
                <option value="">{t("clinical.nailSalonForm.typePlaceholder")}</option>
                {TIPOS_REACCION.map(reac => <option key={reac} value={reac}>{t(REACCION_KEYS[reac])}</option>)}
              </select>
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("clinical.nailSalonForm.severity")}</label>}
              <select
                className="input-new"
                value={a.severidad}
                onChange={e => updateAlergia(idx, "severidad", e.target.value)}
              >
                <option value="">—</option>
                {SEVERIDADES.map(s => <option key={s} value={s}>{t(SEVERIDAD_KEYS[s])}</option>)}
              </select>
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("common.date")}</label>}
              <DateField
                className="input-new"
                value={a.fecha}
                onChange={e => updateAlergia(idx, "fecha", e.target.value)}
              />
            </div>
            <button type="button" onClick={() => removeAlergia(idx)} className="h-9 w-9 flex items-center justify-center rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-lg">×</button>
          </div>
        ))}
        <ButtonNew variant="secondary" type="button" onClick={addAlergia}>
          {t("clinical.nailSalonForm.addAllergy")}
        </ButtonNew>
      </CardNew>

      <CardNew title={t("clinical.nailSalonForm.resultNotesTitle")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.nailSalonForm.resultEvaluation")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.nailSalonForm.resultEvaluationPlaceholder")}
              value={form.assessment}
              onChange={(e) => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("common.notes")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.nailSalonForm.notesPlaceholder")}
              value={form.notas}
              onChange={(e) => set("notas", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.nailSalonForm.saveButton")}
        </ButtonNew>
      </div>
    </form>
  );
}
