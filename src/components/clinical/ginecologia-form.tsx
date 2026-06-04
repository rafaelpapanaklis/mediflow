"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DateField } from "@/components/ui/date-field";
import { PrenatalTracker } from "@/components/clinical/ginecologia/prenatal-tracker";
import { useT } from "@/i18n/i18n-provider";

interface Props { patientId: string; patient?: any; onSaved: (record: any) => void }

type Mode = "normal" | "prenatal";

interface Ultrasound { date: string; findings: string }

const TRIMESTER_LABS: { id: string; labelKey: string; trimester: 1 | 2 | 3 }[] = [
  { id: "bhcg", labelKey: "clinical.ginecologiaForm.labBhcg", trimester: 1 },
  { id: "grupoRh", labelKey: "clinical.ginecologiaForm.labBloodGroupRh", trimester: 1 },
  { id: "bhT1", labelKey: "clinical.ginecologiaForm.labCbc", trimester: 1 },
  { id: "egoT1", labelKey: "clinical.ginecologiaForm.labUrinalysisCulture", trimester: 1 },
  { id: "vih", labelKey: "clinical.ginecologiaForm.labHivVdrlHbsag", trimester: 1 },
  { id: "glucosa", labelKey: "clinical.ginecologiaForm.labFastingGlucose", trimester: 1 },
  { id: "ctog", labelKey: "clinical.ginecologiaForm.labOgtt", trimester: 2 },
  { id: "bhT2", labelKey: "clinical.ginecologiaForm.labCbcT2", trimester: 2 },
  { id: "egoT2", labelKey: "clinical.ginecologiaForm.labUrinalysisT2", trimester: 2 },
  { id: "bhT3", labelKey: "clinical.ginecologiaForm.labCbcT3", trimester: 3 },
  { id: "sgb", labelKey: "clinical.ginecologiaForm.labGbsCulture", trimester: 3 },
  { id: "egoT3", labelKey: "clinical.ginecologiaForm.labUrinalysisT3", trimester: 3 },
];

