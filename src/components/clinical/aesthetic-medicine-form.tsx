"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const PROCEDURES = ["botox", "fillers", "PRP", "mesoterapia", "peeling", "hilos tensores", "láser"] as const;
const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"] as const;
const FACIAL_ZONES = ["frente", "entrecejo", "patas de gallo", "nasogeniano", "labios", "mentón", "pómulos", "mandíbula"] as const;

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
            type: "aesthetic_medicine",
            fototipo: form.fototipo,
            procedimiento: form.procedimiento,
            zonas: form.zonas,
            unidades: form.unidades,
            producto: form.producto,
            lote: form.lote,
            notasPost: form.notasPost,
            planSiguiente: form.planSiguiente,
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
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física / Observaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado actual de la piel, zonas a tratar…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* FOTOTIPO & PROCEDIMIENTO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Datos del procedimiento</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Fototipo Fitzpatrick</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.fototipo} onChange={e => set("fototipo", e.target.value)}>
              <option value="">Seleccionar…</option>
              {FITZPATRICK.map(f => <option key={f} value={f}>Tipo {f}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Procedimiento</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.procedimiento} onChange={e => set("procedimiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {PROCEDURES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unidades/ml aplicados</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Botox Allergan" value={form.producto} onChange={e => set("producto", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Número de lote</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. LOT-2026-0412" value={form.lote} onChange={e => set("lote", e.target.value)} />
          </div>
        </div>
      </div>

      {/* NOTAS & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Notas post-procedimiento</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Cuidados posteriores, reacciones observadas…" value={form.notasPost} onChange={e => set("notasPost", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico estético, hallazgos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Plan siguiente sesión</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Plan de tratamiento para próxima visita…" value={form.planSiguiente} onChange={e => set("planSiguiente", e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente estético"}
        </Button>
      </div>
    </div>
  );
}
