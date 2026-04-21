"use client";
import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";

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
  { key: "frente",            label: "Frente" },
  { key: "glabela",           label: "Glabela (entrecejo)" },
  { key: "patasDeGallo",      label: "Patas de gallo" },
  { key: "surcoNasogeniano",  label: "Surco nasogeniano" },
  { key: "labios",            label: "Labios" },
  { key: "menton",            label: "Mentón" },
  { key: "pomulos",           label: "Pómulos" },
  { key: "lineaMandibular",   label: "Línea mandibular" },
] as const;

const GAIS_OPTIONS = [
  { label: "Muy mejorado", value: 3 },
  { label: "Mejorado",     value: 2 },
  { label: "Sin cambio",   value: 1 },
  { label: "Peor",         value: 0 },
  { label: "Mucho peor",   value: -1 },
] as const;

interface ZoneEntry { product: string; units: string }

interface Props { patientId: string; onSaved: (record: any) => void }

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

  function toggleZona(z: string) {
    setForm(f => ({ ...f, zonas: f.zonas.includes(z) ? f.zonas.filter(x => x !== z) : [...f.zonas, z] }));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega al menos el motivo de consulta o diagnóstico"); return; }
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
      toast.success("Expediente de medicina estética guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
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
      <CardNew title="Motivo de consulta y exploración">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Motivo de consulta / HEA</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="¿Por qué viene el paciente hoy?"
              value={form.subjective}
              onChange={e => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Exploración física / Observaciones</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Estado actual de la piel, zonas a tratar…"
              value={form.objective}
              onChange={e => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Contraindicaciones */}
      <CardNew
        title="Checklist de contraindicaciones"
        sub="Evaluar antes de proceder"
        action={
          contraindicaciones.length > 0 ? (
            <BadgeNew tone="danger" dot>{contraindicaciones.length} detectadas</BadgeNew>
          ) : undefined
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {CONTRAINDICATIONS.map(c => (
            <button
              key={c}
              type="button"
              className="tag-new"
              style={tagButton(contraindicaciones.includes(c))}
              onClick={() => toggleContraindicacion(c)}
            >
              {contraindicaciones.includes(c) && "✓ "}{c}
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
            ⚠ Contraindicaciones detectadas — evaluar riesgo/beneficio antes del procedimiento
          </div>
        )}
      </CardNew>

      {/* Datos del procedimiento */}
      <CardNew title="Datos del procedimiento">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Fototipo Fitzpatrick</label>
            <select className="input-new" value={form.fototipo} onChange={e => set("fototipo", e.target.value)}>
              <option value="">Seleccionar…</option>
              {FITZPATRICK.map(f => <option key={f} value={f}>Tipo {f}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Procedimiento</label>
            <select className="input-new" value={form.procedimiento} onChange={e => set("procedimiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {PROCEDURES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Unidades/ml aplicados</label>
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
      <CardNew title="Zona facial de aplicación">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {FACIAL_ZONES.map(z => (
            <button
              key={z}
              type="button"
              className="tag-new"
              style={{ ...tagButton(form.zonas.includes(z)), textTransform: "capitalize" }}
              onClick={() => toggleZona(z)}
            >
              {form.zonas.includes(z) && "✓ "}{z}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Producto + lote */}
      <CardNew title="Producto utilizado">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Producto usado</label>
            <input
              className="input-new"
              placeholder="Ej. Botox Allergan"
              value={form.producto}
              onChange={e => set("producto", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Número de lote</label>
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
        title="Registro de aplicación por zona"
        action={
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            Total: <span className="mono" style={{ fontWeight: 600, color: "var(--brand)" }}>{totalUnits}</span> U/ml
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {ZONE_MAP.map(z => (
            <div key={z.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-2)", width: 160, flexShrink: 0 }}>{z.label}</span>
              <input
                className="input-new"
                placeholder="Producto"
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
      <CardNew title="Notas y plan">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Notas post-procedimiento</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Cuidados posteriores, reacciones observadas…"
              value={form.notasPost}
              onChange={e => set("notasPost", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Diagnóstico / Evaluación</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Diagnóstico estético, hallazgos…"
              value={form.assessment}
              onChange={e => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">Plan siguiente sesión</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Plan de tratamiento para próxima visita…"
              value={form.planSiguiente}
              onChange={e => set("planSiguiente", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* GAIS */}
      <CardNew
        title="Escala GAIS"
        sub="Global Aesthetic Improvement Scale"
        action={
          gaisDelta !== null ? (
            <BadgeNew tone={gaisDelta > 0 ? "success" : gaisDelta === 0 ? "neutral" : "danger"} dot>
              Δ {gaisDelta > 0 ? "+" : ""}{gaisDelta} {gaisDelta > 0 ? "Mejoría" : gaisDelta === 0 ? "Sin cambio" : "Empeoramiento"}
            </BadgeNew>
          ) : undefined
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 14px" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
              Pre-procedimiento
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
                  {opt.label} <span className="mono" style={{ color: "var(--text-4)" }}>({opt.value})</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 10 }}>
              Post-procedimiento
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
                  {opt.label} <span className="mono" style={{ color: "var(--text-4)" }}>({opt.value})</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar expediente estético"}
        </ButtonNew>
      </div>
    </div>
  );
}
