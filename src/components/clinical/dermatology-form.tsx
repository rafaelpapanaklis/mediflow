"use client";
import { useState, useMemo, useEffect } from "react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { BodyMap, BeforeAfterGallery } from "@/components/clinical/shared";
import { DateField } from "@/components/ui/date-field";
import { useT } from "@/i18n/i18n-provider";
import { Cie10Selector } from "@/components/dashboard/clinical/cie10-selector";
import { useCodedDiagnoses } from "@/components/clinical/use-coded-diagnoses";

// value = stored data (Spanish); labelKey resolves via t() at render time.
const BODY_ZONES = [
  { value: "Cuero cabelludo",          labelKey: "clinical.dermatologyForm.zoneScalp" },
  { value: "Cara",                     labelKey: "clinical.dermatologyForm.zoneFace" },
  { value: "Cuello",                   labelKey: "clinical.dermatologyForm.zoneNeck" },
  { value: "Tórax anterior",           labelKey: "clinical.dermatologyForm.zoneChestAnterior" },
  { value: "Tórax posterior/Espalda",  labelKey: "clinical.dermatologyForm.zoneBack" },
  { value: "Abdomen",                  labelKey: "clinical.dermatologyForm.zoneAbdomen" },
  { value: "Brazos",                   labelKey: "clinical.dermatologyForm.zoneArms" },
  { value: "Manos",                    labelKey: "clinical.dermatologyForm.zoneHands" },
  { value: "Piernas",                  labelKey: "clinical.dermatologyForm.zoneLegs" },
  { value: "Pies",                     labelKey: "clinical.dermatologyForm.zoneFeet" },
  { value: "Genitales",                labelKey: "clinical.dermatologyForm.zoneGenitals" },
  { value: "Pliegues",                 labelKey: "clinical.dermatologyForm.zoneFolds" },
] as const;

const LESION_TYPES = [
  { value: "Mácula",   labelKey: "clinical.dermatologyForm.lesionMacule" },
  { value: "Pápula",   labelKey: "clinical.dermatologyForm.lesionPapule" },
  { value: "Placa",    labelKey: "clinical.dermatologyForm.lesionPlaque" },
  { value: "Nódulo",   labelKey: "clinical.dermatologyForm.lesionNodule" },
  { value: "Vesícula", labelKey: "clinical.dermatologyForm.lesionVesicle" },
  { value: "Ampolla",  labelKey: "clinical.dermatologyForm.lesionBulla" },
  { value: "Pústula",  labelKey: "clinical.dermatologyForm.lesionPustule" },
  { value: "Úlcera",   labelKey: "clinical.dermatologyForm.lesionUlcer" },
  { value: "Costra",   labelKey: "clinical.dermatologyForm.lesionCrust" },
  { value: "Escama",   labelKey: "clinical.dermatologyForm.lesionScale" },
];
const LESION_COLORS = [
  { value: "Eritematosa",     labelKey: "clinical.dermatologyForm.colorErythematous" },
  { value: "Hiperpigmentada", labelKey: "clinical.dermatologyForm.colorHyperpigmented" },
  { value: "Hipopigmentada",  labelKey: "clinical.dermatologyForm.colorHypopigmented" },
  { value: "Violácea",        labelKey: "clinical.dermatologyForm.colorViolaceous" },
  { value: "Amarillenta",     labelKey: "clinical.dermatologyForm.colorYellowish" },
];
const LESION_BORDERS = [
  { value: "Bien definidos", labelKey: "clinical.dermatologyForm.borderWellDefined" },
  { value: "Mal definidos",  labelKey: "clinical.dermatologyForm.borderPoorlyDefined" },
  { value: "Irregulares",    labelKey: "clinical.dermatologyForm.borderIrregular" },
];
const DISTRIBUTION_OPTIONS = [
  { value: "Localizada",            labelKey: "clinical.dermatologyForm.distLocalized" },
  { value: "Generalizada",          labelKey: "clinical.dermatologyForm.distGeneralized" },
  { value: "Simétrica",             labelKey: "clinical.dermatologyForm.distSymmetric" },
  { value: "Asimétrica",            labelKey: "clinical.dermatologyForm.distAsymmetric" },
  { value: "Siguiendo dermatomas",  labelKey: "clinical.dermatologyForm.distDermatomal" },
  { value: "Fotoexpuesta",          labelKey: "clinical.dermatologyForm.distPhotoexposed" },
];

