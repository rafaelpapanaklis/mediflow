"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DateField } from "@/components/ui/date-field";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"];
const COLORES_VELLO = [
  "Negro",
  "Castaño oscuro",
  "Castaño claro",
  "Rubio",
  "Pelirrojo",
  "Canoso",
];
const GROSORES = ["Fino", "Medio", "Grueso"];
const MAQUINAS = ["Alexandrite", "Diode", "Nd:YAG", "IPL"];
const ZONAS = [
  "Labio superior",
  "Axilas",
  "Brazos",
  "Pecho",
  "Espalda",
  "Abdomen",
  "Bikini clasico",
  "Bikini brasileño",
  "Bikini full",
  "Piernas superiores",
  "Piernas inferiores",
  "Gluteos",
  "Rostro completo",
];
const ENFRIAMIENTO = ["Cryo", "Contacto", "Aire"];
const REACCIONES = [
  "Eritema leve",
  "Eritema moderado",
  "Edema",
  "Ampollas",
  "Hiperpigmentacion",
  "Ninguna",
];
const INTERVALOS = ["4 semanas", "6 semanas", "8 semanas"];

const CHECKLIST_PRE_SESION = [
  "Sin exposición solar directa (2 semanas)",
  "Sin depilación con cera/pinza (4 semanas)",
  "Sin uso de retinoides tópicos (1 semana)",
  "Sin autobronceante (2 semanas)",
  "Sin antibióticos fotosensibilizantes",
  "Zona rasurada previo a sesión",
];

