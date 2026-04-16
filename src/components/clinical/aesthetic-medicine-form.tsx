"use client";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const PROCEDURES = ["botox", "fillers", "PRP", "mesoterapia", "peeling", "hilos tensores", "láser"] as const;
const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"] as const;
const FACIAL_ZONES = ["frente", "entrecejo", "patas de gallo", "nasogeniano", "labios", "mentón", "pómulos", "mandíbula"] as const;

const CONTRAINDICATIONS = [
  "Embarazo o lactancia",
  "Anticoagulantes activos",
  "Isotretinoína (últimos 6 meses)",
  "Enfermedad autoinmune activa",
  "Tendencia a queloides",
  "Infección activa en zona",
  "Alergia conocida a ácido hialurónico",
  "Herpes activo (zona perioral)",
] as const;

const ZONE_MAP = [
  { key: "frente", label: "Frente" },
  { key: "glabela", label: "Glabela (entrecejo)" },
  { key: "patasDeGallo", label: "Patas de gallo" },
  { key: "surcoNasogeniano", label: "Surco nasogeniano" },
  { key: "labios", label: "Labios" },
  { key: "menton", label: "Mentón" },
  { key: "pomulos", label: "Pómulos" },
  { key: "lineaMandibular", label: "Línea mandibular" },
] as const;

const GAIS_OPTIONS = [
  { label: "Muy mejorado", value: 3 },
  { label: "Mejorado", value: 2 },
  { label: "Sin cambio", value: 1 },
  { label: "Peor", value: 0 },
  { label: "Mucho peor", value: -1 },
] as const;

interface ZoneEntry { product: string; units: string; }

interface Props { patientId: string; onSaved: (record: any) => void; }

export function AestheticMedicineForm({ patientId, onSaved }: Props) {
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
    setContraindicaciones(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
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

  function toggleZona(z: string) {
    setForm(f => ({
      ...f,
      zonas: f.zonas.includes(z) ? f.zonas.filter(x => x !== z) : [...f.zonas, z],
    }));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega al menos el motivo de consulta o diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          objective: form.objective,
          assessment: form.assessment,
          plan: form.plan,
          specialtyData: {
            type: "aesthetic_medicine",
            fototipo: form.fototipo,
            procedimiento: form.procedimiento,
            zonas: form.zonas,
            unidades: form.unidades,
            producto: form.producto,
            lote: form.lote,
            notasPost: form.notasPost,
            planSiguiente: form.planSiguiente,
            contraindicaciones,
            mapaZonas: zoneMap,
            totalUnidades: totalUnits,
            gaisPre,
            gaisPost,
            gaisDelta,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente de medicina estética guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* ANAMNESIS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de consulta / HEA</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física / Observaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado actual de la piel, zonas a tratar…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* CHECKLIST DE CONTRAINDICACIONES */}
      <div className="rounded-xl border border-red-300 dark:border-red-700 bg-card p-4">
        <h3 className="text-sm font-bold mb-3 text-red-700 dark:text-red-400">🚫 Checklist de contraindicaciones</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CONTRAINDICATIONS.map(c => (
            <label key={c} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={contraindicaciones.includes(c)}
                onChange={() => toggleContraindicacion(c)}
                className="w-4 h-4 accent-red-600"
              />
              <span className="text-sm">{c}</span>
            </label>
          ))}
        </div>
        {contraindicaciones.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-600 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 font-medium">
            ⚠️ Contraindicaciones detectadas — evaluar riesgo/beneficio
          </div>
        )}
      </div>

      {/* FOTOTIPO & PROCEDIMIENTO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Datos del procedimiento</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Fototipo Fitzpatrick</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.fototipo} onChange={e => set("fototipo", e.target.value)}>
              <option value="">Seleccionar…</option>
              {FITZPATRICK.map(f => <option key={f} value={f}>Tipo {f}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Procedimiento</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.procedimiento} onChange={e => set("procedimiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {PROCEDURES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unidades/ml aplicados</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 20" value={form.unidades} onChange={e => set("unidades", e.target.value)} />
          </div>
        </div>
      </div>

      {/* ZONA FACIAL */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Zona facial de aplicación</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FACIAL_ZONES.map(z => (
            <label key={z} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.zonas.includes(z)} onChange={() => toggleZona(z)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{z}</span>
            </label>
          ))}
        </div>
      </div>

      {/* PRODUCTO & LOTE */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Producto utilizado</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Producto usado</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Botox Allergan" value={form.producto} onChange={e => set("producto", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Número de lote</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. LOT-2026-0412" value={form.lote} onChange={e => set("lote", e.target.value)} />
          </div>
        </div>
      </div>

      {/* MAPA FACIAL CON UNIDADES/ZONA */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-3">💉 Registro de aplicación por zona</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ZONE_MAP.map(z => (
            <div key={z.key} className="flex items-center gap-2">
              <span className="text-sm font-medium w-40 shrink-0">{z.label}</span>
              <input
                className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Producto"
                value={zoneMap[z.key]?.product ?? ""}
                onChange={e => setZoneField(z.key, "product", e.target.value)}
              />
              <input
                type="number"
                className="flex h-9 w-24 shrink-0 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="U/ml"
                value={zoneMap[z.key]?.units ?? ""}
                onChange={e => setZoneField(z.key, "units", e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border flex justify-end">
          <span className="text-sm font-bold">Total unidades/ml: <span className="text-brand-600">{totalUnits}</span></span>
        </div>
      </div>

      {/* NOTAS & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Notas post-procedimiento</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Cuidados posteriores, reacciones observadas…" value={form.notasPost} onChange={e => set("notasPost", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico estético, hallazgos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Plan siguiente sesión</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Plan de tratamiento para próxima visita…" value={form.planSiguiente} onChange={e => set("planSiguiente", e.target.value)} />
      </div>

      {/* ESCALA GAIS */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-3">📊 Escala GAIS (Global Aesthetic Improvement Scale)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pre-procedimiento */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Pre-procedimiento</Label>
            <div className="space-y-1">
              {GAIS_OPTIONS.map(opt => (
                <label key={`pre-${opt.value}`} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gais-pre"
                    checked={gaisPre === opt.value}
                    onChange={() => setGaisPre(opt.value)}
                    className="w-4 h-4 accent-brand-600"
                  />
                  <span className="text-sm">{opt.label} ({opt.value})</span>
                </label>
              ))}
            </div>
          </div>
          {/* Post-procedimiento */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Post-procedimiento</Label>
            <div className="space-y-1">
              {GAIS_OPTIONS.map(opt => (
                <label key={`post-${opt.value}`} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gais-post"
                    checked={gaisPost === opt.value}
                    onChange={() => setGaisPost(opt.value)}
                    className="w-4 h-4 accent-brand-600"
                  />
                  <span className="text-sm">{opt.label} ({opt.value})</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        {/* Delta indicator */}
        {gaisDelta !== null && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
            <span className="text-sm font-medium">Cambio (delta):</span>
            <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
              gaisDelta > 0
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                : gaisDelta === 0
                  ? "bg-muted text-muted-foreground"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
            }`}>
              {gaisDelta > 0 ? "+" : ""}{gaisDelta}
            </span>
            <span className="text-xs text-muted-foreground">
              {gaisDelta > 0 ? "Mejoría" : gaisDelta === 0 ? "Sin cambio" : "Empeoramiento"}
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente estético"}
        </Button>
      </div>
    </div>
  );
}
