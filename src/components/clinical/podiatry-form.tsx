"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const RIESGO_PIE = ["bajo", "medio", "alto", "urgente", "no aplica"] as const;
const TRATAMIENTOS = ["cirugía ungueal", "ortesis", "screening diabético", "desbridamiento", "evaluación biomecánica", "fascitis plantar", "crioterapia verruga", "cuidado general", "otro"] as const;
const PIE_AFECTADO = ["izquierdo", "derecho", "ambos"] as const;
const ZONAS_PIE = ["hallux", "dedos menores", "metatarso", "arco", "talón", "dorso", "planta completa"] as const;
const TIPO_HERIDA = ["úlcera", "herida", "callo", "verruga"] as const;
const ESTADO_ORTESIS = ["evaluación", "molde tomado", "en laboratorio", "listo para entrega", "entregado", "en ajuste"] as const;
const RECALL = ["1 mes", "3 meses", "6 meses", "12 meses"] as const;

interface Props { patientId: string; onSaved: (record: any) => void; }

export function PodiatryForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    riesgoPie: "",
    scoreABI: "",
    tratamiento: "",
    pieAfectado: "",
    zonasPie: [] as string[],
    heridaExiste: false,
    heridaLargo: "",
    heridaAncho: "",
    heridaProfundidad: "",
    heridaTipo: "",
    estadoOrtesis: "",
    evaluacionCalzado: "",
    recall: "",
    notasClinicas: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function toggleZona(z: string) {
    setForm(f => ({
      ...f,
      zonasPie: f.zonasPie.includes(z) ? f.zonasPie.filter(x => x !== z) : [...f.zonasPie, z],
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
            type: "podiatry",
            riesgoPie: form.riesgoPie,
            scoreABI: form.scoreABI,
            tratamiento: form.tratamiento,
            pieAfectado: form.pieAfectado,
            zonasPie: form.zonasPie,
            herida: form.heridaExiste ? {
              largo: form.heridaLargo,
              ancho: form.heridaAncho,
              profundidad: form.heridaProfundidad,
              tipo: form.heridaTipo,
            } : null,
            estadoOrtesis: form.estadoOrtesis,
            evaluacionCalzado: form.evaluacionCalzado,
            recall: form.recall,
            notasClinicas: form.notasClinicas,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente de podología guardado");
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
            placeholder="Estado actual del pie, hallazgos…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* RIESGO & TRATAMIENTO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación podológica</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Riesgo pie diabético</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.riesgoPie} onChange={e => set("riesgoPie", e.target.value)}>
              <option value="">Seleccionar…</option>
              {RIESGO_PIE.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Score ABI (opcional)</Label>
            <input type="number" step="0.01" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 0.95" value={form.scoreABI} onChange={e => set("scoreABI", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tratamiento</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tratamiento} onChange={e => set("tratamiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TRATAMIENTOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pie afectado</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.pieAfectado} onChange={e => set("pieAfectado", e.target.value)}>
              <option value="">Seleccionar…</option>
              {PIE_AFECTADO.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ZONA DEL PIE */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Zona del pie</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ZONAS_PIE.map(z => (
            <label key={z} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.zonasPie.includes(z)} onChange={() => toggleZona(z)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{z}</span>
            </label>
          ))}
        </div>
      </div>

      {/* HERIDA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Herida / Lesión</h3>
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input type="checkbox" checked={form.heridaExiste} onChange={e => set("heridaExiste", e.target.checked)}
            className="w-4 h-4 accent-brand-600" />
          <span className="text-sm">Existe herida o lesión</span>
        </label>
        {form.heridaExiste && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Largo (cm)</Label>
              <input type="number" step="0.1" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="cm" value={form.heridaLargo} onChange={e => set("heridaLargo", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ancho (cm)</Label>
              <input type="number" step="0.1" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="cm" value={form.heridaAncho} onChange={e => set("heridaAncho", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Profundidad (cm)</Label>
              <input type="number" step="0.1" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="cm" value={form.heridaProfundidad} onChange={e => set("heridaProfundidad", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={form.heridaTipo} onChange={e => set("heridaTipo", e.target.value)}>
                <option value="">Seleccionar…</option>
                {TIPO_HERIDA.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ORTESIS & CALZADO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Ortesis y calzado</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Estado de ortesis (si aplica)</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.estadoOrtesis} onChange={e => set("estadoOrtesis", e.target.value)}>
              <option value="">Seleccionar…</option>
              {ESTADO_ORTESIS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Intervalo de recall</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.recall} onChange={e => set("recall", e.target.value)}>
              <option value="">Seleccionar…</option>
              {RECALL.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5 mt-3">
          <Label>Evaluación de calzado</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Tipo de calzado, desgaste, adecuación…" value={form.evaluacionCalzado} onChange={e => set("evaluacionCalzado", e.target.value)} />
        </div>
      </div>

      {/* DIAGNÓSTICO & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico podológico…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Plan de tratamiento…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notas clínicas</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Notas adicionales…" value={form.notasClinicas} onChange={e => set("notasClinicas", e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente podología"}
        </Button>
      </div>
    </div>
  );
}