const FITZPATRICK = [
  { value: "I",   labelKey: "clinical.dermatologyForm.fitzI" },
  { value: "II",  labelKey: "clinical.dermatologyForm.fitzII" },
  { value: "III", labelKey: "clinical.dermatologyForm.fitzIII" },
  { value: "IV",  labelKey: "clinical.dermatologyForm.fitzIV" },
  { value: "V",   labelKey: "clinical.dermatologyForm.fitzV" },
  { value: "VI",  labelKey: "clinical.dermatologyForm.fitzVI" },
];

const SCORAD_AREAS = [
  { key: "headNeck",       labelKey: "clinical.dermatologyForm.areaHeadNeck",       weight: 9  },
  { key: "trunkAnterior",  labelKey: "clinical.dermatologyForm.areaTrunkAnterior",  weight: 18 },
  { key: "trunkPosterior", labelKey: "clinical.dermatologyForm.areaTrunkPosterior", weight: 18 },
  { key: "armLeft",        labelKey: "clinical.dermatologyForm.areaArmLeft",        weight: 9  },
  { key: "armRight",       labelKey: "clinical.dermatologyForm.areaArmRight",       weight: 9  },
  { key: "legLeft",        labelKey: "clinical.dermatologyForm.areaLegLeft",        weight: 18 },
  { key: "legRight",       labelKey: "clinical.dermatologyForm.areaLegRight",       weight: 18 },
  { key: "genitals",       labelKey: "clinical.dermatologyForm.areaGenitals",       weight: 1  },
];

const SCORAD_INTENSITY_ITEMS = [
  { value: "Eritema",            labelKey: "clinical.dermatologyForm.intensityErythema" },
  { value: "Edema/papulación",   labelKey: "clinical.dermatologyForm.intensityEdema" },
  { value: "Excoriación",        labelKey: "clinical.dermatologyForm.intensityExcoriation" },
  { value: "Liquenificación",    labelKey: "clinical.dermatologyForm.intensityLichenification" },
  { value: "Exudación/costras",  labelKey: "clinical.dermatologyForm.intensityOozing" },
  { value: "Sequedad",           labelKey: "clinical.dermatologyForm.intensityDryness" },
];

const PHOTO_COMPARISON = [
  { value: "Primera documentación", labelKey: "clinical.dermatologyForm.photoFirstDoc" },
  { value: "Mejoría evidente",      labelKey: "clinical.dermatologyForm.photoImproved" },
  { value: "Sin cambio",            labelKey: "clinical.dermatologyForm.photoNoChange" },
  { value: "Empeoramiento",         labelKey: "clinical.dermatologyForm.photoWorsened" },
  { value: "No aplica",             labelKey: "clinical.dermatologyForm.photoNotApplicable" },
];

interface Props { patientId: string; onSaved: (record: any) => void }

interface LesionDetail { type: string; size: string; color: string; borders: string }

