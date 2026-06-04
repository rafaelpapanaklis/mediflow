"use client";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { MeridianMap } from "@/components/clinical/acupuntura/meridian-map";
import { EvolutionChart } from "@/components/clinical/shared";
import { useT } from "@/i18n/i18n-provider";

interface Props { patientId: string; onSaved: (record: any) => void }

interface PointNote { id: string; notes: string }

export function AcupunturaForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    subjective: "",
    syndrome: "",
    element: "",
    organ: "",
    sessions: { total: "", frequency: "", notes: "" },
  });

  const [usedPoints, setUsedPoints] = useState<string[]>([]);
  const [pointNotes, setPointNotes] = useState<PointNote[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/clinical?patientId=${patientId}`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patientId]);

  const severityData = useMemo(
    () =>
      history
        .filter(r => r?.specialtyData?.severity !== undefined && r?.specialtyData?.severity !== null && r?.specialtyData?.type === "acupuntura")
        .map(r => ({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(r.specialtyData.severity),
        }))
        .reverse(),
    [history]
  );

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setSess = (k: string, v: string) => setForm(f => ({ ...f, sessions: { ...f.sessions, [k]: v } }));

  function togglePoint(id: string) {
    setUsedPoints(prev => {
      if (prev.includes(id)) {
        setPointNotes(n => n.filter(p => p.id !== id));
        return prev.filter(p => p !== id);
      }
      setPointNotes(n => [...n, { id, notes: "" }]);
      return [...prev, id];
    });
  }

  function updatePointNote(id: string, notes: string) {
    setPointNotes(n => n.map(p => (p.id === id ? { ...p, notes } : p)));
  }

  async function handleSave() {
    if (!form.subjective && usedPoints.length === 0) {
      toast.error(t("clinical.acupunturaForm.errReasonOrPoint"));
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
          assessment: `${form.syndrome}${form.element ? ` · ${form.element}` : ""}${form.organ ? ` · ${form.organ}` : ""}`,
          plan: form.sessions.notes,
          specialtyData: {
            type: "acupuntura",
            mtcDiagnosis: {
              syndrome: form.syndrome,
              element: form.element,
              organ: form.organ,
            },
            usedPoints,
            pointNotes,
            sessions: form.sessions,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success(t("clinical.acupunturaForm.saved"));
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.acupunturaForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.acupunturaForm.reasonPlaceholder")}
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title={t("clinical.acupunturaForm.tcmDiagnosisTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.acupunturaForm.syndromeLabel")}</label>
            <select className="input-new" value={form.syndrome} onChange={e => set("syndrome", e.target.value)}>
              <option value="">{t("clinical.acupunturaForm.selectOption")}</option>
              <option value="Vacío">{t("clinical.acupunturaForm.syndromeDeficiency")}</option>
              <option value="Plenitud">{t("clinical.acupunturaForm.syndromeExcess")}</option>
              <option value="Vacío + Plenitud">{t("clinical.acupunturaForm.syndromeBoth")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.acupunturaForm.elementLabel")}</label>
            <select className="input-new" value={form.element} onChange={e => set("element", e.target.value)}>
              <option value="">{t("clinical.acupunturaForm.selectOption")}</option>
              <option value="Madera">{t("clinical.acupunturaForm.elementWood")}</option>
              <option value="Fuego">{t("clinical.acupunturaForm.elementFire")}</option>
              <option value="Tierra">{t("clinical.acupunturaForm.elementEarth")}</option>
              <option value="Metal">{t("clinical.acupunturaForm.elementMetal")}</option>
              <option value="Agua">{t("clinical.acupunturaForm.elementWater")}</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.acupunturaForm.organLabel")}</label>
            <select className="input-new" value={form.organ} onChange={e => set("organ", e.target.value)}>
              <option value="">{t("clinical.acupunturaForm.selectOption")}</option>
              <option value="Hígado/VB">{t("clinical.acupunturaForm.organLiverGb")}</option>
              <option value="Corazón/ID">{t("clinical.acupunturaForm.organHeartSi")}</option>
              <option value="Bazo/Estómago">{t("clinical.acupunturaForm.organSpleenStomach")}</option>
              <option value="Pulmón/IG">{t("clinical.acupunturaForm.organLungLi")}</option>
              <option value="Riñón/Vejiga">{t("clinical.acupunturaForm.organKidneyBladder")}</option>
              <option value="Pericardio/TR">{t("clinical.acupunturaForm.organPericardiumTe")}</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("clinical.acupunturaForm.meridianMapTitle")} sub={t("clinical.acupunturaForm.meridianMapSub")}>
        <MeridianMap editable usedPointIds={usedPoints} onPointToggle={togglePoint} />
      </CardNew>

      <CardNew title={t("clinical.acupunturaForm.pointsUsedTitle")}>
        {pointNotes.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            {t("clinical.acupunturaForm.pointsUsedEmpty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pointNotes.map(p => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "flex-start" }}>
                <div style={{ padding: "8px 10px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8 }}>
                  <span className="mono" style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600 }}>{p.id}</span>
                </div>
                <textarea
                  className="input-new"
                  style={{ minHeight: 52, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder={t("clinical.acupunturaForm.pointNotePlaceholder")}
                  value={p.notes}
                  onChange={e => updatePointNote(p.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </CardNew>

      <CardNew title={t("clinical.acupunturaForm.evolutionTitle")} sub={t("clinical.acupunturaForm.evolutionSub")}>
        {severityData.length < 2 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
            {t("clinical.acupunturaForm.evolutionEmpty")}
          </div>
        ) : (
          <EvolutionChart data={severityData} metric={t("clinical.acupunturaForm.evolutionMetric")} color="#fbbf24" />
        )}
      </CardNew>

      <CardNew title={t("clinical.acupunturaForm.sessionPlanTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.acupunturaForm.sessionCountLabel")}</label>
            <input type="number" min="1" className="input-new mono" placeholder="10" value={form.sessions.total} onChange={e => setSess("total", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.acupunturaForm.frequencyLabel")}</label>
            <select className="input-new" value={form.sessions.frequency} onChange={e => setSess("frequency", e.target.value)}>
              <option value="">{t("clinical.acupunturaForm.selectOption")}</option>
              <option value="Semanal">{t("clinical.acupunturaForm.freqWeekly")}</option>
              <option value="2x/semana">{t("clinical.acupunturaForm.freqTwiceWeek")}</option>
              <option value="Quincenal">{t("clinical.acupunturaForm.freqBiweekly")}</option>
              <option value="Mensual">{t("clinical.acupunturaForm.freqMonthly")}</option>
            </select>
          </div>
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("common.notes")}</label>
          <textarea
            className="input-new"
            style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder={t("clinical.acupunturaForm.sessionNotesPlaceholder")}
            value={form.sessions.notes}
            onChange={e => setSess("notes", e.target.value)}
          />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.acupunturaForm.saveConsult")}
        </ButtonNew>
      </div>
    </div>
  );
}
