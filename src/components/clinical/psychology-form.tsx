"use client";
import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { AlertTriangle } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { EvolutionChart, RecurringCalendar } from "@/components/clinical/shared";
import { useT } from "@/i18n/i18n-provider";

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
  const t = useT();
  const phq9SeverityLabel = (s: number) => s <= 4 ? t("clinical.psych.sevMinimal") : s <= 9 ? t("clinical.psych.sevMild") : s <= 14 ? t("clinical.psych.sevModerate") : s <= 19 ? t("clinical.psych.sevModeratelySevere") : t("clinical.psych.sevSevere");
  const gad7SeverityLabel = (s: number) => s <= 4 ? t("clinical.psych.sevMinimal") : s <= 9 ? t("clinical.psych.sevMild") : s <= 14 ? t("clinical.psych.sevModerate") : t("clinical.psych.sevSevere");
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

  const [scaleTab, setScaleTab] = useState<"phq9" | "gad7">("phq9");
  const [history, setHistory] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/clinical?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch(`/api/appointments`)
      .then(r => r.ok ? r.json() : [])
      .then((d: any[]) => {
        const now = new Date();
        const filtered = (Array.isArray(d) ? d : [])
          .filter(a => a.patientId === patientId && new Date(a.date) >= now && !["CANCELLED", "NO_SHOW"].includes(a.status))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .slice(0, 6);
        setUpcoming(filtered);
      })
      .catch(() => {});
  }, [patientId]);

  const phq9Data = useMemo(() =>
    history
      .filter(r => r?.specialtyData?.scales?.phq9?.score !== undefined)
      .map(r => ({
        date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
        value: Number(r.specialtyData.scales.phq9.score),
      }))
      .reverse(),
    [history]
  );
  const gad7Data = useMemo(() =>
    history
      .filter(r => r?.specialtyData?.scales?.gad7?.score !== undefined)
      .map(r => ({
        date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
        value: Number(r.specialtyData.scales.gad7.score),
      }))
      .reverse(),
    [history]
  );
  const upcomingItems = useMemo(() =>
    upcoming.map(a => ({
      date: a.date,
      title: a.type || t("clinical.psych.sessionLabel"),
      category: a.mode === "TELECONSULTATION" ? t("clinical.psych.teleconsultation") : t("clinical.psych.inPerson"),
      color: "#38bdf8",
    })),
    [upcoming]
  );

  const phq9Score = phq9.reduce((a, b) => a + b, 0);
  const gad7Score = gad7.reduce((a, b) => a + b, 0);
  const auditCScore = auditC.reduce((a, b) => a + b, 0);
  const waisrRated = waisr.filter(v => v > 0);
  const waisrAvg = waisrRated.length > 0 ? waisrRated.reduce((a, b) => a + b, 0) / waisrRated.length : 0;
  const waisrLabel = waisrAvg <= 2 ? t("clinical.psych.waisrWeak") : waisrAvg <= 3.5 ? t("clinical.psych.waisrModerate") : t("clinical.psych.waisrStrong");
  const waisrTone: "success" | "warning" | "danger" = waisrAvg <= 2 ? "danger" : waisrAvg <= 3.5 ? "warning" : "success";
  const auditCLabel = auditCScore < 3 ? t("clinical.psych.auditCLow") : auditCScore <= 7 ? t("clinical.psych.auditCModerate") : t("clinical.psych.auditCHigh");
  const auditCTone: "success" | "warning" | "danger" = auditCScore < 3 ? "success" : auditCScore <= 7 ? "warning" : "danger";

  const highRisk = applyScales && (phq9Score >= 20 || phq9[8] > 0 || form.mentalStatus.suicidalIdeation !== "no");

  function addGoal() { set("treatmentGoals", [...form.treatmentGoals, { goal: "", status: "En progreso" }]); }

  async function handleSave() {
    if (!form.subjective && !form.objective && !form.dap_data && !form.birp_behavior) {
      toast.error(t("clinical.psych.errMissingContent"));
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
      toast.success(t("clinical.psych.savedToast"));
    } catch (err: any) { toast.error(err.message ?? t("common.genericError")); } finally { setSaving(false); }
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
      <CardNew title={t("clinical.psych.sessionInfoTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.psych.session")}</label>
            <div className="input-new mono" style={{ display: "flex", alignItems: "center", fontWeight: 600, minWidth: 60, justifyContent: "center" }}>
              #{sessionNum}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.psych.sessionType")}</label>
            <select className="input-new" value={form.sessionType} onChange={e => set("sessionType", e.target.value)}>
              {SESSION_TYPES.map(st => <option key={st}>{st}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.psych.therapeuticApproach")}</label>
            <select className="input-new" value={form.approach} onChange={e => set("approach", e.target.value)}>
              {APPROACHES.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      {/* Evolución emocional */}
      <CardNew title={t("clinical.psych.emotionalEvolutionTitle")} sub={t("clinical.psych.emotionalEvolutionSub")}>
        <div className="segment-new" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`segment-new__btn ${scaleTab === "phq9" ? "segment-new__btn--active" : ""}`}
            onClick={() => setScaleTab("phq9")}
          >
            PHQ-9
          </button>
          <button
            type="button"
            className={`segment-new__btn ${scaleTab === "gad7" ? "segment-new__btn--active" : ""}`}
            onClick={() => setScaleTab("gad7")}
          >
            GAD-7
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {scaleTab === "phq9" ? (
            phq9Data.length < 2 ? (
              <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
                {t("clinical.psych.addMoreConsults")}
              </div>
            ) : (
              <EvolutionChart
                data={phq9Data}
                metric={t("clinical.psych.phq9Metric")}
                color="#38bdf8"
                normalRange={{ min: 0, max: 4 }}
              />
            )
          ) : (
            gad7Data.length < 2 ? (
              <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
                {t("clinical.psych.addMoreConsults")}
              </div>
            ) : (
              <EvolutionChart
                data={gad7Data}
                metric={t("clinical.psych.gad7Metric")}
                color="#38bdf8"
                normalRange={{ min: 0, max: 4 }}
              />
            )
          )}
          <RecurringCalendar items={upcomingItems} title={t("clinical.psych.upcomingSessions")} emptyMessage={t("clinical.psych.noSessionsScheduled")} />
        </div>
      </CardNew>

      {/* Formato de notas */}
      <CardNew title={t("clinical.psych.noteFormatTitle")}>
        <div className="segment-new">
          {NOTE_TYPES.map(nt => (
            <button
              key={nt}
              type="button"
              className={`segment-new__btn ${noteType === nt ? "segment-new__btn--active" : ""}`}
              onClick={() => setNoteType(nt)}
            >
              {t("clinical.psych.noteLabel", { type: nt })}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Notas de sesión */}
      <CardNew title={t("clinical.psych.sessionNotesTitle")}>
        {noteType === "SOAP" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
            {[
              { key: "subjective", label: t("clinical.psych.soapS"),     ph: t("clinical.psych.soapSPlaceholder") },
              { key: "objective",  label: t("clinical.psych.soapO"), ph: t("clinical.psych.soapOPlaceholder") },
              { key: "assessment", label: t("clinical.psych.soapA"),               ph: t("clinical.psych.soapAPlaceholder") },
              { key: "plan",       label: t("clinical.psych.soapP"),                       ph: t("clinical.psych.soapPPlaceholder") },
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
              { key: "birp_behavior",     label: t("clinical.psych.birpB"),  ph: t("clinical.psych.birpBPlaceholder") },
              { key: "birp_intervention", label: t("clinical.psych.birpI"), ph: t("clinical.psych.birpIPlaceholder") },
              { key: "birp_response",     label: t("clinical.psych.birpR"),       ph: t("clinical.psych.birpRPlaceholder") },
              { key: "birp_plan",         label: t("clinical.psych.birpP"),                         ph: t("clinical.psych.birpPPlaceholder") },
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
              { key: "dap_data",       label: t("clinical.psych.dapD"), ph: t("clinical.psych.dapDPlaceholder") },
              { key: "dap_assessment", label: t("clinical.psych.dapA"), ph: t("clinical.psych.dapAPlaceholder") },
              { key: "dap_plan",       label: t("clinical.psych.dapP"),               ph: t("clinical.psych.dapPPlaceholder") },
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
      <CardNew title={t("clinical.psych.mentalStatusTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          {[
            { key: "mood",              label: t("clinical.psych.mood"),                  opts: ["", "Eutímico", "Deprimido", "Ansioso", "Irritable", "Expansivo", "Lábil"] },
            { key: "sleepQuality",      label: t("clinical.psych.sleepQuality"),                opts: ["", "Buena", "Regular", "Mala", "Insomnio", "Hipersomnia"] },
            { key: "appetiteChanges",   label: t("clinical.psych.appetite"),                          opts: ["", "Normal", "Aumentado", "Disminuido", "Sin cambios"] },
            { key: "socialFunctioning", label: t("clinical.psych.socialFunctioning"),            opts: ["", "Adecuado", "Levemente afectado", "Moderadamente afectado", "Severamente afectado"] },
            { key: "workFunctioning",   label: t("clinical.psych.workFunctioning"), opts: ["", "Adecuado", "Levemente afectado", "Moderadamente afectado", "Severamente afectado", "Sin actividad"] },
            { key: "suicidalIdeation",  label: t("clinical.psych.suicidalIdeation"),    opts: ["no", "Pasiva", "Activa sin plan", "Activa con plan"] },
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
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5" }}>{t("clinical.psych.highRiskTitle")}</div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4, lineHeight: 1.55 }}>
              {phq9Score >= 20 && <>{t("clinical.psych.highRiskPhq9", { score: phq9Score })} </>}
              {phq9[8] > 0 && <>{t("clinical.psych.highRiskPhq9Q9")} </>}
              {form.mentalStatus.suicidalIdeation !== "no" && form.mentalStatus.suicidalIdeation !== "" && <>{t("clinical.psych.highRiskReported", { value: form.mentalStatus.suicidalIdeation })} </>}
              {t("clinical.psych.highRiskAdvice")}
            </div>
          </div>
        </div>
      )}

      {/* Plan de seguridad — solo si ideación suicida */}
      {form.mentalStatus.suicidalIdeation !== "no" && form.mentalStatus.suicidalIdeation !== "" && (
        <CardNew title={t("clinical.psych.safetyPlanTitle")} sub={t("clinical.psych.safetyPlanSub")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
            {[
              { key: "warningSignals",    label: t("clinical.psych.warningSignals"),                ph: t("clinical.psych.warningSignalsPlaceholder") },
              { key: "copingStrategies",  label: t("clinical.psych.copingStrategies"), ph: t("clinical.psych.copingStrategiesPlaceholder") },
              { key: "supportPeople",     label: t("clinical.psych.supportPeople"),                     ph: t("clinical.psych.supportPeoplePlaceholder") },
              { key: "emergencyContacts", label: t("clinical.psych.emergencyContacts"), ph: t("clinical.psych.emergencyContactsPlaceholder") },
              { key: "meansRestriction",  label: t("clinical.psych.meansRestriction"),         ph: t("clinical.psych.meansRestrictionPlaceholder") },
              { key: "reasonToLive",      label: t("clinical.psych.reasonToLive"),                      ph: t("clinical.psych.reasonToLivePlaceholder") },
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
        title={t("clinical.psych.waisrTitle")}
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
          <span style={{ textAlign: "center" }}>{t("clinical.psych.waisrNever")}</span>
          <span style={{ textAlign: "center" }}>{t("clinical.psych.waisrRarely")}</span>
          <span style={{ textAlign: "center" }}>{t("clinical.psych.waisrSometimes")}</span>
          <span style={{ textAlign: "center" }}>{t("clinical.psych.waisrOften")}</span>
          <span style={{ textAlign: "center" }}>{t("clinical.psych.waisrAlways")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            t("clinical.psych.waisrItem1"),
            t("clinical.psych.waisrItem2"),
            t("clinical.psych.waisrItem3"),
            t("clinical.psych.waisrItem4"),
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
        title={t("clinical.psych.standardScalesTitle")}
        action={
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={applyScales} onChange={e => setApplyScales(e.target.checked)} />
            {t("clinical.psych.applyThisSession")}
          </label>
        }
      >
        {!applyScales ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            {t("clinical.psych.scalesDisabled")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* PHQ-9 */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, margin: 0 }}>
                  {t("clinical.psych.phq9Metric")}
                </h4>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{phq9Score}/27</span>
                  <BadgeNew tone={PHQ9_TONE(phq9Score)} dot>{phq9SeverityLabel(phq9Score)}</BadgeNew>
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
                <span style={{ textAlign: "center" }}>{t("clinical.psych.phq9ColNever")}</span>
                <span style={{ textAlign: "center" }}>{t("clinical.psych.phq9ColSeveralDays")}</span>
                <span style={{ textAlign: "center" }}>{t("clinical.psych.phq9ColHalfDays")}</span>
                <span style={{ textAlign: "center" }}>{t("clinical.psych.phq9ColNearlyEvery")}</span>
              </div>
              {PHQ9_ITEMS.map((item, i) => (
                <ScaleItem
                  key={i}
                  idx={i}
                  label={t(`clinical.psych.phq9Item${i + 1}`)}
                  values={phq9}
                  onChange={v => { const n = [...phq9]; n[i] = v; setPHQ9(n); }}
                />
              ))}
            </div>

            {/* GAD-7 */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, margin: 0 }}>
                  {t("clinical.psych.gad7Metric")}
                </h4>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{gad7Score}/21</span>
                  <BadgeNew tone={GAD7_TONE(gad7Score)} dot>{gad7SeverityLabel(gad7Score)}</BadgeNew>
                </div>
              </div>
              {GAD7_ITEMS.map((item, i) => (
                <ScaleItem
                  key={i}
                  idx={i}
                  label={t(`clinical.psych.gad7Item${i + 1}`)}
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
        title={t("clinical.psych.substanceScreeningTitle")}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{auditCScore}/12</span>
            <BadgeNew tone={auditCTone} dot>{auditCLabel}</BadgeNew>
          </div>
        }
      >
        <h4 style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginTop: 0, marginBottom: 10 }}>
          {t("clinical.psych.auditCHeading")}
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 18 }}>
          {[
            { label: t("clinical.psych.auditCQ1"),           opts: [t("clinical.psych.auditCQ1O0"), t("clinical.psych.auditCQ1O1"), t("clinical.psych.auditCQ1O2"), t("clinical.psych.auditCQ1O3"), t("clinical.psych.auditCQ1O4")] },
            { label: t("clinical.psych.auditCQ2"),    opts: ["1-2 (0)", "3-4 (1)", "5-6 (2)", "7-9 (3)", "10+ (4)"] },
            { label: t("clinical.psych.auditCQ3"), opts: [t("clinical.psych.auditCQ3O0"), t("clinical.psych.auditCQ3O1"), t("clinical.psych.auditCQ3O2"), t("clinical.psych.auditCQ3O3"), t("clinical.psych.auditCQ3O4")] },
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
          {t("clinical.psych.dastHeading")}
        </h4>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-1)", cursor: "pointer", marginBottom: 10 }}>
          <input type="checkbox" checked={dastPositive} onChange={e => setDastPositive(e.target.checked)} />
          {t("clinical.psych.dastQuestion")}
        </label>
        {dastPositive && (
          <div className="field-new">
            <label className="field-new__label">{t("clinical.psych.dastDetailLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.psych.dastDetailPlaceholder")}
              value={dastDetail}
              onChange={e => setDastDetail(e.target.value)}
            />
          </div>
        )}
      </CardNew>

      {/* Plan terapéutico */}
      <CardNew
        title={t("clinical.psych.treatmentPlanTitle")}
        action={<ButtonNew size="sm" variant="ghost" onClick={addGoal}>{t("clinical.psych.addGoal")}</ButtonNew>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {form.treatmentGoals.map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="field-new" style={{ flex: 1 }}>
                <label className="field-new__label">{t("clinical.psych.goalLabel", { num: i + 1 })}</label>
                <input
                  className="input-new"
                  placeholder={t("clinical.psych.goalPlaceholder")}
                  value={g.goal}
                  onChange={e => { const goals = [...form.treatmentGoals]; goals[i].goal = e.target.value; set("treatmentGoals", goals); }}
                />
              </div>
              <div className="field-new" style={{ width: 140 }}>
                <label className="field-new__label">{t("common.status")}</label>
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
            <label className="field-new__label">{t("clinical.psych.homeworkLabel")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.psych.homeworkPlaceholder")}
              value={form.homework}
              onChange={e => set("homework", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.psych.nextGoalLabel")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.psych.nextGoalPlaceholder")}
              value={form.nextGoal}
              onChange={e => set("nextGoal", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.psych.saveSession")}
        </ButtonNew>
      </div>
    </div>
  );
}
