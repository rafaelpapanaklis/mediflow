"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

const SERVICIOS = ["hidroterapia", "sauna", "flotación", "body wrap", "circuito termal", "masaje spa", "facial spa", "paquete pareja", "ritual completo"] as const;
const SALUD_OPTIONS = ["problemas cardiovasculares", "claustrofobia", "embarazo", "presión baja", "alergias cutáneas", "ninguno"] as const;
const AROMAS = ["lavanda", "eucalipto", "menta", "romero", "naranja", "sin preferencia"] as const;
const TEMPERATURAS = ["baja", "media", "alta"] as const;
const DURACIONES = ["30", "60", "90", "120"] as const;

const PREF_TEMPERATURAS = ["Fría", "Templada", "Tibia", "Caliente", "Muy caliente"] as const;
const PREF_AROMAS = ["Lavanda", "Eucalipto", "Menta", "Romero", "Naranja", "Rosa", "Sándalo", "Sin aroma"] as const;
const PREF_PRESION = ["Muy suave", "Suave", "Moderada", "Firme", "Profunda"] as const;
const PREF_MUSICA = ["Sin música", "Naturaleza", "Piano", "Cuencos tibetanos", "Ambient", "A elección"] as const;
const PREF_ILUMINACION = ["Tenue", "Media", "Normal"] as const;
const CALIDAD_SUENO = ["Muy mala", "Mala", "Regular", "Buena", "Excelente"] as const;
const CIRCUITO_SERVICIOS = ["Sauna seca", "Sauna húmeda/vapor", "Jacuzzi", "Ducha fría", "Piscina templada", "Sala de relajación", "Baño turco", "Cámara de hielo"] as const;

interface CircuitoStep {
  servicio: string;
  duracion: number;
  temperatura: number;
  notas: string;
}

interface Props { patientId: string; onSaved: (record: any) => void; }

