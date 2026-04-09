"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const TECHNIQUES = ["FUE", "FUT", "PRP capilar", "micropigmentación", "LLLT"] as const;
const NORWOOD = ["Norwood I", "Norwood II", "Norwood III", "Norwood III Vertex", "Norwood IV", "Norwood V", "Norwood VI", "Norwood VII"] as const;
const LUDWIG = ["Ludwig I", "Ludwig II", "Ludwig III"] as const;
const TREATED_ZONES = ["frontal", "temporal", "vertex", "occipital", "línea capilar"] as const;
const FOLLOWUP_MONTHS = ["3", "6", "12"] as const;

interface Props { patientId: string; onSaved: (record: any) => void; }

export function HairRestorationForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    clasificacion: "",
    tecnica: "",
    densidadDonante: "",
    graftsCosechados: "",
    graftsImplantados: "",
    zonas: [] as string[],
    disenoLinea: "",
    seguimientoMeses: "",
    supervivencia: "",
    notasQuirurgicas: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

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
            type: "hair_restoration",
            clasificacion: form.clasificacion,
            tecnica: form.tecnica,
            densidadDonante: form.densidadDonante,
            graftsCosechados: form.graftsCosechados,
            graftsImplantados: form.graftsImplantados,
            zonas: form.zonas,
            disenoLinea: form.disenoLinea,
            seguimientoMeses: form.seguimientoMeses,
            supervivencia: form.supervivencia,
            notasQuirurgicas: form.notasQuirurgicas,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente capilar guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* ANAMNESIS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de consulta / HEA</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física / Observaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado del cuero cabelludo, densidad visual…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* CLASIFICACIÓN & TÉCNICA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Clasificación y técnica</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Clasificación</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.clasificacion} onChange={e => set("clasificacion", e.target.value)}>
              <option value="">Seleccionar…</option>
              <optgroup label="Hombres (Norwood)">
                {NORWOOD.map(n => <option key={n} value={n}>{n}</option>)}
              </optgroup>
              <optgroup label="Mujeres (Ludwig)">
                {LUDWIG.map(l => <option key={l} value={l}>{l}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Técnica</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tecnica} onChange={e => set("tecnica", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TECHNIQUES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* GRAFTS & DENSIDAD */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Datos del procedimiento</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Densidad zona donante (folículos/cm²)</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 80" value={form.densidadDonante} onChange={e => set("densidadDonante", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Grafts cosechados</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 2500" value={form.graftsCosechados} onChange={e => set("graftsCosechados", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Grafts implantados</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 2400" value={form.graftsImplantados} onChange={e => set("graftsImplantados", e.target.value)} />
          </div>
        </div>
      </div>

      {/* ZONAS TRATADAS */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Zonas tratadas</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {TREATED_ZONES.map(z => (
            <label key={z} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.zonas.includes(z)} onChange={() => toggleZona(z)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{z}</span>
            </label>
          ))}
        </div>
      </div>

      {/* DISEÑO LÍNEA CAPILAR */}
      <div className="space-y-1.5">
        <Label>Diseño de línea capilar</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Descripción del diseño de la línea capilar…" value={form.disenoLinea} onChange={e => set("disenoLinea", e.target.value)} />
      </div>

      {/* SEGUIMIENTO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Seguimiento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Seguimiento (meses)</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.seguimientoMeses} onChange={e => set("seguimientoMeses", e.target.value)}>
              <option value="">Seleccionar…</option>
              {FOLLOWUP_MONTHS.map(m => <option key={m} value={m}>{m} meses</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">% supervivencia grafts</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 92" value={form.supervivencia} onChange={e => set("supervivencia", e.target.value)} />
          </div>
        </div>
      </div>

      {/* DIAGNÓSTICO & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico, hallazgos clínicos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan de tratamiento</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Plan de tratamiento futuro…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      {/* NOTAS QUIRÚRGICAS */}
      <div className="space-y-1.5">
        <Label>Notas quirúrgicas</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Detalles del procedimiento quirúrgico, complicaciones…" value={form.notasQuirurgicas} onChange={e => set("notasQuirurgicas", e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente capilar"}
        </Button>
      </div>
    </div>
  );
}
