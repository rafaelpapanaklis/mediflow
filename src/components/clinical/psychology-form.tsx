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
          <div className="mt-3 p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-700 font-bold">
            ⚠️ Alerta: ideación suicida registrada. Evalúa protocolo de seguridad y documenta plan de crisis.
          </div>
        )}
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
