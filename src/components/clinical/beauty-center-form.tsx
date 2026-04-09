"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const TREATMENTS = ["facial", "body wrap", "radiofrecuencia", "cavitación", "LED", "microdermoabrasión", "otro"] as const;
const BODY_ZONES = ["rostro", "cuello", "brazos", "abdomen", "piernas", "glúteos", "espalda", "cuerpo completo"] as const;
const CONTRAINDICATIONS = ["embarazo", "marcapasos", "medicamentos fotosensibles", "enfermedades autoinmunes", "heridas abiertas"] as const;

interface Props { patientId: string; onSaved: (record: any) => void; }

export function BeautyCenterForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    tipoPiel: "",
    tratamiento: "",
    zonaTratada: "",
    productos: "",
    contraindicaciones: [] as string[],
    observaciones: "",
    planSiguiente: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function toggleContra(c: string) {
    setForm(f => ({
      ...f,
      contraindicaciones: f.contraindicaciones.includes(c)
        ? f.contraindicaciones.filter(x => x !== c)
        : [...f.contraindicaciones, c],
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
            type: "beauty_center",
            tipoPiel: form.tipoPiel,
            tratamiento: form.tratamiento,
            zonaTratada: form.zonaTratada,
            productos: form.productos,
            contraindicaciones: form.contraindicaciones,
            observaciones: form.observaciones,
            planSiguiente: form.planSiguiente,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente de centro de belleza guardado");
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
            placeholder="Estado actual de la piel, condiciones observadas…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* TIPO DE PIEL */}
      <div className="space-y-1.5">
        <Label>Tipo de piel / condición</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Ej. Piel mixta, deshidratada, con manchas solares…" value={form.tipoPiel} onChange={e => set("tipoPiel", e.target.value)} />
      </div>

      {/* TRATAMIENTO & ZONA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tratamiento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Tratamiento</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tratamiento} onChange={e => set("tratamiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TREATMENTS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Zona tratada</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.zonaTratada} onChange={e => set("zonaTratada", e.target.value)}>
              <option value="">Seleccionar…</option>
              {BODY_ZONES.map(z => <option key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* PRODUCTOS */}
      <div className="space-y-1.5">
        <Label>Productos utilizados</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Productos, marcas y cantidades aplicadas…" value={form.productos} onChange={e => set("productos", e.target.value)} />
      </div>

      {/* CONTRAINDICACIONES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Checklist contraindicaciones</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CONTRAINDICATIONS.map(c => (
            <label key={c} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.contraindicaciones.includes(c)} onChange={() => toggleContra(c)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{c}</span>
            </label>
          ))}
        </div>
      </div>

      {/* DIAGNÓSTICO & OBSERVACIONES */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico, hallazgos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Observaciones adicionales del tratamiento…" value={form.observaciones} onChange={e => set("observaciones", e.target.value)} />
        </div>
      </div>

      {/* PLAN SIGUIENTE SESIÓN */}
      <div className="space-y-1.5">
        <Label>Plan siguiente sesión</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Plan de tratamiento para próxima visita…" value={form.planSiguiente} onChange={e => set("planSiguiente", e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente de belleza"}
        </Button>
      </div>
    </div>
  );
}
