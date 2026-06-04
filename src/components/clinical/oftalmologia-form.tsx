"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { DateField } from "@/components/ui/date-field";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { VisualAcuityTable } from "@/components/clinical/oftalmologia/visual-acuity-table";
import { OpticalPrescription } from "@/components/clinical/oftalmologia/optical-prescription";
import { useT } from "@/i18n/i18n-provider";

interface Props { patientId: string; patient?: any; onSaved: (record: any) => void }

interface OpticalRx {
  od: { esf?: number; cil?: number; eje?: number; add?: number };
  oi: { esf?: number; cil?: number; eje?: number; add?: number };
  dp?: number;
  notes?: string;
}

export function OftalmologiaForm({ patientId, patient, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    subjective: "",
    fundus: { od: "", oi: "" },
    iop: { od: "", oi: "" },
    plan: "",
    nextVisit: "",
  });
  const [visualAcuity, setVisualAcuity] = useState<{ odSC?: string; odCC?: string; oiSC?: string; oiCC?: string }>({});
  const [rx, setRx] = useState<OpticalRx>({ od: {}, oi: {} });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setFundus = (k: string, v: string) => setForm(f => ({ ...f, fundus: { ...f.fundus, [k]: v } }));
  const setIop = (k: string, v: string) => setForm(f => ({ ...f, iop: { ...f.iop, [k]: v } }));

  const patientName = [patient?.firstName, patient?.lastName].filter(Boolean).join(" ");

  async function handleSave() {
    if (!form.subjective && !form.plan) {
      toast.error(t("clinical.oftalmologiaForm.addReasonOrPlan"));
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
            type: "oftalmologia",
            visualAcuity,
            rx,
            fundus: form.fundus,
            iop: form.iop,
            nextVisit: form.nextVisit,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success(t("clinical.oftalmologiaForm.savedToast"));
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.oftalmologiaForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.oftalmologiaForm.reasonPlaceholder")}
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title={t("clinical.oftalmologiaForm.visualAcuityTitle")}>
        <VisualAcuityTable values={visualAcuity} onChange={setVisualAcuity} editable />
      </CardNew>

      <CardNew title={t("clinical.oftalmologiaForm.refractionTitle")}>
        <OpticalPrescription rx={rx} onChange={setRx} editable patientName={patientName || undefined} />
      </CardNew>

      <CardNew title={t("clinical.oftalmologiaForm.fundusTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">OD</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.oftalmologiaForm.fundusPlaceholder")}
              value={form.fundus.od}
              onChange={e => setFundus("od", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">OI</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.oftalmologiaForm.fundusPlaceholder")}
              value={form.fundus.oi}
              onChange={e => setFundus("oi", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.oftalmologiaForm.iopTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">OD (mmHg)</label>
            <input type="number" className="input-new mono" placeholder="14" value={form.iop.od} onChange={e => setIop("od", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">OI (mmHg)</label>
            <input type="number" className="input-new mono" placeholder="14" value={form.iop.oi} onChange={e => setIop("oi", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.oftalmologiaForm.planTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.oftalmologiaForm.planLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.oftalmologiaForm.planPlaceholder")}
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.oftalmologiaForm.nextVisitLabel")}</label>
            <DateField className="input-new" value={form.nextVisit} onChange={e => set("nextVisit", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.oftalmologiaForm.saveConsultation")}
        </ButtonNew>
      </div>
    </div>
  );
}
