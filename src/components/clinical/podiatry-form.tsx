"use client";
import { useState, useMemo } from "react";
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

const MONOFILAMENTO_SITES = ["Hallux", "1er MTT", "3er MTT", "5to MTT"] as const;
const SENSIBILIDAD_OPCIONES = ["Normal", "Disminuida", "Ausente"] as const;
const TEMPERATURA_OPCIONES = ["Normal", "Fría", "Muy fría"] as const;
const PULSO_OPCIONES = ["Presente", "Débil", "Ausente"] as const;
const LLENADO_OPCIONES = ["< 3 seg (normal)", "3-5 seg (lento)", "> 5 seg (muy lento)"] as const;
const COLORACION_OPCIONES = ["Normal", "Pálida", "Cianótica", "Eritematosa"] as const;
const PLANTAR_ZONAS = ["Hallux", "Dedos menores", "Cabezas metatarsales", "Arco medial", "Arco lateral", "Talón medial", "Talón lateral"] as const;
const PLANTAR_ESTADOS = ["Normal", "Hiperpresión leve", "Hiperpresión moderada", "Hiperpresión severa", "Úlcera", "Callosidad"] as const;

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

  // --- Diabetic foot screening state ---
  const [monofilamentoIzq, setMonofilamentoIzq] = useState<Record<string, boolean>>({});
  const [monofilamentoDer, setMonofilamentoDer] = useState<Record<string, boolean>>({});
  const [sensibilidadIzq, setSensibilidadIzq] = useState("");
  const [sensibilidadDer, setSensibilidadDer] = useState("");
  const [temperaturaIzq, setTemperaturaIzq] = useState("");
  const [temperaturaDer, setTemperaturaDer] = useState("");
  const [iwgdfHistorial, setIwgdfHistorial] = useState({ ulceraPrevia: false, amputacionPrevia: false, deformidad: false, eap: false });

  const iwgdfRiesgo = useMemo(() => {
    if (iwgdfHistorial.ulceraPrevia || iwgdfHistorial.amputacionPrevia) return { nivel: 3, texto: "Riesgo 3 (úlcera/amputación previa)", color: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30" };
    const totalSitesIzq = MONOFILAMENTO_SITES.filter(s => monofilamentoIzq[s]).length;
    const totalSitesDer = MONOFILAMENTO_SITES.filter(s => monofilamentoDer[s]).length;
    const hasNeuropathy = totalSitesIzq < MONOFILAMENTO_SITES.length || totalSitesDer < MONOFILAMENTO_SITES.length
      || sensibilidadIzq === "Disminuida" || sensibilidadIzq === "Ausente"
      || sensibilidadDer === "Disminuida" || sensibilidadDer === "Ausente";
    if (!hasNeuropathy) return { nivel: 0, texto: "Riesgo 0 (sin neuropatía)", color: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30" };
    if (iwgdfHistorial.deformidad || iwgdfHistorial.eap) return { nivel: 2, texto: "Riesgo 2 (neuropatía + deformidad/EAP)", color: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30" };
    return { nivel: 1, texto: "Riesgo 1 (neuropatía)", color: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30" };
  }, [monofilamentoIzq, monofilamentoDer, sensibilidadIzq, sensibilidadDer, iwgdfHistorial]);

  // --- Vascular evaluation state ---
  const [pulsoTibialIzq, setPulsoTibialIzq] = useState("");
  const [pulsoTibialDer, setPulsoTibialDer] = useState("");
  const [pulsoPedioIzq, setPulsoPedioIzq] = useState("");
  const [pulsoPedioDer, setPulsoPedioDer] = useState("");
  const [llenadoIzq, setLlenadoIzq] = useState("");
  const [llenadoDer, setLlenadoDer] = useState("");
  const [coloracionIzq, setColoracionIzq] = useState("");
  const [coloracionDer, setColoracionDer] = useState("");
  const [itbIzq, setItbIzq] = useState("");
  const [itbDer, setItbDer] = useState("");

  function getItbInterpretation(val: string) {
    const n = parseFloat(val);
    if (isNaN(n)) return null;
    if (n > 0.9) return { text: "Normal", color: "text-green-600 dark:text-green-400" };
    if (n >= 0.7) return { text: "EAP leve", color: "text-yellow-600 dark:text-yellow-400" };
    if (n >= 0.4) return { text: "EAP moderada", color: "text-orange-600 dark:text-orange-400" };
    return { text: "EAP severa/isquemia crítica", color: "text-red-600 dark:text-red-400" };
  }

  // --- Plantar map state ---
  const [plantarIzq, setPlantarIzq] = useState<Record<string, string>>({});
  const [plantarDer, setPlantarDer] = useState<Record<string, string>>({});
  const [notasPlantares, setNotasPlantares] = useState("");

  function getPlantarColor(estado: string) {
    switch (estado) {
      case "Normal": return "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300";
      case "Hiperpresión leve": return "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300";
      case "Hiperpresión moderada": return "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300";
      case "Hiperpresión severa": return "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300";
      case "Úlcera": return "bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-200";
      case "Callosidad": return "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300";
      default: return "";
    }
  }

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
            screeningDiabetico: {
              monofilamentoIzq,
              monofilamentoDer,
              sensibilidadIzq,
              sensibilidadDer,
              temperaturaIzq,
              temperaturaDer,
              iwgdfHistorial,
              iwgdfRiesgo: iwgdfRiesgo.texto,
            },
            evaluacionVascular: {
              pulsoTibialIzq, pulsoTibialDer,
              pulsoPedioIzq, pulsoPedioDer,
              llenadoIzq, llenadoDer,
              coloracionIzq, coloracionDer,
              itbIzq, itbDer,
              itbInterpretacionIzq: getItbInterpretation(itbIzq)?.text ?? "",
              itbInterpretacionDer: getItbInterpretation(itbDer)?.text ?? "",
            },
            mapaPlantar: {
              izquierdo: plantarIzq,
              derecho: plantarDer,
              notasPlantares,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Expediente de podología guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  const inputCls = "flex h-9 w-full rounded-lg border border-border bg-white dark:bg-zinc-900 dark:text-zinc-100 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20";
  const selectCls = inputCls;
  const textareaCls = "flex min-h-[80px] w-full rounded-lg border border-border bg-white dark:bg-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none";

  const itbInterpIzq = getItbInterpretation(itbIzq);
  const itbInterpDer = getItbInterpretation(itbDer);

  return (
    <div className="space-y-6">
      {/* ANAMNESIS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de consulta / HEA</Label>
          <textarea className={textareaCls}
            placeholder="¿Por qué viene el paciente hoy?" value={form.subjective} onChange={e => set("subjective", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física / Observaciones</Label>
          <textarea className={textareaCls}
            placeholder="Estado actual del pie, hallazgos…" value={form.objective} onChange={e => set("objective", e.target.value)} />
        </div>
      </div>

      {/* RIESGO & TRATAMIENTO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación podológica</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Riesgo pie diabético</Label>
            <select className={selectCls}
              value={form.riesgoPie} onChange={e => set("riesgoPie", e.target.value)}>
              <option value="">Seleccionar…</option>
              {RIESGO_PIE.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Score ABI (opcional)</Label>
            <input type="number" step="0.01" className={inputCls}
              placeholder="Ej. 0.95" value={form.scoreABI} onChange={e => set("scoreABI", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tratamiento</Label>
            <select className={selectCls}
              value={form.tratamiento} onChange={e => set("tratamiento", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TRATAMIENTOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pie afectado</Label>
            <select className={selectCls}
              value={form.pieAfectado} onChange={e => set("pieAfectado", e.target.value)}>
              <option value="">Seleccionar…</option>
              {PIE_AFECTADO.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* SCREENING DE PIE DIABÉTICO */}
      {form.riesgoPie && form.riesgoPie !== "no aplica" && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold mb-3">{"\uD83E\uDDB6"} Screening de pie diabético (IWGDF)</h3>
          <div className="space-y-4">
            {/* Monofilamento 10g */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Test de monofilamento 10g</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium mb-1">Pie izquierdo</p>
                  <div className="grid grid-cols-2 gap-2">
                    {MONOFILAMENTO_SITES.map(site => (
                      <label key={site} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!monofilamentoIzq[site]}
                          onChange={e => setMonofilamentoIzq(prev => ({ ...prev, [site]: e.target.checked }))}
                          className="w-4 h-4 accent-brand-600" />
                        <span className="text-sm">{site}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium mb-1">Pie derecho</p>
                  <div className="grid grid-cols-2 gap-2">
                    {MONOFILAMENTO_SITES.map(site => (
                      <label key={site} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!monofilamentoDer[site]}
                          onChange={e => setMonofilamentoDer(prev => ({ ...prev, [site]: e.target.checked }))}
                          className="w-4 h-4 accent-brand-600" />
                        <span className="text-sm">{site}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Marcado = siente, desmarcado = no siente</p>
            </div>

            {/* Sensibilidad vibratoria */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Sensibilidad vibratoria (izq)</Label>
                <select className={selectCls} value={sensibilidadIzq} onChange={e => setSensibilidadIzq(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {SENSIBILIDAD_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sensibilidad vibratoria (der)</Label>
                <select className={selectCls} value={sensibilidadDer} onChange={e => setSensibilidadDer(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {SENSIBILIDAD_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* Temperatura */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Temperatura del pie (izq)</Label>
                <select className={selectCls} value={temperaturaIzq} onChange={e => setTemperaturaIzq(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {TEMPERATURA_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Temperatura del pie (der)</Label>
                <select className={selectCls} value={temperaturaDer} onChange={e => setTemperaturaDer(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {TEMPERATURA_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* Historial (for IWGDF classification) */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Historial (afecta clasificación IWGDF)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={iwgdfHistorial.deformidad}
                    onChange={e => setIwgdfHistorial(prev => ({ ...prev, deformidad: e.target.checked }))}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">Deformidad</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={iwgdfHistorial.eap}
                    onChange={e => setIwgdfHistorial(prev => ({ ...prev, eap: e.target.checked }))}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">EAP</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={iwgdfHistorial.ulceraPrevia}
                    onChange={e => setIwgdfHistorial(prev => ({ ...prev, ulceraPrevia: e.target.checked }))}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">Úlcera previa</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={iwgdfHistorial.amputacionPrevia}
                    onChange={e => setIwgdfHistorial(prev => ({ ...prev, amputacionPrevia: e.target.checked }))}
                    className="w-4 h-4 accent-brand-600" />
                  <span className="text-sm">Amputación previa</span>
                </label>
              </div>
            </div>

            {/* Auto-classification */}
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${iwgdfRiesgo.color}`}>
              Clasificación IWGDF: {iwgdfRiesgo.texto}
            </div>
          </div>
        </div>
      )}

      {/* EVALUACIÓN VASCULAR */}
      {form.riesgoPie && form.riesgoPie !== "no aplica" && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold mb-3">{"\uD83E\uDEC0"} Evaluación vascular</h3>
          <div className="space-y-4">
            {/* Pulsos */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Pulso tibial posterior (izq)</Label>
                <select className={selectCls} value={pulsoTibialIzq} onChange={e => setPulsoTibialIzq(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {PULSO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pulso tibial posterior (der)</Label>
                <select className={selectCls} value={pulsoTibialDer} onChange={e => setPulsoTibialDer(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {PULSO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Pulso pedio dorsal (izq)</Label>
                <select className={selectCls} value={pulsoPedioIzq} onChange={e => setPulsoPedioIzq(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {PULSO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pulso pedio dorsal (der)</Label>
                <select className={selectCls} value={pulsoPedioDer} onChange={e => setPulsoPedioDer(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {PULSO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* Llenado capilar */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Llenado capilar (izq)</Label>
                <select className={selectCls} value={llenadoIzq} onChange={e => setLlenadoIzq(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {LLENADO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Llenado capilar (der)</Label>
                <select className={selectCls} value={llenadoDer} onChange={e => setLlenadoDer(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {LLENADO_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* Coloración */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Coloración (izq)</Label>
                <select className={selectCls} value={coloracionIzq} onChange={e => setColoracionIzq(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {COLORACION_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Coloración (der)</Label>
                <select className={selectCls} value={coloracionDer} onChange={e => setColoracionDer(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {COLORACION_OPCIONES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {/* ITB */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">ITB (Índice tobillo-brazo) izq</Label>
                <input type="number" step="0.01" min="0" max="2" className={inputCls}
                  placeholder="0.00 - 2.00" value={itbIzq} onChange={e => setItbIzq(e.target.value)} />
                {itbInterpIzq && <p className={`text-xs font-medium mt-1 ${itbInterpIzq.color}`}>{itbInterpIzq.text}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">ITB (Índice tobillo-brazo) der</Label>
                <input type="number" step="0.01" min="0" max="2" className={inputCls}
                  placeholder="0.00 - 2.00" value={itbDer} onChange={e => setItbDer(e.target.value)} />
                {itbInterpDer && <p className={`text-xs font-medium mt-1 ${itbInterpDer.color}`}>{itbInterpDer.text}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

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
              <input type="number" step="0.1" className={inputCls}
                placeholder="cm" value={form.heridaLargo} onChange={e => set("heridaLargo", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ancho (cm)</Label>
              <input type="number" step="0.1" className={inputCls}
                placeholder="cm" value={form.heridaAncho} onChange={e => set("heridaAncho", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Profundidad (cm)</Label>
              <input type="number" step="0.1" className={inputCls}
                placeholder="cm" value={form.heridaProfundidad} onChange={e => set("heridaProfundidad", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <select className={selectCls}
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
            <select className={selectCls}
              value={form.estadoOrtesis} onChange={e => set("estadoOrtesis", e.target.value)}>
              <option value="">Seleccionar…</option>
              {ESTADO_ORTESIS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Intervalo de recall</Label>
            <select className={selectCls}
              value={form.recall} onChange={e => set("recall", e.target.value)}>
              <option value="">Seleccionar…</option>
              {RECALL.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5 mt-3">
          <Label>Evaluación de calzado</Label>
          <textarea className={textareaCls}
            placeholder="Tipo de calzado, desgaste, adecuación…" value={form.evaluacionCalzado} onChange={e => set("evaluacionCalzado", e.target.value)} />
        </div>
      </div>

      {/* DIAGNÓSTICO & PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Diagnóstico / Evaluación</Label>
          <textarea className={textareaCls}
            placeholder="Diagnóstico podológico…" value={form.assessment} onChange={e => set("assessment", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Plan</Label>
          <textarea className={textareaCls}
            placeholder="Plan de tratamiento…" value={form.plan} onChange={e => set("plan", e.target.value)} />
        </div>
      </div>

      {/* MAPA PLANTAR */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">{"\uD83D\uDC63"} Mapa plantar</h3>
        <div className="grid grid-cols-2 gap-6">
          {/* Pie izquierdo */}
          <div>
            <p className="text-xs font-semibold mb-2">Pie izquierdo</p>
            <div className="space-y-2">
              {PLANTAR_ZONAS.map(zona => (
                <div key={zona} className="flex items-center gap-2">
                  <span className="text-sm min-w-[140px]">{zona}</span>
                  <select className={`${selectCls} ${plantarIzq[zona] ? getPlantarColor(plantarIzq[zona]) : ""}`}
                    value={plantarIzq[zona] ?? ""} onChange={e => setPlantarIzq(prev => ({ ...prev, [zona]: e.target.value }))}>
                    <option value="">--</option>
                    {PLANTAR_ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          {/* Pie derecho */}
          <div>
            <p className="text-xs font-semibold mb-2">Pie derecho</p>
            <div className="space-y-2">
              {PLANTAR_ZONAS.map(zona => (
                <div key={zona} className="flex items-center gap-2">
                  <span className="text-sm min-w-[140px]">{zona}</span>
                  <select className={`${selectCls} ${plantarDer[zona] ? getPlantarColor(plantarDer[zona]) : ""}`}
                    value={plantarDer[zona] ?? ""} onChange={e => setPlantarDer(prev => ({ ...prev, [zona]: e.target.value }))}>
                    <option value="">--</option>
                    {PLANTAR_ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1.5 mt-4">
          <Label className="text-xs">Notas plantares</Label>
          <textarea className={textareaCls}
            placeholder="Observaciones del mapa plantar…" value={notasPlantares} onChange={e => setNotasPlantares(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notas clínicas</Label>
        <textarea className={textareaCls}
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
