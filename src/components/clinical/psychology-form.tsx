"use client";
import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { AlertTriangle } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { EvolutionChart, RecurringCalendar } from "@/components/clinical/shared";

const PHQ9_ITEMS = ["Poco interés en actividades","Sentirse deprimido/sin esperanza","Problemas para dormir","Sentirse cansado","Poco apetito o comer en exceso","Sentirse mal consigo mismo","Dificultad para concentrarse","Moverse/hablar lento, o agitación","Pensamientos de hacerse daño"];
const GAD7_ITEMS = ["Sentirse nervioso o ansioso","No poder parar de preocuparse","Preocuparse demasiado por cosas","Dificultad para relajarse","Tan inquieto que es difícil estar quieto","Irritarse o enojarse fácilmente","Sentir miedo de que algo malo pase"];
const PHQ9_SEVERITY = (s: number) => s <= 4 ? "Mínima" : s <= 9 ? "Leve" : s <= 14 ? "Moderada" : s <= 19 ? "Moderadamente severa" : "Severa";
const GAD7_SEVERITY = (s: number) => s <= 4 ? "Mínima" : s <= 9 ? "Leve" : s <= 14 ? "Moderada" : "Severa";
const PHQ9_TONE = (s: number): "success" | "info" | "warning" | "danger" => s <= 4 ? "success" : s <= 9 ? "info" : s <= 14 ? "warning" : "danger";
const GAD7_TONE = (s: number): "success" | "info" | "warning" | "danger" => s <= 4 ? "success" : s <= 9 ? "info" : s <= 14 ? "warning" : "danger";
const NOTE_TYPES   = ["SOAP","BIRP","DAP"] as const;
const APPROACHES   = ["TCC (Cognitivo-conductual)","Psicodinámico","Humanista","Gestalt","EMDR","Mindfulness","DBT","ACT","Sistémico","Otro"];
const SESSION_TYPES = ["Individual","Pareja","Familia","Grupo","Evaluación inicial","Seguimiento","Alta"];

interface Props { patientId: string; sessionNum: number; onSaved: (record: any) => void }