const REACCIONES_TEST = [
  "Sin reacción",
  "Eritema leve",
  "Eritema moderado",
  "Ampollas",
  "Hiperpigmentación",
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function LaserForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fitzpatrick: "",
    colorVello: "",
    grosor: "",
    maquina: "",
    zona: "",
    fluencia: "",
    anchoPulso: "",
    spotSize: "",
    enfriamiento: "",
    sesionActual: "",
    sesionesTotal: "",
    reacciones: [] as string[],
    intervalo: "6 semanas",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    notas: "",
    checklistPreSesion: [] as string[],
    reduccionPorZona: {} as Record<string, number>,
    testSpotZona: "",
    testSpotParametros: "",
    testSpotReaccion24: "",
    testSpotReaccion48: "",
    testSpotResultado: "",
    testSpotFecha: "",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const colorVelloLabels: Record<string, string> = {
    "Negro": t("clinical.laserForm.hairBlack"),
    "Castaño oscuro": t("clinical.laserForm.hairDarkBrown"),
    "Castaño claro": t("clinical.laserForm.hairLightBrown"),
    "Rubio": t("clinical.laserForm.hairBlonde"),
    "Pelirrojo": t("clinical.laserForm.hairRed"),
    "Canoso": t("clinical.laserForm.hairGray"),
  };
  const grosorLabels: Record<string, string> = {
    "Fino": t("clinical.laserForm.thicknessFine"),
    "Medio": t("clinical.laserForm.thicknessMedium"),
    "Grueso": t("clinical.laserForm.thicknessThick"),
  };
  const zonaLabels: Record<string, string> = {
    "Labio superior": t("clinical.laserForm.zoneUpperLip"),
    "Axilas": t("clinical.laserForm.zoneArmpits"),
    "Brazos": t("clinical.laserForm.zoneArms"),
    "Pecho": t("clinical.laserForm.zoneChest"),
    "Espalda": t("clinical.laserForm.zoneBack"),
    "Abdomen": t("clinical.laserForm.zoneAbdomen"),
    "Bikini clasico": t("clinical.laserForm.zoneBikiniClassic"),
    "Bikini brasileño": t("clinical.laserForm.zoneBikiniBrazilian"),
    "Bikini full": t("clinical.laserForm.zoneBikiniFull"),
    "Piernas superiores": t("clinical.laserForm.zoneUpperLegs"),
    "Piernas inferiores": t("clinical.laserForm.zoneLowerLegs"),
    "Gluteos": t("clinical.laserForm.zoneGlutes"),
    "Rostro completo": t("clinical.laserForm.zoneFullFace"),
  };
  const enfriamientoLabels: Record<string, string> = {
    "Cryo": t("clinical.laserForm.coolingCryo"),
    "Contacto": t("clinical.laserForm.coolingContact"),
    "Aire": t("clinical.laserForm.coolingAir"),
  };
  const reaccionLabels: Record<string, string> = {
    "Eritema leve": t("clinical.laserForm.reactionMildErythema"),
    "Eritema moderado": t("clinical.laserForm.reactionModerateErythema"),
    "Edema": t("clinical.laserForm.reactionEdema"),
    "Ampollas": t("clinical.laserForm.reactionBlisters"),
    "Hiperpigmentacion": t("clinical.laserForm.reactionHyperpigmentation"),
    "Hiperpigmentación": t("clinical.laserForm.reactionHyperpigmentation"),
    "Ninguna": t("clinical.laserForm.reactionNone"),
    "Sin reacción": t("clinical.laserForm.reactionNoReaction"),
  };
  const intervaloLabels: Record<string, string> = {
    "4 semanas": t("clinical.laserForm.interval4Weeks"),
    "6 semanas": t("clinical.laserForm.interval6Weeks"),
    "8 semanas": t("clinical.laserForm.interval8Weeks"),
  };
  const checklistLabels: Record<string, string> = {
    "Sin exposición solar directa (2 semanas)": t("clinical.laserForm.checkNoSun"),
    "Sin depilación con cera/pinza (4 semanas)": t("clinical.laserForm.checkNoWaxing"),
    "Sin uso de retinoides tópicos (1 semana)": t("clinical.laserForm.checkNoRetinoids"),
    "Sin autobronceante (2 semanas)": t("clinical.laserForm.checkNoSelfTanner"),
    "Sin antibióticos fotosensibilizantes": t("clinical.laserForm.checkNoPhotoAntibiotics"),
    "Zona rasurada previo a sesión": t("clinical.laserForm.checkShavedZone"),
  };

  const toggleChecklist = (val: string) => {
    setForm((f) => ({
      ...f,
      checklistPreSesion: f.checklistPreSesion.includes(val)
        ? f.checklistPreSesion.filter((c) => c !== val)
        : [...f.checklistPreSesion, val],
    }));
  };

  const allChecklistChecked = CHECKLIST_PRE_SESION.every((c) =>
    form.checklistPreSesion.includes(c)
  );

  const toggleReaccion = (val: string) => {
    setForm((f) => {
      if (val === "Ninguna") return { ...f, reacciones: f.reacciones.includes(val) ? [] : ["Ninguna"] };
      const without = f.reacciones.filter((r) => r !== "Ninguna");
      return {
        ...f,
        reacciones: without.includes(val)
          ? without.filter((r) => r !== val)
          : [...without, val],
      };
    });
  };

  async function handleSave() {
    if (!form.zona || !form.maquina) {
      toast.error(t("clinical.laserForm.selectZoneAndMachine"));
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
            type: "laser_hair_removal",
            fitzpatrick: form.fitzpatrick,
            colorVello: form.colorVello,
            grosor: form.grosor,
            maquina: form.maquina,
            zona: form.zona,
            parametros: {
              fluencia: form.fluencia ? parseFloat(form.fluencia) : undefined,
              anchoPulso: form.anchoPulso ? parseFloat(form.anchoPulso) : undefined,
              spotSize: form.spotSize ? parseFloat(form.spotSize) : undefined,
              enfriamiento: form.enfriamiento,
            },
            sesionActual: form.sesionActual ? parseInt(form.sesionActual) : undefined,
            sesionesTotal: form.sesionesTotal ? parseInt(form.sesionesTotal) : undefined,
            reacciones: form.reacciones,
            intervalo: form.intervalo,
            notas: form.notas,
            checklistPreSesion: form.checklistPreSesion,
            reduccionPorZona: form.reduccionPorZona,
            testSpot: {
              zona: form.testSpotZona,
              parametros: form.testSpotParametros,
              reaccion24: form.testSpotReaccion24,
              reaccion48: form.testSpotReaccion48,
              resultado: form.testSpotResultado,
              fecha: form.testSpotFecha,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success(t("clinical.laserForm.saved"));
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.laserForm.checklistTitle")}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
            allChecklistChecked
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-800 dark:text-amber-200"
          }`}>
            {allChecklistChecked ? t("clinical.laserForm.eligible") : t("clinical.laserForm.reviewContraindications")}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CHECKLIST_PRE_SESION.map((item) => (
            <label
              key={item}
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                form.checklistPreSesion.includes(item)
                  ? "bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-300"
                  : "border-border bg-card hover:bg-muted dark:hover:bg-card"
              }`}
            >
              <input
                type="checkbox"
                className="accent-emerald-600"
                checked={form.checklistPreSesion.includes(item)}
                onChange={() => toggleChecklist(item)}
              />
              {checklistLabels[item] ?? item}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.laserForm.patientEvaluation")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.fitzpatrickType")}</label>
            <select
              className="input-new"
              value={form.fitzpatrick}
              onChange={(e) => set("fitzpatrick", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {FITZPATRICK.map((f) => (
                <option key={f} value={f}>
                  {t("clinical.laserForm.fitzpatrickTypeLabel", { type: f })}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.hairColor")}</label>
            <select
              className="input-new"
              value={form.colorVello}
              onChange={(e) => set("colorVello", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {COLORES_VELLO.map((c) => (
                <option key={c} value={c}>
                  {colorVelloLabels[c] ?? c}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.thickness")}</label>
            <select
              className="input-new"
              value={form.grosor}
              onChange={(e) => set("grosor", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {GROSORES.map((g) => (
                <option key={g} value={g}>
                  {grosorLabels[g] ?? g}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.machine")}</label>
            <select
              className="input-new"
              value={form.maquina}
              onChange={(e) => set("maquina", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {MAQUINAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.laserForm.treatedZoneTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.laserForm.zone")}</label>
          <select
            className="input-new"
            value={form.zona}
            onChange={(e) => set("zona", e.target.value)}
          >
            <option value="">{t("clinical.laserForm.selectOption")}</option>
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {zonaLabels[z] ?? z}
              </option>
            ))}
          </select>
        </div>
      </CardNew>

      <CardNew title={t("clinical.laserForm.equipmentParamsTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.fluence")}</label>
            <input
              type="number"
              step="0.1"
              className="input-new"
              placeholder={t("clinical.laserForm.fluencePlaceholder")}
              value={form.fluencia}
              onChange={(e) => set("fluencia", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.pulseWidth")}</label>
            <input
              type="number"
              step="0.1"
              className="input-new"
              placeholder={t("clinical.laserForm.pulseWidthPlaceholder")}
              value={form.anchoPulso}
              onChange={(e) => set("anchoPulso", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.spotSize")}</label>
            <input
              type="number"
              step="0.1"
              className="input-new"
              placeholder={t("clinical.laserForm.spotSizePlaceholder")}
              value={form.spotSize}
              onChange={(e) => set("spotSize", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.coolingMethod")}</label>
            <select
              className="input-new"
              value={form.enfriamiento}
              onChange={(e) => set("enfriamiento", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {ENFRIAMIENTO.map((e) => (
                <option key={e} value={e}>
                  {enfriamientoLabels[e] ?? e}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.laserForm.sessionProgressTitle")}>
        <div className="grid grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.sessionNumber")}</label>
            <input
              type="number"
              min="1"
              className="input-new"
              placeholder={t("clinical.laserForm.sessionNumberPlaceholder")}
              value={form.sesionActual}
              onChange={(e) => set("sesionActual", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.totalSessionsPlanned")}</label>
            <input
              type="number"
              min="1"
              className="input-new"
              placeholder={t("clinical.laserForm.totalSessionsPlaceholder")}
              value={form.sesionesTotal}
              onChange={(e) => set("sesionesTotal", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.nextSessionInterval")}</label>
            <select
              className="input-new"
              value={form.intervalo}
              onChange={(e) => set("intervalo", e.target.value)}
            >
              {INTERVALOS.map((i) => (
                <option key={i} value={i}>
                  {intervaloLabels[i] ?? i}
                </option>
              ))}
            </select>
          </div>
        </div>
        {form.sesionActual && form.sesionesTotal && (
          <p className="text-xs text-muted-foreground mt-2">
            {t("clinical.laserForm.sessionXofY", { current: form.sesionActual, total: form.sesionesTotal })}
          </p>
        )}
      </CardNew>

      {form.zona && (
        <CardNew title={t("clinical.laserForm.cumulativeReductionTitle")}>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm min-w-[160px] font-medium">{zonaLabels[form.zona] ?? form.zona}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="input-new"
                  style={{ maxWidth: 100 }}
                  placeholder="0-100"
                  value={form.reduccionPorZona[form.zona] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reduccionPorZona: {
                        ...f.reduccionPorZona,
                        [f.zona]: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                      },
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground">{t("clinical.laserForm.estimatedReductionPct")}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className="h-3 rounded-full transition-all duration-300"
                  style={{
                    width: `${form.reduccionPorZona[form.zona] ?? 0}%`,
                    backgroundColor:
                      (form.reduccionPorZona[form.zona] ?? 0) >= 75
                        ? "#10b981"
                        : (form.reduccionPorZona[form.zona] ?? 0) >= 40
                          ? "#f59e0b"
                          : "#ef4444",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("clinical.laserForm.estimatedReductionResult", { pct: form.reduccionPorZona[form.zona] ?? 0 })}
              </p>
            </div>
          </div>
        </CardNew>
      )}

      <CardNew title={t("clinical.laserForm.observedReactionsTitle")}>
        <div className="flex flex-wrap gap-2">
          {REACCIONES.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.reacciones.includes(r)
                  ? r === "Ninguna"
                    ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                    : "bg-amber-50 border-amber-400 text-amber-700"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className={r === "Ninguna" ? "accent-emerald-600" : "accent-amber-600"}
                checked={form.reacciones.includes(r)}
                onChange={() => toggleReaccion(r)}
              />
              {reaccionLabels[r] ?? r}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.laserForm.testSpotTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.testedZone")}</label>
            <input
              type="text"
              className="input-new"
              placeholder={t("clinical.laserForm.testedZonePlaceholder")}
              value={form.testSpotZona}
              onChange={(e) => set("testSpotZona", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.testParams")}</label>
            <input
              type="text"
              className="input-new"
              placeholder={t("clinical.laserForm.testParamsPlaceholder")}
              value={form.testSpotParametros}
              onChange={(e) => set("testSpotParametros", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.testDate")}</label>
            <DateField
              className="input-new"
              value={form.testSpotFecha}
              onChange={(e) => set("testSpotFecha", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.reaction24h")}</label>
            <select
              className="input-new"
              value={form.testSpotReaccion24}
              onChange={(e) => set("testSpotReaccion24", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {REACCIONES_TEST.map((r) => (
                <option key={r} value={r}>{reaccionLabels[r] ?? r}</option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.reaction48h")}</label>
            <select
              className="input-new"
              value={form.testSpotReaccion48}
              onChange={(e) => set("testSpotReaccion48", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              {REACCIONES_TEST.map((r) => (
                <option key={r} value={r}>{reaccionLabels[r] ?? r}</option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.laserForm.result")}</label>
            <select
              className="input-new"
              value={form.testSpotResultado}
              onChange={(e) => set("testSpotResultado", e.target.value)}
            >
              <option value="">{t("clinical.laserForm.selectOption")}</option>
              <option value="Apto para tratamiento">{t("clinical.laserForm.resultEligible")}</option>
              <option value="Reducir parámetros">{t("clinical.laserForm.resultReduceParams")}</option>
              <option value="No apto">{t("clinical.laserForm.resultNotEligible")}</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.laserForm.soapTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", label: t("clinical.laserForm.soapSubjective"), ph: t("clinical.laserForm.soapSubjectivePlaceholder") },
            { key: "objective", label: t("clinical.laserForm.soapObjective"), ph: t("clinical.laserForm.soapObjectivePlaceholder") },
            { key: "assessment", label: t("clinical.laserForm.soapAssessment"), ph: t("clinical.laserForm.soapAssessmentPlaceholder") },
            { key: "plan", label: t("clinical.laserForm.soapPlan"), ph: t("clinical.laserForm.soapPlanPlaceholder") },
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

      <CardNew title={t("clinical.laserForm.additionalNotesTitle")}>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.laserForm.additionalNotesLabel")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.laserForm.additionalNotesPlaceholder")}
            value={form.notas}
            onChange={(e) => set("notas", e.target.value)}
          />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.laserForm.saveConsult")}
        </ButtonNew>
      </div>
    </form>
  );
}
