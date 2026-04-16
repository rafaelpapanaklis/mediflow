"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const DIAGNOSES_CIE10 = ["J00 - Resfriado común","J06 - IRA superior","J18 - Neumonía","K29 - Gastritis","K57 - Diverticulosis","K92 - Hemorragia GI","E11 - Diabetes tipo 2","E14 - Diabetes NE","I10 - Hipertensión esencial","I50 - Insuficiencia cardíaca","J45 - Asma","F32 - Depresión","F41 - Ansiedad","M54 - Dorsalgia","N39 - ITU","Otro"];
const SPECIALTIES = ["Cardiología","Neurología","Dermatología","Gastroenterología","Ortopedia","Ginecología","Urología","Psiquiatría","Oftalmología","ORL","Endocrinología","Reumatología","Oncología"];

interface Props { patientId: string; onSaved: (record: any) => void }

export function GeneralMedicineForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
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

  /* ── Antecedentes personales y familiares ── */
  const PERSONAL_CONDITIONS = ["Diabetes","Hipertensión","Asma/EPOC","Cardiopatía","Cáncer","Enfermedad renal","Hipotiroidismo","Depresión/Ansiedad","VIH","Hepatitis"] as const;
  const FAMILY_CONDITIONS = ["Diabetes","HTA","Cáncer","Cardiopatía","Enf. mental"] as const;
  const FAMILY_MEMBERS = ["Padre","Madre","Hermanos"] as const;
  const [personalHistory, setPersonalHistory] = useState<Record<string,boolean>>({});
  const [surgicalHistory, setSurgicalHistory] = useState("");
  const [familyHistory, setFamilyHistory] = useState<Record<string,Record<string,boolean>>>({});

  const togglePersonal = (c: string) => setPersonalHistory(p => ({ ...p, [c]: !p[c] }));
  const toggleFamily = (cond: string, member: string) =>
    setFamilyHistory(f => ({ ...f, [cond]: { ...f[cond], [member]: !f[cond]?.[member] } }));

  /* ── Hábitos y factores de riesgo ── */
  const [smoking, setSmoking] = useState("No fuma");
  const [packsYear, setPacksYear] = useState("");
  const [auditC, setAuditC] = useState([0, 0, 0]);
  const auditCScore = auditC[0] + auditC[1] + auditC[2];
  const auditCSeverity = auditCScore >= 8 ? "alto riesgo" : auditCScore >= 4 ? "riesgo moderado" : "bajo riesgo";
  const auditCColor = auditCScore >= 8 ? "text-red-600" : auditCScore >= 4 ? "text-amber-600" : "text-green-600";
  const [physicalActivity, setPhysicalActivity] = useState("");
  const [drugs, setDrugs] = useState("");

  const isSmoker = smoking !== "No fuma" && smoking !== "";

  /* ── Diagnóstico diferencial ── */
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
    <div className="space-y-6">
      {/* SUBJETIVO */}
      <div className="space-y-1.5">
        <Label>Motivo de consulta / Historia de la enfermedad actual (HEA)</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Paciente de X años que acude por… Inicio: … Evolución: … Síntomas acompañantes: …" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
      </div>

      {/* ANTECEDENTES PERSONALES Y FAMILIARES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📋 Antecedentes personales y familiares</h3>

        {/* Antecedentes personales */}
        <p className="text-xs font-semibold mb-2">Antecedentes personales patológicos</p>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {PERSONAL_CONDITIONS.map(c => (
            <label key={c} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={!!personalHistory[c]} onChange={() => togglePersonal(c)} className="w-3.5 h-3.5 accent-brand-600" />
              {c}
            </label>
          ))}
        </div>

        {/* Quirúrgicos */}
        <div className="mb-4 space-y-1">
          <Label className="text-xs">Antecedentes quirúrgicos</Label>
          <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Apendicectomía 2015, colecistectomía 2020…" value={surgicalHistory} onChange={e => setSurgicalHistory(e.target.value)} />
        </div>

        {/* Antecedentes familiares */}
        <p className="text-xs font-semibold mb-2">Antecedentes familiares</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-4 font-semibold">Condición</th>
                {FAMILY_MEMBERS.map(m => <th key={m} className="text-center py-1 px-2 font-semibold">{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {FAMILY_CONDITIONS.map(cond => (
                <tr key={cond} className="border-b border-border/50">
                  <td className="py-1.5 pr-4">{cond}</td>
                  {FAMILY_MEMBERS.map(member => (
                    <td key={member} className="text-center py-1.5">
                      <input type="checkbox" checked={!!familyHistory[cond]?.[member]} onChange={() => toggleFamily(cond, member)} className="w-3.5 h-3.5 accent-brand-600" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* HÁBITOS Y FACTORES DE RIESGO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🚬 Hábitos y factores de riesgo</h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Tabaquismo */}
          <div className="space-y-1">
            <Label className="text-xs">Tabaquismo</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={smoking} onChange={e => setSmoking(e.target.value)}>
              {["No fuma","Exfumador","< 10 cigarros/día","10-20/día","> 20/día"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {/* Paquetes/año - solo si fuma */}
          {isSmoker && (
            <div className="space-y-1">
              <Label className="text-xs">Paquetes/año</Label>
              <input type="number" min="0" className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Ej: 10" value={packsYear} onChange={e => setPacksYear(e.target.value)} />
            </div>
          )}

          {/* Actividad física */}
          <div className="space-y-1">
            <Label className="text-xs">Actividad física</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={physicalActivity} onChange={e => setPhysicalActivity(e.target.value)}>
              <option value="">Seleccionar…</option>
              {["Sedentario","Ligera (1-2x/sem)","Moderada (3-4x/sem)","Intensa (5+/sem)"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* AUDIT-C */}
        <div className="mb-4 p-3 rounded-lg bg-muted/30 space-y-3">
          <p className="text-xs font-semibold">Alcohol (AUDIT-C simplificado)</p>

          <div className="space-y-1">
            <Label className="text-xs">¿Con qué frecuencia toma bebidas alcohólicas?</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={auditC[0]} onChange={e => setAuditC(a => [Number(e.target.value), a[1], a[2]])}>
              <option value={0}>Nunca</option>
              <option value={1}>Mensual o menos</option>
              <option value={2}>2-4 veces/mes</option>
              <option value={3}>2-3 veces/semana</option>
              <option value={4}>4+ veces/semana</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">¿Cuántas bebidas en un día normal?</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={auditC[1]} onChange={e => setAuditC(a => [a[0], Number(e.target.value), a[2]])}>
              <option value={0}>1-2</option>
              <option value={1}>3-4</option>
              <option value={2}>5-6</option>
              <option value={3}>7-9</option>
              <option value={4}>10+</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">¿Con qué frecuencia toma 6+ bebidas en una ocasión?</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={auditC[2]} onChange={e => setAuditC(a => [a[0], a[1], Number(e.target.value)])}>
              <option value={0}>Nunca</option>
              <option value={1}>Menos que mensual</option>
              <option value={2}>Mensual</option>
              <option value={3}>Semanal</option>
              <option value={4}>Diario o casi diario</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs font-semibold">Puntaje AUDIT-C:</span>
            <span className={`text-sm font-bold ${auditCColor}`}>{auditCScore}/12 — {auditCSeverity}</span>
          </div>
        </div>

        {/* Drogas */}
        <div className="space-y-1">
          <Label className="text-xs">Drogas / Otras sustancias</Label>
          <textarea className="flex min-h-[50px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Marihuana, cocaína, benzodiacepinas sin Rx…" value={drugs} onChange={e => setDrugs(e.target.value)} />
        </div>
      </div>

      {/* DIAGNÓSTICO DIFERENCIAL */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold">🔍 Diagnóstico diferencial</h3>
          <button onClick={addDiffDiag} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar diagnóstico</button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Lista de posibles diagnósticos antes de confirmar el definitivo</p>
        {diffDiagnoses.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Sin diagnósticos diferenciales. Haz clic en &quot;+ Agregar diagnóstico&quot; para añadir.</p>
        )}
        <div className="space-y-2">
          {diffDiagnoses.map((dd, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="flex h-9 flex-1 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Ej: Neumonía adquirida en comunidad" value={dd.diagnosis} onChange={e => updateDiffDiag(i, "diagnosis", e.target.value)} />
              <select className="flex h-9 w-32 rounded-lg border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={dd.probability} onChange={e => updateDiffDiag(i, "probability", e.target.value)}>
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Baja">Baja</option>
              </select>
              <button onClick={() => removeDiffDiag(i)} className="h-9 px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors text-lg">×</button>
            </div>
          ))}
        </div>
      </div>

      {/* SIGNOS VITALES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🩺 Signos vitales</h3>
        <div className="grid grid-cols-4 gap-3">
          {[
            { key:"bloodPressure", label:"T/A (mmHg)",      ph:"120/80" },
            { key:"heartRate",     label:"FC (lpm)",         ph:"72"     },
            { key:"temperature",   label:"Temp (°C)",        ph:"36.5"   },
            { key:"respiratoryRate",label:"FR (rpm)",        ph:"16"     },
            { key:"oxygenSat",     label:"Sat O₂ (%)",      ph:"98"     },
            { key:"bloodGlucose",  label:"Glucemia (mg/dL)", ph:"100"    },
            { key:"weight",        label:"Peso (kg)",        ph:"70"     },
            { key:"height",        label:"Talla (cm)",       ph:"170"    },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder={f.ph} value={(form.vitals as any)[f.key]} onChange={e => setV(f.key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* EXPLORACIÓN Y LAB */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Exploración física / Laboratorios</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="BH: Hb 13.5, Leuco 7,500…&#10;EGO: Normal&#10;Tórax: sin alteraciones…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Estudios solicitados</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="BH, QS, RX tórax…" value={form.studies} onChange={e => set("studies", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Diagnóstico CIE-10</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.diagnosis} onChange={e => set("diagnosis", e.target.value)}>
              <option value="">Seleccionar diagnóstico…</option>
              {DIAGNOSES_CIE10.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Diagnóstico libre / Complementario</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Describe el diagnóstico…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
        </div>
      </div>

      {/* PRESCRIPCIÓN */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">💊 Prescripción médica</h3>
          <button onClick={addMed} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar medicamento</button>
        </div>
        <div className="space-y-3">
          {form.medications.map((med, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 items-end">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Medicamento</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none"
                  placeholder="Amoxicilina 500mg" value={med.drug}
                  onChange={e => { const m=[...form.medications]; m[i].drug=e.target.value; set("medications",m); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dosis</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none"
                  placeholder="500mg" value={med.dose}
                  onChange={e => { const m=[...form.medications]; m[i].dose=e.target.value; set("medications",m); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Frecuencia</Label>
                <select className="flex h-9 w-full rounded-lg border border-border bg-card px-2 text-sm focus:outline-none"
                  value={med.frequency} onChange={e => { const m=[...form.medications]; m[i].frequency=e.target.value; set("medications",m); }}>
                  <option value="">…</option>
                  {["c/4h","c/6h","c/8h","c/12h","c/24h","c/48h","Semanal","Según necesidad"].map(f=><option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duración</Label>
                <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none"
                  placeholder="7 días" value={med.duration}
                  onChange={e => { const m=[...form.medications]; m[i].duration=e.target.value; set("medications",m); }} />
              </div>
              <div className="flex items-end">
                {form.medications.length > 1 && (
                  <button onClick={() => removeMed(i)} className="h-9 px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors text-lg">×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* REFERIDO */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <input type="checkbox" id="referral" checked={form.referral.needed} onChange={e => set("referral", { ...form.referral, needed: e.target.checked })} className="w-4 h-4 accent-brand-600" />
          <label htmlFor="referral" className="text-sm font-bold">Referir a especialidad</label>
        </div>
        {form.referral.needed && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Especialidad</Label>
              <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none"
                value={form.referral.specialty} onChange={e => set("referral", { ...form.referral, specialty: e.target.value })}>
                <option value="">Seleccionar…</option>
                {SPECIALTIES.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Motivo del referido</Label>
              <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none"
                placeholder="Evaluación por…" value={form.referral.reason} onChange={e => set("referral", { ...form.referral, reason: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      {/* PLAN E INCAPACIDAD */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Plan / Indicaciones al paciente</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Reposo relativo 3 días, hidratación abundante, dieta blanda…&#10;Regresar si: fiebre >38.5°C, dificultad respiratoria…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Próxima cita / Control</Label>
            <input type="date" className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.returnDate} onChange={e => set("returnDate", e.target.value)} />
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="sicleave" checked={form.sicLeave.granted} onChange={e => set("sicLeave", { ...form.sicLeave, granted: e.target.checked })} className="w-4 h-4 accent-amber-600" />
              <label htmlFor="sicleave" className="text-sm font-bold text-amber-700">Incapacidad médica</label>
            </div>
            {form.sicLeave.granted && (
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="180" placeholder="3" className="w-16 h-8 rounded-lg border border-amber-300 bg-card px-2 text-sm font-bold text-center focus:outline-none"
                  value={form.sicLeave.days} onChange={e => set("sicLeave", { ...form.sicLeave, days: e.target.value })} />
                <span className="text-sm text-amber-700 font-medium">días de incapacidad</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "💾 Guardar consulta médica"}
        </Button>
      </div>
    </div>
  );
}
