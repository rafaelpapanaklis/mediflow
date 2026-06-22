"use client";
import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { Calculator } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { CalculatorModal } from "@/components/clinical/calculators/calculator-modal";
import { EvolutionChart } from "@/components/clinical/shared";
import { DateField } from "@/components/ui/date-field";
import { useT } from "@/i18n/i18n-provider";
import { Cie10Selector } from "@/components/dashboard/clinical/cie10-selector";
import { useCodedDiagnoses } from "@/components/clinical/use-coded-diagnoses";

const SPECIALTIES = ["Cardiología","Neurología","Dermatología","Gastroenterología","Ortopedia","Ginecología","Urología","Psiquiatría","Oftalmología","ORL","Endocrinología","Reumatología","Oncología"];

interface Props { patientId: string; onSaved: (record: any) => void }

export function GeneralMedicineForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  // Dx CIE-10 codificados (NOM-024 §6.3 / NOM-004) — consulta nueva: local + flush al crear.
  const { dxs, onAdd: onAddDx, onRemove: onRemoveDx, flush: flushDx, summary: dxSummary } = useCodedDiagnoses(null);
  const [form, setForm] = useState({
    subjective: "", objective: "", assessment: "", plan: "",
    vitals: { bloodPressure:"", heartRate:"", temperature:"", respiratoryRate:"", oxygenSat:"", bloodGlucose:"", weight:"", height:"" },
    medications: [{ drug:"", dose:"", frequency:"", duration:"", route:"oral", instructions:"" }],
    referral: { needed: false, specialty:"", reason:"" },
    labs: "", studies: "",
    sicLeave: { granted: false, days:"" },
    returnDate: "",
  });

  const PERSONAL_CONDITIONS = ["Diabetes","Hipertensión","Asma/EPOC","Cardiopatía","Cáncer","Enfermedad renal","Hipotiroidismo","Depresión/Ansiedad","VIH","Hepatitis"] as const;
  const FAMILY_CONDITIONS = ["Diabetes","HTA","Cáncer","Cardiopatía","Enf. mental"] as const;
  const FAMILY_MEMBERS = ["Padre","Madre","Hermanos"] as const;
  const PERSONAL_CONDITION_KEYS: Record<string, string> = {
    "Diabetes": "clinical.medicineForm.condDiabetes",
    "Hipertensión": "clinical.medicineForm.condHypertension",
    "Asma/EPOC": "clinical.medicineForm.condAsthmaCopd",
    "Cardiopatía": "clinical.medicineForm.condHeartDisease",
    "Cáncer": "clinical.medicineForm.condCancer",
    "Enfermedad renal": "clinical.medicineForm.condKidneyDisease",
    "Hipotiroidismo": "clinical.medicineForm.condHypothyroidism",
    "Depresión/Ansiedad": "clinical.medicineForm.condDepressionAnxiety",
    "VIH": "clinical.medicineForm.condHiv",
    "Hepatitis": "clinical.medicineForm.condHepatitis",
  };
  const FAMILY_CONDITION_KEYS: Record<string, string> = {
    "Diabetes": "clinical.medicineForm.famDiabetes",
    "HTA": "clinical.medicineForm.famHypertension",
    "Cáncer": "clinical.medicineForm.famCancer",
    "Cardiopatía": "clinical.medicineForm.famHeartDisease",
    "Enf. mental": "clinical.medicineForm.famMentalIllness",
  };
  const FAMILY_MEMBER_KEYS: Record<string, string> = {
    "Padre": "clinical.medicineForm.memberFather",
    "Madre": "clinical.medicineForm.memberMother",
    "Hermanos": "clinical.medicineForm.memberSiblings",
  };
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
  const auditCSeverity = auditCScore >= 8 ? t("clinical.medicineForm.riskHigh") : auditCScore >= 4 ? t("clinical.medicineForm.riskModerate") : t("clinical.medicineForm.riskLow");
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

  const [bpTab, setBpTab] = useState<"systolic" | "diastolic">("systolic");
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/clinical?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patientId]);

  function parseBp(record: any): { sys: number; dia: number } | null {
    const bp = record?.vitals?.bloodPressure ?? record?.specialtyData?.vitals?.bloodPressure;
    if (!bp) return null;
    if (typeof bp === "string") {
      const m = bp.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return { sys: Number(m[1]), dia: Number(m[2]) };
      return null;
    }
    if (typeof bp === "object" && bp.systolic && bp.diastolic) {
      return { sys: Number(bp.systolic), dia: Number(bp.diastolic) };
    }
    return null;
  }

  const bpHistory = useMemo(() =>
    history
      .map(r => ({ record: r, bp: parseBp(r) }))
      .filter(x => x.bp !== null)
      .slice(0, 6)
      .map(x => ({
        date: new Date(x.record.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
        sys: x.bp!.sys,
        dia: x.bp!.dia,
      }))
      .reverse(),
    [history]
  );

  const systolicData = useMemo(() =>
    bpHistory.map(b => ({ date: b.date, value: b.sys })),
    [bpHistory]
  );
  const diastolicData = useMemo(() =>
    bpHistory.map(b => ({ date: b.date, value: b.dia })),
    [bpHistory]
  );

  function addMed() { set("medications", [...form.medications, { drug:"", dose:"", frequency:"", duration:"", route:"oral", instructions:"" }]); }
  function removeMed(i: number) { set("medications", form.medications.filter((_,j) => j !== i)); }

  async function handleSave() {
    if (!form.subjective && !form.assessment && dxs.length === 0) { toast.error(t("clinical.medicineForm.errorReasonOrDx")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective, objective: form.objective,
          assessment: form.assessment || dxSummary, plan: form.plan,
          vitals: form.vitals,
          specialtyData: {
            type: "medicine",
            vitals: form.vitals,
            diagnosis: dxSummary,
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
      const record = await res.json();
      // Persistir los dx codificados en el expediente recién creado → fluyen al CDA.
      if (dxs.length > 0) {
        const saved = await flushDx(record.id);
        if (saved < dxs.length) toast.error("La consulta se guardó, pero algún diagnóstico CIE-10 no se registró.");
      }
      onSaved(record);
      toast.success(t("clinical.medicineForm.savedToast"));
    } catch (err: any) { toast.error(err.message ?? t("common.genericError")); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew size="sm" variant="ghost" icon={<Calculator size={14} />} onClick={() => setCalcOpen(true)}>
          {t("clinical.medicineForm.clinicalCalculators")}
        </ButtonNew>
      </div>

      {/* Motivo de consulta */}
      <CardNew title={t("clinical.medicineForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.medicineForm.reasonPlaceholder")}
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      {/* Antecedentes personales y familiares */}
      <CardNew title={t("clinical.medicineForm.historyTitle")}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>{t("clinical.medicineForm.personalPathologicalHistory")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {PERSONAL_CONDITIONS.map(c => (
              <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!personalHistory[c]} onChange={() => togglePersonal(c)} />
                {t(PERSONAL_CONDITION_KEYS[c])}
              </label>
            ))}
          </div>
        </div>

        <div className="field-new" style={{ marginBottom: 16 }}>
          <label className="field-new__label">{t("clinical.medicineForm.surgicalHistory")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder={t("clinical.medicineForm.surgicalHistoryPlaceholder")}
            value={surgicalHistory}
            onChange={e => setSurgicalHistory(e.target.value)}
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>{t("clinical.medicineForm.familyHistory")}</div>
          <table className="table-new">
            <thead>
              <tr>
                <th>{t("clinical.medicineForm.conditionColumn")}</th>
                {FAMILY_MEMBERS.map(m => <th key={m} style={{ textAlign: "center" }}>{t(FAMILY_MEMBER_KEYS[m])}</th>)}
              </tr>
            </thead>
            <tbody>
              {FAMILY_CONDITIONS.map(cond => (
                <tr key={cond}>
                  <td>{t(FAMILY_CONDITION_KEYS[cond])}</td>
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
      <CardNew title={t("clinical.medicineForm.habitsTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 16 }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.medicineForm.smoking")}</label>
            <select className="input-new" value={smoking} onChange={e => setSmoking(e.target.value)}>
              <option value="No fuma">{t("clinical.medicineForm.smokingNone")}</option>
              <option value="Exfumador">{t("clinical.medicineForm.smokingFormer")}</option>
              <option value="< 10 cigarros/día">{t("clinical.medicineForm.smokingLt10")}</option>
              <option value="10-20/día">{t("clinical.medicineForm.smoking1020")}</option>
              <option value="> 20/día">{t("clinical.medicineForm.smokingGt20")}</option>
            </select>
          </div>
          {isSmoker && (
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.packsYear")}</label>
              <input type="number" min="0" className="input-new mono" placeholder="10" value={packsYear} onChange={e => setPacksYear(e.target.value)} />
            </div>
          )}
          <div className="field-new">
            <label className="field-new__label">{t("clinical.medicineForm.physicalActivity")}</label>
            <select className="input-new" value={physicalActivity} onChange={e => setPhysicalActivity(e.target.value)}>
              <option value="">{t("clinical.medicineForm.selectPlaceholder")}</option>
              <option value="Sedentario">{t("clinical.medicineForm.activitySedentary")}</option>
              <option value="Ligera (1-2x/sem)">{t("clinical.medicineForm.activityLight")}</option>
              <option value="Moderada (3-4x/sem)">{t("clinical.medicineForm.activityModerate")}</option>
              <option value="Intensa (5+/sem)">{t("clinical.medicineForm.activityIntense")}</option>
            </select>
          </div>
        </div>

        {/* AUDIT-C */}
        <div style={{ padding: 14, borderRadius: 10, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 10 }}>{t("clinical.medicineForm.auditCTitle")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.auditCq1")}</label>
              <select className="input-new" value={auditC[0]} onChange={e => setAuditC(a => [Number(e.target.value), a[1], a[2]])}>
                <option value={0}>{t("clinical.medicineForm.auditCfreqNever")}</option>
                <option value={1}>{t("clinical.medicineForm.auditCfreqMonthlyOrLess")}</option>
                <option value={2}>{t("clinical.medicineForm.auditCfreq24Month")}</option>
                <option value={3}>{t("clinical.medicineForm.auditCfreq23Week")}</option>
                <option value={4}>{t("clinical.medicineForm.auditCfreq4Week")}</option>
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.auditCq2")}</label>
              <select className="input-new" value={auditC[1]} onChange={e => setAuditC(a => [a[0], Number(e.target.value), a[2]])}>
                <option value={0}>1-2</option><option value={1}>3-4</option><option value={2}>5-6</option><option value={3}>7-9</option><option value={4}>10+</option>
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.auditCq3")}</label>
              <select className="input-new" value={auditC[2]} onChange={e => setAuditC(a => [a[0], a[1], Number(e.target.value)])}>
                <option value={0}>{t("clinical.medicineForm.auditCfreqNever")}</option><option value={1}>{t("clinical.medicineForm.auditCfreqLessThanMonthly")}</option><option value={2}>{t("clinical.medicineForm.auditCfreqMonthly")}</option><option value={3}>{t("clinical.medicineForm.auditCfreqWeekly")}</option><option value={4}>{t("clinical.medicineForm.auditCfreqDaily")}</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>{t("clinical.medicineForm.auditCScore")}</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{auditCScore}/12</span>
              <BadgeNew tone={auditCTone} dot>{auditCSeverity}</BadgeNew>
            </div>
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">{t("clinical.medicineForm.drugsOtherSubstances")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 50, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder={t("clinical.medicineForm.drugsPlaceholder")}
            value={drugs}
            onChange={e => setDrugs(e.target.value)}
          />
        </div>
      </CardNew>

      {/* Diagnóstico diferencial */}
      <CardNew
        title={t("clinical.medicineForm.diffDxTitle")}
        sub={t("clinical.medicineForm.diffDxSub")}
        action={<ButtonNew size="sm" variant="ghost" onClick={addDiffDiag}>{t("clinical.medicineForm.addShort")}</ButtonNew>}
      >
        {diffDiagnoses.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            {t("clinical.medicineForm.diffDxEmpty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {diffDiagnoses.map((dd, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="input-new"
                  placeholder={t("clinical.medicineForm.diffDxPlaceholder")}
                  value={dd.diagnosis}
                  onChange={e => updateDiffDiag(i, "diagnosis", e.target.value)}
                />
                <select
                  className="input-new"
                  style={{ width: 120 }}
                  value={dd.probability}
                  onChange={e => updateDiffDiag(i, "probability", e.target.value)}
                >
                  <option value="Alta">{t("clinical.medicineForm.probHigh")}</option>
                  <option value="Media">{t("clinical.medicineForm.probMedium")}</option>
                  <option value="Baja">{t("clinical.medicineForm.probLow")}</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeDiffDiag(i)}
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ padding: 0, width: 28, color: "var(--danger)" }}
                  aria-label={t("common.delete")}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      {/* Evolución TA */}
      <CardNew title={t("clinical.medicineForm.bpEvolutionTitle")} sub={t("clinical.medicineForm.bpEvolutionSub")}>
        <div className="segment-new" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`segment-new__btn ${bpTab === "systolic" ? "segment-new__btn--active" : ""}`}
            onClick={() => setBpTab("systolic")}
          >
            {t("clinical.medicineForm.systolic")}
          </button>
          <button
            type="button"
            className={`segment-new__btn ${bpTab === "diastolic" ? "segment-new__btn--active" : ""}`}
            onClick={() => setBpTab("diastolic")}
          >
            {t("clinical.medicineForm.diastolic")}
          </button>
        </div>
        {bpTab === "systolic" ? (
          systolicData.length < 2 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
              {t("clinical.medicineForm.add2Consults")}
            </div>
          ) : (
            <EvolutionChart
              data={systolicData}
              metric={t("clinical.medicineForm.bpSystolicMetric")}
              color="#34d399"
              unit="mmHg"
              normalRange={{ min: 90, max: 120 }}
            />
          )
        ) : (
          diastolicData.length < 2 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
              {t("clinical.medicineForm.add2Consults")}
            </div>
          ) : (
            <EvolutionChart
              data={diastolicData}
              metric={t("clinical.medicineForm.bpDiastolicMetric")}
              color="#34d399"
              unit="mmHg"
              normalRange={{ min: 60, max: 80 }}
            />
          )
        )}
      </CardNew>

      {/* Signos vitales */}
      <CardNew title={t("clinical.medicineForm.vitalsTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
          {[
            { key:"bloodPressure", label:t("clinical.medicineForm.vitalBp"),       ph:"120/80" },
            { key:"heartRate",     label:t("clinical.medicineForm.vitalHr"),       ph:"72"     },
            { key:"temperature",   label:t("clinical.medicineForm.vitalTemp"),     ph:"36.5"   },
            { key:"respiratoryRate",label:t("clinical.medicineForm.vitalRr"),      ph:"16"     },
            { key:"oxygenSat",     label:t("clinical.medicineForm.vitalSpo2"),     ph:"98"     },
            { key:"bloodGlucose",  label:t("clinical.medicineForm.vitalGlucose"),  ph:"100"    },
            { key:"weight",        label:t("clinical.medicineForm.vitalWeight"),   ph:"70"     },
            { key:"height",        label:t("clinical.medicineForm.vitalHeight"),   ph:"170"    },
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
      <CardNew title={t("clinical.medicineForm.examLabsTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.medicineForm.examLabsLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.medicineForm.examLabsPlaceholder")}
              value={form.objective}
              onChange={e => set("objective", e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.studiesRequested")}</label>
              <input
                className="input-new"
                placeholder={t("clinical.medicineForm.studiesPlaceholder")}
                value={form.studies}
                onChange={e => set("studies", e.target.value)}
              />
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.diagnosisCie10")}</label>
              <Cie10Selector diagnoses={dxs} onAdd={onAddDx} onRemove={onRemoveDx} disabled={saving} />
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.freeDiagnosis")}</label>
              <input
                className="input-new"
                placeholder={t("clinical.medicineForm.freeDiagnosisPlaceholder")}
                value={form.assessment}
                onChange={e => set("assessment", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardNew>

      {/* Prescripción */}
      <CardNew
        title={t("clinical.medicineForm.prescriptionTitle")}
        action={<ButtonNew size="sm" variant="ghost" onClick={addMed}>{t("clinical.medicineForm.addMedication")}</ButtonNew>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {form.medications.map((med, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.medicineForm.medication")}</label>
                <input
                  className="input-new"
                  placeholder="Amoxicilina 500mg"
                  value={med.drug}
                  onChange={e => { const m=[...form.medications]; m[i].drug=e.target.value; set("medications",m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.medicineForm.dose")}</label>
                <input
                  className="input-new mono"
                  placeholder="500mg"
                  value={med.dose}
                  onChange={e => { const m=[...form.medications]; m[i].dose=e.target.value; set("medications",m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.medicineForm.frequency")}</label>
                <select
                  className="input-new"
                  value={med.frequency}
                  onChange={e => { const m=[...form.medications]; m[i].frequency=e.target.value; set("medications",m); }}
                >
                  <option value="">…</option>
                  <option value="c/4h">c/4h</option>
                  <option value="c/6h">c/6h</option>
                  <option value="c/8h">c/8h</option>
                  <option value="c/12h">c/12h</option>
                  <option value="c/24h">c/24h</option>
                  <option value="c/48h">c/48h</option>
                  <option value="Semanal">{t("clinical.medicineForm.freqWeekly")}</option>
                  <option value="Según necesidad">{t("clinical.medicineForm.freqAsNeeded")}</option>
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.medicineForm.duration")}</label>
                <input
                  className="input-new"
                  placeholder={t("clinical.medicineForm.durationPlaceholder")}
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
                  aria-label={t("common.delete")}
                >×</button>
              )}
            </div>
          ))}
        </div>
      </CardNew>

      {/* Referido */}
      <CardNew title={t("clinical.medicineForm.referralTitle")}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.referral.needed}
            onChange={e => set("referral", { ...form.referral, needed: e.target.checked })}
          />
          <span style={{ fontSize: 13, color: "var(--text-1)" }}>{t("clinical.medicineForm.referToOtherSpecialty")}</span>
        </label>
        {form.referral.needed && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.specialty")}</label>
              <select
                className="input-new"
                value={form.referral.specialty}
                onChange={e => set("referral", { ...form.referral, specialty: e.target.value })}
              >
                <option value="">{t("clinical.medicineForm.selectPlaceholder")}</option>
                {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.referralReason")}</label>
              <input
                className="input-new"
                placeholder={t("clinical.medicineForm.referralReasonPlaceholder")}
                value={form.referral.reason}
                onChange={e => set("referral", { ...form.referral, reason: e.target.value })}
              />
            </div>
          </div>
        )}
      </CardNew>

      {/* Plan e incapacidad */}
      <CardNew title={t("clinical.medicineForm.planTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.medicineForm.planLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.medicineForm.planPlaceholder")}
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.medicineForm.nextAppointment")}</label>
              <DateField
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
                <span style={{ fontSize: 12, color: "#fcd34d", fontWeight: 600 }}>{t("clinical.medicineForm.sickLeave")}</span>
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
                  <span style={{ fontSize: 12, color: "#fcd34d" }}>{t("clinical.medicineForm.daysOfLeave")}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardNew>

      {/* Save */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.medicineForm.saveButton")}
        </ButtonNew>
      </div>

      <CalculatorModal isOpen={calcOpen} onClose={() => setCalcOpen(false)} />
    </div>
  );
}
