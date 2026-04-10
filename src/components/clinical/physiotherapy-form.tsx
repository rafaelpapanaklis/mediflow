"use client";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

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
      for (const t of tests) {
        init[t] = { checked: false, resultado: "positivo", lateralidad: "Bilateral" };
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
      if (pct <= 20) { severity = "Sin discapacidad"; color = "text-green-600 dark:text-green-400"; }
      else if (pct <= 40) { severity = "Discapacidad leve"; color = "text-yellow-600 dark:text-yellow-400"; }
      else if (pct <= 60) { severity = "Discapacidad moderada"; color = "text-orange-600 dark:text-orange-400"; }
      else { severity = "Discapacidad severa"; color = "text-red-600 dark:text-red-400"; }
    } else if (outcomeScale.startsWith("KOOS")) {
      const koosScore = 100 - pct;
      if (koosScore >= 80) { severity = "Función excelente"; color = "text-green-600 dark:text-green-400"; }
      else if (koosScore >= 60) { severity = "Función buena"; color = "text-yellow-600 dark:text-yellow-400"; }
      else if (koosScore >= 40) { severity = "Función moderada"; color = "text-orange-600 dark:text-orange-400"; }
      else { severity = "Función pobre"; color = "text-red-600 dark:text-red-400"; }
    } else {
      // NDI / Oswestry style
      if (pct <= 20) { severity = "Mínima"; color = "text-green-600 dark:text-green-400"; }
      else if (pct <= 40) { severity = "Moderada"; color = "text-yellow-600 dark:text-yellow-400"; }
      else if (pct <= 60) { severity = "Severa"; color = "text-orange-600 dark:text-orange-400"; }
      else { severity = "Discapacidad completa"; color = "text-red-600 dark:text-red-400"; }
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

  function toggleTratamiento(t: string) {
    setForm(f => ({
      ...f,
      tratamientos: f.tratamientos.includes(t) ? f.tratamientos.filter(x => x !== t) : [...f.tratamientos, t],
    }));
  }

  function updateRom(i: number, k: keyof RomRow, v: string) {
    setRomRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }
  function updateHep(i: number, k: keyof HepRow, v: string) {
    setHepRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega al menos el motivo de consulta o diagnóstico"); return; }
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
      toast.success("Expediente de fisioterapia guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  const inputCls = "flex h-9 w-full rounded-lg border border-border bg-white dark:bg-zinc-900 dark:text-zinc-100 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20";
  const selectCls = inputCls;
  const textareaCls = "flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none";

  return (
    <div className="space-y-6">
      {/* DIAGNÓSTICO & REFERENCIA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Diagnóstico y referencia</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Diagnóstico</Label>
            <input className={inputCls}
              placeholder="Ej. Cervicalgia mecánica" value={form.diagnostico} onChange={e => set("diagnostico", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Código CIE-10</Label>
            <input className={inputCls}
              placeholder="Ej. M54.2" value={form.codigoCIE} onChange={e => set("codigoCIE", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Médico referente</Label>
            <input className={inputCls}
              placeholder="Dr. / Dra." value={form.medicoReferente} onChange={e => set("medicoReferente", e.target.value)} />
          </div>
        </div>
      </div>

      {/* ESCALA DE DOLOR VAS */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Escala de dolor VAS</h3>
        <div className="space-y-2">
          <input type="range" min={0} max={10} step={1} value={form.dolorVAS}
            onChange={e => set("dolorVAS", Number(e.target.value))}
            className="w-full accent-brand-600" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 — Sin dolor</span>
            <span>5 — Moderado</span>
            <span>10 — Peor dolor</span>
          </div>
          <p className="text-center text-sm font-semibold">Valor actual: {form.dolorVAS}</p>
        </div>
      </div>

      {/* ROM TABLE */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Mediciones ROM</h3>
        <div className="space-y-2">
          {romRows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <select className={selectCls}
                value={row.articulacion} onChange={e => updateRom(i, "articulacion", e.target.value)}>
                <option value="">Articulación…</option>
                {ARTICULACIONES.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
              </select>
              <input className={inputCls}
                placeholder="Movimiento" value={row.movimiento} onChange={e => updateRom(i, "movimiento", e.target.value)} />
              <input type="number" className={inputCls}
                placeholder="Grados" value={row.grados} onChange={e => updateRom(i, "grados", e.target.value)} />
              <select className={selectCls}
                value={row.lado} onChange={e => updateRom(i, "lado", e.target.value)}>
                <option value="">Lado…</option>
                {LADOS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </select>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRomRows(r => [...r, { articulacion: "", movimiento: "", grados: "", lado: "" }])}>
            + Agregar fila ROM
          </Button>
        </div>
      </div>

      {/* TESTS ORTOPÉDICOS ESPECIALES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">{"\uD83E\uDDEA"} Tests ortopédicos especiales</h3>
        <div className="space-y-4">
          {Object.entries(ORTHO_TESTS).map(([region, tests]) => (
            <div key={region}>
              <p className="text-xs font-semibold text-muted-foreground mb-2">{region}</p>
              <div className="space-y-2">
                {tests.map(t => (
                  <div key={t} className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer min-w-[180px]">
                      <input type="checkbox" checked={orthoTests[t].checked} onChange={() => toggleOrthoTest(t)}
                        className="w-4 h-4 accent-brand-600" />
                      <span className="text-sm">{t}</span>
                    </label>
                    {orthoTests[t].checked && (
                      <>
                        <div className="flex items-center gap-1">
                          <button type="button"
                            className={`px-2 py-1 rounded text-xs font-medium border ${orthoTests[t].resultado === "positivo" ? "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300" : "border-border text-muted-foreground"}`}
                            onClick={() => setOrthoField(t, "resultado", "positivo")}>
                            Positivo +
                          </button>
                          <button type="button"
                            className={`px-2 py-1 rounded text-xs font-medium border ${orthoTests[t].resultado === "negativo" ? "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300" : "border-border text-muted-foreground"}`}
                            onClick={() => setOrthoField(t, "resultado", "negativo")}>
                            Negativo -
                          </button>
                        </div>
                        <select className="h-8 rounded-lg border border-border bg-white dark:bg-zinc-900 dark:text-zinc-100 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                          value={orthoTests[t].lateralidad} onChange={e => setOrthoField(t, "lateralidad", e.target.value)}>
                          <option value="Izq">Izq</option>
                          <option value="Der">Der</option>
                          <option value="Bilateral">Bilateral</option>
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
            <p className="text-xs font-semibold mb-1">Resumen de resultados:</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(orthoTests).filter(([, v]) => v.checked).map(([name, v]) => (
                <span key={name} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${v.resultado === "positivo" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"}`}>
                  {name} ({v.resultado === "positivo" ? "+" : "-"}) {v.lateralidad}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* TRATAMIENTO APLICADO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tratamiento aplicado</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRATAMIENTOS.map(t => (
            <label key={t} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.tratamientos.includes(t)} onChange={() => toggleTratamiento(t)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>

      {/* HEP TABLE */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Programa de ejercicios en casa (HEP)</h3>
        <div className="space-y-2">
          {hepRows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <input className={inputCls}
                placeholder="Ejercicio" value={row.nombre} onChange={e => updateHep(i, "nombre", e.target.value)} />
              <input type="number" className={inputCls}
                placeholder="Series" value={row.series} onChange={e => updateHep(i, "series", e.target.value)} />
              <input type="number" className={inputCls}
                placeholder="Repeticiones" value={row.repeticiones} onChange={e => updateHep(i, "repeticiones", e.target.value)} />
              <select className={selectCls}
                value={row.frecuencia} onChange={e => updateHep(i, "frecuencia", e.target.value)}>
                <option value="">Frecuencia…</option>
                {FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setHepRows(r => [...r, { nombre: "", series: "", repeticiones: "", frecuencia: "" }])}>
            + Agregar ejercicio
          </Button>
        </div>
      </div>

      {/* SESIONES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Control de sesiones</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Sesiones autorizadas</Label>
            <input type="number" className={inputCls}
              placeholder="Ej. 12" value={form.sesionesAutorizadas} onChange={e => set("sesionesAutorizadas", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sesiones realizadas</Label>
            <input type="number" className={inputCls}
              placeholder="Ej. 3" value={form.sesionesRealizadas} onChange={e => set("sesionesRealizadas", e.target.value)} />
          </div>
        </div>
      </div>

      {/* ESCALAS FUNCIONALES VALIDADAS (Outcome measures) */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">{"\uD83D\uDCCA"} Escalas funcionales validadas</h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Escala</Label>
            <select className={selectCls} value={outcomeScale} onChange={e => { setOutcomeScale(e.target.value); setOutcomeScores({}); }}>
              <option value="">Seleccionar escala…</option>
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
                  <span className="text-sm font-semibold">Resultado:</span>
                  <span className={`text-lg font-bold ${outcomeResult.color}`}>
                    {outcomeResult.sum} pts &middot; {outcomeResult.pct}% &middot; {outcomeResult.severity}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* EVALUACIÓN POSTURAL Y DE MARCHA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">{"\uD83E\uDDCD"} Evaluación postural y marcha</h3>
        <div className="space-y-4">
          {/* Vista anterior */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Vista anterior</p>
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
            <p className="text-xs font-semibold text-muted-foreground mb-2">Vista lateral</p>
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
            <p className="text-xs font-semibold text-muted-foreground mb-2">Vista posterior</p>
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
            <div className="space-y-1">
              <Label className="text-xs">Patrón de marcha</Label>
              <select className={selectCls} value={patronMarcha} onChange={e => setPatronMarcha(e.target.value)}>
                <option value="">Seleccionar…</option>
                {PATRONES_MARCHA.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          {/* Notas posturales */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notas posturales</Label>
            <textarea className={textareaCls}
              placeholder="Observaciones de postura y marcha…" value={notasPosturales} onChange={e => setNotasPosturales(e.target.value)} />
          </div>
        </div>
      </div>

      {/* NOTAS SOAP */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Notas SOAP</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Subjetivo</Label>
            <textarea className={textareaCls}
              placeholder="Lo que refiere el paciente…" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Objetivo</Label>
            <textarea className={textareaCls}
              placeholder="Hallazgos clínicos…" value={form.objective} onChange={e => set("objective", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Evaluación</Label>
            <textarea className={textareaCls}
              placeholder="Diagnóstico y evaluación…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <textarea className={textareaCls}
              placeholder="Plan de tratamiento…" value={form.plan} onChange={e => set("plan", e.target.value)} />
          </div>
        </div>
      </div>

      {/* SCORE FUNCIONAL */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Score funcional</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de score</Label>
            <select className={selectCls}
              value={form.scoreTipo} onChange={e => set("scoreTipo", e.target.value)}>
              <option value="">Seleccionar…</option>
              {SCORES_TIPO.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Score</Label>
            <input type="number" className={inputCls}
              placeholder="Valor numérico" value={form.scoreValor} onChange={e => set("scoreValor", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente fisioterapia"}
        </Button>
      </div>
    </div>
  );
}
