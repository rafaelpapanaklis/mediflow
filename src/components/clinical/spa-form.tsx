"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const SERVICIOS = ["hidroterapia", "sauna", "flotación", "body wrap", "circuito termal", "masaje spa", "facial spa", "paquete pareja", "ritual completo"] as const;
const SALUD_OPTIONS = ["problemas cardiovasculares", "claustrofobia", "embarazo", "presión baja", "alergias cutáneas", "ninguno"] as const;
const AROMAS = ["lavanda", "eucalipto", "menta", "romero", "naranja", "sin preferencia"] as const;
const TEMPERATURAS = ["baja", "media", "alta"] as const;
const DURACIONES = ["30", "60", "90", "120"] as const;

interface Props { patientId: string; onSaved: (record: any) => void; }

export function SpaForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    tipoServicio: "",
    cuestionarioSalud: [] as string[],
    aromaterapia: [] as string[],
    temperatura: "",
    duracion: "",
    observaciones: "",
    recomendacionesPost: "",
    productosRecomendados: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function toggleCheck(field: "cuestionarioSalud" | "aromaterapia", val: string) {
    setForm(f => ({
      ...f,
      [field]: f[field].includes(val) ? f[field].filter(x => x !== val) : [...f[field], val],
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
            type: "spa",
            tipoServicio: form.tipoServicio,
            cuestionarioSalud: form.cuestionarioSalud,
            aromaterapia: form.aromaterapia,
            temperatura: form.temperatura,
            duracion: form.duracion,
            observaciones: form.observaciones,
            recomendacionesPost: form.recomendacionesPost,
            productosRecomendados: form.productosRecomendados,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente de spa guardado");
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
            placeholder="Estado actual del paciente…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* SERVICIO & DURACIÓN */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Datos del servicio</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de servicio</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tipoServicio} onChange={e => set("tipoServicio", e.target.value)}>
              <option value="">Seleccionar…</option>
              {SERVICIOS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Preferencia temperatura</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.temperatura} onChange={e => set("temperatura", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TEMPERATURAS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Duración del servicio</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.duracion} onChange={e => set("duracion", e.target.value)}>
              <option value="">Seleccionar…</option>
              {DURACIONES.map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* CUESTIONARIO DE SALUD */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Cuestionario de salud</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SALUD_OPTIONS.map(s => (
            <label key={s} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.cuestionarioSalud.includes(s)} onChange={() => toggleCheck("cuestionarioSalud", s)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>

      {/* AROMATERAPIA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Preferencias aromaterapia</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AROMAS.map(a => (
            <label key={a} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.aromaterapia.includes(a)} onChange={() => toggleCheck("aromaterapia", a)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{a}</span>
            </label>
          ))}
        </div>
      </div>

      {/* OBSERVACIONES & RECOMENDACIONES */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Observaciones durante servicio</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Reacciones, notas durante el servicio…" value={form.observaciones} onChange={e => set("observaciones", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Recomendaciones post-servicio</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Cuidados posteriores…" value={form.recomendacionesPost} onChange={e => set("recomendacionesPost", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Productos recomendados para casa</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Productos sugeridos para uso en casa…" value={form.productosRecomendados} onChange={e => set("productosRecomendados", e.target.value)} />
      </div>

      {/* DIAGNÓSTICO & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Evaluación general…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Plan de seguimiento…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente spa"}
        </Button>
      </div>
    </div>
  );
}
