"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const PHQ9_QUESTIONS = [
  "Poco interés o placer en hacer cosas",
  "Sentirse decaído/a, deprimido/a o sin esperanza",
  "Dificultad para dormir o dormir demasiado",
  "Sentirse cansado/a o con poca energía",
  "Poco apetito o comer en exceso",
  "Sentirse mal consigo mismo/a o que es un fracaso",
  "Dificultad para concentrarse",
  "Moverse/hablar tan lento que otros lo notan, o lo contrario",
  "Pensamientos de hacerse daño o de que estaría mejor muerto/a",
];

const GAD7_QUESTIONS = [
  "Sentirse nervioso/a, ansioso/a o con los nervios de punta",
  "No poder dejar de preocuparse o no poder controlar la preocupación",
  "Preocuparse demasiado por diferentes cosas",
  "Dificultad para relajarse",
  "Estar tan inquieto/a que es difícil estar sentado/a tranquilo/a",
  "Molestarse o irritarse fácilmente",
  "Sentir miedo como si algo horrible fuera a pasar",
];

const FREQ_OPTIONS = ["Nunca (0)","Varios días (1)","Más de la mitad de los días (2)","Casi todos los días (3)"];
const ANXIETY_FREQ = ["Para nada (0)","Varios días (1)","Más de la mitad de los días (2)","Casi todos los días (3)"];

const THERAPY_APPROACHES = [
  "Terapia Cognitivo-Conductual (TCC)","Terapia Dialéctica Conductual (DBT)",
  "EMDR","Terapia de Aceptación y Compromiso (ACT)","Psicodinámica",
  "Humanista/Gestalt","Terapia Familiar Sistémica","Terapia de Exposición",
  "Mindfulness","Otro",
];

const DSM5_CATEGORIES = [
  "F32 - Trastorno depresivo mayor","F41.1 - Trastorno de ansiedad generalizada",
  "F40.10 - Fobia social","F41.0 - Trastorno de pánico","F43.1 - TEPT",
  "F42 - TOC","F50.0 - Anorexia nerviosa","F50.2 - Bulimia nerviosa",
  "F60.3 - Trastorno límite de personalidad","F90.0 - TDAH",
  "F20.9 - Esquizofrenia","F31 - Trastorno bipolar","F10 - Trastorno por uso de alcohol",
  "Z - Problema de relación / situacional","Otro",
];

const SESSION_TYPES = ["Primera vez / Evaluación inicial","Seguimiento","Crisis","Cierre de proceso","Supervisión"];

interface Props {
  patientId:   string;
  sessionNum:  number;
  onSaved:     (record: any) => void;
}

