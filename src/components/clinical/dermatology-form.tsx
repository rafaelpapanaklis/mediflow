"use client";
import { useState, useMemo, useEffect } from "react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { BodyMap, BeforeAfterGallery } from "@/components/clinical/shared";

const BODY_ZONES = [
  "Cuero cabelludo","Cara","Cuello","Tórax anterior","Tórax posterior/Espalda",
  "Abdomen","Brazos","Manos","Piernas","Pies","Genitales","Pliegues",
] as const;

const LESION_TYPES = ["Mácula","Pápula","Placa","Nódulo","Vesícula","Ampolla","Pústula","Úlcera","Costra","Escama"];
const LESION_COLORS = ["Eritematosa","Hiperpigmentada","Hipopigmentada","Violácea","Amarillenta"];
const LESION_BORDERS = ["Bien definidos","Mal definidos","Irregulares"];
const DISTRIBUTION_OPTIONS = ["Localizada","Generalizada","Simétrica","Asimétrica","Siguiendo dermatomas","Fotoexpuesta"];

const FITZPATRICK = [
  { value: "I",   label: "I — Siempre se quema, nunca se broncea" },
  { value: "II",  label: "II — Siempre se quema, se broncea mínimamente" },
  { value: "III", label: "III — Se quema moderadamente, se broncea gradualmente" },
  { value: "IV",  label: "IV — Se quema poco, se broncea bien" },
  { value: "V",   label: "V — Rara vez se quema, se broncea intensamente" },
  { value: "VI",  label: "VI — Nunca se quema, pigmentación oscura" },
];

const SCORAD_AREAS = [
  { key: "headNeck",       label: "Cabeza/cuello",    weight: 9  },
  { key: "trunkAnterior",  label: "Tronco anterior",  weight: 18 },
  { key: "trunkPosterior", label: "Tronco posterior", weight: 18 },
  { key: "armLeft",        label: "Brazo izq",        weight: 9  },
  { key: "armRight",       label: "Brazo der",        weight: 9  },
  { key: "legLeft",        label: "Pierna izq",       weight: 18 },
  { key: "legRight",       label: "Pierna der",       weight: 18 },
  { key: "genitals",       label: "Genitales",        weight: 1  },
];

const SCORAD_INTENSITY_ITEMS = ["Eritema","Edema/papulación","Excoriación","Liquenificación","Exudación/costras","Sequedad"];

const DIAGNOSES_CIE10_DERM = [
  "L20 - Dermatitis atópica","L23 - Dermatitis alérgica de contacto","L30 - Dermatitis, no especificada",
  "L40 - Psoriasis","L50 - Urticaria","L70 - Acné","L80 - Vitíligo","L82 - Queratosis seborreica",
  "L85 - Queratosis actínica","B35 - Dermatofitosis","B37 - Candidiasis cutánea","C43 - Melanoma maligno de piel",
  "C44 - Carcinoma de piel","D22 - Nevo melanocítico","L57 - Daño actínico crónico","L60 - Onicodistrofia",
  "L63 - Alopecia areata","L65 - Alopecia no cicatricial","Otro",
];

const PHOTO_COMPARISON = ["Primera documentación","Mejoría evidente","Sin cambio","Empeoramiento","No aplica"];

interface Props { patientId: string; onSaved: (record: any) => void }

interface LesionDetail { type: string; size: string; color: string; borders: string }

