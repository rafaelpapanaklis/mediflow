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
    // Baumann skin type
    baumannHidratacion: "" as "" | "O" | "D",
    baumannSensibilidad: "" as "" | "S" | "R",
    baumannPigmentacion: "" as "" | "P" | "N",
    baumannArrugas: "" as "" | "W" | "T",
    // Equipment parameters
    equipoUtilizado: "",
    energia: "",
    frecuencia: "",
    profundidad: "",
    tiempoExposicion: "",
    modoPrograma: "",
    // Post-treatment reactions
    reaccionEritema: 0,
    reaccionEdema: 0,
    reaccionSensibilidad: 0,
    reaccionDescamacion: 0,
    tiempoResolucion: "",
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
            baumannType: `${form.baumannHidratacion}${form.baumannSensibilidad}${form.baumannPigmentacion}${form.baumannArrugas}`,
            baumannHidratacion: form.baumannHidratacion,
            baumannSensibilidad: form.baumannSensibilidad,
            baumannPigmentacion: form.baumannPigmentacion,
            baumannArrugas: form.baumannArrugas,
            equipoUtilizado: form.equipoUtilizado,
            energia: form.energia,
            frecuencia: form.frecuencia,
            profundidad: form.profundidad,
            tiempoExposicion: form.tiempoExposicion,
            modoPrograma: form.modoPrograma,
            reacciones: {
              eritema: form.reaccionEritema,
              edema: form.reaccionEdema,
              sensibilidad: form.reaccionSensibilidad,
              descamacion: form.reaccionDescamacion,
            },
            tiempoResolucion: form.tiempoResolucion,
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
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física / Observaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado actual de la piel, condiciones observadas…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* TIPO DE PIEL */}
      <div className="space-y-1.5">
        <Label>Tipo de piel / condición</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Ej. Piel mixta, deshidratada, con manchas solares…" value={form.tipoPiel} onChange={e => set("tipoPiel", e.target.value)} />
      </div>

      {/* TRATAMIENTO & ZONA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tratamiento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Tratamiento</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tratamiento} onChange={e => set("tratamiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TREATMENTS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Zona tratada</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Diagnóstico, hallazgos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones</Label>
          <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Observaciones adicionales del tratamiento…" value={form.observaciones} onChange={e => set("observaciones", e.target.value)} />
        </div>
      </div>

      {/* TIPO DE PIEL BAUMANN */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tipo de piel Baumann</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Hidratación</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.baumannHidratacion} onChange={e => set("baumannHidratacion", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="O">Oleosa (O)</option>
              <option value="D">Seca (D)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sensibilidad</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.baumannSensibilidad} onChange={e => set("baumannSensibilidad", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="S">Sensible (S)</option>
              <option value="R">Resistente (R)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pigmentación</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.baumannPigmentacion} onChange={e => set("baumannPigmentacion", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="P">Pigmentada (P)</option>
              <option value="N">No pigmentada (N)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Arrugas</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.baumannArrugas} onChange={e => set("baumannArrugas", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="W">Con arrugas (W)</option>
              <option value="T">Tirante (T)</option>
            </select>
          </div>
        </div>
        {(form.baumannHidratacion || form.baumannSensibilidad || form.baumannPigmentacion || form.baumannArrugas) && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Tipo Baumann:</span>
            <span className="inline-flex items-center rounded-full bg-brand-500/15 px-3 py-0.5 text-sm font-bold text-brand-700 dark:text-brand-300">
              {form.baumannHidratacion || "–"}{form.baumannSensibilidad || "–"}{form.baumannPigmentacion || "–"}{form.baumannArrugas || "–"}
            </span>
          </div>
        )}
      </div>

      {/* PARÁMETROS DEL EQUIPO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Parámetros del equipo</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Equipo utilizado</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Nombre del equipo" value={form.equipoUtilizado} onChange={e => set("equipoUtilizado", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Energía (J/cm²)</Label>
            <input type="number" min={0} step="0.1" className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="0" value={form.energia} onChange={e => set("energia", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Frecuencia (Hz)</Label>
            <input type="number" min={0} step="0.1" className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="0" value={form.frecuencia} onChange={e => set("frecuencia", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Profundidad (mm)</Label>
            <input type="number" min={0} step="0.1" className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="0" value={form.profundidad} onChange={e => set("profundidad", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tiempo de exposición (seg)</Label>
            <input type="number" min={0} step="1" className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="0" value={form.tiempoExposicion} onChange={e => set("tiempoExposicion", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modo/Programa</Label>
            <input className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Modo o programa utilizado" value={form.modoPrograma} onChange={e => set("modoPrograma", e.target.value)} />
          </div>
        </div>
      </div>

      {/* EVALUACIÓN DE REACCIONES POST-TRATAMIENTO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación de reacciones post-tratamiento</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {([
            { key: "reaccionEritema", label: "Eritema" },
            { key: "reaccionEdema", label: "Edema" },
            { key: "reaccionSensibilidad", label: "Sensibilidad" },
            { key: "reaccionDescamacion", label: "Descamación" },
          ] as const).map(item => (
            <div key={item.key} className="space-y-1">
              <Label className="text-xs">{item.label}</Label>
              <select className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={(form as any)[item.key]} onChange={e => set(item.key, Number(e.target.value))}>
                <option value={0}>0 - Ninguna</option>
                <option value={1}>1 - Leve</option>
                <option value={2}>2 - Moderada</option>
                <option value={3}>3 - Severa</option>
              </select>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tiempo de resolución estimado</Label>
          <select className="flex h-9 w-full rounded-lg border border-border bg-card dark:bg-neutral-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 max-w-xs"
            value={form.tiempoResolucion} onChange={e => set("tiempoResolucion", e.target.value)}>
            <option value="">Seleccionar…</option>
            <option value="Inmediata">Inmediata</option>
            <option value="24h">24h</option>
            <option value="48h">48h</option>
            <option value="72h">72h</option>
            <option value="1 semana">1 semana</option>
            <option value="> 1 semana">&gt; 1 semana</option>
          </select>
        </div>
      </div>

      {/* PLAN SIGUIENTE SESIÓN */}
      <div className="space-y-1.5">
        <Label>Plan siguiente sesión</Label>
        <textarea className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
