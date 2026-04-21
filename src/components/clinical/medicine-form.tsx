"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Calculator } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { CalculatorModal } from "@/components/clinical/calculators/calculator-modal";

const DIAGNOSES_CIE10 = ["J00 - Resfriado común","J06 - IRA superior","J18 - Neumonía","K29 - Gastritis","K57 - Diverticulosis","K92 - Hemorragia GI","E11 - Diabetes tipo 2","E14 - Diabetes NE","I10 - Hipertensión esencial","I50 - Insuficiencia cardíaca","J45 - Asma","F32 - Depresión","F41 - Ansiedad","M54 - Dorsalgia","N39 - ITU","Otro"];
const SPECIALTIES = ["Cardiología","Neurología","Dermatología","Gastroenterología","Ortopedia","Ginecología","Urología","Psiquiatría","Oftalmología","ORL","Endocrinología","Reumatología","Oncología"];

interface Props { patientId: string; onSaved: (record: any) => void }

export function GeneralMedicineForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [form, setForm] = useState({
    subjective: "", objective: "", assessment: "", plan: "",
    vitals: { bloodPressure:"", heartRate:"", temperature:"", respiratoryRate:"", oxygenSat:"", bloodGlucose:"", weight:"", height:"" },
    diagnosis: "",
    medications: [{ drug:"", dose:"", frequency:"", duration:"", route:"oral", instructions:"" }],
    referral: { needed: false, specialty:"", reason:"" },
    labs: "", studies: "",
    sicLeave: { granted: false, days:"" },
    returnDate: "",
  });

  const PERSONAL_CONDITIONS = ["Diabetes","Hipertensión","Asma/EPOC","Cardiopatía","Cáncer","Enfermedad renal","Hipotiroidismo","Depresión/Ansiedad","VIH","Hepatitis"] as const;
  const FAMILY_CONDITIONS = ["Diabetes","HTA","Cáncer","Cardiopatía","Enf. mental"] as const;
  const FAMILY_MEMBERS = ["Padre","Madre","Hermanos"] as const;
  const [personalHistory, setPersonalHistory] = useState<Record<string,boolean>>({});
  const [surgicalHistory, setSurgicalHistory] = useState("");
  const [familyHistory, setFamilyHistory] = useState<Record<string,Record<string,boolean>>>({});

  const togglePersonal = (c: string) => setPersonalHistory(p => ({ ...p, [c]: !p[c] }));
  const toggleFamily = (cond: string, member: string) =>
    setFamilyHistory(f => ({ ...f, [cond]: { ...f[cond], [member]: !f[cond]?.[member] } }));

  const [smoking, setSmoking] = useState("No fuma");
  const [packsYear, setPacksYear] = useState("");
  const [auditC, setAuditC] = useState([0, 0, 0]);
  const auditCScore = auditC[0] + auditC[1] + auditC[2];
  const auditCSeverity = auditCScore >= 8 ? "alto riesgo" : auditCScore >= 4 ? "riesgo moderado" : "bajo riesgo";
  const auditCTone: "success" | "warning" | "danger" = auditCScore >= 8 ? "danger" : auditCScore >= 4 ? "warning" : "success";
  const [physicalActivity, setPhysicalActivity] = useState("");
  const [drugs, setDrugs] = useState("");
  const isSmoker = smoking !== "No fuma" && smoking !== "";

  const [diffDiagnoses, setDiffDiagnoses] = useState<{ diagnosis: string; probability: string }[]>([]);
  const addDiffDiag = () => setDiffDiagnoses(d => [...d, { diagnosis: "", probability: "Media" }]);
  const removeDiffDiag = (i: number) => setDiffDiagnoses(d => d.filter((_, j) => j !== i));
  const updateDiffDiag = (i: number, field: string, value: string) =>
    setDiffDiagnoses(d => d.map((item, j) => j === i ? { ...item, [field]: value } : item));

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setV = (k: string, v: string) => setForm(f => ({ ...f, vitals: { ...f.vitals, [k]: v } }));

  function addMed() { set("medications", [...form.medications, { drug:"", dose:"", frequency:"", duration:"", route:"oral", instructions:"" }]); }
  function removeMed(i: number) { set("medications", form.medications.filter((_,j) => j !== i)); }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega el motivo de consulta o diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective, objective: form.objective,
          assessment: form.assessment || form.diagnosis, plan: form.plan,
          vitals: form.vitals,
          specialtyData: {
            type: "medicine",
            vitals: form.vitals,
            diagnosis: form.diagnosis,
            medications: form.medications.filter(m => m.drug),
            referral: form.referral.needed ? form.referral : undefined,
            labs: form.labs, studies: form.studies,
            sicLeave: form.sicLeave.granted ? form.sicLeave : undefined,
            returnDate: form.returnDate,
            personalHistory: Object.entries(personalHistory).filter(([,v]) => v).map(([k]) => k),
            surgicalHistory,
            familyHistory,
            habits: { smoking, packsYear: isSmoker ? packsYear : undefined, auditC, auditCScore, physicalActivity, drugs },
            differentialDiagnoses: diffDiagnoses.filter(d => d.diagnosis),
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Consulta médica guardada");
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew size="sm" variant="ghost" icon={<Calculator size={14} />} onClick={() => setCalcOpen(true)}>
          Calculadoras clínicas
        </ButtonNew>
      </div>

      {/* Motivo de consulta */}
      <CardNew title="Motivo de consulta / HEA">
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="Paciente de X años que acude por… Inicio: … Evolución: … Síntomas acompañantes: …"
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      {/* Antecedentes personales y familiares */}
      <CardNew title="Antecedentes personales y familiares">
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Antecedentes personales patológicos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {PERSONAL_CONDITIONS.map(c => (
              <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!personalHistory[c]} onChange={() => togglePersonal(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div className="field-new" style={{ marginBottom: 16 }}>
          <label className="field-new__label">Antecedentes quirúrgicos</label>
          <textarea
            className="input-new"
            style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder="Apendicectomía 2015, colecistectomía 2020…"
            value={surgicalHistory}
            onChange={e => setSurgicalHistory(e.target.value)}
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>Antecedentes familiares</div>
          <table className="table-new">
            <thead>
              <tr>
                <th>Condición</th>
                {FAMILY_MEMBERS.map(m => <th key={m} style={{ textAlign: "center" }}>{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {FAMILY_CONDITIONS.map(cond => (
                <tr key={cond}>
                  <td>{cond}</td>
                  {FAMILY_MEMBERS.map(member => (
                    <td key={member} style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={!!familyHistory[cond]?.[member]} onChange={() => toggleFamily(cond, member)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardNew>

      {/* Hábitos y factores de riesgo */}
      <CardNew title="Hábitos y factores de riesgo">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 16 }}>
          <div className="field-new">
            <label className="field-new__label">Tabaquismo</label>
            <select className="input-new" value={smoking} onChange={e => setSmoking(e.target.value)}>
              {["No fuma","Exfumador","< 10 cigarros/día","10-20/día","> 20/día"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {isSmoker && (
            <div className="field-new">
              <label className="field-new__label">Paquetes/año</label>
              <input type="number" min="0" className="input-new mono" placeholder="10" value={packsYear} onChange={e => setPacksYear(e.target.value)} />
            </div>
          )}
          <div className="field-new">
            <label className="field-new__label">Actividad física</label>
            <select className="input-new" value={physicalActivity} onChange={e => setPhysicalActivity(e.target.value)}>
              <option value="">Seleccionar…</option>
              {["Sedentario","Ligera (1-2x/sem)","Moderada (3-4x/sem)","Intensa (5+/sem)"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* AUDIT-C */}
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>Alcohol (AUDIT-C simplificado)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field-new">
              <label className="field-new__label">¿Con qué frecuencia toma bebidas alcohólicas?</label>
              <select className="input-new" value={auditC[0]} onChange={e => setAuditC(a => [Number(e.target.value), a[1], a[2]])}>
                <option value={0}>Nunca</option>
                <option value={1}>Mensual o menos</option>
                <option value={2}>2-4 veces/mes</option>
                <option value={3}>2-3 veces/semana</option>
                <option value={4}>4+ veces/semana</option>
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">¿Cuántas bebidas en un día normal?</label>
              <select className="input-new" value={auditC[1]} onChange={e => setAuditC(a => [a[0], Number(e.target.value), a[2]])}>
                <option value={0}>1-2</option><option value={1}>3-4</option><option value={2}>5-6</option><option value={3}>7-9</option><option value={4}>10+</option>
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">¿Con qué frecuencia toma 6+ bebidas en una ocasión?</label>
              <select className="input-new" value={auditC[2]} onChange={e => setAuditC(a => [a[0], a[1], Number(e.target.value)])}>
                <option value={0}>Nunca</option><option value={1}>Menos que mensual</option><option value={2}>Mensual</option><option value={3}>Semanal</option><option value={4}>Diario o casi diario</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>Puntaje AUDIT-C:</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{auditCScore}/12</span>
              <BadgeNew tone={auditCTone} dot>{auditCSeverity}</BadgeNew>
            </div>
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">Drogas / Otras sustancias</label>
          <textarea
            className="input-new"
            style={{ minHeight: 50, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder="Marihuana, cocaína, benzodiacepinas sin Rx…"
            value={drugs}
            onChange={e => setDrugs(e.target.value)}
          />
        </div>
      </CardNew>

      {/* Diagnóstico diferencial */}
      <CardNew
        title="Diagnóstico diferencial"
        sub="Lista de posibles diagnósticos antes de confirmar el definitivo"
        action={<ButtonNew size="sm" variant="ghost" onClick={addDiffDiag}>+ Agregar</ButtonNew>}
      >
        {diffDiagnoses.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            Sin diagnósticos diferenciales. Haz clic en &quot;+ Agregar&quot; para añadir.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {diffDiagnoses.map((dd, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="input-new"
                  placeholder="Ej: Neumonía adquirida en comunidad"
                  value={dd.diagnosis}
                  onChange={e => updateDiffDiag(i, "diagnosis", e.target.value)}
                />
                <select
                  className="input-new"
                  style={{ width: 120 }}
                  value={dd.probability}
                  onChange={e => updateDiffDiag(i, "probability", e.target.value)}
                >
                  <option value="Alta">Alta</option>
                  <option value="Media">Media</option>
                  <option value="Baja">Baja</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeDiffDiag(i)}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ padding: 0, width: 28, color: "var(--danger)" }}
                  aria-label="Eliminar"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      {/* Signos vitales */}
      <CardNew title="Signos vitales">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
          {[
            { key:"bloodPressure", label:"T/A (mmHg)",      ph:"120/80" },
            { key:"heartRate",     label:"FC (lpm)",         ph:"72"     },
            { key:"temperature",   label:"Temp (°C)",        ph:"36.5"   },
            { key:"respiratoryRate",label:"FR (rpm)",        ph:"16"     },
            { key:"oxygenSat",     label:"Sat O₂ (%)",       ph:"98"     },
            { key:"bloodGlucose",  label:"Glucemia (mg/dL)", ph:"100"    },
            { key:"weight",        label:"Peso (kg)",        ph:"70"     },
            { key:"height",        label:"Talla (cm)",       ph:"170"    },
          ].map(f => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <input
                className="input-new mono"
                placeholder={f.ph}
                value={(form.vitals as any)[f.key]}
                onChange={e => setV(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </CardNew>

      {/* Exploración física y lab */}
      <CardNew title="Exploración física y laboratorios">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Exploración física / Laboratorios</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="BH: Hb 13.5, Leuco 7,500…&#10;EGO: Normal&#10;Tórax: sin alteraciones…"
              value={form.objective}
              onChange={e => set("objective", e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field-new">
              <label className="field-new__label">Estudios solicitados</label>
              <input
                className="input-new"
                placeholder="BH, QS, RX tórax…"
                value={form.studies}
                onChange={e => set("studies", e.target.value)}
              />
            </div>
            <div className="field-new">
              <label className="field-new__label">Diagnóstico CIE-10</label>
              <select className="input-new" value={form.diagnosis} onChange={e => set("diagnosis", e.target.value)}>
                <option value="">Seleccionar…</option>
                {DIAGNOSES_CIE10.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">Diagnóstico libre / Complementario</label>
              <input
                className="input-new"
                placeholder="Describe el diagnóstico…"
                value={form.assessment}
                onChange={e => set("assessment", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardNew>

      {/* Prescripción */}
      <CardNew
        title="Prescripción médica"
        action={<ButtonNew size="sm" variant="ghost" onClick={addMed}>+ Agregar medicamento</ButtonNew>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {form.medications.map((med, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
              <div className="field-new">
                <label className="field-new__label">Medicamento</label>
                <input
                  className="input-new"
                  placeholder="Amoxicilina 500mg"
                  value={med.drug}
                  onChange={e => { const m=[...form.medications]; m[i].drug=e.target.value; set("medications",m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Dosis</label>
                <input
                  className="input-new mono"
                  placeholder="500mg"
                  value={med.dose}
                  onChange={e => { const m=[...form.medications]; m[i].dose=e.target.value; set("medications",m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Frecuencia</label>
                <select
                  className="input-new"
                  value={med.frequency}
                  onChange={e => { const m=[...form.medications]; m[i].frequency=e.target.value; set("medications",m); }}
                >
                  <option value="">…</option>
                  {["c/4h","c/6h","c/8h","c/12h","c/24h","c/48h","Semanal","Según necesidad"].map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">Duración</label>
                <input
                  className="input-new"
                  placeholder="7 días"
                  value={med.duration}
                  onChange={e => { const m=[...form.medications]; m[i].duration=e.target.value; set("medications",m); }}
                />
              </div>
              {form.medications.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMed(i)}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ padding: 0, width: 28, color: "var(--danger)", alignSelf: "flex-end" }}
                  aria-label="Eliminar"
                >×</button>
              )}
            </div>
          ))}
        </div>
      </CardNew>

      {/* Referido */}
      <CardNew title="Referir a especialidad">
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.referral.needed}
            onChange={e => set("referral", { ...form.referral, needed: e.target.checked })}
          />
          <span style={{ fontSize: 13, color: "var(--text-1)" }}>Referir a otra especialidad</span>
        </label>
        {form.referral.needed && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
            <div className="field-new">
              <label className="field-new__label">Especialidad</label>
              <select
                className="input-new"
                value={form.referral.specialty}
                onChange={e => set("referral", { ...form.referral, specialty: e.target.value })}
              >
                <option value="">Seleccionar…</option>
                {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">Motivo del referido</label>
              <input
                className="input-new"
                placeholder="Evaluación por…"
                value={form.referral.reason}
                onChange={e => set("referral", { ...form.referral, reason: e.target.value })}
              />
            </div>
          </div>
        )}
      </CardNew>

      {/* Plan e incapacidad */}
      <CardNew title="Plan e indicaciones">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Plan / Indicaciones al paciente</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Reposo relativo 3 días, hidratación abundante…&#10;Regresar si: fiebre >38.5°C…"
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field-new">
              <label className="field-new__label">Próxima cita / Control</label>
              <input
                type="date"
                className="input-new"
                value={form.returnDate}
                onChange={e => set("returnDate", e.target.value)}
              />
            </div>
            <div style={{ padding: 12, borderRadius: 10, background: "var(--warning-soft)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={form.sicLeave.granted}
                  onChange={e => set("sicLeave", { ...form.sicLeave, granted: e.target.checked })}
                />
                <span style={{ fontSize: 12, color: "#fcd34d", fontWeight: 600 }}>Incapacidad médica</span>
              </label>
              {form.sicLeave.granted && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number" min="1" max="180"
                    placeholder="3"
                    className="input-new mono"
                    style={{ width: 64 }}
                    value={form.sicLeave.days}
                    onChange={e => set("sicLeave", { ...form.sicLeave, days: e.target.value })}
                  />
                  <span style={{ fontSize: 12, color: "#fcd34d" }}>días de incapacidad</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardNew>

      {/* Save */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta médica"}
        </ButtonNew>
      </div>

      <CalculatorModal isOpen={calcOpen} onClose={() => setCalcOpen(false)} />
    </div>
  );
}
