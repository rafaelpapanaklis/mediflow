"use client";
import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DateField } from "@/components/ui/date-field";
import { useT } from "@/i18n/i18n-provider";

const SERVICIOS = [
  "Extensiones clásicas",
  "Volumen",
  "Híbridas",
  "Lash lift",
  "Tinte pestañas",
  "Microblading",
  "Laminado cejas",
  "Henna cejas",
];

const FORMAS_OJO = ["Almendrado", "Redondo", "Encapotado", "Caído", "Prominente"];

const SERVICIO_KEYS: Record<string, string> = {
  "Extensiones clásicas": "clinical.browLashForm.svcClassic",
  "Volumen": "clinical.browLashForm.svcVolume",
  "Híbridas": "clinical.browLashForm.svcHybrid",
  "Lash lift": "clinical.browLashForm.svcLashLift",
  "Tinte pestañas": "clinical.browLashForm.svcLashTint",
  "Microblading": "clinical.browLashForm.svcMicroblading",
  "Laminado cejas": "clinical.browLashForm.svcBrowLamination",
  "Henna cejas": "clinical.browLashForm.svcBrowHenna",
};

const FORMA_OJO_KEYS: Record<string, string> = {
  "Almendrado": "clinical.browLashForm.eyeAlmond",
  "Redondo": "clinical.browLashForm.eyeRound",
  "Encapotado": "clinical.browLashForm.eyeHooded",
  "Caído": "clinical.browLashForm.eyeDownturned",
  "Prominente": "clinical.browLashForm.eyeProminent",
};

const CURL_TYPES = ["J", "B", "C", "D"];
const LONGITUDES = Array.from({ length: 9 }, (_, i) => i + 8); // 8-16mm
const GROSORES = ["0.05", "0.07", "0.10", "0.12", "0.15", "0.18", "0.20", "0.25"];

const REFILL_INTERVALS = ["2 semanas", "3 semanas", "4 semanas"];

const REFILL_KEYS: Record<string, string> = {
  "2 semanas": "clinical.browLashForm.refill2Weeks",
  "3 semanas": "clinical.browLashForm.refill3Weeks",
  "4 semanas": "clinical.browLashForm.refill4Weeks",
};