export function PsychologyForm({ patientId, sessionNum, onSaved }: Props) {
  const [saving,     setSaving]   = useState(false);
  const [noteType,   setNoteType] = useState<typeof NOTE_TYPES[number]>("SOAP");
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
  const waisrTone: "success" | "warning" | "danger" = waisrAvg <= 2 ? "danger" : waisrAvg <= 3.5 ? "warning" : "success";
  const auditCLabel = auditCScore < 3 ? "Bajo riesgo" : auditCScore <= 7 ? "Riesgo moderado" : "Alto riesgo";
  const auditCTone: "success" | "warning" | "danger" = auditCScore < 3 ? "success" : auditCScore <= 7 ? "warning" : "danger";

  const highRisk = applyScales && (phq9Score >= 20 || phq9[8] > 0 || form.mentalStatus.suicidalIdeation !== "no");

  function addGoal() { set("treatmentGoals", [...form.treatmentGoals, { goal: "", status: "En progreso" }]); }

  async function handleSave() {
    if (!form.subjective && !form.objective && !form.dap_data && !form.birp_behavior) {
      toast.error("Completa al menos el contenido de la sesión");
      return;
    }
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

  // Helper para una pregunta de escala (PHQ-9 / GAD-7) con segment 0-3
  const ScaleItem = ({ idx, label, values, onChange }: {
    idx: number; label: string; values: number[]; onChange: (v: number) => void;
  }) => (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: 12,
      alignItems: "center",
      padding: "10px 0",
      borderBottom: "1px solid var(--border-soft)",
    }}>
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>
        <span className="mono" style={{ color: "var(--text-4)", marginRight: 6 }}>{idx + 1}.</span>
        {label}
      </div>
      <div className="segment-new">
        {[0, 1, 2, 3].map(v => (
          <button
            key={v}
            type="button"
            className={`segment-new__btn ${values[idx] === v ? "segment-new__btn--active" : ""}`}
            onClick={() => onChange(v)}
            style={{ minWidth: 24 }}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Sesión info */}
      <CardNew title="Información de la sesión">
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Sesión</label>
            <div className="input-new mono" style={{ display: "flex", alignItems: "center", fontWeight: 600, minWidth: 60, justifyContent: "center" }}>
              #{sessionNum}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">Tipo de sesión</label>
            <select className="input-new" value={form.sessionType} onChange={e => set("sessionType", e.target.value)}>
              {SESSION_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Enfoque terapéutico</label>
            <select className="input-new" value={form.approach} onChange={e => set("approach", e.target.value)}>
              {APPROACHES.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      {/* Formato de notas */}
      <CardNew title="Formato de notas">
        <div className="segment-new">
          {NOTE_TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={`segment-new__btn ${noteType === t ? "segment-new__btn--active" : ""}`}
              onClick={() => setNoteType(t)}
            >
              Nota {t}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Notas de sesión */}
      <CardNew title="Notas de sesión">
        {noteType === "SOAP" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
            {[
              { key: "subjective", label: "S — Subjetivo (reporte del paciente)",     ph: "¿Cómo se siente? ¿Qué comenta hoy?" },
              { key: "objective",  label: "O — Objetivo (observaciones del terapeuta)", ph: "Estado anímico, lenguaje no verbal…" },
              { key: "assessment", label: "A — Evaluación / Diagnóstico",               ph: "Diagnóstico DSM-5, hipótesis clínica…" },
              { key: "plan",       label: "P — Plan terapéutico",                       ph: "Intervenciones, tareas, objetivos…" },
            ].map(f => (
              <div key={f.key} className="field-new">
                <label className="field-new__label">{f.label}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 100, padding: "10px 12px", height: "auto", resize: "vertical" }}
                  placeholder={f.ph}
                  value={(form as any)[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        {noteType === "BIRP" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
            {[
              { key: "birp_behavior",     label: "B — Comportamiento del paciente",  ph: "Conductas observadas, verbalizaciones…" },
              { key: "birp_intervention", label: "I — Intervenciones del terapeuta", ph: "Técnicas aplicadas, preguntas clave…" },
              { key: "birp_response",     label: "R — Respuesta del paciente",       ph: "Cómo reaccionó a las intervenciones…" },
              { key: "birp_plan",         label: "P — Plan",                         ph: "Próximos pasos, tarea para casa…" },
            ].map(f => (
              <div key={f.key} className="field-new">
                <label className="field-new__label">{f.label}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 100, padding: "10px 12px", height: "auto", resize: "vertical" }}
                  placeholder={f.ph}
                  value={(form as any)[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        {noteType === "DAP" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
            {[
              { key: "dap_data",       label: "D — Datos de la sesión", ph: "Lo que ocurrió en la sesión…" },
              { key: "dap_assessment", label: "A — Evaluación clínica", ph: "Interpretación clínica…" },
              { key: "dap_plan",       label: "P — Plan",               ph: "Intervenciones futuras…" },
            ].map(f => (
              <div key={f.key} className="field-new">
                <label className="field-new__label">{f.label}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 110, padding: "10px 12px", height: "auto", resize: "vertical" }}
                  placeholder={f.ph}
                  value={(form as any)[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </CardNew>

      {/* Estado mental */}
      <CardNew title="Estado mental">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          {[
            { key: "mood",              label: "Estado de ánimo",                  opts: ["", "Eutímico", "Deprimido", "Ansioso", "Irritable", "Expansivo", "Lábil"] },
            { key: "sleepQuality",      label: "Calidad del sueño",                opts: ["", "Buena", "Regular", "Mala", "Insomnio", "Hipersomnia"] },
            { key: "appetiteChanges",   label: "Apetito",                          opts: ["", "Normal", "Aumentado", "Disminuido", "Sin cambios"] },
            { key: "socialFunctioning", label: "Funcionamiento social",            opts: ["", "Adecuado", "Levemente afectado", "Moderadamente afectado", "Severamente afectado"] },
            { key: "workFunctioning",   label: "Funcionamiento laboral/académico", opts: ["", "Adecuado", "Levemente afectado", "Moderadamente afectado", "Severamente afectado", "Sin actividad"] },
            { key: "suicidalIdeation",  label: "Ideación suicida / autolesión",    opts: ["no", "Pasiva", "Activa sin plan", "Activa con plan"] },
          ].map(f => {
            const alert = f.key === "suicidalIdeation" && form.mentalStatus.suicidalIdeation !== "no";
            return (
              <div key={f.key} className="field-new">
                <label className="field-new__label">{f.label}</label>
                <select
                  className="input-new"
                  style={alert ? { borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.06)" } : undefined}
                  value={(form.mentalStatus as any)[f.key]}
                  onChange={e => setMS(f.key, e.target.value)}
                >
                  {f.opts.map(o => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </CardNew>

      {/* Alerta de riesgo alto */}
      {highRisk && (
        <div style={{
          padding: 14,
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: "var(--radius-lg)",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}>
          <AlertTriangle size={20} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5" }}>Riesgo alto detectado</div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4, lineHeight: 1.55 }}>
              {phq9Score >= 20 && <>Score PHQ-9 severo ({phq9Score}/27). </>}
              {phq9[8] > 0 && <>Ideación suicida en PHQ-9 (pregunta 9). </>}
              {form.mentalStatus.suicidalIdeation !== "no" && form.mentalStatus.suicidalIdeation !== "" && <>Ideación reportada: {form.mentalStatus.suicidalIdeation}. </>}
              Completa el plan de seguridad abajo y documenta la intervención en el plan terapéutico.
            </div>
          </div>
        </div>
      )}

      {/* Plan de seguridad — solo si ideación suicida */}
      {form.mentalStatus.suicidalIdeation !== "no" && form.mentalStatus.suicidalIdeation !== "" && (
        <CardNew title="Plan de seguridad" sub="Protocolo de crisis para ideación suicida">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
            {[
              { key: "warningSignals",    label: "Señales de advertencia",                ph: "Pensamientos, sentimientos o situaciones que detonan la crisis" },
              { key: "copingStrategies",  label: "Estrategias de afrontamiento internas", ph: "Cosas que puede hacer solo/a para distraerse" },
              { key: "supportPeople",     label: "Personas de apoyo",                     ph: "Nombres y teléfonos a quién llamar" },
              { key: "emergencyContacts", label: "Contactos profesionales de emergencia", ph: "Línea de crisis, terapeuta de guardia, hospital" },
              { key: "meansRestriction",  label: "Restricción de medios letales",         ph: "Pasos para limitar acceso a medios" },
              { key: "reasonToLive",      label: "Razón para vivir",                      ph: "Lo más importante para el paciente" },
            ].map(f => (
              <div key={f.key} className="field-new">
                <label className="field-new__label">{f.label}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder={f.ph}
                  value={(safetyPlan as any)[f.key]}
                  onChange={e => setSafetyPlan(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </CardNew>
      )}

      {/* Alianza terapéutica WAI-SR */}
      <CardNew
        title="Alianza terapéutica (WAI-SR)"
        action={
          waisrRated.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{waisrAvg.toFixed(1)}/5</span>
              <BadgeNew tone={waisrTone} dot>{waisrLabel}</BadgeNew>
            </div>
          ) : undefined
        }
      >
        <div style={{
          display: "grid",
          gridTemplateColumns: "auto repeat(5, auto)",
          gap: 8,
          fontSize: 9,
          color: "var(--text-4)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
          marginBottom: 8,
        }}>
          <span />
          <span style={{ textAlign: "center" }}>Nunca 1</span>
          <span style={{ textAlign: "center" }}>Rara vez 2</span>
          <span style={{ textAlign: "center" }}>A veces 3</span>
          <span style={{ textAlign: "center" }}>Frecuente 4</span>
          <span style={{ textAlign: "center" }}>Siempre 5</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "El paciente y yo trabajamos hacia metas mutuamente acordadas",
            "Se ha establecido un vínculo de confianza y respeto mutuo",
            "Hay acuerdo sobre las tareas y métodos del tratamiento",
            "El paciente se siente comprendido en la relación terapéutica",
          ].map((item, i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "center",
              paddingBottom: 8,
              borderBottom: "1px solid var(--border-soft)",
            }}>
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>{item}</div>
              <div className="segment-new">
                {[1, 2, 3, 4, 5].map(v => (
                  <button
                    key={v}
                    type="button"
                    className={`segment-new__btn ${waisr[i] === v ? "segment-new__btn--active" : ""}`}
                    onClick={() => { const n = [...waisr]; n[i] = v; setWaisr(n); }}
                    style={{ minWidth: 24 }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardNew>

      {/* Escalas PHQ-9 y GAD-7 */}
      <CardNew
        title="Escalas estandarizadas"
        action={
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={applyScales} onChange={e => setApplyScales(e.target.checked)} />
            Aplicar esta sesión
          </label>
        }
      >
        {!applyScales ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            Escalas desactivadas para esta sesión.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* PHQ-9 */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, margin: 0 }}>
                  PHQ-9 · Depresión
                </h4>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{phq9Score}/27</span>
                  <BadgeNew tone={PHQ9_TONE(phq9Score)} dot>{PHQ9_SEVERITY(phq9Score)}</BadgeNew>
                </div>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "auto repeat(4, auto)",
                gap: 8,
                fontSize: 9,
                color: "var(--text-4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
                marginBottom: 4,
              }}>
                <span />
                <span style={{ textAlign: "center" }}>Nunca</span>
                <span style={{ textAlign: "center" }}>Varios días</span>
                <span style={{ textAlign: "center" }}>Mitad del tiempo</span>
                <span style={{ textAlign: "center" }}>Casi todos</span>
              </div>
              {PHQ9_ITEMS.map((item, i) => (
                <ScaleItem
                  key={i}
                  idx={i}
                  label={item}
                  values={phq9}
                  onChange={v => { const n = [...phq9]; n[i] = v; setPHQ9(n); }}
                />
              ))}
            </div>

            {/* GAD-7 */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, margin: 0 }}>
                  GAD-7 · Ansiedad
                </h4>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{gad7Score}/21</span>
                  <BadgeNew tone={GAD7_TONE(gad7Score)} dot>{GAD7_SEVERITY(gad7Score)}</BadgeNew>
                </div>
              </div>
              {GAD7_ITEMS.map((item, i) => (
                <ScaleItem
                  key={i}
                  idx={i}
                  label={item}
                  values={gad7}
                  onChange={v => { const n = [...gad7]; n[i] = v; setGAD7(n); }}
                />
              ))}
            </div>
          </div>
        )}
      </CardNew>

      {/* Screening sustancias */}
      <CardNew
        title="Screening de sustancias"
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{auditCScore}/12</span>
            <BadgeNew tone={auditCTone} dot>{auditCLabel}</BadgeNew>
          </div>
        }
      >
        <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginTop: 0, marginBottom: 10 }}>
          AUDIT-C (alcohol)
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 18 }}>
          {[
            { label: "Frecuencia de consumo de alcohol",           opts: ["Nunca (0)", "Mensual o menos (1)", "2-4 veces/mes (2)", "2-3 veces/semana (3)", "4+ veces/semana (4)"] },
            { label: "Cantidad habitual de tragos por ocasión",    opts: ["1-2 (0)", "3-4 (1)", "5-6 (2)", "7-9 (3)", "10+ (4)"] },
            { label: "Frecuencia de consumo excesivo (6+ tragos)", opts: ["Nunca (0)", "Menos de mensual (1)", "Mensual (2)", "Semanal (3)", "Diario o casi (4)"] },
          ].map((q, i) => (
            <div key={i} className="field-new">
              <label className="field-new__label">{q.label}</label>
              <select
                className="input-new"
                value={auditC[i]}
                onChange={e => { const n = [...auditC]; n[i] = Number(e.target.value); setAuditC(n); }}
              >
                {q.opts.map((o, v) => <option key={v} value={v}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>

        <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
          DAST (otras sustancias)
        </h4>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-1)", cursor: "pointer", marginBottom: 10 }}>
          <input type="checkbox" checked={dastPositive} onChange={e => setDastPositive(e.target.checked)} />
          ¿El paciente reporta uso de sustancias no prescritas?
        </label>
        {dastPositive && (
          <div className="field-new">
            <label className="field-new__label">Detalle de sustancias y frecuencia</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Ej: Cannabis 3 veces/semana, cocaína uso esporádico…"
              value={dastDetail}
              onChange={e => setDastDetail(e.target.value)}
            />
          </div>
        )}
      </CardNew>

      {/* Plan terapéutico */}
      <CardNew
        title="Plan terapéutico"
        action={<ButtonNew size="sm" variant="ghost" onClick={addGoal}>+ Agregar meta</ButtonNew>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {form.treatmentGoals.map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="field-new" style={{ flex: 1 }}>
                <label className="field-new__label">Meta {i + 1}</label>
                <input
                  className="input-new"
                  placeholder="Reducir ansiedad ante situaciones sociales…"
                  value={g.goal}
                  onChange={e => { const goals = [...form.treatmentGoals]; goals[i].goal = e.target.value; set("treatmentGoals", goals); }}
                />
              </div>
              <div className="field-new" style={{ width: 140 }}>
                <label className="field-new__label">Estado</label>
                <select
                  className="input-new"
                  value={g.status}
                  onChange={e => { const goals = [...form.treatmentGoals]; goals[i].status = e.target.value; set("treatmentGoals", goals); }}
                >
                  {["En progreso", "Logrado", "Abandonado", "Nuevo"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Tarea para casa / Actividades entre sesiones</label>
            <input
              className="input-new"
              placeholder="Registro de pensamientos automáticos, técnica de respiración…"
              value={form.homework}
              onChange={e => set("homework", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Objetivo para próxima sesión</label>
            <input
              className="input-new"
              placeholder="Trabajar técnica de exposición gradual…"
              value={form.nextGoal}
              onChange={e => set("nextGoal", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar sesión de psicología"}
        </ButtonNew>
      </div>
    </div>
  );
}
