"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";

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
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Anamnesis">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Motivo de consulta / HEA</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Exploración física / Observaciones</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Estado actual de la piel, condiciones observadas…" value={form.objective} onChange={e => set("objective", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title="Tipo de piel">
        <div className="field-new">
          <label className="field-new__label">Tipo de piel / condición</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Ej. Piel mixta, deshidratada, con manchas solares…" value={form.tipoPiel} onChange={e => set("tipoPiel", e.target.value)} />
        </div>
      </CardNew>

      <CardNew title="Tratamiento">
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">Tratamiento</label>
            <select className="input-new"
              value={form.tratamiento} onChange={e => set("tratamiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TREATMENTS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Zona tratada</label>
            <select className="input-new"
              value={form.zonaTratada} onChange={e => set("zonaTratada", e.target.value)}>
              <option value="">Seleccionar…</option>
              {BODY_ZONES.map(z => <option key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Productos">
        <div className="field-new">
          <label className="field-new__label">Productos utilizados</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Productos, marcas y cantidades aplicadas…" value={form.productos} onChange={e => set("productos", e.target.value)} />
        </div>
      </CardNew>

      <CardNew title="Checklist contraindicaciones">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CONTRAINDICATIONS.map(c => (
            <label key={c} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.contraindicaciones.includes(c)} onChange={() => toggleContra(c)}
                className="w-4 h-4 accent-brand-600" />
              <span className="text-sm capitalize">{c}</span>
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title="Diagnóstico y observaciones">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Diagnóstico / Evaluación</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Diagnóstico, hallazgos…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Observaciones</label>
            <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Observaciones adicionales del tratamiento…" value={form.observaciones} onChange={e => set("observaciones", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title="Tipo de piel Baumann">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">Hidratación</label>
            <select className="input-new"
              value={form.baumannHidratacion} onChange={e => set("baumannHidratacion", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="O">Oleosa (O)</option>
              <option value="D">Seca (D)</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Sensibilidad</label>
            <select className="input-new"
              value={form.baumannSensibilidad} onChange={e => set("baumannSensibilidad", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="S">Sensible (S)</option>
              <option value="R">Resistente (R)</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Pigmentación</label>
            <select className="input-new"
              value={form.baumannPigmentacion} onChange={e => set("baumannPigmentacion", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="P">Pigmentada (P)</option>
              <option value="N">No pigmentada (N)</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Arrugas</label>
            <select className="input-new"
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
      </CardNew>

      <CardNew title="Parámetros del equipo">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">Equipo utilizado</label>
            <input className="input-new"
              placeholder="Nombre del equipo" value={form.equipoUtilizado} onChange={e => set("equipoUtilizado", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Energía (J/cm²)</label>
            <input type="number" min={0} step="0.1" className="input-new"
              placeholder="0" value={form.energia} onChange={e => set("energia", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Frecuencia (Hz)</label>
            <input type="number" min={0} step="0.1" className="input-new"
              placeholder="0" value={form.frecuencia} onChange={e => set("frecuencia", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Profundidad (mm)</label>
            <input type="number" min={0} step="0.1" className="input-new"
              placeholder="0" value={form.profundidad} onChange={e => set("profundidad", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Tiempo de exposición (seg)</label>
            <input type="number" min={0} step="1" className="input-new"
              placeholder="0" value={form.tiempoExposicion} onChange={e => set("tiempoExposicion", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Modo/Programa</label>
            <input className="input-new"
              placeholder="Modo o programa utilizado" value={form.modoPrograma} onChange={e => set("modoPrograma", e.target.value)} />
          </div>
        </div>
      </CardNew>

      <CardNew title="Evaluación de reacciones post-tratamiento">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {([
            { key: "reaccionEritema", label: "Eritema" },
            { key: "reaccionEdema", label: "Edema" },
            { key: "reaccionSensibilidad", label: "Sensibilidad" },
            { key: "reaccionDescamacion", label: "Descamación" },
          ] as const).map(item => (
            <div key={item.key} className="field-new">
              <label className="field-new__label">{item.label}</label>
              <select className="input-new"
                value={(form as any)[item.key]} onChange={e => set(item.key, Number(e.target.value))}>
                <option value={0}>0 - Ninguna</option>
                <option value={1}>1 - Leve</option>
                <option value={2}>2 - Moderada</option>
                <option value={3}>3 - Severa</option>
              </select>
            </div>
          ))}
        </div>
        <div className="field-new">
          <label className="field-new__label">Tiempo de resolución estimado</label>
          <select className="input-new"
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
      </CardNew>

      <CardNew title="Plan siguiente sesión">
        <div className="field-new">
          <label className="field-new__label">Plan siguiente sesión</label>
          <textarea className="input-new" style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Plan de tratamiento para próxima visita…" value={form.planSiguiente} onChange={e => set("planSiguiente", e.target.value)} />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ButtonNew variant="primary" type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta"}
        </ButtonNew>
      </div>
    </form>
  );
}
