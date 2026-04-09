"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const ARTICULACIONES = ["hombro", "codo", "muñeca", "cadera", "rodilla", "tobillo", "columna cervical", "columna lumbar"] as const;
const LADOS = ["izquierdo", "derecho", "bilateral"] as const;
const TRATAMIENTOS = ["terapia manual", "ejercicio terapéutico", "TENS", "EMS", "ultrasonido", "punción seca", "hidroterapia", "vendaje", "crioterapia", "termoterapia"] as const;
const FRECUENCIAS = ["diario", "3x/semana", "2x/semana", "1x/semana"] as const;
const SCORES_TIPO = ["LEFS", "DASH", "Oswestry", "otro"] as const;

interface RomRow { articulacion: string; movimiento: string; grados: string; lado: string; }
interface HepRow { nombre: string; series: string; repeticiones: string; frecuencia: string; }

interface Props { patientId: string; onSaved: (record: any) => void; }

export function PhysiotherapyForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    diagnostico: "",
    codigoCIE: "",
    medicoReferente: "",
    dolorVAS: 0,
    tratamientos: [] as string[],
    sesionesAutorizadas: "",
    sesionesRealizadas: "",
    scoreTipo: "",
    scoreValor: "",
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const [romRows, setRomRows] = useState<RomRow[]>([{ articulacion: "", movimiento: "", grados: "", lado: "" }]);
  const [hepRows, setHepRows] = useState<HepRow[]>([{ nombre: "", series: "", repeticiones: "", frecuencia: "" }]);

  function toggleTratamiento(t: string) {
    setForm(f => ({
      ...f,
      tratamientos: f.tratamientos.includes(t) ? f.tratamientos.filter(x => x !== t) : [...f.tratamientos, t],
    }));
  }

  function updateRom(i: number, k: keyof RomRow, v: string) {
    setRomRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }
  function updateHep(i: number, k: keyof HepRow, v: string) {
    setHepRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
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
            type: "physiotherapy",
            diagnostico: form.diagnostico,
            codigoCIE: form.codigoCIE,
            medicoReferente: form.medicoReferente,
            dolorVAS: form.dolorVAS,
            rom: romRows,
            tratamientos: form.tratamientos,
            hep: hepRows,
            sesionesAutorizadas: form.sesionesAutorizadas,
            sesionesRealizadas: form.sesionesRealizadas,
            scoreTipo: form.scoreTipo,
            scoreValor: form.scoreValor,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente de fisioterapia guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* DIAGNÓSTICO & REFERENCIA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Diagnóstico y referencia</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Diagnóstico</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Cervicalgia mecánica" value={form.diagnostico} onChange={e => set("diagnostico", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Código CIE-10</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. M54.2" value={form.codigoCIE} onChange={e => set("codigoCIE", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Médico referente</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Dr. / Dra." value={form.medicoReferente} onChange={e => set("medicoReferente", e.target.value)} />
          </div>
        </div>
      </div>

      {/* ESCALA DE DOLOR VAS */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Escala de dolor VAS</h3>
        <div className="space-y-2">
          <input type="range" min={0} max={10} step={1} value={form.dolorVAS}
            onChange={e => set("dolorVAS", Number(e.target.value))}
            className="w-full accent-brand-600" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 — Sin dolor</span>
            <span>5 — Moderado</span>
            <span>10 — Peor dolor</span>
          </div>
          <p className="text-center text-sm font-semibold">Valor actual: {form.dolorVAS}</p>
        </div>
      </div>

      {/* ROM TABLE */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Mediciones ROM</h3>
        <div className="space-y-2">
          {romRows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={row.articulacion} onChange={e => updateRom(i, "articulacion", e.target.value)}>
                <option value="">Articulación…</option>
                {ARTICULACIONES.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
              </select>
              <input className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Movimiento" value={row.movimiento} onChange={e => updateRom(i, "movimiento", e.target.value)} />
              <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Grados" value={row.grados} onChange={e => updateRom(i, "grados", e.target.value)} />
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={row.lado} onChange={e => updateRom(i, "lado", e.target.value)}>
                <option value="">Lado…</option>
                {LADOS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </select>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRomRows(r => [...r, { articulacion: "", movimiento: "", grados: "", lado: "" }])}>
            + Agregar fila ROM
          </Button>
        </div>
      </div>

      {/* TRATAMIENTO APLICADO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tratamiento aplicado</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRATAMIENTOS.map(t => (
            <label key={t} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.tratamientos.includes(t)} onChange={() => toggleTratamiento(t)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>

      {/* HEP TABLE */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Programa de ejercicios en casa (HEP)</h3>
        <div className="space-y-2">
          {hepRows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <input className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Ejercicio" value={row.nombre} onChange={e => updateHep(i, "nombre", e.target.value)} />
              <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Series" value={row.series} onChange={e => updateHep(i, "series", e.target.value)} />
              <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Repeticiones" value={row.repeticiones} onChange={e => updateHep(i, "repeticiones", e.target.value)} />
              <select className="flex h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={row.frecuencia} onChange={e => updateHep(i, "frecuencia", e.target.value)}>
                <option value="">Frecuencia…</option>
                {FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setHepRows(r => [...r, { nombre: "", series: "", repeticiones: "", frecuencia: "" }])}>
            + Agregar ejercicio
          </Button>
        </div>
      </div>

      {/* SESIONES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Control de sesiones</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Sesiones autorizadas</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 12" value={form.sesionesAutorizadas} onChange={e => set("sesionesAutorizadas", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sesiones realizadas</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 3" value={form.sesionesRealizadas} onChange={e => set("sesionesRealizadas", e.target.value)} />
          </div>
        </div>
      </div>

      {/* NOTAS SOAP */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Notas SOAP</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Subjetivo</Label>
            <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Lo que refiere el paciente…" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Objetivo</Label>
            <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Hallazgos clínicos…" value={form.objective} onChange={e => set("objective", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Evaluación</Label>
            <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Diagnóstico y evaluación…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Plan de tratamiento…" value={form.plan} onChange={e => set("plan", e.target.value)} />
          </div>
        </div>
      </div>

      {/* SCORE FUNCIONAL */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Score funcional</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de score</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.scoreTipo} onChange={e => set("scoreTipo", e.target.value)}>
              <option value="">Seleccionar…</option>
              {SCORES_TIPO.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Score</Label>
            <input type="number" className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Valor numérico" value={form.scoreValor} onChange={e => set("scoreValor", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente fisioterapia"}
        </Button>
      </div>
    </div>
  );
}