const CONDICION_KEYS: Record<string, string> = {
  "Sanas": "clinical.browLashForm.condHealthy",
  "Quebradizas": "clinical.browLashForm.condBrittle",
  "Con gaps/huecos": "clinical.browLashForm.condGaps",
  "Debilitadas por extensiones previas": "clinical.browLashForm.condWeakened",
};

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function BrowLashForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    servicio: "",
    formaOjo: "",
    lashMap: {
      inner: { curl: "C", longitud: "10", grosor: "0.10" },
      middle: { curl: "C", longitud: "12", grosor: "0.10" },
      outer: { curl: "C", longitud: "11", grosor: "0.10" },
    },
    adhesivo: "",
    adhesivoBatch: "",
    formulaColor: "",
    patchTestDate: "",
    refillInterval: "3 semanas",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    notas: "",
    // Natural lash evaluation
    longitudNatural: "",
    densidad: "",
    curvaturaNatural: "",
    condicionPestanas: [] as string[],
    // Retention rate
    semanasDesdeUltima: "",
    porcentajeRetencion: "",
    // Sensitivity history
    historialSensibilidad: [] as Array<{
      fecha: string;
      producto: string;
      reaccion: string;
      notas: string;
    }>,
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  function toggleCondicion(c: string) {
    setForm((f) => ({
      ...f,
      condicionPestanas: f.condicionPestanas.includes(c)
        ? f.condicionPestanas.filter((x) => x !== c)
        : [...f.condicionPestanas, c],
    }));
  }

  function addSensibilidad() {
    setForm((f) => ({
      ...f,
      historialSensibilidad: [
        ...f.historialSensibilidad,
        { fecha: "", producto: "", reaccion: "", notas: "" },
      ],
    }));
  }

  function removeSensibilidad(index: number) {
    setForm((f) => ({
      ...f,
      historialSensibilidad: f.historialSensibilidad.filter((_, i) => i !== index),
    }));
  }

  function updateSensibilidad(index: number, key: string, value: string) {
    setForm((f) => ({
      ...f,
      historialSensibilidad: f.historialSensibilidad.map((item, i) =>
        i === index ? { ...item, [key]: value } : item
      ),
    }));
  }

  const retencionPct = Number(form.porcentajeRetencion) || 0;
  const retencionColor =
    retencionPct > 70
      ? "bg-green-500"
      : retencionPct >= 40
      ? "bg-amber-500"
      : "bg-red-500";
  const setLash = (zone: string, k: string, v: string) =>
    setForm((f) => ({
      ...f,
      lashMap: { ...f.lashMap, [zone]: { ...(f.lashMap as any)[zone], [k]: v } },
    }));

  const patchWarning = useMemo(() => {
    if (!form.patchTestDate) return t("clinical.browLashForm.patchNone");
    const diff = Date.now() - new Date(form.patchTestDate).getTime();
    const sixMonths = 1000 * 60 * 60 * 24 * 180;
    if (diff > sixMonths) return t("clinical.browLashForm.patchExpired");
    return "";
  }, [form.patchTestDate, t]);

  async function handleSave() {
    if (!form.servicio) {
      toast.error(t("clinical.browLashForm.errService"));
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
            type: "brow_lash",
            servicio: form.servicio,
            formaOjo: form.formaOjo,
            lashMap: form.lashMap,
            adhesivo: form.adhesivo,
            adhesivoBatch: form.adhesivoBatch,
            formulaColor: form.formulaColor,
            patchTestDate: form.patchTestDate,
            refillInterval: form.refillInterval,
            notas: form.notas,
            longitudNatural: form.longitudNatural,
            densidad: form.densidad,
            curvaturaNatural: form.curvaturaNatural,
            condicionPestanas: form.condicionPestanas,
            semanasDesdeUltima: form.semanasDesdeUltima,
            porcentajeRetencion: form.porcentajeRetencion,
            historialSensibilidad: form.historialSensibilidad,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success(t("clinical.browLashForm.savedToast"));
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.browLashForm.serviceTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.serviceLabel")}</label>
            <select
              className="input-new"
              value={form.servicio}
              onChange={(e) => set("servicio", e.target.value)}
            >
              <option value="">{t("clinical.browLashForm.selectOption")}</option>
              {SERVICIOS.map((s) => (
                <option key={s} value={s}>
                  {t(SERVICIO_KEYS[s] ?? "")}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.eyeShapeLabel")}</label>
            <select
              className="input-new"
              value={form.formaOjo}
              onChange={(e) => set("formaOjo", e.target.value)}
            >
              <option value="">{t("clinical.browLashForm.selectOption")}</option>
              {FORMAS_OJO.map((shape) => (
                <option key={shape} value={shape}>
                  {t(FORMA_OJO_KEYS[shape] ?? "")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.browLashForm.lashMapTitle")}>
        <div className="grid grid-cols-3 gap-4">
          {(["inner", "middle", "outer"] as const).map((zone) => {
            const labels: Record<string, string> = {
              inner: t("clinical.browLashForm.zoneInner"),
              middle: t("clinical.browLashForm.zoneMiddle"),
              outer: t("clinical.browLashForm.zoneOuter"),
            };
            return (
              <div key={zone} className="space-y-2">
                <p className="text-xs font-semibold text-brand-600">{labels[zone]}</p>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.browLashForm.curlLabel")}</label>
                  <select
                    className="input-new"
                    value={(form.lashMap as any)[zone].curl}
                    onChange={(e) => setLash(zone, "curl", e.target.value)}
                  >
                    {CURL_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.browLashForm.lengthLabel")}</label>
                  <select
                    className="input-new"
                    value={(form.lashMap as any)[zone].longitud}
                    onChange={(e) => setLash(zone, "longitud", e.target.value)}
                  >
                    {LONGITUDES.map((l) => (
                      <option key={l} value={String(l)}>
                        {l} mm
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.browLashForm.thicknessLabel")}</label>
                  <select
                    className="input-new"
                    value={(form.lashMap as any)[zone].grosor}
                    onChange={(e) => setLash(zone, "grosor", e.target.value)}
                  >
                    {GROSORES.map((g) => (
                      <option key={g} value={g}>
                        {g} mm
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </CardNew>

      <CardNew title={t("clinical.browLashForm.materialsTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.adhesiveLabel")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.browLashForm.adhesivePlaceholder")}
              value={form.adhesivo}
              onChange={(e) => set("adhesivo", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.adhesiveBatchLabel")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.browLashForm.adhesiveBatchPlaceholder")}
              value={form.adhesivoBatch}
              onChange={(e) => set("adhesivoBatch", e.target.value)}
            />
          </div>
          <div className="field-new col-span-2">
            <label className="field-new__label">{t("clinical.browLashForm.colorFormulaLabel")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.browLashForm.colorFormulaPlaceholder")}
              value={form.formulaColor}
              onChange={(e) => set("formulaColor", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.browLashForm.safetyTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.patchTestDateLabel")}</label>
            <DateField
              className="input-new"
              value={form.patchTestDate}
              onChange={(e) => set("patchTestDate", e.target.value)}
            />
            {patchWarning && (
              <p className="text-xs font-semibold text-red-600 mt-1">{patchWarning}</p>
            )}
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.refillIntervalLabel")}</label>
            <select
              className="input-new"
              value={form.refillInterval}
              onChange={(e) => set("refillInterval", e.target.value)}
            >
              {REFILL_INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {t(REFILL_KEYS[i] ?? "")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.browLashForm.naturalEvalTitle")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.naturalLengthLabel")}</label>
            <select
              className="input-new"
              value={form.longitudNatural}
              onChange={(e) => set("longitudNatural", e.target.value)}
            >
              <option value="">{t("clinical.browLashForm.selectOption")}</option>
              <option value="Cortas (<8mm)">{t("clinical.browLashForm.naturalLengthShort")}</option>
              <option value="Medias (8-11mm)">{t("clinical.browLashForm.naturalLengthMedium")}</option>
              <option value="Largas (>11mm)">{t("clinical.browLashForm.naturalLengthLong")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.densityLabel")}</label>
            <select
              className="input-new"
              value={form.densidad}
              onChange={(e) => set("densidad", e.target.value)}
            >
              <option value="">{t("clinical.browLashForm.selectOption")}</option>
              <option value="Escasa">{t("clinical.browLashForm.densitySparse")}</option>
              <option value="Normal">{t("clinical.browLashForm.densityNormal")}</option>
              <option value="Abundante">{t("clinical.browLashForm.densityAbundant")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.naturalCurlLabel")}</label>
            <select
              className="input-new"
              value={form.curvaturaNatural}
              onChange={(e) => set("curvaturaNatural", e.target.value)}
            >
              <option value="">{t("clinical.browLashForm.selectOption")}</option>
              <option value="Recta">{t("clinical.browLashForm.naturalCurlStraight")}</option>
              <option value="Ligeramente curvada">{t("clinical.browLashForm.naturalCurlSlight")}</option>
              <option value="Curvada">{t("clinical.browLashForm.naturalCurlCurved")}</option>
            </select>
          </div>
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("clinical.browLashForm.conditionLabel")}</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {["Sanas", "Quebradizas", "Con gaps/huecos", "Debilitadas por extensiones previas"].map((c) => (
              <label key={c} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.condicionPestanas.includes(c)}
                  onChange={() => toggleCondicion(c)}
                  className="w-4 h-4 accent-brand-600"
                />
                <span className="text-sm">{t(CONDICION_KEYS[c] ?? "")}</span>
              </label>
            ))}
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.browLashForm.retentionTitle")}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.weeksSinceLastLabel")}</label>
            <input
              type="number"
              min={0}
              className="input-new"
              placeholder="0"
              value={form.semanasDesdeUltima}
              onChange={(e) => set("semanasDesdeUltima", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.browLashForm.retentionPctLabel")}</label>
            <input
              type="number"
              min={0}
              max={100}
              className="input-new"
              placeholder="0"
              value={form.porcentajeRetencion}
              onChange={(e) => set("porcentajeRetencion", e.target.value)}
            />
          </div>
        </div>
        {form.porcentajeRetencion && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("clinical.browLashForm.retentionLevel")}</span>
              <span className="font-semibold">{retencionPct}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${retencionColor}`}
                style={{ width: `${Math.min(Math.max(retencionPct, 0), 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {retencionPct > 70
                ? t("clinical.browLashForm.retentionGood")
                : retencionPct >= 40
                ? t("clinical.browLashForm.retentionModerate")
                : t("clinical.browLashForm.retentionLow")}
            </p>
          </div>
        )}
      </CardNew>

      <CardNew title={t("clinical.browLashForm.sensitivityTitle")}>
        {form.historialSensibilidad.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">{t("clinical.browLashForm.noReactions")}</p>
        )}
        <div className="space-y-3">
          {form.historialSensibilidad.map((entry, idx) => (
            <div key={idx} className="rounded-lg border border-border p-3 space-y-2 bg-neutral-50 dark:bg-neutral-800/50">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="field-new">
                  <label className="field-new__label">{t("common.date")}</label>
                  <DateField
                    className="input-new"
                    value={entry.fecha}
                    onChange={(e) => updateSensibilidad(idx, "fecha", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.browLashForm.productLabel")}</label>
                  <input
                    className="input-new"
                    placeholder={t("clinical.browLashForm.productPlaceholder")}
                    value={entry.producto}
                    onChange={(e) => updateSensibilidad(idx, "producto", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("clinical.browLashForm.reactionLabel")}</label>
                  <select
                    className="input-new"
                    value={entry.reaccion}
                    onChange={(e) => updateSensibilidad(idx, "reaccion", e.target.value)}
                  >
                    <option value="">{t("clinical.browLashForm.selectOption")}</option>
                    <option value="Irritación leve">{t("clinical.browLashForm.reactionMildIrritation")}</option>
                    <option value="Enrojecimiento">{t("clinical.browLashForm.reactionRedness")}</option>
                    <option value="Hinchazón">{t("clinical.browLashForm.reactionSwelling")}</option>
                    <option value="Reacción alérgica severa">{t("clinical.browLashForm.reactionSevereAllergic")}</option>
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("common.notes")}</label>
                  <input
                    className="input-new"
                    placeholder={t("clinical.browLashForm.notesPlaceholder")}
                    value={entry.notas}
                    onChange={(e) => updateSensibilidad(idx, "notas", e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeSensibilidad(idx)}
                className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
              >
                {t("clinical.browLashForm.removeReaction")}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addSensibilidad}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          {t("clinical.browLashForm.addReaction")}
        </button>
      </CardNew>

      <CardNew title={t("clinical.browLashForm.soapTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", labelKey: "clinical.browLashForm.soapSubjective" },
            { key: "objective", labelKey: "clinical.browLashForm.soapObjective" },
            { key: "assessment", labelKey: "clinical.browLashForm.soapAssessment" },
            { key: "plan", labelKey: "clinical.browLashForm.soapPlan" },
          ] as const).map((field) => (
            <div key={field.key} className="field-new">
              <label className="field-new__label">{t(field.labelKey)}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 80, resize: "vertical" }}
                placeholder={t(field.labelKey)}
                value={(form as any)[field.key]}
                onChange={(e) => set(field.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 field-new">
          <label className="field-new__label">{t("clinical.browLashForm.additionalNotesLabel")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.browLashForm.additionalNotesPlaceholder")}
            value={form.notas}
            onChange={(e) => set("notas", e.target.value)}
          />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.browLashForm.saveConsultation")}
        </ButtonNew>
      </div>
    </form>
  );
}
