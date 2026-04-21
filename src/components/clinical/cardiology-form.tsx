"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Calculator, FileText, X } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { CalculatorModal } from "@/components/clinical/calculators/calculator-modal";
import { EkgRenderer } from "@/components/clinical/cardiology/ekg-renderer";
import { PrescriptionQR } from "@/components/clinical/shared";

interface Props { patientId: string; onSaved: (record: any) => void }

type RhythmType = "normal" | "sinus" | "afib" | "flutter" | "vtach" | "paced";

interface Med { name: string; dose: string; frequency: string; duration: string; notes: string }

export function CardiologyForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [rxSaving, setRxSaving] = useState(false);
  const [rxResult, setRxResult] = useState<any | null>(null);

  const [form, setForm] = useState({
    subjective: "",
    vitals: { bpSys: "", bpDia: "", hr: "", rr: "", spo2: "", temp: "" },
    ekg: { rhythm: "sinus" as RhythmType, rate: "72", pr: "160", qrs: "90", qt: "380" },
    auscultation: { cardiac: "", pulmonary: "" },
    scales: { cha2ds2Vasc: "", nyha: "" },
    plan: "",
    indications: "",
  });
  const [meds, setMeds] = useState<Med[]>([
    { name: "", dose: "", frequency: "", duration: "", notes: "" },
  ]);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setV = (k: string, v: string) => setForm(f => ({ ...f, vitals: { ...f.vitals, [k]: v } }));
  const setE = (k: string, v: string) => setForm(f => ({ ...f, ekg: { ...f.ekg, [k]: v } }));
  const setA = (k: string, v: string) => setForm(f => ({ ...f, auscultation: { ...f.auscultation, [k]: v } }));
  const setS = (k: string, v: string) => setForm(f => ({ ...f, scales: { ...f.scales, [k]: v } }));

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
      const bp = form.vitals.bpSys && form.vitals.bpDia ? `${form.vitals.bpSys}/${form.vitals.bpDia}` : "";
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          assessment: "",
          plan: form.plan,
          vitals: {
            bloodPressure: bp,
            heartRate: form.vitals.hr,
            respiratoryRate: form.vitals.rr,
            oxygenSat: form.vitals.spo2,
            temperature: form.vitals.temp,
          },
          specialtyData: {
            type: "cardiology",
            vitals: { ...form.vitals, bloodPressure: bp },
            ekg: {
              rhythm: form.ekg.rhythm,
              rate: Number(form.ekg.rate) || 0,
              intervals: {
                pr: Number(form.ekg.pr) || undefined,
                qrs: Number(form.ekg.qrs) || undefined,
                qt: Number(form.ekg.qt) || undefined,
              },
            },
            auscultation: form.auscultation,
            scales: {
              cha2ds2Vasc: form.scales.cha2ds2Vasc ? Number(form.scales.cha2ds2Vasc) : undefined,
              nyha: form.scales.nyha || undefined,
            },
            indications: form.indications,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success("Consulta cardiológica guardada");
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
          specialtyData: { type: "cardiology", indications: form.indications },
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

  const ekgRate = Number(form.ekg.rate) || 72;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Motivo de consulta">
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="Dolor precordial, disnea de esfuerzo, palpitaciones…"
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title="Signos vitales">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">TA sistólica (mmHg)</label>
            <input type="number" className="input-new mono" placeholder="120" value={form.vitals.bpSys} onChange={e => setV("bpSys", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">TA diastólica (mmHg)</label>
            <input type="number" className="input-new mono" placeholder="80" value={form.vitals.bpDia} onChange={e => setV("bpDia", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">FC (lpm)</label>
            <input type="number" className="input-new mono" placeholder="72" value={form.vitals.hr} onChange={e => setV("hr", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">FR (rpm)</label>
            <input type="number" className="input-new mono" placeholder="16" value={form.vitals.rr} onChange={e => setV("rr", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">SpO₂ (%)</label>
            <input type="number" className="input-new mono" placeholder="98" value={form.vitals.spo2} onChange={e => setV("spo2", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Temp (°C)</label>
            <input type="number" step="0.1" className="input-new mono" placeholder="36.5" value={form.vitals.temp} onChange={e => setV("temp", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title="Electrocardiograma">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px 14px", marginBottom: 16 }}>
          <div className="field-new">
            <label className="field-new__label">Ritmo</label>
            <select className="input-new" value={form.ekg.rhythm} onChange={e => setE("rhythm", e.target.value)}>
              <option value="normal">Normal</option>
              <option value="sinus">Sinusal</option>
              <option value="afib">Fibrilación auricular</option>
              <option value="flutter">Flutter auricular</option>
              <option value="vtach">Taquicardia ventricular</option>
              <option value="paced">Con marcapasos</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Frecuencia (bpm)</label>
            <input type="number" className="input-new mono" placeholder="72" value={form.ekg.rate} onChange={e => setE("rate", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">PR (ms)</label>
            <input type="number" className="input-new mono" placeholder="160" value={form.ekg.pr} onChange={e => setE("pr", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">QRS (ms)</label>
            <input type="number" className="input-new mono" placeholder="90" value={form.ekg.qrs} onChange={e => setE("qrs", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">QT (ms)</label>
            <input type="number" className="input-new mono" placeholder="380" value={form.ekg.qt} onChange={e => setE("qt", e.target.value)} />
          </div>
        </div>
        <EkgRenderer
          rhythm={form.ekg.rhythm}
          rate={ekgRate}
          intervals={{
            pr: Number(form.ekg.pr) || undefined,
            qrs: Number(form.ekg.qrs) || undefined,
            qt: Number(form.ekg.qt) || undefined,
          }}
        />
      </CardNew>

      <CardNew title="Auscultación">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Cardíaca</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Ruidos rítmicos, sin soplos…"
              value={form.auscultation.cardiac}
              onChange={e => setA("cardiac", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Pulmonar</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Murmullo vesicular conservado, sin estertores…"
              value={form.auscultation.pulmonary}
              onChange={e => setA("pulmonary", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew
        title="Escalas"
        action={
          <ButtonNew size="sm" variant="ghost" icon={<Calculator size={14} />} onClick={() => setCalcOpen(true)}>
            Calculadoras clínicas
          </ButtonNew>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">CHA₂DS₂-VASc (puntaje)</label>
            <input
              type="number" min="0" max="9"
              className="input-new mono"
              placeholder="0-9"
              value={form.scales.cha2ds2Vasc}
              onChange={e => setS("cha2ds2Vasc", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">NYHA (clase)</label>
            <select className="input-new" value={form.scales.nyha} onChange={e => setS("nyha", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="I">Clase I</option>
              <option value="II">Clase II</option>
              <option value="III">Clase III</option>
              <option value="IV">Clase IV</option>
            </select>
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
            placeholder="Inicio IECA, beta bloqueador, control en 4 semanas…"
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

      <CalculatorModal isOpen={calcOpen} onClose={() => setCalcOpen(false)} defaultSpecialty="cardiología" />

      {rxOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setRxOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 820, width: "100%", maxHeight: "85vh", overflow: "auto",
              background: "var(--bg-elev)", borderRadius: 12, border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 600, fontSize: 15, color: "var(--text-1)" }}>
                Nueva receta
              </div>
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                onClick={() => setRxOpen(false)}
                style={{ padding: 0, width: 28 }}
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {meds.map((m, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
                  <div className="field-new">
                    <label className="field-new__label">Medicamento</label>
                    <input className="input-new" placeholder="Enalapril 10mg" value={m.name} onChange={e => updateMed(i, "name", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Dosis</label>
                    <input className="input-new mono" placeholder="10 mg" value={m.dose} onChange={e => updateMed(i, "dose", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Frecuencia</label>
                    <input className="input-new" placeholder="c/12h" value={m.frequency} onChange={e => updateMed(i, "frequency", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Duración</label>
                    <input className="input-new" placeholder="30 días" value={m.duration} onChange={e => updateMed(i, "duration", e.target.value)} />
                  </div>
                  {meds.length > 1 && (
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