export function SpaForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    tipoServicio: "",
    cuestionarioSalud: [] as string[],
    aromaterapia: [] as string[],
    temperatura: "",
    duracion: "",
    observaciones: "",
    recomendacionesPost: "",
    productosRecomendados: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Stress scale state
  const [estresLlegar, setEstresLlegar] = useState(0);
  const [estresSalir, setEstresSalir] = useState(0);
  const [calidadSueno, setCalidadSueno] = useState(0);

  // Guest preferences state
  const [prefTemperatura, setPrefTemperatura] = useState("");
  const [prefAromas, setPrefAromas] = useState<string[]>([]);
  const [prefPresion, setPrefPresion] = useState("");
  const [prefMusica, setPrefMusica] = useState("");
  const [prefIluminacion, setPrefIluminacion] = useState("");

  // Thermal circuit state
  const [circuito, setCircuito] = useState<CircuitoStep[]>([]);

  function togglePrefAroma(val: string) {
    setPrefAromas(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  function addCircuitoStep() {
    setCircuito(prev => [...prev, { servicio: "", duracion: 0, temperatura: 0, notas: "" }]);
  }
  function removeCircuitoStep(idx: number) {
    setCircuito(prev => prev.filter((_, i) => i !== idx));
  }
  function updateCircuitoStep(idx: number, field: keyof CircuitoStep, value: string | number) {
    setCircuito(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }
  function moveCircuitoStep(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= circuito.length) return;
    setCircuito(prev => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }

  const circuitoTotalMin = circuito.reduce((sum, s) => sum + (s.duracion || 0), 0);
  const stressReduction = estresLlegar && estresSalir ? estresLlegar - estresSalir : 0;

  function toggleCheck(field: "cuestionarioSalud" | "aromaterapia", val: string) {
    setForm(f => ({
      ...f,
      [field]: f[field].includes(val) ? f[field].filter(x => x !== val) : [...f[field], val],
    }));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error(t("clinical.spaForm.needReasonOrDiagnosis")); return; }
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
            type: "spa",
            tipoServicio: form.tipoServicio,
            cuestionarioSalud: form.cuestionarioSalud,
            aromaterapia: form.aromaterapia,
            temperatura: form.temperatura,
            duracion: form.duracion,
            observaciones: form.observaciones,
            recomendacionesPost: form.recomendacionesPost,
            productosRecomendados: form.productosRecomendados,
            escalaEstres: { llegada: estresLlegar, salida: estresSalir, calidadSueno },
            preferenciasHuesped: { temperatura: prefTemperatura, aromas: prefAromas, presion: prefPresion, musica: prefMusica, iluminacion: prefIluminacion },
            circuitoTermal: circuito,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success(t("clinical.spaForm.recordSaved"));
    } catch (err: any) { toast.error(err.message ?? t("clinical.spaForm.saveError")); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.spaForm.anamnesis")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.reasonField")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.spaForm.reasonPlaceholder")} value={form.subjective} onChange={e => set("subjective", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.physicalExamField")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.spaForm.currentStatePlaceholder")} value={form.objective} onChange={e => set("objective", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.serviceData")}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.serviceType")}</label>
            <select className="input-new"
              value={form.tipoServicio} onChange={e => set("tipoServicio", e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {SERVICIOS.map(s => <option key={s} value={s}>{t(`clinical.spaForm.servicio.${s}`)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.temperaturePreference")}</label>
            <select className="input-new"
              value={form.temperatura} onChange={e => set("temperatura", e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {TEMPERATURAS.map(temp => <option key={temp} value={temp}>{t(`clinical.spaForm.temperatura.${temp}`)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.serviceDuration")}</label>
            <select className="input-new"
              value={form.duracion} onChange={e => set("duracion", e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {DURACIONES.map(d => <option key={d} value={d}>{t("clinical.spaForm.minutes", { count: Number(d) })}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.personalizedPreferences")}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.preferredTemperature")}</label>
            <select className="input-new"
              value={prefTemperatura} onChange={e => setPrefTemperatura(e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {PREF_TEMPERATURAS.map(temp => <option key={temp} value={temp}>{t(`clinical.spaForm.prefTemperatura.${temp}`)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.massagePressure")}</label>
            <select className="input-new"
              value={prefPresion} onChange={e => setPrefPresion(e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {PREF_PRESION.map(p => <option key={p} value={p}>{t(`clinical.spaForm.prefPresion.${p}`)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.music")}</label>
            <select className="input-new"
              value={prefMusica} onChange={e => setPrefMusica(e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {PREF_MUSICA.map(m => <option key={m} value={m}>{t(`clinical.spaForm.prefMusica.${m}`)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.lighting")}</label>
            <select className="input-new"
              value={prefIluminacion} onChange={e => setPrefIluminacion(e.target.value)}>
              <option value="">{t("clinical.spaForm.selectOption")}</option>
              {PREF_ILUMINACION.map(i => <option key={i} value={i}>{t(`clinical.spaForm.prefIluminacion.${i}`)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="field-new__label">{t("clinical.spaForm.preferredAromas")}</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
            {PREF_AROMAS.map(a => (
              <label key={a} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={prefAromas.includes(a)} onChange={() => togglePrefAroma(a)} className="w-4 h-4 accent-brand-600" />
                <span className="text-sm">{t(`clinical.spaForm.prefAroma.${a}`)}</span>
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3 italic">{t("clinical.spaForm.preferencesHelper")}</p>
      </CardNew>

      <CardNew title={t("clinical.spaForm.healthQuestionnaire")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SALUD_OPTIONS.map(s => (
            <label key={s} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.cuestionarioSalud.includes(s)} onChange={() => toggleCheck("cuestionarioSalud", s)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm">{t(`clinical.spaForm.salud.${s}`)}</span>
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.aromatherapyPreferences")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AROMAS.map(a => (
            <label key={a} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.aromaterapia.includes(a)} onChange={() => toggleCheck("aromaterapia", a)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm">{t(`clinical.spaForm.aroma.${a}`)}</span>
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.stressWellbeing")}>
        <div className="space-y-4">
          <div>
            <label className="field-new__label">{t("clinical.spaForm.stressOnArrival")}</label>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button key={n} type="button" onClick={() => setEstresLlegar(n)}
                  className={`h-9 w-9 rounded-lg text-sm font-medium transition-all ${estresLlegar === n ? "ring-2 ring-offset-1 ring-brand-600 text-white" : "border border-border hover:opacity-80"}`}
                  style={{ backgroundColor: estresLlegar === n ? `hsl(${(10 - n) * 12}, 80%, 45%)` : undefined }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="field-new__label">{t("clinical.spaForm.stressOnDeparture")}</label>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button key={n} type="button" onClick={() => setEstresSalir(n)}
                  className={`h-9 w-9 rounded-lg text-sm font-medium transition-all ${estresSalir === n ? "ring-2 ring-offset-1 ring-brand-600 text-white" : "border border-border hover:opacity-80"}`}
                  style={{ backgroundColor: estresSalir === n ? `hsl(${(10 - n) * 12}, 80%, 45%)` : undefined }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {stressReduction > 0 && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">{t("clinical.spaForm.stressReduction", { count: stressReduction })}</p>
          )}
          {stressReduction < 0 && (
            <p className="text-sm font-medium text-red-500 dark:text-red-400">{t("clinical.spaForm.stressIncrease", { count: Math.abs(stressReduction) })}</p>
          )}

          <div>
            <label className="field-new__label">{t("clinical.spaForm.sleepQuality")}</label>
            <div className="flex gap-1">
              {CALIDAD_SUENO.map((label, i) => (
                <button key={label} type="button" onClick={() => setCalidadSueno(i + 1)}
                  className={`h-9 px-3 rounded-lg text-xs font-medium transition-all ${calidadSueno === i + 1 ? "bg-brand-600 text-white ring-2 ring-offset-1 ring-brand-600" : "border border-border hover:bg-muted"}`}>
                  {t(`clinical.spaForm.calidadSueno.${label}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.observationsRecommendations")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.observationsDuringService")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.spaForm.observationsPlaceholder")} value={form.observaciones} onChange={e => set("observaciones", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.postServiceRecommendations")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.spaForm.aftercarePlaceholder")} value={form.recomendacionesPost} onChange={e => set("recomendacionesPost", e.target.value)} />
          </div>
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">{t("clinical.spaForm.homeProducts")}</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder={t("clinical.spaForm.homeProductsPlaceholder")} value={form.productosRecomendados} onChange={e => set("productosRecomendados", e.target.value)} />
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.diagnosisPlan")}>
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.diagnosisField")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.spaForm.generalEvaluationPlaceholder")} value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.spaForm.planField")}</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.spaForm.followUpPlaceholder")} value={form.plan} onChange={e => set("plan", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.spaForm.recommendedThermalCircuit")}>
        {form.cuestionarioSalud.length > 0 && !form.cuestionarioSalud.includes("ninguno") && (
          <div className="mb-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
            {t("clinical.spaForm.contraindicationsDetected", { list: form.cuestionarioSalud.map(c => t(`clinical.spaForm.salud.${c}`)).join(", ") })}
          </div>
        )}

        {circuito.map((step, idx) => (
          <div key={idx} className="grid grid-cols-[auto_1fr_auto_auto_1fr_auto] gap-2 mb-2 items-end">
            <div className="flex flex-col items-center gap-1">
              {idx === 0 && <label className="field-new__label">{t("clinical.spaForm.step")}</label>}
              <span className="h-9 w-9 flex items-center justify-center rounded-lg bg-brand-600/15 text-brand-700 dark:text-brand-300 text-sm font-bold">{idx + 1}</span>
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("clinical.spaForm.serviceColumn")}</label>}
              <select className="input-new"
                value={step.servicio} onChange={e => updateCircuitoStep(idx, "servicio", e.target.value)}>
                <option value="">{t("clinical.spaForm.selectOption")}</option>
                {CIRCUITO_SERVICIOS.map(s => <option key={s} value={s}>{t(`clinical.spaForm.circuitoServicio.${s}`)}</option>)}
              </select>
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("clinical.spaForm.minColumn")}</label>}
              <input type="number" min={0} className="input-new" style={{ width: 64 }}
                value={step.duracion || ""} onChange={e => updateCircuitoStep(idx, "duracion", parseInt(e.target.value) || 0)} placeholder={t("clinical.spaForm.minPlaceholder")} />
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">°C</label>}
              <input type="number" className="input-new" style={{ width: 64 }}
                value={step.temperatura || ""} onChange={e => updateCircuitoStep(idx, "temperatura", parseInt(e.target.value) || 0)} placeholder="°C" />
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">{t("common.notes")}</label>}
              <input className="input-new"
                value={step.notas} onChange={e => updateCircuitoStep(idx, "notas", e.target.value)} placeholder={t("clinical.spaForm.notesPlaceholder")} />
            </div>
            <div className="flex gap-1">
              {idx === 0 && <label className="field-new__label invisible">{t("clinical.spaForm.actionsColumn")}</label>}
              <button type="button" onClick={() => moveCircuitoStep(idx, -1)} disabled={idx === 0} className="h-9 w-7 flex items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-30">↑</button>
              <button type="button" onClick={() => moveCircuitoStep(idx, 1)} disabled={idx === circuito.length - 1} className="h-9 w-7 flex items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-30">↓</button>
              <button type="button" onClick={() => removeCircuitoStep(idx)} className="h-9 w-7 flex items-center justify-center rounded border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-lg">×</button>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between mt-3">
          <Button type="button" variant="outline" size="sm" onClick={addCircuitoStep} className="">
            {t("clinical.spaForm.addStep")}
          </Button>
          {circuito.length > 0 && (
            <span className="text-sm font-medium">{t("clinical.spaForm.totalTime")} <span className="text-brand-600 dark:text-brand-400">{t("clinical.spaForm.minutes", { count: circuitoTotalMin })}</span></span>
          )}
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.spaForm.saveConsultation")}
        </ButtonNew>
      </div>
    </form>
  );
}
