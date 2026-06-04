"use client";
import { useState, useMemo, useEffect } from "react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { FaceInjectionMap, BeforeAfterGallery, RecurringCalendar } from "@/components/clinical/shared";
import { useT } from "@/i18n/i18n-provider";

const PROCEDURES = ["botox", "fillers", "PRP", "mesoterapia", "peeling", "hilos tensores", "láser"] as const;
const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"] as const;
const FACIAL_ZONES: { value: string; labelKey: string }[] = [
  { value: "frente",          labelKey: "clinical.aestheticForm.faceZoneForehead" },
  { value: "entrecejo",       labelKey: "clinical.aestheticForm.faceZoneGlabella" },
  { value: "patas de gallo",  labelKey: "clinical.aestheticForm.faceZoneCrowsFeet" },
  { value: "nasogeniano",     labelKey: "clinical.aestheticForm.faceZoneNasolabial" },
  { value: "labios",          labelKey: "clinical.aestheticForm.faceZoneLips" },
  { value: "mentón",          labelKey: "clinical.aestheticForm.faceZoneChin" },
  { value: "pómulos",         labelKey: "clinical.aestheticForm.faceZoneCheekbones" },
  { value: "mandíbula",       labelKey: "clinical.aestheticForm.faceZoneJaw" },
];

const CONTRAINDICATIONS: { value: string; labelKey: string }[] = [
  { value: "Embarazo o lactancia",                    labelKey: "clinical.aestheticForm.contraPregnancy" },
  { value: "Anticoagulantes activos",                 labelKey: "clinical.aestheticForm.contraAnticoagulants" },
  { value: "Isotretinoína (últimos 6 meses)",         labelKey: "clinical.aestheticForm.contraIsotretinoin" },
  { value: "Enfermedad autoinmune activa",            labelKey: "clinical.aestheticForm.contraAutoimmune" },
  { value: "Tendencia a queloides",                   labelKey: "clinical.aestheticForm.contraKeloids" },
  { value: "Infección activa en zona",                labelKey: "clinical.aestheticForm.contraInfection" },
  { value: "Alergia conocida a ácido hialurónico",    labelKey: "clinical.aestheticForm.contraHaAllergy" },
  { value: "Herpes activo (zona perioral)",           labelKey: "clinical.aestheticForm.contraHerpes" },
];

const ZONE_MAP = [
  { key: "frente",            labelKey: "clinical.aestheticForm.zoneForehead" },
  { key: "glabela",           labelKey: "clinical.aestheticForm.zoneGlabella" },
  { key: "patasDeGallo",      labelKey: "clinical.aestheticForm.zoneCrowsFeet" },
  { key: "surcoNasogeniano",  labelKey: "clinical.aestheticForm.zoneNasolabialFold" },
  { key: "labios",            labelKey: "clinical.aestheticForm.zoneLips" },
  { key: "menton",            labelKey: "clinical.aestheticForm.zoneChin" },
  { key: "pomulos",           labelKey: "clinical.aestheticForm.zoneCheekbones" },
  { key: "lineaMandibular",   labelKey: "clinical.aestheticForm.zoneJawline" },
] as const;

const GAIS_OPTIONS = [
  { labelKey: "clinical.aestheticForm.gaisMuchImproved",  value: 3 },
  { labelKey: "clinical.aestheticForm.gaisImproved",      value: 2 },
  { labelKey: "clinical.aestheticForm.gaisNoChange",      value: 1 },
  { labelKey: "clinical.aestheticForm.gaisWorse",         value: 0 },
  { labelKey: "clinical.aestheticForm.gaisMuchWorse",     value: -1 },
] as const;

interface ZoneEntry { product: string; units: string }

interface Props { patientId: string; onSaved: (record: any) => void }

