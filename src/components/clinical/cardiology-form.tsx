"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Calculator, FileText } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { CalculatorModal } from "@/components/clinical/calculators/calculator-modal";
import { EkgRenderer } from "@/components/clinical/cardiology/ekg-renderer";
import { PrescriptionModal } from "@/components/clinical/shared/prescription-modal";
import { useT } from "@/i18n/i18n-provider";

interface Props { patientId: string; onSaved: (record: any) => void }

type RhythmType = "normal" | "sinus" | "afib" | "flutter" | "vtach" | "paced";

export function CardiologyForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  // Receta standalone — no toca el expediente clínico para evitar
  // medicalRecord huérfanos en el histórico.
  const [rxOpen, setRxOpen] = useState(false);
  const [rxResult, setRxResult] = useState<{ id: string; verifyUrl: string } | null>(null);

  const [form, setForm] = useState({
    subjective: "",
    vitals: { bpSys: "", bpDia: "", hr: "", rr: "", spo2: "", temp: "" },
    ekg: { rhythm: "sinus" as RhythmType, rate: "72", pr: "160", qrs: "90", qt: "380" },
    auscultation: { cardiac: "", pulmonary: "" },
    scales: { cha2ds2Vasc: "", nyha: "" },
    plan: "",
    indications: "",
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setV = (k: string, v: string) => setForm(f => ({ ...f, vitals: { ...f.vitals, [k]: v } }));
  const setE = (k: string, v: string) => setForm(f => ({ ...f, ekg: { ...f.ekg, [k]: v } }));
  const setA = (k: string, v: string) => setForm(f => ({ ...f, auscultation: { ...f.auscultation, [k]: v } }));
  const setS = (k: string, v: string) => setForm(f => ({ ...f, scales: { ...f.scales, [k]: v } }));

  async function handleSave() {
    if (!form.subjective && !form.plan) {
      toast.error(t("clinical.cardiologyForm.reasonOrPlanRequired"));
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
      toast.success(t("clinical.cardiologyForm.savedToast"));
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  function openPrescriptionModal() {
    setRxOpen(true);
  }

  const ekgRate = Number(form.ekg.rate) || 72;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.cardiologyForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.cardiologyForm.reasonPlaceholder")}
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title={t("clinical.cardiologyForm.vitalsTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.bpSysLabel")}</label>
            <input type="number" className="input-new mono" placeholder="120" value={form.vitals.bpSys} onChange={e => setV("bpSys", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.bpDiaLabel")}</label>
            <input type="number" className="input-new mono" placeholder="80" value={form.vitals.bpDia} onChange={e => setV("bpDia", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.hrLabel")}</label>
            <input type="number" className="input-new mono" placeholder="72" value={form.vitals.hr} onChange={e => setV("hr", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.rrLabel")}</label>
            <input type="number" className="input-new mono" placeholder="16" value={form.vitals.rr} onChange={e => setV("rr", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.spo2Label")}</label>
            <input type="number" className="input-new mono" placeholder="98" value={form.vitals.spo2} onChange={e => setV("spo2", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.tempLabel")}</label>
            <input type="number" step="0.1" className="input-new mono" placeholder="36.5" value={form.vitals.temp} onChange={e => setV("temp", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.cardiologyForm.ekgTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px 14px", marginBottom: 16 }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.rhythmLabel")}</label>
            <select className="input-new" value={form.ekg.rhythm} onChange={e => setE("rhythm", e.target.value)}>
              <option value="normal">{t("clinical.cardiologyForm.rhythmNormal")}</option>
              <option value="sinus">{t("clinical.cardiologyForm.rhythmSinus")}</option>
              <option value="afib">{t("clinical.cardiologyForm.rhythmAfib")}</option>
              <option value="flutter">{t("clinical.cardiologyForm.rhythmFlutter")}</option>
              <option value="vtach">{t("clinical.cardiologyForm.rhythmVtach")}</option>
              <option value="paced">{t("clinical.cardiologyForm.rhythmPaced")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.frequencyLabel")}</label>
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

      <CardNew title={t("clinical.cardiologyForm.auscultationTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.cardiacLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.cardiologyForm.cardiacPlaceholder")}
              value={form.auscultation.cardiac}
              onChange={e => setA("cardiac", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.pulmonaryLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.cardiologyForm.pulmonaryPlaceholder")}
              value={form.auscultation.pulmonary}
              onChange={e => setA("pulmonary", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew
        title={t("clinical.cardiologyForm.scalesTitle")}
        action={
          <ButtonNew type="button" size="sm" variant="ghost" icon={<Calculator size={14} />} onClick={() => setCalcOpen(true)}>
            {t("clinical.cardiologyForm.clinicalCalculators")}
          </ButtonNew>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.cha2ds2VascLabel")}</label>
            <input
              type="number" min="0" max="9"
              className="input-new mono"
              placeholder="0-9"
              value={form.scales.cha2ds2Vasc}
              onChange={e => setS("cha2ds2Vasc", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.cardiologyForm.nyhaLabel")}</label>
            <select className="input-new" value={form.scales.nyha} onChange={e => setS("nyha", e.target.value)}>
              <option value="">{t("clinical.cardiologyForm.selectPlaceholder")}</option>
              <option value="I">{t("clinical.cardiologyForm.nyhaClassI")}</option>
              <option value="II">{t("clinical.cardiologyForm.nyhaClassII")}</option>
              <option value="III">{t("clinical.cardiologyForm.nyhaClassIII")}</option>
              <option value="IV">{t("clinical.cardiologyForm.nyhaClassIV")}</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew
        title={t("clinical.cardiologyForm.planTitle")}
        action={
          <ButtonNew type="button" size="sm" variant="ghost" icon={<FileText size={14} />} onClick={openPrescriptionModal}>
            {t("clinical.cardiologyForm.createPrescription")}
          </ButtonNew>
        }
      >
        <div className="field-new">
          <label className="field-new__label">{t("clinical.cardiologyForm.planLabel")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
            placeholder={t("clinical.cardiologyForm.planPlaceholder")}
            value={form.plan}
            onChange={e => set("plan", e.target.value)}
          />
        </div>
        {rxResult && (
          <div style={{ marginTop: 16, padding: 12, background: "rgba(16, 185, 129, 0.06)", border: "1px solid rgba(16, 185, 129, 0.30)", borderRadius: 10, fontSize: 13 }}>
            ✓ {t("clinical.cardiologyForm.prescriptionCreated")} <a href={rxResult.verifyUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#059669", fontWeight: 600 }}>{t("clinical.cardiologyForm.viewPrescription")}</a>
          </div>
        )}
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.cardiologyForm.saveConsultation")}
        </ButtonNew>
      </div>

      <CalculatorModal isOpen={calcOpen} onClose={() => setCalcOpen(false)} defaultSpecialty="cardiología" />

      <PrescriptionModal
        open={rxOpen}
        patientId={patientId}
        medicalRecordId={null}
        onClose={() => setRxOpen(false)}
        onCreated={(rx) => setRxResult(rx)}
      />
    </div>
  );
}