export function PsychologyForm({ patientId, sessionNum, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [phq9, setPhq9]     = useState<number[]>(new Array(9).fill(0));
  const [gad7, setGad7]     = useState<number[]>(new Array(7).fill(0));
  const [showScales, setShowScales] = useState(true);

  const phq9Score = phq9.reduce((a, b) => a + b, 0);
  const gad7Score = gad7.reduce((a, b) => a + b, 0);

  function phq9Severity(score: number) {
    if (score <= 4)  return { label: "Mínimo",   color: "text-emerald-600" };
    if (score <= 9)  return { label: "Leve",      color: "text-yellow-600" };
    if (score <= 14) return { label: "Moderado",  color: "text-orange-600" };
    if (score <= 19) return { label: "Moderado-severo", color: "text-red-600" };
    return { label: "Severo", color: "text-red-700 font-extrabold" };
  }
  function gad7Severity(score: number) {
    if (score <= 4)  return { label: "Mínimo",  color: "text-emerald-600" };
    if (score <= 9)  return { label: "Leve",    color: "text-yellow-600" };
    if (score <= 14) return { label: "Moderado",color: "text-orange-600" };
    return { label: "Severo", color: "text-red-700 font-extrabold" };
  }

  const [form, setForm] = useState({
    sessionType: SESSION_TYPES[0],
    chiefComplaint: "",
    currentState: "",
    suicidalIdeation: "no",
    suicidalPlan: "no",
    moodScale: "5",
    anxietyScale: "5",
    sleepQuality: "",
    appetiteChanges: "",
    socialFunctioning: "",
    workFunctioning: "",
    diagnosis: "",
    customDiagnosis: "",
    approach: THERAPY_APPROACHES[0],
    sessionContent: "",
    interventions: "",
    patientResponse: "",
    homework: "",
    plan: "",
    nextSession: "",
    sessionGoals: "",
    crisisProtocol: "no",
    referral: "",
    observations: "",
  });

  async function handleSave() {
    if (!form.sessionContent) { toast.error("Ingresa el contenido de la sesión"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.chiefComplaint || form.currentState,
          objective:  form.sessionContent,
          assessment: form.diagnosis || form.customDiagnosis,
          plan:       form.plan,
          vitals: {
            moodScale: form.moodScale,
            anxietyScale: form.anxietyScale,
            phq9Score, gad7Score,
          },
          specialtyData: {
            type: "psychology",
            sessionNumber: sessionNum,
            sessionType: form.sessionType,
            scales: { phq9: { answers: phq9, score: phq9Score, severity: phq9Severity(phq9Score).label },
                      gad7: { answers: gad7, score: gad7Score, severity: gad7Severity(gad7Score).label } },
            mentalStatus: {
              mood: form.moodScale, anxiety: form.anxietyScale,
              suicidalIdeation: form.suicidalIdeation, suicidalPlan: form.suicidalPlan,
              sleepQuality: form.sleepQuality, appetiteChanges: form.appetiteChanges,
              socialFunctioning: form.socialFunctioning, workFunctioning: form.workFunctioning,
            },
            diagnosis: form.diagnosis || form.customDiagnosis,
            approach: form.approach,
            interventions: form.interventions,
            patientResponse: form.patientResponse,
            homework: form.homework,
            sessionGoals: form.sessionGoals,
            crisisProtocol: form.crisisProtocol,
            referral: form.referral,
            nextSession: form.nextSession,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      toast.success("Sesión guardada correctamente");
      onSaved(record);
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Tipo de sesión */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Tipo de sesión — Sesión #{sessionNum}</Label>
          <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            value={form.sessionType} onChange={e => setForm(f => ({ ...f, sessionType: e.target.value }))}>
            {SESSION_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Enfoque terapéutico</Label>
          <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            value={form.approach} onChange={e => setForm(f => ({ ...f, approach: e.target.value }))}>
            {THERAPY_APPROACHES.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* Estado mental */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🧠 Estado mental actual</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div className="space-y-1">
            <Label>Ánimo (1-10)</Label>
            <div className="flex items-center gap-2">
              <input type="range" min="1" max="10" value={form.moodScale}
                onChange={e => setForm(f => ({ ...f, moodScale: e.target.value }))} className="flex-1" />
              <span className="text-sm font-bold w-6">{form.moodScale}</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Ansiedad (1-10)</Label>
            <div className="flex items-center gap-2">
              <input type="range" min="1" max="10" value={form.anxietyScale}
                onChange={e => setForm(f => ({ ...f, anxietyScale: e.target.value }))} className="flex-1" />
              <span className="text-sm font-bold w-6">{form.anxietyScale}</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Ideación suicida</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
              value={form.suicidalIdeation} onChange={e => setForm(f => ({ ...f, suicidalIdeation: e.target.value }))}>
              <option value="no">No</option>
              <option value="pasiva">Pasiva (sin plan)</option>
              <option value="activa">Activa (con plan)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Protocolo de crisis</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
              value={form.crisisProtocol} onChange={e => setForm(f => ({ ...f, crisisProtocol: e.target.value }))}>
              <option value="no">No requerido</option>
              <option value="si">Activado</option>
              <option value="referido">Referido a urgencias</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: "sleepQuality",     label: "Calidad del sueño" },
            { key: "appetiteChanges",  label: "Apetito" },
            { key: "socialFunctioning",label: "Funcionamiento social" },
            { key: "workFunctioning",  label: "Funcionamiento laboral/escolar" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none"
                value={(form as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {f.key === "sleepQuality"      && ["Buena","Regular","Mala","Insomnio","Hipersomnia"].map(o => <option key={o}>{o}</option>)}
                {f.key === "appetiteChanges"   && ["Normal","Aumentado","Disminuido","Sin apetito"].map(o => <option key={o}>{o}</option>)}
                {f.key === "socialFunctioning" && ["Conservado","Levemente afectado","Moderadamente afectado","Severamente afectado"].map(o => <option key={o}>{o}</option>)}
                {f.key === "workFunctioning"   && ["Conservado","Levemente afectado","Moderadamente afectado","Severamente afectado","Sin actividad"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Escalas PHQ-9 y GAD-7 */}
      <div className="rounded-xl border border-border overflow-hidden">
        <button onClick={() => setShowScales(!showScales)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 text-sm font-bold hover:bg-muted/50 transition-colors">
          <span>📋 Escalas PHQ-9 y GAD-7</span>
          <span className="text-xs text-muted-foreground">{showScales ? "▲ Ocultar" : "▼ Mostrar"}</span>
        </button>

        {showScales && (
          <div className="p-4 grid lg:grid-cols-2 gap-6">
            {/* PHQ-9 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold">PHQ-9 — Depresión</h4>
                <div className="text-right">
                  <span className={`text-xl font-extrabold ${phq9Severity(phq9Score).color}`}>{phq9Score}</span>
                  <span className="text-xs text-muted-foreground ml-1">/27</span>
                  <div className={`text-xs font-bold ${phq9Severity(phq9Score).color}`}>{phq9Severity(phq9Score).label}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado los siguientes problemas?</p>
              <div className="space-y-2">
                {PHQ9_QUESTIONS.map((q, i) => (
                  <div key={i} className="rounded-lg border border-border p-2">
                    <p className="text-xs font-medium mb-1.5">{i + 1}. {q}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {FREQ_OPTIONS.map((opt, val) => (
                        <label key={val} className={`flex items-center gap-1.5 text-[11px] cursor-pointer px-2 py-1 rounded transition-colors ${phq9[i] === val ? "bg-brand-50 text-brand-700 font-semibold" : "hover:bg-muted/50"}`}>
                          <input type="radio" name={`phq9-${i}`} value={val} checked={phq9[i] === val}
                            onChange={() => setPhq9(prev => { const n = [...prev]; n[i] = val; return n; })} className="w-3 h-3" />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* GAD-7 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold">GAD-7 — Ansiedad</h4>
                <div className="text-right">
                  <span className={`text-xl font-extrabold ${gad7Severity(gad7Score).color}`}>{gad7Score}</span>
                  <span className="text-xs text-muted-foreground ml-1">/21</span>
                  <div className={`text-xs font-bold ${gad7Severity(gad7Score).color}`}>{gad7Severity(gad7Score).label}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado los siguientes problemas?</p>
              <div className="space-y-2">
                {GAD7_QUESTIONS.map((q, i) => (
                  <div key={i} className="rounded-lg border border-border p-2">
                    <p className="text-xs font-medium mb-1.5">{i + 1}. {q}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {ANXIETY_FREQ.map((opt, val) => (
                        <label key={val} className={`flex items-center gap-1.5 text-[11px] cursor-pointer px-2 py-1 rounded transition-colors ${gad7[i] === val ? "bg-violet-50 text-violet-700 font-semibold" : "hover:bg-muted/50"}`}>
                          <input type="radio" name={`gad7-${i}`} value={val} checked={gad7[i] === val}
                            onChange={() => setGad7(prev => { const n = [...prev]; n[i] = val; return n; })} className="w-3 h-3" />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Diagnóstico */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico DSM-5 / CIE-10</Label>
          <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))}>
            <option value="">Seleccionar…</option>
            {DSM5_CATEGORIES.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Diagnóstico personalizado / Notas diagnósticas</Label>
          <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            placeholder="Especificar si aplica…"
            value={form.customDiagnosis} onChange={e => setForm(f => ({ ...f, customDiagnosis: e.target.value }))} />
        </div>
      </div>

      {/* Contenido de sesión */}
      <div className="space-y-1.5">
        <Label>Contenido de la sesión *</Label>
        <textarea className="flex min-h-[100px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          placeholder="El paciente llegó reportando... Se exploró... Se trabajó con la técnica de..."
          value={form.sessionContent} onChange={e => setForm(f => ({ ...f, sessionContent: e.target.value }))} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Intervenciones realizadas</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="Reestructuración cognitiva, exposición gradual, técnicas de relajación…"
            value={form.interventions} onChange={e => setForm(f => ({ ...f, interventions: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Respuesta del paciente</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="El paciente mostró resistencia inicial pero logró… Identificó el pensamiento automático…"
            value={form.patientResponse} onChange={e => setForm(f => ({ ...f, patientResponse: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Tareas / Tarea para casa</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="Registro de pensamientos automáticos, práctica de mindfulness 10 min/día…"
            value={form.homework} onChange={e => setForm(f => ({ ...f, homework: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan terapéutico / Próximos pasos</Label>
          <textarea className="flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-none focus:outline-none"
            placeholder="Continuar con técnicas de exposición, revisar tarea, explorar esquemas tempranos…"
            value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Referencia / Interconsulta</Label>
          <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            placeholder="Psiquiatría, neurología, médico general…"
            value={form.referral} onChange={e => setForm(f => ({ ...f, referral: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Próxima sesión</Label>
          <input type="date" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
            value={form.nextSession} onChange={e => setForm(f => ({ ...f, nextSession: e.target.value }))} />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full" size="lg">
        {saving ? "Guardando sesión…" : "💾 Guardar nota de sesión"}
      </Button>
    </div>
  );
}
