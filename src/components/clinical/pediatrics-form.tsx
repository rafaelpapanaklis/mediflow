"use client";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FileText, X } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { GrowthCurves } from "@/components/clinical/pediatrics/growth-curves";
import { PrescriptionQR } from "@/components/clinical/shared";

interface Props { patientId: string; patient?: any; onSaved: (record: any) => void }

type MetricTab = "weight-age" | "height-age" | "bmi-age";

interface Vaccine { id: string; label: string; applied: boolean; date: string }
interface Milestone { id: string; label: string; age: string; achieved: boolean }
interface Med { name: string; dose: string; frequency: string; duration: string; notes: string }

const DEFAULT_VACCINES: Vaccine[] = [
  { id: "bcg", label: "BCG (nacimiento)", applied: false, date: "" },
  { id: "hepB", label: "Hepatitis B (nacimiento, 2m, 6m)", applied: false, date: "" },
  { id: "penta2", label: "Pentavalente (2 meses)", applied: false, date: "" },
  { id: "penta4", label: "Pentavalente (4 meses)", applied: false, date: "" },
  { id: "penta6", label: "Pentavalente (6 meses)", applied: false, date: "" },
  { id: "rota", label: "Rotavirus (2, 4, 6 meses)", applied: false, date: "" },
  { id: "neumo", label: "Neumocócica conjugada (2, 4, 12 meses)", applied: false, date: "" },
  { id: "influenza", label: "Influenza (6m en adelante, anual)", applied: false, date: "" },
  { id: "srp12", label: "SRP (12 meses)", applied: false, date: "" },
  { id: "srp6a", label: "SRP refuerzo (6 años)", applied: false, date: "" },
  { id: "dpt", label: "DPT refuerzo (4 años)", applied: false, date: "" },
  { id: "vph", label: "VPH (11 años)", applied: false, date: "" },
];

const DEFAULT_MILESTONES: Milestone[] = [
  { id: "smile", label: "Sonrisa social", age: "2m", achieved: false },
  { id: "head", label: "Sostén cefálico", age: "3-4m", achieved: false },
  { id: "roll", label: "Giros prono-supino", age: "4-5m", achieved: false },
  { id: "sit", label: "Sedestación con apoyo", age: "6m", achieved: false },
  { id: "crawl", label: "Gateo", age: "8-9m", achieved: false },
  { id: "stand", label: "Bipedestación con apoyo", age: "10m", achieved: false },
  { id: "walk", label: "Marcha independiente", age: "12m", achieved: false },
  { id: "words", label: "Primeras palabras", age: "12m", achieved: false },
  { id: "phrase", label: "Frases 2-3 palabras", age: "24m", achieved: false },
  { id: "run", label: "Corre con coordinación", age: "24-30m", achieved: false },
];

function ageInMonths(dob?: string | Date): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  return Math.max(0, months);
}

