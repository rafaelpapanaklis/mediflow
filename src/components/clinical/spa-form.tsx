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

const PREF_TEMPERATURAS = ["Fría", "Templada", "Tibia", "Caliente", "Muy caliente"] as const;
const PREF_AROMAS = ["Lavanda", "Eucalipto", "Menta", "Romero", "Naranja", "Rosa", "Sándalo", "Sin aroma"] as const;
const PREF_PRESION = ["Muy suave", "Suave", "Moderada", "Firme", "Profunda"] as const;
const PREF_MUSICA = ["Sin música", "Naturaleza", "Piano", "Cuencos tibetanos", "Ambient", "A elección"] as const;
const PREF_ILUMINACION = ["Tenue", "Media", "Normal"] as const;
const CALIDAD_SUENO = ["Muy mala", "Mala", "Regular", "Buena", "Excelente"] as const;
const CIRCUITO_SERVICIOS = ["Sauna seca", "Sauna húmeda/vapor", "Jacuzzi", "Ducha fría", "Piscina templada", "Sala de relajación", "Baño turco", "Cámara de hielo"] as const;

interface CircuitoStep {
  servicio: string;
  duracion: number;
  temperatura: number;
  notas: string;
}

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

  // Stress scale state
  const [estresLlegar, setEstresLlegar] = useState(0);
  const [estresSalir, setEstresSalir] = useState(0);
  const [calidadSueno, setCalidadSueno] = useState(0);

  // Guest preferences state
  const [prefTemperatura, setPrefTemperatura] = useState("");
  const [prefAromas, setPrefAromas] = useState<string[]>([]);
  const [prefPresion, setPrefPresion] = useState("");
  const [prefMusica, setPrefMusica] = useState("");
  const [prefIluminacion, setPrefIluminacion] = useState("");

  // Thermal circuit state
  const [circuito, setCircuito] = useState<CircuitoStep[]>([]);

  function togglePrefAroma(val: string) {
    setPrefAromas(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  }

  function addCircuitoStep() {
    setCircuito(prev => [...prev, { servicio: "", duracion: 0, temperatura: 0, notas: "" }]);
  }
  function removeCircuitoStep(idx: number) {
    setCircuito(prev => prev.filter((_, i) => i !== idx));
  }
  function updateCircuitoStep(idx: number, field: keyof CircuitoStep, value: string | number) {
    setCircuito(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }
  function moveCircuitoStep(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= circuito.length) return;
    setCircuito(prev => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }

  const circuitoTotalMin = circuito.reduce((sum, s) => sum + (s.duracion || 0), 0);
  const stressReduction = estresLlegar && estresSalir ? estresLlegar - estresSalir : 0;

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
            escalaEstres: { llegada: estresLlegar, salida: estresSalir, calidadSueno },
            preferenciasHuesped: { temperatura: prefTemperatura, aromas: prefAromas, presion: prefPresion, musica: prefMusica, iluminacion: prefIluminacion },
            circuitoTermal: circuito,
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

      {/* PREFERENCIAS PERSONALIZADAS */}
      <div className="rounded-xl border border-border dark:border-gray-700 p-4">
        <h3 className="text-sm font-bold mb-3 dark:text-white">🎯 Preferencias personalizadas</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs dark:text-gray-300">Temperatura preferida</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={prefTemperatura} onChange={e => setPrefTemperatura(e.target.value)}>
              <option value="">Seleccionar…</option>
              {PREF_TEMPERATURAS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs dark:text-gray-300">Presión de masaje</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={prefPresion} onChange={e => setPrefPresion(e.target.value)}>
              <option value="">Seleccionar…</option>
              {PREF_PRESION.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs dark:text-gray-300">Música</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={prefMusica} onChange={e => setPrefMusica(e.target.value)}>
              <option value="">Seleccionar…</option>
              {PREF_MUSICA.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs dark:text-gray-300">Iluminación</Label>
            <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={prefIluminacion} onChange={e => setPrefIluminacion(e.target.value)}>
              <option value="">Seleccionar…</option>
              {PREF_ILUMINACION.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs dark:text-gray-300">Aromas preferidos</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
            {PREF_AROMAS.map(a => (
              <label key={a} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={prefAromas.includes(a)} onChange={() => togglePrefAroma(a)} className="w-4 h-4 accent-brand-600" />
                <span className="text-sm dark:text-gray-300">{a}</span>
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground dark:text-gray-500 mt-3 italic">Estas preferencias se guardan para personalizar futuras visitas.</p>
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

      {/* ESCALA DE ESTRÉS / BIENESTAR */}
      <div className="rounded-xl border border-border dark:border-gray-700 p-4">
        <h3 className="text-sm font-bold mb-4 dark:text-white">🧘 Nivel de estrés / bienestar</h3>

        <div className="space-y-4">
          <div>
            <Label className="text-xs dark:text-gray-300 mb-2 block">Nivel de estrés al llegar (1-10)</Label>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button key={n} type="button" onClick={() => setEstresLlegar(n)}
                  className={`h-9 w-9 rounded-lg text-sm font-medium transition-all ${estresLlegar === n ? "ring-2 ring-offset-1 ring-brand-600 text-white" : "border border-border dark:border-gray-600 dark:text-gray-300 hover:opacity-80"}`}
                  style={{ backgroundColor: estresLlegar === n ? `hsl(${(10 - n) * 12}, 80%, 45%)` : undefined }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs dark:text-gray-300 mb-2 block">Nivel de estrés al salir (1-10)</Label>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button key={n} type="button" onClick={() => setEstresSalir(n)}
                  className={`h-9 w-9 rounded-lg text-sm font-medium transition-all ${estresSalir === n ? "ring-2 ring-offset-1 ring-brand-600 text-white" : "border border-border dark:border-gray-600 dark:text-gray-300 hover:opacity-80"}`}
                  style={{ backgroundColor: estresSalir === n ? `hsl(${(10 - n) * 12}, 80%, 45%)` : undefined }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {stressReduction > 0 && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">Reduccion de {stressReduction} punto{stressReduction !== 1 ? "s" : ""}</p>
          )}
          {stressReduction < 0 && (
            <p className="text-sm font-medium text-red-500 dark:text-red-400">Aumento de {Math.abs(stressReduction)} punto{Math.abs(stressReduction) !== 1 ? "s" : ""}</p>
          )}

          <div>
            <Label className="text-xs dark:text-gray-300 mb-2 block">Calidad de sueño últimas noches</Label>
            <div className="flex gap-1">
              {CALIDAD_SUENO.map((label, i) => (
                <button key={label} type="button" onClick={() => setCalidadSueno(i + 1)}
                  className={`h-9 px-3 rounded-lg text-xs font-medium transition-all ${calidadSueno === i + 1 ? "bg-brand-600 text-white ring-2 ring-offset-1 ring-brand-600" : "border border-border dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
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

      {/* CIRCUITO TERMAL PERSONALIZADO */}
      <div className="rounded-xl border border-border dark:border-gray-700 p-4">
        <h3 className="text-sm font-bold mb-3 dark:text-white">♨️ Circuito termal recomendado</h3>

        {form.cuestionarioSalud.length > 0 && !form.cuestionarioSalud.includes("ninguno") && (
          <div className="mb-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
            ⚠️ Contraindicaciones detectadas: {form.cuestionarioSalud.join(", ")}. Ajustar circuito en consecuencia.
          </div>
        )}

        {circuito.map((step, idx) => (
          <div key={idx} className="grid grid-cols-[auto_1fr_auto_auto_1fr_auto] gap-2 mb-2 items-end">
            <div className="flex flex-col items-center gap-1">
              {idx === 0 && <Label className="text-xs dark:text-gray-300">Paso</Label>}
              <span className="h-9 w-9 flex items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-sm font-bold">{idx + 1}</span>
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs dark:text-gray-300">Servicio</Label>}
              <select className="flex h-9 w-full rounded-md border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={step.servicio} onChange={e => updateCircuitoStep(idx, "servicio", e.target.value)}>
                <option value="">Seleccionar…</option>
                {CIRCUITO_SERVICIOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs dark:text-gray-300">Min</Label>}
              <input type="number" min={0} className="flex h-9 w-16 rounded-md border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={step.duracion || ""} onChange={e => updateCircuitoStep(idx, "duracion", parseInt(e.target.value) || 0)} placeholder="min" />
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs dark:text-gray-300">°C</Label>}
              <input type="number" className="flex h-9 w-16 rounded-md border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={step.temperatura || ""} onChange={e => updateCircuitoStep(idx, "temperatura", parseInt(e.target.value) || 0)} placeholder="°C" />
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs dark:text-gray-300">Notas</Label>}
              <input className="flex h-9 w-full rounded-md border border-border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={step.notas} onChange={e => updateCircuitoStep(idx, "notas", e.target.value)} placeholder="Notas…" />
            </div>
            <div className="flex gap-1">
              {idx === 0 && <Label className="text-xs invisible">Act</Label>}
              <button type="button" onClick={() => moveCircuitoStep(idx, -1)} disabled={idx === 0} className="h-9 w-7 flex items-center justify-center rounded border border-border dark:border-gray-600 dark:text-gray-300 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => moveCircuitoStep(idx, 1)} disabled={idx === circuito.length - 1} className="h-9 w-7 flex items-center justify-center rounded border border-border dark:border-gray-600 dark:text-gray-300 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30">↓</button>
              <button type="button" onClick={() => removeCircuitoStep(idx)} className="h-9 w-7 flex items-center justify-center rounded border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-lg">×</button>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between mt-3">
          <Button type="button" variant="outline" size="sm" onClick={addCircuitoStep} className="dark:border-gray-600 dark:text-gray-300">
            + Agregar paso
          </Button>
          {circuito.length > 0 && (
            <span className="text-sm font-medium dark:text-gray-300">Tiempo total: <span className="text-brand-600 dark:text-brand-400">{circuitoTotalMin} min</span></span>
          )}
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
