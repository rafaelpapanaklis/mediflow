"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Repertorization } from "@/components/clinical/homeopatia/repertorization";
import { useT } from "@/i18n/i18n-provider";

interface Props { patientId: string; onSaved: (record: any) => void }

export function HomeopatiaForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    subjective: "",
    biotipo: "",
    temperamento: "",
    miasma: "",
    modalities: { better: "", worse: "", desires: "", aversions: "" },
    remedy: { name: "", potency: "30CH", dosage: "" },
    follow: { notes: "", weeks: "" },
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setMod = (k: string, v: string) => setForm(f => ({ ...f, modalities: { ...f.modalities, [k]: v } }));
  const setRemedy = (k: string, v: string) => setForm(f => ({ ...f, remedy: { ...f.remedy, [k]: v } }));
  const setFollow = (k: string, v: string) => setForm(f => ({ ...f, follow: { ...f.follow, [k]: v } }));

  const constitutional = [form.biotipo, form.temperamento].filter(Boolean).join(" · ");

  function handleRemedySelect(remedy: { name: string; potency: string; score: number; rationale: string }) {
    setForm(f => ({
      ...f,
      remedy: { ...f.remedy, name: remedy.name, potency: remedy.potency || f.remedy.potency },
    }));
    toast.success(t("clinical.homeopatiaForm.remedyLoaded", { name: remedy.name }));
  }

  async function handleSave() {
    if (!form.subjective && !form.remedy.name) {
      toast.error(t("clinical.homeopatiaForm.reasonOrRemedyRequired"));
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
          assessment: [form.biotipo, form.temperamento, form.miasma].filter(Boolean).join(" · "),
          plan: form.follow.notes,
          specialtyData: {
            type: "homeopatia",
            constitutional: {
              biotipo: form.biotipo,
              temperamento: form.temperamento,
              miasma: form.miasma,
            },
            modalities: form.modalities,
            remedy: form.remedy,
            followUp: form.follow,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success(t("clinical.homeopatiaForm.saved"));
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.homeopatiaForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.homeopatiaForm.reasonPlaceholder")}
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title={t("clinical.homeopatiaForm.constitutionalTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.biotype")}</label>
            <select className="input-new" value={form.biotipo} onChange={e => set("biotipo", e.target.value)}>
              <option value="">{t("clinical.homeopatiaForm.selectOption")}</option>
              <option value="Carbónico">{t("clinical.homeopatiaForm.biotypeCarbonic")}</option>
              <option value="Fosfórico">{t("clinical.homeopatiaForm.biotypePhosphoric")}</option>
              <option value="Fluórico">{t("clinical.homeopatiaForm.biotypeFluoric")}</option>
              <option value="Sulfúrico">{t("clinical.homeopatiaForm.biotypeSulfuric")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.temperament")}</label>
            <select className="input-new" value={form.temperamento} onChange={e => set("temperamento", e.target.value)}>
              <option value="">{t("clinical.homeopatiaForm.selectOption")}</option>
              <option value="Sanguíneo">{t("clinical.homeopatiaForm.temperamentSanguine")}</option>
              <option value="Flemático">{t("clinical.homeopatiaForm.temperamentPhlegmatic")}</option>
              <option value="Colérico">{t("clinical.homeopatiaForm.temperamentCholeric")}</option>
              <option value="Melancólico">{t("clinical.homeopatiaForm.temperamentMelancholic")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.miasm")}</label>
            <select className="input-new" value={form.miasma} onChange={e => set("miasma", e.target.value)}>
              <option value="">{t("clinical.homeopatiaForm.selectOption")}</option>
              <option value="Psórico">{t("clinical.homeopatiaForm.miasmPsoric")}</option>
              <option value="Sicótico">{t("clinical.homeopatiaForm.miasmSycotic")}</option>
              <option value="Sifilítico">{t("clinical.homeopatiaForm.miasmSyphilitic")}</option>
              <option value="Tuberculínico">{t("clinical.homeopatiaForm.miasmTubercular")}</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.homeopatiaForm.modalitiesTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.betterWith")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.homeopatiaForm.betterPlaceholder")}
              value={form.modalities.better}
              onChange={e => setMod("better", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.worseWith")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.homeopatiaForm.worsePlaceholder")}
              value={form.modalities.worse}
              onChange={e => setMod("worse", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.desires")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.homeopatiaForm.desiresPlaceholder")}
              value={form.modalities.desires}
              onChange={e => setMod("desires", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.aversions")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.homeopatiaForm.aversionsPlaceholder")}
              value={form.modalities.aversions}
              onChange={e => setMod("aversions", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.homeopatiaForm.repertorizationTitle")}>
        <Repertorization constitutional={constitutional || undefined} onRemedySelect={handleRemedySelect} />
      </CardNew>

      <CardNew title={t("clinical.homeopatiaForm.chosenRemedyTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("common.name")}</label>
            <input
              className="input-new"
              placeholder="Sulphur, Lycopodium, Natrum muriaticum…"
              value={form.remedy.name}
              onChange={e => setRemedy("name", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.potency")}</label>
            <select className="input-new" value={form.remedy.potency} onChange={e => setRemedy("potency", e.target.value)}>
              <option value="6CH">6CH</option>
              <option value="30CH">30CH</option>
              <option value="200CH">200CH</option>
              <option value="1M">1M</option>
              <option value="10M">10M</option>
              <option value="50M">50M</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.dosage")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.homeopatiaForm.dosagePlaceholder")}
              value={form.remedy.dosage}
              onChange={e => setRemedy("dosage", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.homeopatiaForm.followUpTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.followUpNotes")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.homeopatiaForm.followUpNotesPlaceholder")}
              value={form.follow.notes}
              onChange={e => setFollow("notes", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.homeopatiaForm.nextAppointmentWeeks")}</label>
            <input type="number" min="1" className="input-new mono" placeholder="4" value={form.follow.weeks} onChange={e => setFollow("weeks", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.homeopatiaForm.saveConsult")}
        </ButtonNew>
      </div>
    </div>
  );
}