export function DermatologyForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);

  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [diagnosis, setDiagnosis] = useState("");

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
        label: p.angle || p.category || "Foto",
      })),
    [beforeAfter]
  );

  async function handleSave() {
    if (!subjective && !assessment) { toast.error("Agrega el motivo de consulta o diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective, objective, assessment: assessment || diagnosis, plan,
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
            diagnosis,
            medications: medications.filter(m => m.drug),
            returnDate,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Consulta dermatológica guardada");
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Motivo de consulta">
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="Paciente de X años que acude por lesiones en… desde hace… Evolución: …"
          value={subjective}
          onChange={e => setSubjective(e.target.value)}
        />
      </CardNew>

      <CardNew title="Exploración física" sub="Descripción general y fototipo">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Exploración física</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Inspección general, descripción de lesiones, palpación…"
              value={objective}
              onChange={e => setObjective(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Fototipo de Fitzpatrick</label>
            <select className="input-new" value={fitzpatrick} onChange={e => setFitzpatrick(e.target.value)}>
              <option value="">Seleccionar…</option>
              {FITZPATRICK.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      {/* Localización de lesiones */}
      <CardNew title="Localización de lesiones" sub="Body map + detalles por zona">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
          {BODY_ZONES.map(z => (
            <label key={z} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!checkedZones[z]} onChange={() => toggleZone(z)} />
              {z}
            </label>
          ))}
        </div>

        {BODY_ZONES.filter(z => checkedZones[z]).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {BODY_ZONES.filter(z => checkedZones[z]).map(zone => (
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
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{zone}</div>
                <select
                  className="input-new"
                  value={lesionDetails[zone]?.type || ""}
                  onChange={e => setLesionField(zone, "type", e.target.value)}
                >
                  <option value="">Tipo…</option>
                  {LESION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  className="input-new"
                  placeholder="Tamaño (2x3cm)"
                  value={lesionDetails[zone]?.size || ""}
                  onChange={e => setLesionField(zone, "size", e.target.value)}
                />
                <select
                  className="input-new"
                  value={lesionDetails[zone]?.color || ""}
                  onChange={e => setLesionField(zone, "color", e.target.value)}
                >
                  <option value="">Color…</option>
                  {LESION_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  className="input-new"
                  value={lesionDetails[zone]?.borders || ""}
                  onChange={e => setLesionField(zone, "borders", e.target.value)}
                >
                  <option value="">Bordes…</option>
                  {LESION_BORDERS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="field-new">
          <label className="field-new__label">Distribución general</label>
          <select className="input-new" value={distribution} onChange={e => setDistribution(e.target.value)}>
            <option value="">Seleccionar…</option>
            {DISTRIBUTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </CardNew>

      {/* SCORAD */}
      <CardNew
        title="SCORAD · Scoring Atopic Dermatitis"
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{scoradTotal.toFixed(1)}</span>
            <BadgeNew tone={scoradTone} dot>{scoradSeverity}</BadgeNew>
          </div>
        }
      >
        {/* A — Extensión */}
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
            Extensión (A) — Regla de los 9
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px 12px" }}>
            {SCORAD_AREAS.map(area => (
              <div key={area.key} className="field-new">
                <label className="field-new__label">{area.label} ({area.weight}%)</label>
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
            Intensidad (B) — 6 ítems (0-3)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px 12px" }}>
            {SCORAD_INTENSITY_ITEMS.map((item, i) => (
              <div key={item} className="field-new">
                <label className="field-new__label">{item}</label>
                <select
                  className="input-new"
                  value={intensityScores[i]}
                  onChange={e => setIntensityScores(s => s.map((v, j) => j === i ? Number(e.target.value) : v))}
                >
                  <option value={0}>0 — Ausente</option>
                  <option value={1}>1 — Leve</option>
                  <option value={2}>2 — Moderado</option>
                  <option value={3}>3 — Severo</option>
                </select>
              </div>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 11, marginTop: 8, color: "var(--text-2)" }}>B = {scoradB}/18</div>
        </div>

        {/* C — Subjetivo */}
        <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
            Síntomas subjetivos (C)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
            <div className="field-new">
              <label className="field-new__label">Prurito (VAS 0-10)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min="0" max="10" value={prurito} onChange={e => setPrurito(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--brand)" }} />
                <span className="mono" style={{ width: 24, textAlign: "center", color: "var(--text-1)", fontWeight: 600 }}>{prurito}</span>
              </div>
            </div>
            <div className="field-new">
              <label className="field-new__label">Insomnio por prurito (VAS 0-10)</label>
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
          <span style={{ color: "var(--text-2)" }}>SCORAD total = A/5 + 7B/2 + C =</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>{scoradTotal.toFixed(2)}</span>
          <BadgeNew tone={scoradTone} dot>{scoradSeverity}</BadgeNew>
        </div>
      </CardNew>

      {/* Protocolo fotográfico */}
      <CardNew title="Protocolo de seguimiento fotográfico">
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
          Zonas fotografiadas
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
          {BODY_ZONES.map(z => (
            <label key={z} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!photoZones[z]} onChange={() => setPhotoZones(p => ({ ...p, [z]: !p[z] }))} />
              {z}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={standardLight} onChange={e => setStandardLight(e.target.checked)} />
            Se usó iluminación estandarizada
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
            <input type="checkbox" checked={standardDistance} onChange={e => setStandardDistance(e.target.checked)} />
            Se mantuvo distancia estándar
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Comparativa con sesión anterior</label>
            <select className="input-new" value={photoComparison} onChange={e => setPhotoComparison(e.target.value)}>
              <option value="">Seleccionar…</option>
              {PHOTO_COMPARISON.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Notas fotográficas</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Observaciones sobre la documentación fotográfica…"
              value={photoNotes}
              onChange={e => setPhotoNotes(e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Seguimiento visual */}
      {(lesionMarkers.length > 0 || galleryImages.length > 0) && (
        <CardNew title="Seguimiento visual" sub="Mapa de lesiones y comparativa fotográfica">
          <div style={{ display: "grid", gridTemplateColumns: lesionMarkers.length > 0 && galleryImages.length > 0 ? "1fr 1fr" : "1fr", gap: 14 }}>
            {lesionMarkers.length > 0 && (
              <BodyMap
                view="front"
                markers={lesionMarkers}
                color="#a78bfa"
                legend={[{ color: "#a78bfa", label: "Lesión registrada" }]}
              />
            )}
            {galleryImages.length > 0 && (
              <BeforeAfterGallery
                images={galleryImages}
                sessionLabel="Antes/Después"
              />
            )}
          </div>
        </CardNew>
      )}

      {/* Diagnóstico y plan */}
      <CardNew title="Diagnóstico y plan">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Diagnóstico / Impresión clínica</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Dermatitis atópica moderada, sobreinfección…"
              value={assessment}
              onChange={e => setAssessment(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Diagnóstico CIE-10</label>
            <select className="input-new" value={diagnosis} onChange={e => setDiagnosis(e.target.value)}>
              <option value="">Seleccionar…</option>
              {DIAGNOSES_CIE10_DERM.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">Plan de tratamiento</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Medidas generales, emolientes, corticoides tópicos, fotoprotección…&#10;Signos de alarma: …"
              value={plan}
              onChange={e => setPlan(e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Prescripción */}
      <CardNew
        title="Prescripción"
        action={<ButtonNew size="sm" variant="ghost" onClick={addMed}>+ Agregar</ButtonNew>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {medications.map((med, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
              <div className="field-new">
                <label className="field-new__label">Medicamento</label>
                <input
                  className="input-new"
                  placeholder="Betametasona 0.05% crema"
                  value={med.drug}
                  onChange={e => { const m = [...medications]; m[i].drug = e.target.value; setMedications(m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Dosis</label>
                <input
                  className="input-new"
                  placeholder="Capa fina"
                  value={med.dose}
                  onChange={e => { const m = [...medications]; m[i].dose = e.target.value; setMedications(m); }}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Frecuencia</label>
                <select
                  className="input-new"
                  value={med.frequency}
                  onChange={e => { const m = [...medications]; m[i].frequency = e.target.value; setMedications(m); }}
                >
                  <option value="">…</option>
                  {["c/12h","c/24h","c/8h","2 veces/sem","3 veces/sem","Según necesidad"].map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">Duración</label>
                <input
                  className="input-new"
                  placeholder="14 días"
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
                  aria-label="Eliminar"
                >×</button>
              )}
            </div>
          ))}
        </div>
      </CardNew>

      {/* Próxima cita */}
      <CardNew title="Próxima cita / Control">
        <div className="field-new" style={{ maxWidth: 240 }}>
          <label className="field-new__label">Fecha</label>
          <input type="date" className="input-new" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta dermatológica"}
        </ButtonNew>
      </div>
    </div>
  );
}