export function PediatricsForm({ patientId, patient, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [rxSaving, setRxSaving] = useState(false);
  const [rxResult, setRxResult] = useState<any | null>(null);

  const [form, setForm] = useState({
    subjective: "",
    anthro: { weight: "", height: "", headCirc: "" },
    ageMonthsManual: "",
    feeding: { breastFormula: "", weaning: "", currentDiet: "" },
    plan: "",
    indications: "",
  });

  const [tab, setTab] = useState<MetricTab>("weight-age");
  const [vaccines, setVaccines] = useState<Vaccine[]>(DEFAULT_VACCINES);
  const [milestones, setMilestones] = useState<Milestone[]>(DEFAULT_MILESTONES);
  const [meds, setMeds] = useState<Med[]>([{ name: "", dose: "", frequency: "", duration: "", notes: "" }]);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setAnthro = (k: string, v: string) => setForm(f => ({ ...f, anthro: { ...f.anthro, [k]: v } }));
  const setFeeding = (k: string, v: string) => setForm(f => ({ ...f, feeding: { ...f.feeding, [k]: v } }));

  const w = parseFloat(form.anthro.weight) || 0;
  const h = parseFloat(form.anthro.height) || 0;
  const bmi = w > 0 && h > 0 ? +(w / ((h / 100) ** 2)).toFixed(1) : 0;

  const autoAgeMonths = useMemo(() => ageInMonths(patient?.dob), [patient]);
  const ageM = autoAgeMonths ?? (parseFloat(form.ageMonthsManual) || 0);
  const gender: "M" | "F" = patient?.gender === "F" ? "F" : "M";

  const growthValue = useMemo(() => {
    if (tab === "weight-age") return w;
    if (tab === "height-age") return h;
    return bmi;
  }, [tab, w, h, bmi]);

  const toggleVaccine = (id: string) =>
    setVaccines(vs => vs.map(v => (v.id === id ? { ...v, applied: !v.applied } : v)));
  const setVaccineDate = (id: string, date: string) =>
    setVaccines(vs => vs.map(v => (v.id === id ? { ...v, date } : v)));
  const toggleMilestone = (id: string) =>
    setMilestones(ms => ms.map(m => (m.id === id ? { ...m, achieved: !m.achieved } : m)));

  const addMed = () => setMeds(m => [...m, { name: "", dose: "", frequency: "", duration: "", notes: "" }]);
  const removeMed = (i: number) => setMeds(m => m.filter((_, j) => j !== i));
  const updateMed = (i: number, k: keyof Med, v: string) =>
    setMeds(m => m.map((mm, j) => (j === i ? { ...mm, [k]: v } : mm)));

  async function handleSave() {
    if (!form.subjective && !form.plan) {
      toast.error("Agrega el motivo de consulta o plan");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          assessment: "",
          plan: form.plan,
          specialtyData: {
            type: "pediatrics",
            anthropometrics: { weight: w || undefined, height: h || undefined, headCirc: form.anthro.headCirc || undefined, bmi: bmi || undefined },
            ageMonths: ageM || undefined,
            feeding: form.feeding,
            vaccines: vaccines.filter(v => v.applied),
            milestones: milestones.filter(m => m.achieved).map(m => ({ id: m.id, label: m.label, age: m.age })),
            indications: form.indications,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success("Consulta pediátrica guardada");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePrescription() {
    const filtered = meds.filter(m => m.name.trim());
    if (filtered.length === 0) {
      toast.error("Agrega al menos un medicamento");
      return;
    }
    setRxSaving(true);
    try {
      const clinicalRes = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          assessment: "",
          plan: form.plan,
          specialtyData: { type: "pediatrics", indications: form.indications },
        }),
      });
      if (!clinicalRes.ok) throw new Error("No se pudo guardar el expediente");
      const record = await clinicalRes.json();
      const rxRes = await fetch("/api/prescriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          medicalRecordId: record.id,
          patientId,
          medications: filtered,
          indications: form.indications,
        }),
      });
      if (!rxRes.ok) throw new Error("No se pudo crear la receta");
      const rx = await rxRes.json();
      setRxResult({ ...rx, medications: filtered });
      setRxOpen(false);
      onSaved(record);
      toast.success("Receta creada");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setRxSaving(false);
    }
  }

  const metricLabel: Record<MetricTab, string> = {
    "weight-age": "Peso / Edad",
    "height-age": "Talla / Edad",
    "bmi-age": "IMC / Edad",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Motivo de consulta">
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="Control de niño sano, fiebre, tos…"
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title="Antropometría">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Peso (kg)</label>
            <input type="number" step="0.1" className="input-new mono" placeholder="12.5" value={form.anthro.weight} onChange={e => setAnthro("weight", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Talla (cm)</label>
            <input type="number" step="0.1" className="input-new mono" placeholder="90" value={form.anthro.height} onChange={e => setAnthro("height", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Perímetro cefálico (cm)</label>
            <input type="number" step="0.1" className="input-new mono" placeholder="48" value={form.anthro.headCirc} onChange={e => setAnthro("headCirc", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">IMC</label>
            <input className="input-new mono" value={bmi > 0 ? String(bmi) : ""} readOnly placeholder="—" />
          </div>
          <div className="field-new">
            <label className="field-new__label">Edad (meses){autoAgeMonths !== null ? " auto" : ""}</label>
            <input
              type="number"
              className="input-new mono"
              placeholder="24"
              value={autoAgeMonths !== null ? String(autoAgeMonths) : form.ageMonthsManual}
              onChange={e => set("ageMonthsManual", e.target.value)}
              readOnly={autoAgeMonths !== null}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Curvas de crecimiento">
        <div className="segment-new" style={{ marginBottom: 14 }}>
          {(["weight-age", "height-age", "bmi-age"] as MetricTab[]).map(t => (
            <button
              key={t}
              type="button"
              className={`segment-new__btn ${tab === t ? "segment-new__btn--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {metricLabel[t]}
            </button>
          ))}
        </div>
        {ageM > 0 && growthValue > 0 ? (
          <GrowthCurves metric={tab} gender={gender} ageMonths={ageM} value={growthValue} />
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
            Captura edad y {tab === "weight-age" ? "peso" : tab === "height-age" ? "talla" : "IMC"} para ver la curva
          </div>
        )}
      </CardNew>

      <CardNew title="Vacunación cartilla nacional MX">
        <table className="table-new">
          <thead>
            <tr>
              <th>Vacuna</th>
              <th style={{ textAlign: "center", width: 90 }}>Aplicada</th>
              <th style={{ width: 180 }}>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {vaccines.map(v => (
              <tr key={v.id}>
                <td>{v.label}</td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={v.applied} onChange={() => toggleVaccine(v.id)} />
                </td>
                <td>
                  <input type="date" className="input-new" value={v.date} onChange={e => setVaccineDate(v.id, e.target.value)} disabled={!v.applied} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardNew>

      <CardNew title="Hitos del desarrollo">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {milestones.map(m => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: m.achieved ? "rgba(52,211,153,0.08)" : "transparent" }}>
              <input type="checkbox" checked={m.achieved} onChange={() => toggleMilestone(m.id)} />
              <span style={{ fontSize: 12, color: "var(--text-1)", flex: 1 }}>{m.label}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-2)" }}>{m.age}</span>
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title="Alimentación">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Lactancia materna / fórmula</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="LME hasta 6m, fórmula complementaria…"
              value={form.feeding.breastFormula}
              onChange={e => setFeeding("breastFormula", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Ablactación</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Inicio a los 6m con verduras y frutas…"
              value={form.feeding.weaning}
              onChange={e => setFeeding("weaning", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Dieta actual</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="3 comidas + 2 colaciones, variada…"
              value={form.feeding.currentDiet}
              onChange={e => setFeeding("currentDiet", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew
        title="Plan y receta"
        action={
          <ButtonNew size="sm" variant="ghost" icon={<FileText size={14} />} onClick={() => setRxOpen(true)}>
            Crear receta
          </ButtonNew>
        }
      >
        <div className="field-new">
          <label className="field-new__label">Plan e indicaciones</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
            placeholder="Dieta, vigilar fiebre, control en 2 semanas…"
            value={form.plan}
            onChange={e => set("plan", e.target.value)}
          />
        </div>
        {rxResult && (
          <div style={{ marginTop: 16 }}>
            <PrescriptionQR
              prescriptionId={rxResult.id}
              verifyUrl={rxResult.verifyUrl || ""}
              doctor=""
              clinic=""
              patient=""
              medications={rxResult.medications}
              indications={rxResult.indications ?? undefined}
              issuedAt={rxResult.issuedAt || new Date()}
              expiresAt={rxResult.expiresAt ?? null}
              cofeprisGroup={rxResult.cofeprisGroup ?? null}
              cofeprisFolio={rxResult.cofeprisFolio ?? null}
            />
          </div>
        )}
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta"}
        </ButtonNew>
      </div>

      {rxOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setRxOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 820, width: "100%", maxHeight: "85vh", overflow: "auto", background: "var(--bg-elev)", borderRadius: 12, border: "1px solid var(--border)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 600, fontSize: 15, color: "var(--text-1)" }}>Nueva receta</div>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={() => setRxOpen(false)} style={{ padding: 0, width: 28 }} aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {meds.map((m, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
                  <div className="field-new">
                    <label className="field-new__label">Medicamento</label>
                    <input className="input-new" placeholder="Amoxicilina susp. 250mg/5mL" value={m.name} onChange={e => updateMed(i, "name", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Dosis</label>
                    <input className="input-new mono" placeholder="5 mL" value={m.dose} onChange={e => updateMed(i, "dose", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Frecuencia</label>
                    <input className="input-new" placeholder="c/8h" value={m.frequency} onChange={e => updateMed(i, "frequency", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Duración</label>
                    <input className="input-new" placeholder="7 días" value={m.duration} onChange={e => updateMed(i, "duration", e.target.value)} />
                  </div>
                  {meds.length > 1 && (
                    <button type="button" onClick={() => removeMed(i)} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 0, width: 28, color: "var(--danger)", alignSelf: "flex-end" }} aria-label="Eliminar">×</button>
                  )}
                </div>
              ))}
              <div>
                <ButtonNew size="sm" variant="ghost" onClick={addMed}>+ Agregar medicamento</ButtonNew>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
              <ButtonNew variant="ghost" onClick={() => setRxOpen(false)}>Cancelar</ButtonNew>
              <ButtonNew variant="primary" onClick={handleCreatePrescription} disabled={rxSaving}>
                {rxSaving ? "Creando…" : "Crear receta"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
