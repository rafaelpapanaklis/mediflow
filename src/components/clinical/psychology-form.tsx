"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const PHQ9_ITEMS = ["Poco interés en actividades","Sentirse deprimido/sin esperanza","Problemas para dormir","Sentirse cansado","Poco apetito o comer en exceso","Sentirse mal consigo mismo","Dificultad para concentrarse","Moverse/hablar lento, o agitación","Pensamientos de hacerse daño"];
const GAD7_ITEMS = ["Sentirse nervioso o ansioso","No poder parar de preocuparse","Preocuparse demasiado por cosas","Dificultad para relajarse","Tan inquieto que es difícil estar quieto","Irritarse o enojarse fácilmente","Sentir miedo de que algo malo pase"];
const PHQ9_SEVERITY = (s: number) => s <= 4 ? "Mínimo" : s <= 9 ? "Leve" : s <= 14 ? "Moderado" : s <= 19 ? "Moderado-severo" : "Severo";
const GAD7_SEVERITY = (s: number) => s <= 4 ? "Mínimo" : s <= 9 ? "Leve" : s <= 14 ? "Moderado" : "Severo";
const PHQ9_COLOR   = (s: number) => s <= 4 ? "text-emerald-600" : s <= 9 ? "text-amber-600" : "text-rose-600";
const GAD7_COLOR   = (s: number) => s <= 4 ? "text-emerald-600" : s <= 9 ? "text-amber-600" : "text-rose-600";
const NOTE_TYPES   = ["SOAP","BIRP","DAP"];
const APPROACHES   = ["TCC (Cognitivo-conductual)","Psicodinámico","Humanista","Gestalt","EMDR","Mindfulness","DBT","ACT","Sistémico","Otro"];
const SESSION_TYPES = ["Individual","Pareja","Familia","Grupo","Evaluación inicial","Seguimiento","Alta"];

interface Props { patientId: string; sessionNum: number; onSaved: (record: any) => void }

