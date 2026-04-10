"use client";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

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
  { key: "headNeck",      label: "Cabeza/cuello",    weight: 9  },
  { key: "trunkAnterior",  label: "Tronco anterior",  weight: 18 },
  { key: "trunkPosterior", label: "Tronco posterior",  weight: 18 },
  { key: "armLeft",        label: "Brazo izq",         weight: 9  },
  { key: "armRight",       label: "Brazo der",         weight: 9  },
  { key: "legLeft",        label: "Pierna izq",        weight: 18 },
  { key: "legRight",       label: "Pierna der",        weight: 18 },
  { key: "genitals",       label: "Genitales",         weight: 1  },
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

  // Basic SOAP
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [diagnosis, setDiagnosis] = useState("");

  // Fitzpatrick
  const [fitzpatrick, setFitzpatrick] = useState("");

  // Body map
  const [checkedZones, setCheckedZones] = useState<Record<string, boolean>>({});
  const [lesionDetails, setLesionDetails] = useState<Record<string, LesionDetail>>({});
  const [distribution, setDistribution] = useState("");

  const toggleZone = (z: string) => {
    setCheckedZones(p => ({ ...p, [z]: !p[z] }));
    if (!lesionDetails[z]) setLesionDetails(p => ({ ...p, [z]: { type: "", size: "", color: "", borders: "" } }));
  };
  const setLesionField = (zone: string, field: keyof LesionDetail, value: string) =>
    setLesionDetails(p => ({ ...p, [zone]: { ...p[zone], [field]: value } }));

  // SCORAD
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
  const scoradColor = scoradTotal < 25 ? "text-green-600" : scoradTotal <= 50 ? "text-amber-600" : "text-red-600";

  // Photo protocol
  const [photoZones, setPhotoZones] = useState<Record<string, boolean>>({});
  const [standardLight, setStandardLight] = useState(false);
  const [standardDistance, setStandardDistance] = useState(false);
  const [photoComparison, setPhotoComparison] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");

  // Prescription
  const [medications, setMedications] = useState([{ drug: "", dose: "", frequency: "", duration: "", route: "tópica", instructions: "" }]);
  const addMed = () => setMedications(m => [...m, { drug: "", dose: "", frequency: "", duration: "", route: "tópica", instructions: "" }]);
  const removeMed = (i: number) => setMedications(m => m.filter((_, j) => j !== i));

  // Next visit
  const [returnDate, setReturnDate] = useState("");

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

  const inputClass = "flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20";
  const selectClass = inputClass;
  const textareaClass = "flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none";

  return (
    <div className="space-y-6">
      {/* SUBJETIVO */}
      <div className="space-y-1.5">
        <Label>Motivo de consulta</Label>
        <textarea className={textareaClass}
          placeholder="Paciente de X años que acude por lesiones en… desde hace… Evolución: …"
          value={subjective} onChange={e => setSubjective(e.target.value)} />
      </div>

      {/* EXPLORACIÓN FÍSICA */}
      <div className="space-y-1.5">
        <Label>Exploración física</Label>
        <textarea className={textareaClass}
          placeholder="Inspección general, descripción de lesiones, palpación…"
          value={objective} onChange={e => setObjective(e.target.value)} />
      </div>

      {/* FITZPATRICK */}
      <div className="space-y-1.5">
        <Label>Fototipo de Fitzpatrick</Label>
        <select className={selectClass} value={fitzpatrick} onChange={e => setFitzpatrick(e.target.value)}>
          <option value="">Seleccionar fototipo…</option>
          {FITZPATRICK.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {/* ═══ 1. BODY MAP ═══ */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">🗺️ Localización de lesiones</h3>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {BODY_ZONES.map(z => (
            <label key={z} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={!!checkedZones[z]} onChange={() => toggleZone(z)} className="w-3.5 h-3.5 accent-brand-600" />
              {z}
            </label>
          ))}
        </div>

        {BODY_ZONES.filter(z => checkedZones[z]).map(zone => (
          <div key={zone} className="grid grid-cols-5 gap-2 mb-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{zone}</Label>
              <select className={selectClass} value={lesionDetails[zone]?.type || ""} onChange={e => setLesionField(zone, "type", e.target.value)}>
                <option value="">Tipo de lesión…</option>
                {LESION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tamaño</Label>
              <input className={inputClass} placeholder="2x3cm" value={lesionDetails[zone]?.size || ""} onChange={e => setLesionField(zone, "size", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <select className={selectClass} value={lesionDetails[zone]?.color || ""} onChange={e => setLesionField(zone, "color", e.target.value)}>
                <option value="">Color…</option>
                {LESION_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bordes</Label>
              <select className={selectClass} value={lesionDetails[zone]?.borders || ""} onChange={e => setLesionField(zone, "borders", e.target.value)}>
                <option value="">Bordes…</option>
                {LESION_BORDERS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div />
          </div>
        ))}

        <div className="space-y-1 mt-3">
          <Label className="text-xs">Distribución general</Label>
          <select className={selectClass} value={distribution} onChange={e => setDistribution(e.target.value)}>
            <option value="">Seleccionar distribución…</option>
            {DISTRIBUTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* ═══ 2. SCORAD ═══ */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📊 SCORAD (Scoring Atopic Dermatitis)</h3>

        {/* A — Extensión */}
        <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-700/30">
          <p className="text-xs font-semibold mb-2">Extensión (A) — Regla de los 9</p>
          <div className="grid grid-cols-4 gap-3">
            {SCORAD_AREAS.map(area => (
              <div key={area.key} className="space-y-1">
                <Label className="text-xs">{area.label} ({area.weight}%)</Label>
                <input type="number" min="0" max="100" className={inputClass}
                  placeholder="0" value={scoradAreas[area.key] || ""}
                  onChange={e => setScoradAreas(p => ({ ...p, [area.key]: Math.min(100, Math.max(0, Number(e.target.value))) }))} />
              </div>
            ))}
          </div>
          <p className="text-xs mt-2 font-semibold">A = {scoradA.toFixed(2)} → A/5 = {(scoradA / 5).toFixed(2)}</p>
        </div>

        {/* B — Intensidad */}
        <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-700/30">
          <p className="text-xs font-semibold mb-2">Intensidad (B) — 6 ítems (0-3 cada uno)</p>
          <div className="grid grid-cols-3 gap-3">
            {SCORAD_INTENSITY_ITEMS.map((item, i) => (
              <div key={item} className="space-y-1">
                <Label className="text-xs">{item}</Label>
                <select className={selectClass} value={intensityScores[i]}
                  onChange={e => setIntensityScores(s => s.map((v, j) => j === i ? Number(e.target.value) : v))}>
                  <option value={0}>0 — Ausente</option>
                  <option value={1}>1 — Leve</option>
                  <option value={2}>2 — Moderado</option>
                  <option value={3}>3 — Severo</option>
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs mt-2 font-semibold">B = {scoradB}/18</p>
        </div>

        {/* C — Síntomas subjetivos */}
        <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-700/30">
          <p className="text-xs font-semibold mb-2">Síntomas subjetivos (C)</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Prurito (VAS 0-10)</Label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="10" value={prurito} onChange={e => setPrurito(Number(e.target.value))} className="flex-1 accent-brand-600" />
                <span className="text-sm font-bold w-6 text-center">{prurito}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Insomnio por prurito (VAS 0-10)</Label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="10" value={insomnia} onChange={e => setInsomnia(Number(e.target.value))} className="flex-1 accent-brand-600" />
                <span className="text-sm font-bold w-6 text-center">{insomnia}</span>
              </div>
            </div>
          </div>
          <p className="text-xs mt-2 font-semibold">C = {scoradC}/20</p>
        </div>

        {/* SCORAD Total */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-slate-800 border border-border">
          <span className="text-sm font-bold">SCORAD total = A/5 + 7B/2 + C =</span>
          <span className={`text-lg font-extrabold ${scoradColor}`}>{scoradTotal.toFixed(2)}</span>
          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
            scoradTotal < 25 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : scoradTotal <= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}>{scoradSeverity}</span>
        </div>
      </div>

      {/* ═══ 3. PHOTO PROTOCOL ═══ */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📸 Protocolo de seguimiento fotográfico</h3>

        <p className="text-xs font-semibold mb-2">Zonas fotografiadas</p>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {BODY_ZONES.map(z => (
            <label key={z} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={!!photoZones[z]} onChange={() => setPhotoZones(p => ({ ...p, [z]: !p[z] }))} className="w-3.5 h-3.5 accent-brand-600" />
              {z}
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-2 mb-4">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={standardLight} onChange={e => setStandardLight(e.target.checked)} className="w-3.5 h-3.5 accent-brand-600" />
            Sí, se usó iluminación estandarizada
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={standardDistance} onChange={e => setStandardDistance(e.target.checked)} className="w-3.5 h-3.5 accent-brand-600" />
            Sí, se mantuvo distancia estándar
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Comparativa con sesión anterior</Label>
            <select className={selectClass} value={photoComparison} onChange={e => setPhotoComparison(e.target.value)}>
              <option value="">Seleccionar…</option>
              {PHOTO_COMPARISON.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notas fotográficas</Label>
            <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Observaciones sobre la documentación fotográfica…"
              value={photoNotes} onChange={e => setPhotoNotes(e.target.value)} />
          </div>
        </div>
      </div>

      {/* ASSESSMENT & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico / Impresión clínica</Label>
          <textarea className={textareaClass}
            placeholder="Dermatitis atópica moderada, sobreinfección…"
            value={assessment} onChange={e => setAssessment(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Diagnóstico CIE-10</Label>
          <select className={selectClass} value={diagnosis} onChange={e => setDiagnosis(e.target.value)}>
            <option value="">Seleccionar diagnóstico…</option>
            {DIAGNOSES_CIE10_DERM.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Plan de tratamiento</Label>
        <textarea className={textareaClass}
          placeholder="Medidas generales, emolientes, corticoides tópicos, fotoprotección…&#10;Signos de alarma: …"
          value={plan} onChange={e => setPlan(e.target.value)} />
      </div>

      {/* PRESCRIPCIÓN */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">💊 Prescripción</h3>
          <button onClick={addMed} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar medicamento</button>
        </div>
        <div className="space-y-3">
          {medications.map((med, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 items-end">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Medicamento</Label>
                <input className={inputClass}
                  placeholder="Betametasona 0.05% crema" value={med.drug}
                  onChange={e => { const m = [...medications]; m[i].drug = e.target.value; setMedications(m); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dosis</Label>
                <input className={inputClass}
                  placeholder="Capa fina" value={med.dose}
                  onChange={e => { const m = [...medications]; m[i].dose = e.target.value; setMedications(m); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Frecuencia</Label>
                <select className={selectClass}
                  value={med.frequency} onChange={e => { const m = [...medications]; m[i].frequency = e.target.value; setMedications(m); }}>
                  <option value="">…</option>
                  {["c/12h","c/24h","c/8h","2 veces/sem","3 veces/sem","Según necesidad"].map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duración</Label>
                <input className={inputClass}
                  placeholder="14 días" value={med.duration}
                  onChange={e => { const m = [...medications]; m[i].duration = e.target.value; setMedications(m); }} />
              </div>
              <div className="flex items-end">
                {medications.length > 1 && (
                  <button onClick={() => removeMed(i)} className="h-9 px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors text-lg">×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NEXT VISIT */}
      <div className="space-y-1.5">
        <Label>Próxima cita / Control</Label>
        <input type="date" className={inputClass} value={returnDate} onChange={e => setReturnDate(e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "💾 Guardar consulta dermatológica"}
        </Button>
      </div>
    </div>
  );
}