export function GinecologiaForm({ patientId, patient, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("normal");

  const [form, setForm] = useState({
    subjective: "",
    history: {
      menarca: "",
      ivsa: "",
      gesta: "",
      para: "",
      aborto: "",
      cesarea: "",
      fur: "",
      method: "",
    },
    exam: { breasts: "", pelvic: "", cytology: "" },
    plan: "",
    fum: "",
    prenatal: { weight: "", bp: "", fundalHeight: "", fhr: "", movements: "" },
  });

  const [ultrasounds, setUltrasounds] = useState<Ultrasound[]>([]);
  const [labs, setLabs] = useState<Record<string, boolean>>({});

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setH = (k: string, v: string) => setForm(f => ({ ...f, history: { ...f.history, [k]: v } }));
  const setE = (k: string, v: string) => setForm(f => ({ ...f, exam: { ...f.exam, [k]: v } }));
  const setP = (k: string, v: string) => setForm(f => ({ ...f, prenatal: { ...f.prenatal, [k]: v } }));

  const addUS = () => setUltrasounds(us => [...us, { date: "", findings: "" }]);
  const removeUS = (i: number) => setUltrasounds(us => us.filter((_, j) => j !== i));
  const updateUS = (i: number, k: keyof Ultrasound, v: string) =>
    setUltrasounds(us => us.map((u, j) => (j === i ? { ...u, [k]: v } : u)));

  const toggleLab = (id: string) => setLabs(l => ({ ...l, [id]: !l[id] }));

  async function handleSave() {
    if (!form.subjective && !form.plan && mode === "normal") {
      toast.error(t("clinical.ginecologiaForm.errReasonOrPlan"));
      return;
    }
    if (mode === "prenatal" && !form.fum) {
      toast.error(t("clinical.ginecologiaForm.errCaptureLmp"));
      return;
    }
    setSaving(true);
    try {
      const specialtyData: any = {
        type: "ginecologia",
        mode,
      };
      if (mode === "normal") {
        specialtyData.history = form.history;
        specialtyData.exam = form.exam;
      } else {
        specialtyData.fum = form.fum;
        specialtyData.prenatal = form.prenatal;
        specialtyData.ultrasounds = ultrasounds.filter(u => u.date || u.findings);
        specialtyData.labs = Object.entries(labs).filter(([, v]) => v).map(([k]) => k);
      }

      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          assessment: "",
          plan: form.plan,
          specialtyData,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success(mode === "prenatal" ? t("clinical.ginecologiaForm.savedPrenatal") : t("clinical.ginecologiaForm.savedConsult"));
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  const prenatalMeasurements = ultrasounds
    .filter(u => u.date && u.findings)
    .map(u => ({ weeks: 0, fundal: 0 }))
    .filter(m => m.weeks > 0);

  const fundalHeightNum = parseFloat(form.prenatal.fundalHeight) || undefined;
  const weightNum = parseFloat(form.prenatal.weight) || undefined;
  const fhrNum = parseFloat(form.prenatal.fhr) || undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="segment-new">
        <button
          type="button"
          className={`segment-new__btn ${mode === "normal" ? "segment-new__btn--active" : ""}`}
          onClick={() => setMode("normal")}
        >
          {t("clinical.ginecologiaForm.modeNormal")}
        </button>
        <button
          type="button"
          className={`segment-new__btn ${mode === "prenatal" ? "segment-new__btn--active" : ""}`}
          onClick={() => setMode("prenatal")}
        >
          {t("clinical.ginecologiaForm.modePrenatal")}
        </button>
      </div>

      {mode === "normal" ? (
        <>
          <CardNew title={t("clinical.ginecologiaForm.reasonTitle")}>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.ginecologiaForm.reasonPlaceholder")}
              value={form.subjective}
              onChange={e => set("subjective", e.target.value)}
            />
          </CardNew>

          <CardNew title={t("clinical.ginecologiaForm.historyTitle")}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.menarcheAge")}</label>
                <input type="number" className="input-new mono" placeholder="12" value={form.history.menarca} onChange={e => setH("menarca", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.ivsaAge")}</label>
                <input type="number" className="input-new mono" placeholder="18" value={form.history.ivsa} onChange={e => setH("ivsa", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.gravida")}</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.gesta} onChange={e => setH("gesta", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.para")}</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.para} onChange={e => setH("para", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.abortions")}</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.aborto} onChange={e => setH("aborto", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.cesareans")}</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.cesarea} onChange={e => setH("cesarea", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.lmpPrevAbbr")}</label>
                <DateField className="input-new" value={form.history.fur} onChange={e => setH("fur", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.contraceptiveMethod")}</label>
                <select className="input-new" value={form.history.method} onChange={e => setH("method", e.target.value)}>
                  <option value="">{t("clinical.ginecologiaForm.methodNone")}</option>
                  <option value="ACO">{t("clinical.ginecologiaForm.methodOral")}</option>
                  <option value="DIU">{t("clinical.ginecologiaForm.methodIud")}</option>
                  <option value="Implante">{t("clinical.ginecologiaForm.methodImplant")}</option>
                  <option value="Inyectable">{t("clinical.ginecologiaForm.methodInjectable")}</option>
                  <option value="Parche">{t("clinical.ginecologiaForm.methodPatch")}</option>
                  <option value="Barrera">{t("clinical.ginecologiaForm.methodBarrier")}</option>
                  <option value="OTB">{t("clinical.ginecologiaForm.methodTubalLigation")}</option>
                  <option value="Vasectomía pareja">{t("clinical.ginecologiaForm.methodPartnerVasectomy")}</option>
                </select>
              </div>
            </div>
          </CardNew>

          <CardNew title={t("clinical.ginecologiaForm.examTitle")}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.breasts")}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder={t("clinical.ginecologiaForm.breastsPlaceholder")}
                  value={form.exam.breasts}
                  onChange={e => setE("breasts", e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.pelvicExam")}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder={t("clinical.ginecologiaForm.pelvicExamPlaceholder")}
                  value={form.exam.pelvic}
                  onChange={e => setE("pelvic", e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.cytology")}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder={t("clinical.ginecologiaForm.cytologyPlaceholder")}
                  value={form.exam.cytology}
                  onChange={e => setE("cytology", e.target.value)}
                />
              </div>
            </div>
          </CardNew>

          <CardNew title={t("clinical.ginecologiaForm.planTitle")}>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.ginecologiaForm.planPlaceholder")}
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </CardNew>
        </>
      ) : (
        <>
          <CardNew title={t("clinical.ginecologiaForm.lmpFollowupTitle")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px 14px", marginBottom: 16 }}>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.lmpDate")}</label>
                <DateField className="input-new" value={form.fum} onChange={e => set("fum", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.reasonNotes")}</label>
                <input
                  className="input-new"
                  placeholder={t("clinical.ginecologiaForm.reasonNotesPlaceholder")}
                  value={form.subjective}
                  onChange={e => set("subjective", e.target.value)}
                />
              </div>
            </div>
            {form.fum && (
              <PrenatalTracker
                fum={form.fum}
                currentWeight={weightNum}
                fundalHeight={fundalHeightNum}
                fetalHeartRate={fhrNum}
                measurements={prenatalMeasurements}
              />
            )}
          </CardNew>

          <CardNew title={t("clinical.ginecologiaForm.visitChecksTitle")}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.weightKg")}</label>
                <input type="number" step="0.1" className="input-new mono" placeholder="65" value={form.prenatal.weight} onChange={e => setP("weight", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.bpMmhg")}</label>
                <input className="input-new mono" placeholder="110/70" value={form.prenatal.bp} onChange={e => setP("bp", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.fundalHeightCm")}</label>
                <input type="number" step="0.1" className="input-new mono" placeholder="24" value={form.prenatal.fundalHeight} onChange={e => setP("fundalHeight", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.fhrBpm")}</label>
                <input type="number" className="input-new mono" placeholder="140" value={form.prenatal.fhr} onChange={e => setP("fhr", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.ginecologiaForm.fetalMovements")}</label>
                <select className="input-new" value={form.prenatal.movements} onChange={e => setP("movements", e.target.value)}>
                  <option value="">{t("clinical.ginecologiaForm.selectPlaceholder")}</option>
                  <option value="Presentes">{t("clinical.ginecologiaForm.movementsPresent")}</option>
                  <option value="Disminuidos">{t("clinical.ginecologiaForm.movementsDecreased")}</option>
                  <option value="Ausentes">{t("clinical.ginecologiaForm.movementsAbsent")}</option>
                  <option value="N/A">{t("clinical.ginecologiaForm.movementsNa")}</option>
                </select>
              </div>
            </div>
          </CardNew>

          <CardNew
            title={t("clinical.ginecologiaForm.ultrasoundsTitle")}
            action={<ButtonNew size="sm" variant="ghost" onClick={addUS}>{t("clinical.ginecologiaForm.addUs")}</ButtonNew>}
          >
            {ultrasounds.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
                {t("clinical.ginecologiaForm.ultrasoundsEmpty")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ultrasounds.map((u, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "170px 1fr auto", gap: 8, alignItems: "flex-end" }}>
                    <div className="field-new">
                      <label className="field-new__label">{t("common.date")}</label>
                      <DateField className="input-new" value={u.date} onChange={e => updateUS(i, "date", e.target.value)} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">{t("clinical.ginecologiaForm.findings")}</label>
                      <input className="input-new" placeholder={t("clinical.ginecologiaForm.findingsPlaceholder")} value={u.findings} onChange={e => updateUS(i, "findings", e.target.value)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeUS(i)}
                      className="btn-new btn-new--ghost btn-new--sm"
                      style={{ padding: 0, width: 28, color: "var(--danger)", alignSelf: "flex-end" }}
                      aria-label={t("common.delete")}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </CardNew>

          <CardNew title={t("clinical.ginecologiaForm.labsByTrimesterTitle")}>
            {[1, 2, 3].map(tri => (
              <div key={tri} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>
                  {t("clinical.ginecologiaForm.trimesterLabel", { tri })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {TRIMESTER_LABS.filter(l => l.trimester === tri).map(l => (
                    <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: labs[l.id] ? "rgba(52,211,153,0.08)" : "transparent" }}>
                      <input type="checkbox" checked={!!labs[l.id]} onChange={() => toggleLab(l.id)} />
                      <span style={{ fontSize: 12, color: "var(--text-1)" }}>{t(l.labelKey)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </CardNew>

          <CardNew title={t("clinical.ginecologiaForm.planTitle")}>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.ginecologiaForm.planPrenatalPlaceholder")}
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </CardNew>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.ginecologiaForm.saveConsult")}
        </ButtonNew>
      </div>
    </div>
  );
}