export function DermatologyForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  // Dx CIE-10 codificados (NOM-024 §6.3 / NOM-004) — consulta nueva: local + flush al crear.
  const { dxs, onAdd: onAddDx, onRemove: onRemoveDx, flush: flushDx, summary: dxSummary } = useCodedDiagnoses(null);

  const [fitzpatrick, setFitzpatrick] = useState("");

  const [checkedZones, setCheckedZones] = useState<Record<string, boolean>>({});
  const [lesionDetails, setLesionDetails] = useState<Record<string, LesionDetail>>({});
  const [distribution, setDistribution] = useState("");

  const toggleZone = (z: string) => {
    setCheckedZones(p => ({ ...p, [z]: !p[z] }));
    if (!lesionDetails[z]) setLesionDetails(p => ({ ...p, [z]: { type: "", size: "", color: "", borders: "" } }));
  };
  const setLesionField = (zone: string, field: keyof LesionDetail, value: string) =>
    setLesionDetails(p => ({ ...p, [zone]: { ...p[zone], [field]: value } }));

  const [scoradAreas, setScoradAreas] = useState<Record<string, number>>(
    Object.fromEntries(SCORAD_AREAS.map(a => [a.key, 0]))
  );
  const [intensityScores, setIntensityScores] = useState<number[]>(new Array(6).fill(0));
  const [prurito, setPrurito] = useState(0);
  const [insomnia, setInsomnia] = useState(0);

  const scoradA = useMemo(() => {
    let sum = 0;
    for (const area of SCORAD_AREAS) {
      sum += ((scoradAreas[area.key] || 0) / 100) * area.weight;
    }
    return Math.round(sum * 100) / 100;
  }, [scoradAreas]);

  const scoradB = useMemo(() => intensityScores.reduce((a, b) => a + b, 0), [intensityScores]);
  const scoradC = prurito + insomnia;
  const scoradTotal = useMemo(() => Math.round((scoradA / 5 + 7 * scoradB / 2 + scoradC) * 100) / 100, [scoradA, scoradB, scoradC]);
  const scoradSeverity = scoradTotal < 25 ? "Leve" : scoradTotal <= 50 ? "Moderado" : "Severo";
  const scoradSeverityLabel = scoradTotal < 25
    ? t("clinical.dermatologyForm.severityMild")
    : scoradTotal <= 50
      ? t("clinical.dermatologyForm.severityModerate")
      : t("clinical.dermatologyForm.severitySevere");
  const scoradTone: "success" | "warning" | "danger" = scoradTotal < 25 ? "success" : scoradTotal <= 50 ? "warning" : "danger";

  const [photoZones, setPhotoZones] = useState<Record<string, boolean>>({});
  const [standardLight, setStandardLight] = useState(false);
  const [standardDistance, setStandardDistance] = useState(false);
  const [photoComparison, setPhotoComparison] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");

  const [medications, setMedications] = useState([{ drug: "", dose: "", frequency: "", duration: "", route: "tópica", instructions: "" }]);
  const addMed = () => setMedications(m => [...m, { drug: "", dose: "", frequency: "", duration: "", route: "tópica", instructions: "" }]);
  const removeMed = (i: number) => setMedications(m => m.filter((_, j) => j !== i));

  const [returnDate, setReturnDate] = useState("");

  const [history, setHistory] = useState<any[]>([]);
  const [beforeAfter, setBeforeAfter] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/clinical?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch(`/api/before-after?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setBeforeAfter(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patientId]);

  const lesionMarkers = useMemo(() => {
    const out: { x: number; y: number; color: string; label?: string }[] = [];
    for (const r of history) {
      const lesions = r?.specialtyData?.bodyMap?.zones ?? r?.specialtyData?.lesions ?? [];
      if (!Array.isArray(lesions)) continue;
      for (const l of lesions) {
        if (typeof l?.x === "number" && typeof l?.y === "number") {
          out.push({
            x: l.x,
            y: l.y,
            color: "#a78bfa",
            label: l.zone || l.type || undefined,
          });
        }
      }
    }
    return out;
  }, [history]);

  const galleryImages = useMemo(() =>
    beforeAfter
      .filter(p => p?.url)
      .map(p => ({
        id: p.id,
        url: p.url,
        date: p.takenAt ? new Date(p.takenAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "",
        label: p.angle || p.category || t("clinical.dermatologyForm.photoLabel"),
      })),
    [beforeAfter]
  );

  async function handleSave() {
    if (!subjective && !assessment && dxs.length === 0) { toast.error(t("clinical.dermatologyForm.reasonOrDiagnosisRequired")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective, objective, assessment: assessment || dxSummary, plan,
          specialtyData: {
            type: "dermatology",
            fitzpatrick,
            bodyMap: {
              zones: Object.entries(checkedZones).filter(([, v]) => v).map(([z]) => ({
                zone: z, ...lesionDetails[z],
              })),
              distribution,
            },
            scorad: {
              areas: scoradAreas, A: scoradA,
              intensity: intensityScores, B: scoradB,
              prurito, insomnia, C: scoradC,
              total: scoradTotal, severity: scoradSeverity,
            },
            photoProtocol: {
              zones: Object.entries(photoZones).filter(([, v]) => v).map(([z]) => z),
              standardLight, standardDistance,
              comparison: photoComparison,
              notes: photoNotes,
            },
            diagnosis: dxSummary,
            medications: medications.filter(m => m.drug),
            returnDate,
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
      toast.success(t("clinical.dermatologyForm.savedToast"));
    } catch (err: any) { toast.error(err.message ?? t("common.genericError")); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title={t("clinical.dermatologyForm.reasonTitle")}>
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder={t("clinical.dermatologyForm.reasonPlaceholder")}
          value={subjective}
          onChange={e => setSubjective(e.target.value)}
        />
      </CardNew>

      <CardNew title={t("clinical.dermatologyForm.physicalExamTitle")} sub={t("clinical.dermatologyForm.physicalExamSub")}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dermatologyForm.physicalExamLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.dermatologyForm.physicalExamPlaceholder")}
              value={objective}
              onChange={e => setObjective(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dermatologyForm.fitzpatrickLabel")}</label>
            <select className="input-new" value={fitzpatrick} onChange={e => setFitzpatrick(e.target.value)}>
              <option value="">{t("clinical.dermatologyForm.selectPlaceholder")}</option>
              {FITZPATRICK.map(f => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      {/* Localización de lesiones */}
      <CardNew title={t("clinical.dermatologyForm.lesionLocationTitle")} sub={t("clinical.dermatologyForm.lesionLocationSub")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
          {BODY_ZONES.map(z => (
            <label key={z.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!checkedZones[z.value]} onChange={() => toggleZone(z.value)} />
              {t(z.labelKey)}
            </label>
          ))}
        </div>

        {BODY_ZONES.filter(z => checkedZones[z.value]).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {BODY_ZONES.filter(z => checkedZones[z.value]).map(z => {
              const zone = z.value;
              return (
              <div
                key={zone}
                style={{
                  padding: 10,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 8,
                  display: "grid",
                  gridTemplateColumns: "140px repeat(4, 1fr)",
                  gap: "8px 10px",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{t(z.labelKey)}</div>
                <select
                  className="input-new"
                  value={lesionDetails[zone]?.type || ""}
                  onChange={e => setLesionField(zone, "type", e.target.value)}
                >
                  <option value="">{t("clinical.dermatologyForm.typePlaceholder")}</option>
                  {LESION_TYPES.map(lt => <option key={lt.value} value={lt.value}>{t(lt.labelKey)}</option>)}
                </select>
                <input
                  className="input-new"
                  placeholder={t("clinical.dermatologyForm.sizePlaceholder")}
                  value={lesionDetails[zone]?.size || ""}
                  onChange={e => setLesionField(zone, "size", e.target.value)}
                />
                <select
                  className="input-new"
                  value={lesionDetails[zone]?.color || ""}
                  onChange={e => setLesionField(zone, "color", e.target.value)}
                >
                  <option value="">{t("clinical.dermatologyForm.colorPlaceholder")}</option>
                  {LESION_COLORS.map(c => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
                </select>
                <select
                  className="input-new"
                  value={lesionDetails[zone]?.borders || ""}
                  onChange={e => setLesionField(zone, "borders", e.target.value)}
                >
                  <option value="">{t("clinical.dermatologyForm.bordersPlaceholder")}</option>
                  {LESION_BORDERS.map(b => <option key={b.value} value={b.value}>{t(b.labelKey)}</option>)}
                </select>
              </div>
              );
            })}
          </div>
        )}

        <div className="field-new">
          <label className="field-new__label">{t("clinical.dermatologyForm.generalDistributionLabel")}</label>
          <select className="input-new" value={distribution} onChange={e => setDistribution(e.target.value)}>
            <option value="">{t("clinical.dermatologyForm.selectPlaceholder")}</option>
            {DISTRIBUTION_OPTIONS.map(d => <option key={d.value} value={d.value}>{t(d.labelKey)}</option>)}
          </select>
        </div>
      </CardNew>

      {/* SCORAD */}
      <CardNew
        title="SCORAD · Scoring Atopic Dermatitis"
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{scoradTotal.toFixed(1)}</span>
            <BadgeNew tone={scoradTone} dot>{scoradSeverityLabel}</BadgeNew>
          </div>
        }
      >
        {/* A — Extensión */}
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
            {t("clinical.dermatologyForm.extensionLabel")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px 12px" }}>
            {SCORAD_AREAS.map(area => (
              <div key={area.key} className="field-new">
                <label className="field-new__label">{t(area.labelKey)} ({area.weight}%)</label>
                <input
                  type="number" min="0" max="100"
                  className="input-new mono"
                  placeholder="0"
                  value={scoradAreas[area.key] || ""}
                  onChange={e => setScoradAreas(p => ({ ...p, [area.key]: Math.min(100, Math.max(0, Number(e.target.value))) }))}
                />
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, marginTop: 8, color: "var(--text-2)" }}>
            A = {scoradA.toFixed(2)} → A/5 = {(scoradA / 5).toFixed(2)}
          </div>
        </div>

        {/* B — Intensidad */}
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
            {t("clinical.dermatologyForm.intensityLabel")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px 12px" }}>
            {SCORAD_INTENSITY_ITEMS.map((item, i) => (
              <div key={item.value} className="field-new">
                <label className="field-new__label">{t(item.labelKey)}</label>
                <select
                  className="input-new"
                  value={intensityScores[i]}
                  onChange={e => setIntensityScores(s => s.map((v, j) => j === i ? Number(e.target.value) : v))}
                >
                  <option value={0}>{t("clinical.dermatologyForm.intensity0")}</option>
                  <option value={1}>{t("clinical.dermatologyForm.intensity1")}</option>
                  <option value={2}>{t("clinical.dermatologyForm.intensity2")}</option>
                  <option value={3}>{t("clinical.dermatologyForm.intensity3")}</option>
                </select>
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, marginTop: 8, color: "var(--text-2)" }}>B = {scoradB}/18</div>
        </div>

        {/* C — Subjetivo */}
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
            {t("clinical.dermatologyForm.subjectiveSymptomsLabel")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.dermatologyForm.pruritusLabel")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min="0" max="10" value={prurito} onChange={e => setPrurito(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--brand)" }} />
                <span className="mono" style={{ width: 24, textAlign: "center", color: "var(--text-1)", fontWeight: 600 }}>{prurito}</span>
              </div>
            </div>
            <div className="field-new">
              <label className="field-new__label">{t("clinical.dermatologyForm.insomniaLabel")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min="0" max="10" value={insomnia} onChange={e => setInsomnia(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--brand)" }} />
                <span className="mono" style={{ width: 24, textAlign: "center", color: "var(--text-1)", fontWeight: 600 }}>{insomnia}</span>
              </div>
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11, marginTop: 8, color: "var(--text-2)" }}>C = {scoradC}/20</div>
        </div>

        <div style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 10,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
        }}>
          <span style={{ color: "var(--text-2)" }}>{t("clinical.dermatologyForm.scoradFormula")}</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>{scoradTotal.toFixed(2)}</span>
          <BadgeNew tone={scoradTone} dot>{scoradSeverityLabel}</BadgeNew>
        </div>
      </CardNew>

      {/* Protocolo fotográfico */}
      <CardNew title={t("clinical.dermatologyForm.photoProtocolTitle")}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
          {t("clinical.dermatologyForm.photographedZonesLabel")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
          {BODY_ZONES.map(z => (
            <label key={z.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!photoZones[z.value]} onChange={() => setPhotoZones(p => ({ ...p, [z.value]: !p[z.value] }))} />
              {t(z.labelKey)}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={standardLight} onChange={e => setStandardLight(e.target.checked)} />
            {t("clinical.dermatologyForm.standardLight")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={standardDistance} onChange={e => setStandardDistance(e.target.checked)} />
            {t("clinical.dermatologyForm.standardDistance")}
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dermatologyForm.comparisonLabel")}</label>
            <select className="input-new" value={photoComparison} onChange={e => setPhotoComparison(e.target.value)}>
              <option value="">{t("clinical.dermatologyForm.selectPlaceholder")}</option>
              {PHOTO_COMPARISON.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dermatologyForm.photoNotesLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.dermatologyForm.photoNotesPlaceholder")}
              value={photoNotes}
              onChange={e => setPhotoNotes(e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Seguimiento visual */}
      {(lesionMarkers.length > 0 || galleryImages.length > 0) && (
        <CardNew title={t("clinical.dermatologyForm.visualFollowupTitle")} sub={t("clinical.dermatologyForm.visualFollowupSub")}>
          <div style={{ display: "grid", gridTemplateColumns: lesionMarkers.length > 0 && galleryImages.length > 0 ? "1fr 1fr" : "1fr", gap: 14 }}>
            {lesionMarkers.length > 0 && (
              <BodyMap
                view="front"
                markers={lesionMarkers}
                color="#a78bfa"
                legend={[{ color: "#a78bfa", label: t("clinical.dermatologyForm.registeredLesion") }]}
              />
            )}
            {galleryImages.length > 0 && (
              <BeforeAfterGallery
                images={galleryImages}
                sessionLabel={t("clinical.dermatologyForm.beforeAfter")}
              />
            )}
          </div>
        </CardNew>
      )}

      {/* Diagnóstico y plan */}
      <CardNew title={t("clinical.dermatologyForm.diagnosisPlanTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dermatologyForm.diagnosisImpressionLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.dermatologyForm.diagnosisImpressionPlaceholder")}
              value={assessment}
              onChange={e => setAssessment(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.dermatologyForm.cie10Label")}</label>
            <Cie10Selector diagnoses={dxs} onAdd={onAddDx} onRemove={onRemoveDx} disabled={saving} />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">{t("clinical.dermatologyForm.treatmentPlanLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.dermatologyForm.treatmentPlanPlaceholder")}
              value={plan}
              onChange={e => setPlan(e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Prescripción */}
      <CardNew
        title={t("clinical.dermatologyForm.prescriptionTitle")}
        action={<ButtonNew size="sm" variant="ghost" onClick={addMed}>+ {t("common.add")}</ButtonNew>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {medications.map((med, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.dermatologyForm.drugLabel")}</label>
                <input
                  className="input-new"
                  placeholder={t("clinical.dermatologyForm.drugPlaceholder")}
                  value={med.drug}
                  onChange={e => { const m = [...medications]; m[i].drug = e.target.value; setMedications(m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.dermatologyForm.doseLabel")}</label>
                <input
                  className="input-new"
                  placeholder={t("clinical.dermatologyForm.dosePlaceholder")}
                  value={med.dose}
                  onChange={e => { const m = [...medications]; m[i].dose = e.target.value; setMedications(m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.dermatologyForm.frequencyLabel")}</label>
                <select
                  className="input-new"
                  value={med.frequency}
                  onChange={e => { const m = [...medications]; m[i].frequency = e.target.value; setMedications(m); }}
                >
                  <option value="">…</option>
                  {[
                    { value: "c/12h", labelKey: "clinical.dermatologyForm.freqQ12h" },
                    { value: "c/24h", labelKey: "clinical.dermatologyForm.freqQ24h" },
                    { value: "c/8h", labelKey: "clinical.dermatologyForm.freqQ8h" },
                    { value: "2 veces/sem", labelKey: "clinical.dermatologyForm.freq2week" },
                    { value: "3 veces/sem", labelKey: "clinical.dermatologyForm.freq3week" },
                    { value: "Según necesidad", labelKey: "clinical.dermatologyForm.freqAsNeeded" },
                  ].map(f => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">{t("clinical.dermatologyForm.durationLabel")}</label>
                <input
                  className="input-new"
                  placeholder={t("clinical.dermatologyForm.durationPlaceholder")}
                  value={med.duration}
                  onChange={e => { const m = [...medications]; m[i].duration = e.target.value; setMedications(m); }}
                />
              </div>
              {medications.length > 1 && (
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

      {/* Próxima cita */}
      <CardNew title={t("clinical.dermatologyForm.nextVisitTitle")}>
        <div className="field-new" style={{ maxWidth: 240 }}>
          <label className="field-new__label">{t("common.date")}</label>
          <DateField className="input-new" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.dermatologyForm.saveConsultation")}
        </ButtonNew>
      </div>
    </div>
  );
}