export function PsychologyForm({ patientId, sessionNum, onSaved }: Props) {
  const [saving,     setSaving]   = useState(false);
  const [noteType,   setNoteType] = useState("SOAP");
  const [phq9,       setPHQ9]     = useState<number[]>(new Array(9).fill(0));
  const [gad7,       setGAD7]     = useState<number[]>(new Array(7).fill(0));
  const [applyScales, setApplyScales] = useState(true);
  const [waisr,      setWaisr]    = useState<number[]>(new Array(4).fill(0));
  const [auditC,     setAuditC]   = useState<number[]>(new Array(3).fill(0));
  const [dastPositive, setDastPositive] = useState(false);
  const [dastDetail, setDastDetail] = useState("");
  const [safetyPlan, setSafetyPlan] = useState({
    warningSignals: "", copingStrategies: "", supportPeople: "",
    emergencyContacts: "", meansRestriction: "", reasonToLive: "",
  });
  const [form, setForm] = useState({
    sessionType: SESSION_TYPES[0], approach: APPROACHES[0],
    subjective: "", objective: "", assessment: "", plan: "",
    birp_behavior: "", birp_intervention: "", birp_response: "", birp_plan: "",
    dap_data: "", dap_assessment: "", dap_plan: "",
    mentalStatus: { sleepQuality: "", appetiteChanges: "", socialFunctioning: "", workFunctioning: "", suicidalIdeation: "no", mood: "" },
    interventions: "", patientResponse: "", homework: "", nextGoal: "",
    treatmentGoals: [{ goal: "", status: "En progreso" }],
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setMS = (k: string, v: string) => setForm(f => ({ ...f, mentalStatus: { ...f.mentalStatus, [k]: v } }));

  const phq9Score = phq9.reduce((a, b) => a + b, 0);
  const gad7Score = gad7.reduce((a, b) => a + b, 0);
  const auditCScore = auditC.reduce((a, b) => a + b, 0);
  const waisrRated = waisr.filter(v => v > 0);
  const waisrAvg = waisrRated.length > 0 ? waisrRated.reduce((a, b) => a + b, 0) / waisrRated.length : 0;
  const waisrLabel = waisrAvg <= 2 ? "Débil — requiere atención" : waisrAvg <= 3.5 ? "Moderada — en desarrollo" : "Fuerte";
  const waisrColor = waisrAvg <= 2 ? "text-rose-600 dark:text-rose-400" : waisrAvg <= 3.5 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  const auditCLabel = auditCScore < 3 ? "Bajo riesgo" : auditCScore <= 7 ? "Riesgo moderado" : "Alto riesgo";
  const auditCColor = auditCScore < 3 ? "text-emerald-600 dark:text-emerald-400" : auditCScore <= 7 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";

  function addGoal() { set("treatmentGoals", [...form.treatmentGoals, { goal: "", status: "En progreso" }]); }

  async function handleSave() {
    if (!form.subjective && !form.objective && !form.dap_data) { toast.error("Completa al menos el contenido de la sesión"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: noteType === "SOAP" ? form.subjective : noteType === "BIRP" ? form.birp_behavior : form.dap_data,
          objective:  noteType === "SOAP" ? form.objective  : noteType === "BIRP" ? form.birp_intervention : "",
          assessment: noteType === "SOAP" ? form.assessment : noteType === "BIRP" ? form.birp_response : form.dap_assessment,
          plan:       noteType === "SOAP" ? form.plan       : noteType === "BIRP" ? form.birp_plan : form.dap_plan,
          specialtyData: {
            type: "psychology", noteType, sessionNumber: sessionNum,
            sessionType: form.sessionType, approach: form.approach,
            scales: applyScales ? {
              phq9: { score: phq9Score, items: phq9, severity: PHQ9_SEVERITY(phq9Score) },
              gad7: { score: gad7Score, items: gad7, severity: GAD7_SEVERITY(gad7Score) },
            } : undefined,
            mentalStatus: form.mentalStatus,
            waisr: { items: waisr, average: waisrRated.length > 0 ? Number(waisrAvg.toFixed(1)) : null, interpretation: waisrRated.length > 0 ? waisrLabel : null },
            substanceScreening: {
              auditC: { items: auditC, score: auditCScore, interpretation: auditCLabel },
              dast: { positive: dastPositive, detail: dastPositive ? dastDetail : undefined },
            },
            safetyPlan: form.mentalStatus.suicidalIdeation !== "no" ? safetyPlan : undefined,
            interventions: form.interventions,
            patientResponse: form.patientResponse,
            homework: form.homework,
            nextGoal: form.nextGoal,
            treatmentGoals: form.treatmentGoals.filter(g => g.goal),
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Sesión guardada");
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setSaving(false); }
  }

  const ScaleQuestion = ({ items, values, onChange, label }: { items: string[]; values: number[]; onChange: (i: number, v: number) => void; label: string }) => (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1 text-[10px] font-bold text-center text-muted-foreground mb-1">
        <span></span><span>Nunca (0)</span><span>Varios días (1)</span><span>Más de la mitad (2)</span><span>Casi todos (3)</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-5 gap-1 items-center text-xs">
          <span className="text-foreground leading-tight">{item}</span>
          {[0,1,2,3].map(v => (
            <button key={v} onClick={() => onChange(i, v)}
              className={`h-7 rounded-lg border text-xs font-bold transition-all ${values[i] === v ? "bg-brand-600 text-white border-brand-600" : "bg-white border-border hover:border-brand-300"}`}>
              {v}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sesión info */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Sesión #</Label>
          <div className="h-10 flex items-center px-3 rounded-lg bg-muted border border-border text-sm font-bold">{sessionNum}</div>
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de sesión</Label>
          <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            value={form.sessionType} onChange={e => set("sessionType", e.target.value)}>
            {SESSION_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Enfoque terapéutico</Label>
          <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            value={form.approach} onChange={e => set("approach", e.target.value)}>
            {APPROACHES.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* Note type selector */}
      <div className="flex gap-1 bg-muted rounded-xl p-1 w-fit">
        {NOTE_TYPES.map(t => (
          <button key={t} onClick={() => setNoteType(t)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${noteType === t ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Nota {t}
          </button>
        ))}
      </div>

      {/* SOAP note */}
      {noteType === "SOAP" && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { key:"subjective", label:"S — Subjetivo (reporte del paciente)", ph:"¿Cómo se siente? ¿Qué comenta hoy?" },
            { key:"objective",  label:"O — Objetivo (observaciones del terapeuta)", ph:"Estado anímico, lenguaje no verbal, comportamiento…" },
            { key:"assessment", label:"A — Evaluación / Diagnóstico", ph:"Diagnóstico DSM-5, hipótesis clínica…" },
            { key:"plan",       label:"P — Plan terapéutico", ph:"Intervenciones, tareas, objetivos próxima sesión…" },
          ].map(f => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <textarea className="flex min-h-[90px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder={f.ph} value={(form as any)[f.key]} onChange={e => set(f.key, e.target.value)} />
            </div>
          ))}
        </div>
      )}

      {/* BIRP note */}
      {noteType === "BIRP" && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { key:"birp_behavior",     label:"B — Comportamiento del paciente",  ph:"Conductas observadas, verbalizaciones…" },
            { key:"birp_intervention", label:"I — Intervenciones del terapeuta", ph:"Técnicas aplicadas, preguntas clave…" },
            { key:"birp_response",     label:"R — Respuesta del paciente",       ph:"Cómo reaccionó a las intervenciones…" },
            { key:"birp_plan",         label:"P — Plan",                         ph:"Próximos pasos, tarea para casa…" },
          ].map(f => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <textarea className="flex min-h-[90px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder={f.ph} value={(form as any)[f.key]} onChange={e => set(f.key, e.target.value)} />
            </div>
          ))}
        </div>
      )}

      {/* DAP note */}
      {noteType === "DAP" && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { key:"dap_data",       label:"D — Datos de la sesión",    ph:"Lo que ocurrió en la sesión…" },
            { key:"dap_assessment", label:"A — Evaluación clínica",   ph:"Interpretación clínica…" },
            { key:"dap_plan",       label:"P — Plan",                  ph:"Intervenciones futuras…" },
          ].map(f => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <textarea className="flex min-h-[100px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder={f.ph} value={(form as any)[f.key]} onChange={e => set(f.key, e.target.value)} />
            </div>
          ))}
        </div>
      )}

      {/* Estado mental */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Estado mental</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { key:"mood",              label:"Estado de ánimo",          opts:["Eutímico","Deprimido","Ansioso","Irritable","Expansivo","Lábil"] },
            { key:"sleepQuality",      label:"Calidad del sueño",        opts:["Buena","Regular","Mala","Insomnio","Hipersomnia"] },
            { key:"appetiteChanges",   label:"Apetito",                  opts:["Normal","Aumentado","Disminuido","Sin cambios"] },
            { key:"socialFunctioning", label:"Funcionamiento social",    opts:["Adecuado","Levemente afectado","Moderadamente afectado","Severamente afectado"] },
            { key:"workFunctioning",   label:"Funcionamiento laboral/académico", opts:["Adecuado","Levemente afectado","Moderadamente afectado","Severamente afectado","Sin actividad"] },
            { key:"suicidalIdeation",  label:"Ideación suicida / autolesión", opts:["no","Pasiva","Activa sin plan","Activa con plan"] },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <select className={`flex h-9 w-full rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 ${f.key === "suicidalIdeation" && form.mentalStatus.suicidalIdeation !== "no" ? "border-rose-400 bg-rose-50" : "border-border bg-white"}`}
                value={(form.mentalStatus as any)[f.key]} onChange={e => setMS(f.key, e.target.value)}>
                {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
        {form.mentalStatus.suicidalIdeation !== "no" && (
          <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-bold">
            ⚠️ Alerta: ideación suicida registrada. Evalúa protocolo de seguridad y documenta plan de crisis.
          </div>
        )}
      </div>

      {/* Plan de seguridad — solo si ideación suicida */}
      {form.mentalStatus.suicidalIdeation !== "no" && (
        <div className="rounded-xl border-2 border-rose-400 dark:border-rose-600 p-4 bg-white dark:bg-card">
          <h3 className="text-sm font-bold mb-3 text-rose-700 dark:text-rose-300">🚨 Plan de seguridad</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { key: "warningSignals",    label: "Señales de advertencia",                   ph: "¿Qué pensamientos, sentimientos o situaciones detonan la crisis?" },
              { key: "copingStrategies",  label: "Estrategias de afrontamiento internas",    ph: "Cosas que puedo hacer solo/a para distraerme" },
              { key: "supportPeople",     label: "Personas de apoyo",                        ph: "Nombres y teléfonos de personas a quién llamar" },
              { key: "emergencyContacts", label: "Contactos profesionales de emergencia",    ph: "Línea de crisis, terapeuta de guardia, hospital" },
              { key: "meansRestriction",  label: "Restricción de medios letales",            ph: "Pasos para limitar acceso a medios" },
              { key: "reasonToLive",      label: "Razón para vivir",                         ph: "Lo más importante para mí en este momento" },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <textarea
                  className="flex min-h-[70px] w-full rounded-lg border border-border dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/20 resize-none"
                  placeholder={f.ph}
                  value={(safetyPlan as any)[f.key]}
                  onChange={e => setSafetyPlan(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alianza terapéutica (WAI-SR simplificada) */}
      <div className="rounded-xl border border-border p-4 bg-white dark:bg-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🤝 Alianza terapéutica</h3>
          {waisrRated.length > 0 && (
            <div className="text-right">
              <span className={`text-lg font-extrabold ${waisrColor}`}>{waisrAvg.toFixed(1)}</span>
              <span className={`text-xs font-bold ml-1 ${waisrColor}`}>{waisrLabel}</span>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-6 gap-1 text-[10px] font-bold text-center text-muted-foreground mb-1">
            <span></span><span>Nunca (1)</span><span>Rara vez (2)</span><span>A veces (3)</span><span>Frecuente (4)</span><span>Siempre (5)</span>
          </div>
          {[
            "El paciente y yo trabajamos hacia metas mutuamente acordadas",
            "Se ha establecido un vínculo de confianza y respeto mutuo",
            "Hay acuerdo sobre las tareas y métodos del tratamiento",
            "El paciente se siente comprendido en la relación terapéutica",
          ].map((item, i) => (
            <div key={i} className="grid grid-cols-6 gap-1 items-center text-xs">
              <span className="text-foreground leading-tight">{item}</span>
              {[1,2,3,4,5].map(v => (
                <button key={v} onClick={() => { const n = [...waisr]; n[i] = v; setWaisr(n); }}
                  className={`h-7 rounded-lg border text-xs font-bold transition-all ${waisr[i] === v ? "bg-brand-600 text-white border-brand-600 dark:bg-brand-500 dark:border-brand-500" : "bg-white dark:bg-muted border-border hover:border-brand-300 dark:hover:border-brand-400"}`}>
                  {v}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Escalas PHQ-9 y GAD-7 */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold">Escalas de evaluación estandarizadas</h3>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" checked={applyScales} onChange={e => setApplyScales(e.target.checked)} className="accent-brand-600" />
            Aplicar escalas esta sesión
          </label>
        </div>
        {applyScales && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">PHQ-9 · Depresión</h4>
                <div className="text-right">
                  <span className={`text-lg font-extrabold ${PHQ9_COLOR(phq9Score)}`}>{phq9Score}</span>
                  <span className={`text-xs font-bold ml-1 ${PHQ9_COLOR(phq9Score)}`}>{PHQ9_SEVERITY(phq9Score)}</span>
                </div>
              </div>
              <ScaleQuestion items={PHQ9_ITEMS} values={phq9} onChange={(i, v) => { const n = [...phq9]; n[i] = v; setPHQ9(n); }} label="PHQ-9" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">GAD-7 · Ansiedad</h4>
                <div className="text-right">
                  <span className={`text-lg font-extrabold ${GAD7_COLOR(gad7Score)}`}>{gad7Score}</span>
                  <span className={`text-xs font-bold ml-1 ${GAD7_COLOR(gad7Score)}`}>{GAD7_SEVERITY(gad7Score)}</span>
                </div>
              </div>
              <ScaleQuestion items={GAD7_ITEMS} values={gad7} onChange={(i, v) => { const n = [...gad7]; n[i] = v; setGAD7(n); }} label="GAD-7" />
            </div>
          </div>
        )}
      </div>

      {/* Screening de sustancias */}
      <div className="rounded-xl border border-border p-4 bg-white dark:bg-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🍷 Screening de sustancias</h3>
          <div className="text-right">
            <span className={`text-lg font-extrabold ${auditCColor}`}>{auditCScore}</span>
            <span className={`text-xs font-bold ml-1 ${auditCColor}`}>{auditCLabel}</span>
          </div>
        </div>

        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">AUDIT-C</h4>
        <div className="space-y-2 mb-4">
          {[
            { label: "Frecuencia de consumo de alcohol", opts: ["Nunca (0)","Mensual o menos (1)","2-4 veces/mes (2)","2-3 veces/semana (3)","4+ veces/semana (4)"] },
            { label: "Cantidad habitual de tragos por ocasión", opts: ["1-2 (0)","3-4 (1)","5-6 (2)","7-9 (3)","10+ (4)"] },
            { label: "Frecuencia de consumo excesivo (6+ tragos)", opts: ["Nunca (0)","Menos de mensual (1)","Mensual (2)","Semanal (3)","Diario o casi (4)"] },
          ].map((q, i) => (
            <div key={i} className="space-y-1">
              <Label className="text-xs">{q.label}</Label>
              <select
                className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-muted px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={auditC[i]}
                onChange={e => { const n = [...auditC]; n[i] = Number(e.target.value); setAuditC(n); }}>
                {q.opts.map((o, v) => <option key={v} value={v}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>

        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">DAST-10 (simplificado)</h4>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={dastPositive} onChange={e => setDastPositive(e.target.checked)} className="accent-brand-600" />
            ¿El paciente reporta uso de sustancias no prescritas?
          </label>
          {dastPositive && (
            <div className="space-y-1">
              <Label className="text-xs">Detalle de sustancias y frecuencia</Label>
              <textarea
                className="flex min-h-[70px] w-full rounded-lg border border-border dark:border-border bg-white dark:bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder="Ej: Cannabis 3 veces/semana, cocaína uso esporádico..."
                value={dastDetail}
                onChange={e => setDastDetail(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Plan terapéutico con metas */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🎯 Objetivos terapéuticos</h3>
          <button onClick={addGoal} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar meta</button>
        </div>
        <div className="space-y-2">
          {form.treatmentGoals.map((g, i) => (
            <div key={i} className="flex gap-2">
              <input className="flex-1 h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder={`Meta ${i+1}: Reducir ansiedad ante situaciones sociales…`}
                value={g.goal} onChange={e => { const goals = [...form.treatmentGoals]; goals[i].goal = e.target.value; set("treatmentGoals", goals); }} />
              <select className="h-9 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none"
                value={g.status} onChange={e => { const goals = [...form.treatmentGoals]; goals[i].status = e.target.value; set("treatmentGoals", goals); }}>
                {["En progreso","Logrado","Abandonado","Nuevo"].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          <div className="space-y-1"><Label className="text-xs">Tarea para casa / Actividades entre sesiones</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Registro de pensamientos automáticos, técnica de respiración diafragmática…"
              value={form.homework} onChange={e => set("homework", e.target.value)} />
          </div>
          <div className="space-y-1"><Label className="text-xs">Objetivo para próxima sesión</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Trabajar técnica de exposición gradual…"
              value={form.nextGoal} onChange={e => set("nextGoal", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "💾 Guardar sesión de psicología"}
        </Button>
      </div>
    </div>
  );
}
