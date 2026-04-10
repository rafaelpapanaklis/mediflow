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
const DENSITY_ZONES = ["Frontal", "Temporal", "Vertex", "Occipital (donante)"] as const;
const TIMELINE_MILESTONES = ["1 mes", "3 meses", "6 meses", "9 meses", "12 meses"] as const;
const SURVIVAL_ZONES = ["Frontal", "Temporal", "Vertex", "Línea de implantación"] as const;

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
    densidadZonas: Object.fromEntries(DENSITY_ZONES.map(z => [z, { antes: "", despues: "" }])) as Record<string, { antes: string; despues: string }>,
    timelineMilestones: {} as Record<string, { checked: boolean; observaciones: string }>,
    supervivenciaInjertos: Object.fromEntries(SURVIVAL_ZONES.map(z => [z, { implantados: "", supervivencia: "" }])) as Record<string, { implantados: string; supervivencia: string }>,
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
            densidadZonas: form.densidadZonas,
            timelineMilestones: form.timelineMilestones,
            supervivenciaInjertos: form.supervivenciaInjertos,
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

      {/* DENSIDAD BASELINE POR ZONA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📐 Densidad folicular por zona (folículos/cm²)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {DENSITY_ZONES.map(zone => {
            const antes = Number(form.densidadZonas[zone]?.antes) || 0;
            const despues = Number(form.densidadZonas[zone]?.despues) || 0;
            const pctChange = antes > 0 ? (((despues - antes) / antes) * 100).toFixed(1) : null;
            return (
              <div key={zone} className="space-y-2 rounded-lg border border-border/60 p-3">
                <span className="text-xs font-semibold">{zone}</span>
                <div className="space-y-1">
                  <Label className="text-xs">Antes</Label>
                  <input type="number" min={0} className="flex h-8 w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="0" value={form.densidadZonas[zone]?.antes ?? ""}
                    onChange={e => setForm(f => ({ ...f, densidadZonas: { ...f.densidadZonas, [zone]: { ...f.densidadZonas[zone], antes: e.target.value } } }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Después</Label>
                  <input type="number" min={0} className="flex h-8 w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="0" value={form.densidadZonas[zone]?.despues ?? ""}
                    onChange={e => setForm(f => ({ ...f, densidadZonas: { ...f.densidadZonas, [zone]: { ...f.densidadZonas[zone], despues: e.target.value } } }))} />
                </div>
                {pctChange !== null && (
                  <p className={`text-xs font-medium ${Number(pctChange) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {Number(pctChange) >= 0 ? "+" : ""}{pctChange}%
                  </p>
                )}
              </div>
            );
          })}
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

      {/* TIMELINE DE EVOLUCIÓN */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📸 Timeline de evolución post-procedimiento</h3>
        <div className="space-y-3">
          {TIMELINE_MILESTONES.map(milestone => {
            const entry = form.timelineMilestones[milestone];
            const isChecked = entry?.checked ?? false;
            return (
              <div key={milestone} className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isChecked}
                    onChange={() => setForm(f => ({
                      ...f,
                      timelineMilestones: {
                        ...f.timelineMilestones,
                        [milestone]: { checked: !isChecked, observaciones: entry?.observaciones ?? "" },
                      },
                    }))}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm font-medium">{milestone}</span>
                </label>
                {isChecked && (
                  <textarea className="flex min-h-[60px] w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none ml-6"
                    placeholder={`Observaciones a los ${milestone}…`}
                    value={entry?.observaciones ?? ""}
                    onChange={e => setForm(f => ({
                      ...f,
                      timelineMilestones: {
                        ...f.timelineMilestones,
                        [milestone]: { ...f.timelineMilestones[milestone], checked: true, observaciones: e.target.value },
                      },
                    }))} />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3">Las fotos comparativas se registran en la sección Antes/Después</p>
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

      {/* TASA DE SUPERVIVENCIA DE INJERTOS */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">📊 Supervivencia de injertos</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {SURVIVAL_ZONES.map(zone => (
            <div key={zone} className="space-y-2 rounded-lg border border-border/60 p-3">
              <span className="text-xs font-semibold">{zone}</span>
              <div className="space-y-1">
                <Label className="text-xs">Injertos implantados</Label>
                <input type="number" min={0} className="flex h-8 w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="0" value={form.supervivenciaInjertos[zone]?.implantados ?? ""}
                  onChange={e => setForm(f => ({ ...f, supervivenciaInjertos: { ...f.supervivenciaInjertos, [zone]: { ...f.supervivenciaInjertos[zone], implantados: e.target.value } } }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Supervivencia estimada %</Label>
                <input type="number" min={0} max={100} className="flex h-8 w-full rounded-lg border border-border bg-white dark:bg-zinc-900 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="0" value={form.supervivenciaInjertos[zone]?.supervivencia ?? ""}
                  onChange={e => setForm(f => ({ ...f, supervivenciaInjertos: { ...f.supervivenciaInjertos, [zone]: { ...f.supervivenciaInjertos[zone], supervivencia: e.target.value } } }))} />
              </div>
            </div>
          ))}
        </div>
        {(() => {
          const entries = Object.values(form.supervivenciaInjertos);
          const totalInjertos = entries.reduce((sum, e) => sum + (Number(e.implantados) || 0), 0);
          const weightedSum = entries.reduce((sum, e) => sum + (Number(e.implantados) || 0) * (Number(e.supervivencia) || 0), 0);
          const avgSurvival = totalInjertos > 0 ? (weightedSum / totalInjertos).toFixed(1) : null;
          return totalInjertos > 0 ? (
            <div className="mt-3 flex gap-6 text-sm">
              <span>Total injertos: <strong>{totalInjertos}</strong></span>
              <span>Supervivencia promedio ponderada: <strong>{avgSurvival}%</strong></span>
            </div>
          ) : null;
        })()}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar expediente capilar"}
        </Button>
      </div>
    </div>
  );
}