export function AestheticMedicineForm({ patientId, onSaved }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    fototipo: "",
    procedimiento: "",
    zonas: [] as string[],
    unidades: "",
    producto: "",
    lote: "",
    notasPost: "",
    planSiguiente: "",
  });
  const [contraindicaciones, setContraindicaciones] = useState<string[]>([]);
  const [zoneMap, setZoneMap] = useState<Record<string, ZoneEntry>>(
    Object.fromEntries(ZONE_MAP.map(z => [z.key, { product: "", units: "" }]))
  );
  const [gaisPre, setGaisPre] = useState<number | null>(null);
  const [gaisPost, setGaisPost] = useState<number | null>(null);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function toggleContraindicacion(c: string) {
    setContraindicaciones(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function setZoneField(key: string, field: keyof ZoneEntry, value: string) {
    setZoneMap(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  const totalUnits = useMemo(() => {
    return Object.values(zoneMap).reduce((sum, entry) => {
      const n = parseFloat(entry.units);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
  }, [zoneMap]);

  const gaisDelta = useMemo(() => {
    if (gaisPre === null || gaisPost === null) return null;
    return gaisPost - gaisPre;
  }, [gaisPre, gaisPost]);

  const [beforeAfter, setBeforeAfter] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/before-after?patientId=${patientId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setBeforeAfter(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch(`/api/appointments`)
      .then(r => r.ok ? r.json() : [])
      .then((d: any[]) => {
        const now = new Date();
        const filtered = (Array.isArray(d) ? d : [])
          .filter(a => a.patientId === patientId && new Date(a.date) >= now && !["CANCELLED", "NO_SHOW"].includes(a.status))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .slice(0, 6);
        setUpcoming(filtered);
      })
      .catch(() => {});
  }, [patientId]);

  const galleryImages = useMemo(() =>
    beforeAfter
      .filter(p => p?.url)
      .map(p => ({
        id: p.id,
        url: p.url,
        date: p.takenAt ? new Date(p.takenAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "",
        label: p.angle || p.category || t("clinical.aestheticForm.photoFallback"),
      })),
    [beforeAfter, t]
  );
  const upcomingItems = useMemo(() =>
    upcoming.map(a => ({
      date: a.date,
      title: a.type || t("clinical.aestheticForm.sessionFallback"),
      category: a.mode === "TELECONSULTATION" ? t("clinical.aestheticForm.teleconsult") : t("clinical.aestheticForm.inPerson"),
      color: "#a78bfa",
    })),
    [upcoming, t]
  );
  const injectionPoints = useMemo(() => {
    const proc = (form.procedimiento || "").toLowerCase();
    if (!proc.includes("toxina") && !proc.includes("botox")) return null;
    const entries = Object.entries(zoneMap)
      .filter(([, v]) => {
        const n = parseFloat(v.units);
        return !isNaN(n) && n > 0;
      });
    const coords: Record<string, { x: number; y: number }> = {
      frente: { x: 50, y: 20 },
      glabela: { x: 50, y: 30 },
      patasDeGallo: { x: 20, y: 40 },
      surcoNasogeniano: { x: 32, y: 60 },
      labios: { x: 50, y: 72 },
      menton: { x: 50, y: 85 },
      pomulos: { x: 30, y: 50 },
      lineaMandibular: { x: 25, y: 78 },
    };
    return entries.map(([key, v]) => ({
      x: coords[key]?.x ?? 50,
      y: coords[key]?.y ?? 50,
      units: parseFloat(v.units) || 0,
      product: v.product || form.producto,
    }));
  }, [form.procedimiento, form.producto, zoneMap]);

  function toggleZona(z: string) {
    setForm(f => ({ ...f, zonas: f.zonas.includes(z) ? f.zonas.filter(x => x !== z) : [...f.zonas, z] }));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error(t("clinical.aestheticForm.errReasonOrDiagnosis")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective, objective: form.objective,
          assessment: form.assessment, plan: form.plan,
          specialtyData: {
            type: "aesthetic_medicine",
            fototipo: form.fototipo, procedimiento: form.procedimiento,
            zonas: form.zonas, unidades: form.unidades,
            producto: form.producto, lote: form.lote,
            notasPost: form.notasPost, planSiguiente: form.planSiguiente,
            contraindicaciones, mapaZonas: zoneMap, totalUnidades: totalUnits,
            gaisPre, gaisPost, gaisDelta,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success(t("clinical.aestheticForm.saved"));
    } catch (err: any) { toast.error(err.message ?? t("clinical.aestheticForm.errSave")); } finally { setSaving(false); }
  }

  // Tag button compartido para zonas faciales / contraindicaciones
  const tagButton = (isActive: boolean): React.CSSProperties => ({
    cursor: "pointer",
    background: isActive ? "var(--brand-soft)" : "rgba(255,255,255,0.04)",
    color: isActive ? "#c4b5fd" : "var(--text-2)",
    borderColor: isActive ? "rgba(124,58,237,0.3)" : "var(--border-soft)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Motivo + exploración */}
      <CardNew title={t("clinical.aestheticForm.reasonExamTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.reasonLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.aestheticForm.reasonPlaceholder")}
              value={form.subjective}
              onChange={e => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.examLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.aestheticForm.examPlaceholder")}
              value={form.objective}
              onChange={e => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Contraindicaciones */}
      <CardNew
        title={t("clinical.aestheticForm.contraTitle")}
        sub={t("clinical.aestheticForm.contraSub")}
        action={
          contraindicaciones.length > 0 ? (
            <BadgeNew tone="danger" dot>{t("clinical.aestheticForm.contraDetected", { count: contraindicaciones.length })}</BadgeNew>
          ) : undefined
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {CONTRAINDICATIONS.map(c => (
            <button
              key={c.value}
              type="button"
              className="tag-new"
              style={tagButton(contraindicaciones.includes(c.value))}
              onClick={() => toggleContraindicacion(c.value)}
            >
              {contraindicaciones.includes(c.value) && "✓ "}{t(c.labelKey)}
            </button>
          ))}
        </div>
        {contraindicaciones.length > 0 && (
          <div style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 8,
            background: "var(--warning-soft)",
            border: "1px solid rgba(245,158,11,0.2)",
            fontSize: 11,
            color: "#fcd34d",
          }}>
            {t("clinical.aestheticForm.contraWarning")}
          </div>
        )}
      </CardNew>

      {/* Datos del procedimiento */}
      <CardNew title={t("clinical.aestheticForm.procedureDataTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.fitzpatrickLabel")}</label>
            <select className="input-new" value={form.fototipo} onChange={e => set("fototipo", e.target.value)}>
              <option value="">{t("clinical.aestheticForm.selectOption")}</option>
              {FITZPATRICK.map(f => <option key={f} value={f}>{t("clinical.aestheticForm.fitzpatrickType", { type: f })}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.procedureLabel")}</label>
            <select className="input-new" value={form.procedimiento} onChange={e => set("procedimiento", e.target.value)}>
              <option value="">{t("clinical.aestheticForm.selectOption")}</option>
              {PROCEDURES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.unitsAppliedLabel")}</label>
            <input
              type="number"
              className="input-new mono"
              placeholder="20"
              value={form.unidades}
              onChange={e => set("unidades", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Zonas faciales */}
      <CardNew title={t("clinical.aestheticForm.facialZoneTitle")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {FACIAL_ZONES.map(z => (
            <button
              key={z.value}
              type="button"
              className="tag-new"
              style={{ ...tagButton(form.zonas.includes(z.value)), textTransform: "capitalize" }}
              onClick={() => toggleZona(z.value)}
            >
              {form.zonas.includes(z.value) && "✓ "}{t(z.labelKey)}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Producto + lote */}
      <CardNew title={t("clinical.aestheticForm.productUsedTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.productLabel")}</label>
            <input
              className="input-new"
              placeholder={t("clinical.aestheticForm.productPlaceholder")}
              value={form.producto}
              onChange={e => set("producto", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.lotLabel")}</label>
            <input
              className="input-new mono"
              placeholder="LOT-2026-0412"
              value={form.lote}
              onChange={e => set("lote", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Mapa facial con unidades/zona */}
      <CardNew
        title={t("clinical.aestheticForm.perZoneTitle")}
        action={
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            {t("clinical.aestheticForm.totalLabel")} <span className="mono" style={{ fontWeight: 600, color: "var(--brand)" }}>{totalUnits}</span> U/ml
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {ZONE_MAP.map(z => (
            <div key={z.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-2)", width: 160, flexShrink: 0 }}>{t(z.labelKey)}</span>
              <input
                className="input-new"
                placeholder={t("clinical.aestheticForm.productColumn")}
                value={zoneMap[z.key]?.product ?? ""}
                onChange={e => setZoneField(z.key, "product", e.target.value)}
              />
              <input
                type="number"
                className="input-new mono"
                style={{ width: 80, flexShrink: 0 }}
                placeholder="U/ml"
                value={zoneMap[z.key]?.units ?? ""}
                onChange={e => setZoneField(z.key, "units", e.target.value)}
              />
            </div>
          ))}
        </div>
      </CardNew>

      {/* Notas + plan */}
      <CardNew title={t("clinical.aestheticForm.notesPlanTitle")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.postNotesLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.aestheticForm.postNotesPlaceholder")}
              value={form.notasPost}
              onChange={e => set("notasPost", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("clinical.aestheticForm.diagnosisLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.aestheticForm.diagnosisPlaceholder")}
              value={form.assessment}
              onChange={e => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">{t("clinical.aestheticForm.nextSessionPlanLabel")}</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder={t("clinical.aestheticForm.nextSessionPlanPlaceholder")}
              value={form.planSiguiente}
              onChange={e => set("planSiguiente", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Seguimiento visual */}
      {(injectionPoints !== null || galleryImages.length > 0 || upcomingItems.length > 0) && (
        <CardNew title={t("clinical.aestheticForm.visualFollowTitle")} sub={t("clinical.aestheticForm.visualFollowSub")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {injectionPoints !== null && injectionPoints.length > 0 && (
              <FaceInjectionMap
                injections={injectionPoints}
                product={form.producto || t("clinical.aestheticForm.toxinFallback")}
              />
            )}
            {galleryImages.length > 0 && (
              <BeforeAfterGallery images={galleryImages} sessionLabel={t("clinical.aestheticForm.beforeAfterLabel")} />
            )}
            <RecurringCalendar items={upcomingItems} title={t("clinical.aestheticForm.upcomingSessionsTitle")} emptyMessage={t("clinical.aestheticForm.noSessionsScheduled")} />
          </div>
        </CardNew>
      )}

      {/* GAIS */}
      <CardNew
        title={t("clinical.aestheticForm.gaisScaleTitle")}
        sub="Global Aesthetic Improvement Scale"
        action={
          gaisDelta !== null ? (
            <BadgeNew tone={gaisDelta > 0 ? "success" : gaisDelta === 0 ? "neutral" : "danger"} dot>
              Δ {gaisDelta > 0 ? "+" : ""}{gaisDelta} {gaisDelta > 0 ? t("clinical.aestheticForm.gaisDeltaImproved") : gaisDelta === 0 ? t("clinical.aestheticForm.gaisDeltaNoChange") : t("clinical.aestheticForm.gaisDeltaWorsened")}
            </BadgeNew>
          ) : undefined
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 14px" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
              {t("clinical.aestheticForm.preProcedure")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {GAIS_OPTIONS.map(opt => (
                <label key={`pre-${opt.value}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="gais-pre"
                    checked={gaisPre === opt.value}
                    onChange={() => setGaisPre(opt.value)}
                  />
                  {t(opt.labelKey)} <span className="mono" style={{ color: "var(--text-4)" }}>({opt.value})</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
              {t("clinical.aestheticForm.postProcedure")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {GAIS_OPTIONS.map(opt => (
                <label key={`post-${opt.value}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="gais-post"
                    checked={gaisPost === opt.value}
                    onChange={() => setGaisPost(opt.value)}
                  />
                  {t(opt.labelKey)} <span className="mono" style={{ color: "var(--text-4)" }}>({opt.value})</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("clinical.aestheticForm.saveRecord")}
        </ButtonNew>
      </div>
    </div>
  );
}
