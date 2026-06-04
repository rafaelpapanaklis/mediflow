"use client";
import { useState, useMemo } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

const ARTICULACIONES = ["hombro", "codo", "muñeca", "cadera", "rodilla", "tobillo", "columna cervical", "columna lumbar"] as const;
const LADOS = ["izquierdo", "derecho", "bilateral"] as const;
const TRATAMIENTOS = ["terapia manual", "ejercicio terapéutico", "TENS", "EMS", "ultrasonido", "punción seca", "hidroterapia", "vendaje", "crioterapia", "termoterapia"] as const;
const FRECUENCIAS = ["diario", "3x/semana", "2x/semana", "1x/semana"] as const;
const SCORES_TIPO = ["LEFS", "DASH", "Oswestry", "otro"] as const;

const ORTHO_TESTS: Record<string, string[]> = {
  "Hombro": ["Neer", "Hawkins-Kennedy", "Jobe (Empty can)", "Speed", "Apprehension"],
  "Rodilla": ["Lachman", "Cajón anterior", "Cajón posterior", "McMurray", "Varo/Valgo"],
  "Columna lumbar": ["Lasègue (SLR)", "Slump", "Crossed SLR", "Kemp"],
  "Cervical": ["Spurling", "Distracción", "Test de compresión"],
  "Cadera": ["Thomas", "FABER/Patrick", "Trendelenburg"],
};

const OUTCOME_SCALES: Record<string, { items: string[]; maxPerItem: number }> = {
  "DASH (Miembro superior)": {
    items: ["Abrir un frasco cerrado", "Realizar tareas domésticas pesadas", "Llevar una bolsa de compras", "Lavarse la espalda", "Usar un cuchillo para cortar alimentos"],
    maxPerItem: 5,
  },
  "KOOS (Rodilla)": {
    items: ["Dolor al caminar en superficie plana", "Dolor al subir/bajar escaleras", "Dolor nocturno en cama", "Dificultad para ponerse calcetines", "Dificultad para entrar/salir del auto"],
    maxPerItem: 4,
  },
  "LEFS (Miembro inferior)": { items: [], maxPerItem: 0 },
  "NDI (Cervical)": {
    items: ["Intensidad de dolor cervical", "Cuidado personal", "Lectura", "Dolor de cabeza", "Concentración"],
    maxPerItem: 5,
  },
  "Oswestry (Lumbar)": {
    items: ["Intensidad de dolor lumbar", "Cuidado personal", "Levantar objetos", "Caminar", "Sentarse"],
    maxPerItem: 5,
  },
  "PSFS (Específica del paciente)": { items: [], maxPerItem: 0 },
};

const VISTA_ANTERIOR = ["Cabeza inclinada", "Hombros desnivelados", "Pelvis desnivelada", "Genu valgum", "Genu varum", "Pie plano", "Pie cavo"];
const VISTA_LATERAL = ["Cabeza adelantada", "Hipercifosis dorsal", "Hiperlordosis lumbar", "Rectificación lumbar", "Rodillas hiperextendidas"];
const VISTA_POSTERIOR = ["Escápulas aladas", "Escoliosis funcional", "Pliegue glúteo asimétrico", "Tendón de Aquiles desviado"];
const PATRONES_MARCHA = ["Normal", "Antálgica", "Trendelenburg", "Espástica", "Atáxica", "Steppage"];

interface OrthoTestResult { checked: boolean; resultado: "positivo" | "negativo"; lateralidad: "Izq" | "Der" | "Bilateral"; }
interface RomRow { articulacion: string; movimiento: string; grados: string; lado: string; }
interface HepRow { nombre: string; series: string; repeticiones: string; frecuencia: string; }

interface Props { patientId: string; onSaved: (record: any) => void; }

export function PhysiotherapyForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    diagnostico: "",
    codigoCIE: "",
    medicoReferente: "",
    dolorVAS: 0,
    tratamientos: [] as string[],
    sesionesAutorizadas: "",
    sesionesRealizadas: "",
    scoreTipo: "",
    scoreValor: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const [romRows, setRomRows] = useState<RomRow[]>([{ articulacion: "", movimiento: "", grados: "", lado: "" }]);
  const [hepRows, setHepRows] = useState<HepRow[]>([{ nombre: "", series: "", repeticiones: "", frecuencia: "" }]);

  // --- Orthopedic tests state ---
  const [orthoTests, setOrthoTests] = useState<Record<string, OrthoTestResult>>(() => {
    const init: Record<string, OrthoTestResult> = {};
    for (const tests of Object.values(ORTHO_TESTS)) {
      for (const test of tests) {
        init[test] = { checked: false, resultado: "positivo", lateralidad: "Bilateral" };
      }
    }
    return init;
  });
  function toggleOrthoTest(name: string) {
    setOrthoTests(prev => ({ ...prev, [name]: { ...prev[name], checked: !prev[name].checked } }));
  }
  function setOrthoField(name: string, field: "resultado" | "lateralidad", value: any) {
    setOrthoTests(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  }

  // --- Outcome measures state ---
  const [outcomeScale, setOutcomeScale] = useState("");
  const [outcomeScores, setOutcomeScores] = useState<Record<string, number>>({});
  function setOutcomeItem(item: string, val: number) {
    setOutcomeScores(prev => ({ ...prev, [item]: val }));
  }
  const outcomeResult = useMemo(() => {
    const scale = OUTCOME_SCALES[outcomeScale];
    if (!scale || scale.items.length === 0) return null;
    const answered = scale.items.filter(i => outcomeScores[i] !== undefined);
    if (answered.length === 0) return null;
    const sum = answered.reduce((acc, i) => acc + (outcomeScores[i] ?? 0), 0);
    const maxPossible = scale.items.length * scale.maxPerItem;
    const pct = Math.round((sum / maxPossible) * 100);
    let severity = "";
    let color = "";
    if (outcomeScale.startsWith("DASH")) {
      if (pct <= 20) { severity = t("clinical.physio.sevNoDisability"); color = "text-green-600 dark:text-green-400"; }
      else if (pct <= 40) { severity = t("clinical.physio.sevMildDisability"); color = "text-yellow-600 dark:text-yellow-400"; }
      else if (pct <= 60) { severity = t("clinical.physio.sevModerateDisability"); color = "text-orange-600 dark:text-orange-400"; }
      else { severity = t("clinical.physio.sevSevereDisability"); color = "text-red-600 dark:text-red-400"; }
    } else if (outcomeScale.startsWith("KOOS")) {
      const koosScore = 100 - pct;
      if (koosScore >= 80) { severity = t("clinical.physio.funcExcellent"); color = "text-green-600 dark:text-green-400"; }
      else if (koosScore >= 60) { severity = t("clinical.physio.funcGood"); color = "text-yellow-600 dark:text-yellow-400"; }
      else if (koosScore >= 40) { severity = t("clinical.physio.funcModerate"); color = "text-orange-600 dark:text-orange-400"; }
      else { severity = t("clinical.physio.funcPoor"); color = "text-red-600 dark:text-red-400"; }
    } else {
      // NDI / Oswestry style
      if (pct <= 20) { severity = t("clinical.physio.sevMinimal"); color = "text-green-600 dark:text-green-400"; }
      else if (pct <= 40) { severity = t("clinical.physio.sevModerate"); color = "text-yellow-600 dark:text-yellow-400"; }
      else if (pct <= 60) { severity = t("clinical.physio.sevSevere"); color = "text-orange-600 dark:text-orange-400"; }
      else { severity = t("clinical.physio.sevComplete"); color = "text-red-600 dark:text-red-400"; }
    }
    return { sum, pct, severity, color };
  }, [outcomeScale, outcomeScores]);

  // --- Postural & gait state ---
  const [posturalAnterior, setPosturalAnterior] = useState<string[]>([]);
  const [posturalLateral, setPosturalLateral] = useState<string[]>([]);
  const [posturalPosterior, setPosturalPosterior] = useState<string[]>([]);
  const [patronMarcha, setPatronMarcha] = useState("");
  const [notasPosturales, setNotasPosturales] = useState("");
  function togglePostural(list: string[], setList: (v: string[]) => void, item: string) {
    setList(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  }

  function toggleTratamiento(tx: string) {
    setForm(f => ({
      ...f,
      tratamientos: f.tratamientos.includes(tx) ? f.tratamientos.filter(x => x !== tx) : [...f.tratamientos, tx],
    }));
  }

  function updateRom(i: number, k: keyof RomRow, v: string) {
    setRomRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }
  function updateHep(i: number, k: keyof HepRow, v: string) {
    setHepRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error(t("clinical.physio.errMissingReason")); return; }
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
            type: "physiotherapy",
            diagnostico: form.diagnostico,
            codigoCIE: form.codigoCIE,
            medicoReferente: form.medicoReferente,
            dolorVAS: form.dolorVAS,
            rom: romRows,
            tratamientos: form.tratamientos,
            hep: hepRows,
            sesionesAutorizadas: form.sesionesAutorizadas,
            sesionesRealizadas: form.sesionesRealizadas,
            scoreTipo: form.scoreTipo,
            scoreValor: form.scoreValor,
            orthoTests: Object.fromEntries(Object.entries(orthoTests).filter(([, v]) => v.checked)),
            outcomeScale,
            outcomeScores,
            outcomeResult,
            postural: {
              anterior: posturalAnterior,
              lateral: posturalLateral,
              posterior: posturalPosterior,
              patronMarcha,
              notasPosturales,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success(t("clinical.physio.savedToast"));
    } catch (err: any) { toast.error(err.message ?? t("clinical.physio.errSaving")); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.physio.diagRefTitle")}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.diagnosis")}</label>
            <input className="input-new"
              placeholder={t("clinical.physio.diagnosisPlaceholder")} value={form.diagnostico} onChange={e => set("diagnostico", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.icd10")}</label>
            <input className="input-new"
              placeholder={t("clinical.physio.icd10Placeholder")} value={form.codigoCIE} onChange={e => set("codigoCIE", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.referringDoctor")}</label>
            <input className="input-new"
              placeholder={t("clinical.physio.referringDoctorPlaceholder")} value={form.medicoReferente} onChange={e => set("medicoReferente", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.vasTitle")}>
        <div className="space-y-2">
          <input type="range" min={0} max={10} step={1} value={form.dolorVAS}
            onChange={e => set("dolorVAS", Number(e.target.value))}
            className="w-full accent-brand-600" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("clinical.physio.vasNoPain")}</span>
            <span>{t("clinical.physio.vasModerate")}</span>
            <span>{t("clinical.physio.vasWorstPain")}</span>
          </div>
          <p className="text-center text-sm font-semibold">{t("clinical.physio.vasCurrent", { value: form.dolorVAS })}</p>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.romTitle")}>
        <div className="space-y-2">
          {romRows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <select className="input-new"
                value={row.articulacion} onChange={e => updateRom(i, "articulacion", e.target.value)}>
                <option value="">{t("clinical.physio.jointPlaceholder")}</option>
                {ARTICULACIONES.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
              </select>
              <input className="input-new"
                placeholder={t("clinical.physio.movement")} value={row.movimiento} onChange={e => updateRom(i, "movimiento", e.target.value)} />
              <input type="number" className="input-new"
                placeholder={t("clinical.physio.degrees")} value={row.grados} onChange={e => updateRom(i, "grados", e.target.value)} />
              <select className="input-new"
                value={row.lado} onChange={e => updateRom(i, "lado", e.target.value)}>
                <option value="">{t("clinical.physio.sidePlaceholder")}</option>
                {LADOS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </select>
            </div>
          ))}
          <ButtonNew variant="secondary" type="button" onClick={() => setRomRows(r => [...r, { articulacion: "", movimiento: "", grados: "", lado: "" }])}>
            {t("clinical.physio.addRomRow")}
          </ButtonNew>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.orthoTestsTitle")}>
        <div className="space-y-4">
          {Object.entries(ORTHO_TESTS).map(([region, tests]) => (
            <div key={region}>
              <p className="text-xs font-semibold text-muted-foreground mb-2">{region}</p>
              <div className="space-y-2">
                {tests.map(test => (
                  <div key={test} className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer min-w-[180px]">
                      <input type="checkbox" checked={orthoTests[test].checked} onChange={() => toggleOrthoTest(test)}
                        className="w-4 h-4 accent-brand-600" />
                      <span className="text-sm">{test}</span>
                    </label>
                    {orthoTests[test].checked && (
                      <>
                        <div className="flex items-center gap-1">
                          <button type="button"
                            className={`px-2 py-1 rounded text-xs font-medium border ${orthoTests[test].resultado === "positivo" ? "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300" : "border-border text-muted-foreground"}`}
                            onClick={() => setOrthoField(test, "resultado", "positivo")}>
                            {t("clinical.physio.testPositive")}
                          </button>
                          <button type="button"
                            className={`px-2 py-1 rounded text-xs font-medium border ${orthoTests[test].resultado === "negativo" ? "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300" : "border-border text-muted-foreground"}`}
                            onClick={() => setOrthoField(test, "resultado", "negativo")}>
                            {t("clinical.physio.testNegative")}
                          </button>
                        </div>
                        <select className="input-new"
                          value={orthoTests[test].lateralidad} onChange={e => setOrthoField(test, "lateralidad", e.target.value)}>
                          <option value="Izq">{t("clinical.physio.sideLeft")}</option>
                          <option value="Der">{t("clinical.physio.sideRight")}</option>
                          <option value="Bilateral">{t("clinical.physio.sideBilateral")}</option>
                        </select>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Results summary */}
        {Object.values(orthoTests).some(v => v.checked) && (
          <div className="mt-4 pt-3 border-t border-border">
            <p className="text-xs font-semibold mb-1">{t("clinical.physio.resultsSummary")}</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(orthoTests).filter(([, v]) => v.checked).map(([name, v]) => (
                <span key={name} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${v.resultado === "positivo" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"}`}>
                  {name} ({v.resultado === "positivo" ? "+" : "-"}) {v.lateralidad}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardNew>

      <CardNew title={t("clinical.physio.treatmentTitle")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRATAMIENTOS.map(tx => (
            <label key={tx} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.tratamientos.includes(tx)} onChange={() => toggleTratamiento(tx)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{tx}</span>
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.hepTitle")}>
        <div className="space-y-2">
          {hepRows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <input className="input-new"
                placeholder={t("clinical.physio.exercise")} value={row.nombre} onChange={e => updateHep(i, "nombre", e.target.value)} />
              <input type="number" className="input-new"
                placeholder={t("clinical.physio.sets")} value={row.series} onChange={e => updateHep(i, "series", e.target.value)} />
              <input type="number" className="input-new"
                placeholder={t("clinical.physio.reps")} value={row.repeticiones} onChange={e => updateHep(i, "repeticiones", e.target.value)} />
              <select className="input-new"
                value={row.frecuencia} onChange={e => updateHep(i, "frecuencia", e.target.value)}>
                <option value="">{t("clinical.physio.frequencyPlaceholder")}</option>
                {FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
          <ButtonNew variant="secondary" type="button" onClick={() => setHepRows(r => [...r, { nombre: "", series: "", repeticiones: "", frecuencia: "" }])}>
            {t("clinical.physio.addExercise")}
          </ButtonNew>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.sessionControlTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.sessionsAuthorized")}</label>
            <input type="number" className="input-new"
              placeholder={t("clinical.physio.sessionsAuthorizedPlaceholder")} value={form.sesionesAutorizadas} onChange={e => set("sesionesAutorizadas", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.sessionsCompleted")}</label>
            <input type="number" className="input-new"
              placeholder={t("clinical.physio.sessionsCompletedPlaceholder")} value={form.sesionesRealizadas} onChange={e => set("sesionesRealizadas", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.outcomeScalesTitle")}>
        <div className="space-y-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.scale")}</label>
            <select className="input-new" value={outcomeScale} onChange={e => { setOutcomeScale(e.target.value); setOutcomeScores({}); }}>
              <option value="">{t("clinical.physio.selectScalePlaceholder")}</option>
              {Object.keys(OUTCOME_SCALES).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {outcomeScale && OUTCOME_SCALES[outcomeScale]?.items.length > 0 && (
            <div className="space-y-2">
              {OUTCOME_SCALES[outcomeScale].items.map(item => (
                <div key={item} className="flex items-center gap-3">
                  <span className="text-sm flex-1 min-w-0">{item}</span>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: OUTCOME_SCALES[outcomeScale].maxPerItem + 1 }, (_, n) => (
                      <button key={n} type="button"
                        className={`w-8 h-8 rounded text-xs font-medium border ${outcomeScores[item] === n ? "bg-brand-600 text-white border-brand-600" : "border-border text-muted-foreground hover:bg-muted dark:hover:bg-zinc-800"}`}
                        onClick={() => setOutcomeItem(item, n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {outcomeResult && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-3">
                  <span className="text-sm font-semibold">{t("clinical.physio.result")}</span>
                  <span className={`text-lg font-bold ${outcomeResult.color}`}>
                    {t("clinical.physio.resultValue", { sum: outcomeResult.sum, pct: outcomeResult.pct })} &middot; {outcomeResult.severity}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.posturalTitle")}>
        <div className="space-y-4">
          {/* Vista anterior */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t("clinical.physio.anteriorView")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {VISTA_ANTERIOR.map(item => (
                <label key={item} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={posturalAnterior.includes(item)}
                    onChange={() => togglePostural(posturalAnterior, setPosturalAnterior, item)}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">{item}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Vista lateral */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t("clinical.physio.lateralView")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {VISTA_LATERAL.map(item => (
                <label key={item} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={posturalLateral.includes(item)}
                    onChange={() => togglePostural(posturalLateral, setPosturalLateral, item)}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">{item}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Vista posterior */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t("clinical.physio.posteriorView")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {VISTA_POSTERIOR.map(item => (
                <label key={item} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={posturalPosterior.includes(item)}
                    onChange={() => togglePostural(posturalPosterior, setPosturalPosterior, item)}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">{item}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Patrón de marcha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="field-new">
              <label className="field-new__label">{t("clinical.physio.gaitPattern")}</label>
              <select className="input-new" value={patronMarcha} onChange={e => setPatronMarcha(e.target.value)}>
                <option value="">{t("clinical.physio.selectPlaceholder")}</option>
                {PATRONES_MARCHA.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          {/* Notas posturales */}
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.posturalNotes")}</label>
            <textarea className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.physio.posturalNotesPlaceholder")} value={notasPosturales} onChange={e => setNotasPosturales(e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.soapTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.subjective")}</label>
            <textarea className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.physio.subjectivePlaceholder")} value={form.subjective} onChange={e => set("subjective", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.objective")}</label>
            <textarea className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.physio.objectivePlaceholder")} value={form.objective} onChange={e => set("objective", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.assessment")}</label>
            <textarea className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.physio.assessmentPlaceholder")} value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.plan")}</label>
            <textarea className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder={t("clinical.physio.planPlaceholder")} value={form.plan} onChange={e => set("plan", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.physio.functionalScoreTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.scoreType")}</label>
            <select className="input-new"
              value={form.scoreTipo} onChange={e => set("scoreTipo", e.target.value)}>
              <option value="">{t("clinical.physio.selectPlaceholder")}</option>
              {SCORES_TIPO.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.physio.score")}</label>
            <input type="number" className="input-new"
              placeholder={t("clinical.physio.scorePlaceholder")} value={form.scoreValor} onChange={e => set("scoreValor", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("clinical.physio.saveConsult")}
        </ButtonNew>
      </div>
    </form>
  );
}
