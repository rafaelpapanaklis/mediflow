"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const SERVICIOS = [
  "manicure",
  "pedicure",
  "gel",
  "acrílico",
  "dip powder",
  "nail art",
  "reparación",
  "parafina",
  "manicure + pedicure",
];

const MANO_PIE = ["manos", "pies", "ambos"];

const FORMAS = [
  "almendra",
  "cuadrada",
  "ovalada",
  "stiletto",
  "coffin",
  "squoval",
  "redonda",
];

const DEDOS = ["Pulgar", "Índice", "Medio", "Anular", "Meñique"] as const;
const CONDICIONES_UNA = ["Sana", "Hongos", "Estriada", "Manchada", "Frágil/Quebradiza", "Onicólisis", "Encarnada", "Engrosada"] as const;
const TIPOS_SERVICIO_PREF = ["Manicure clásico", "Gel", "Acrílico", "Dip powder", "Nail art", "Natural"] as const;
const LARGOS = ["Muy corto (natural)", "Corto", "Medio", "Largo", "Extra largo"] as const;
const TIPOS_REACCION = ["Enrojecimiento", "Descamación", "Ampollas", "Dolor", "Hinchazón", "Reacción alérgica"] as const;
const SEVERIDADES = ["Leve", "Moderada", "Severa"] as const;

interface AlergiaEntry {
  producto: string;
  tipoReaccion: string;
  severidad: string;
  fecha: string;
}

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function NailSalonForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    servicio: "",
    manoPie: "",
    formaPreferida: "",
    materialProducto: "",
    colorDiseno: "",
    condicionUnas: "",
    tecnicoAsignado: "",
    notas: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Nail health evaluation state
  const createFingerMap = () => Object.fromEntries(DEDOS.map(d => [d, ""]));
  const [manoIzq, setManoIzq] = useState<Record<string, string>>(createFingerMap());
  const [manoDer, setManoDer] = useState<Record<string, string>>(createFingerMap());
  const [pieIzq, setPieIzq] = useState<Record<string, string>>(createFingerMap());
  const [pieDer, setPieDer] = useState<Record<string, string>>(createFingerMap());
  const [resumenSaludUngueal, setResumenSaludUngueal] = useState("");

  // Preferences state
  const [colorRecurrente, setColorRecurrente] = useState("");
  const [tipoServicioPref, setTipoServicioPref] = useState("");
  const [marcaFavorita, setMarcaFavorita] = useState("");
  const [largoPreferido, setLargoPreferido] = useState("");
  const [notasEstilo, setNotasEstilo] = useState("");

  // Allergies state
  const [alergias, setAlergias] = useState<AlergiaEntry[]>([]);
  const [alergiaMetacrilato, setAlergiaMetacrilato] = useState(false);

  function addAlergia() {
    setAlergias(prev => [...prev, { producto: "", tipoReaccion: "", severidad: "", fecha: "" }]);
  }
  function removeAlergia(idx: number) {
    setAlergias(prev => prev.filter((_, i) => i !== idx));
  }
  function updateAlergia(idx: number, field: keyof AlergiaEntry, value: string) {
    setAlergias(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  async function handleSave() {
    if (!form.servicio) {
      toast.error("Selecciona el servicio realizado");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          objective: form.objective,
          assessment: form.assessment,
          plan: form.plan,
          specialtyData: {
            type: "nail_salon",
            servicio: form.servicio,
            manoPie: form.manoPie,
            formaPreferida: form.formaPreferida,
            materialProducto: form.materialProducto,
            colorDiseno: form.colorDiseno,
            condicionUnas: form.condicionUnas,
            tecnicoAsignado: form.tecnicoAsignado,
            notas: form.notas,
            saludUngueal: { manoIzq, manoDer, pieIzq, pieDer, resumen: resumenSaludUngueal },
            preferencias: { colorRecurrente, tipoServicioPref, marcaFavorita, largoPreferido, notasEstilo, formaFavorita: form.formaPreferida },
            alergias: { lista: alergias, alergiaMetacrilato },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();
      onSaved(record);
      toast.success("Registro de uñas guardado");
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* SOAP */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de visita</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Qué servicio busca el cliente?"
            value={form.subjective}
            onChange={(e) => set("subjective", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones previas</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado previo de las uñas, historial…"
            value={form.objective}
            onChange={(e) => set("objective", e.target.value)}
          />
        </div>
      </div>

      {/* SERVICIO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Servicio</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Servicio</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.servicio}
              onChange={(e) => set("servicio", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {SERVICIOS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Mano/pie</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.manoPie}
              onChange={(e) => set("manoPie", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {MANO_PIE.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Forma preferida</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.formaPreferida}
              onChange={(e) => set("formaPreferida", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {FORMAS.map((f) => (
                <option key={f} value={f}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* DETALLES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Detalles del servicio</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Material/producto usado</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Gel UV, Acrílico Mia Secret…"
              value={form.materialProducto}
              onChange={(e) => set("materialProducto", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color/diseño aplicado</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Rojo cereza #45, french tips…"
              value={form.colorDiseno}
              onChange={(e) => set("colorDiseno", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Condición de uñas</Label>
          <textarea
            className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Observaciones: hongos, fragilidad, manchas, estrías, daño previo…"
            value={form.condicionUnas}
            onChange={(e) => set("condicionUnas", e.target.value)}
          />
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Técnico asignado</Label>
          <input
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Nombre del técnico"
            value={form.tecnicoAsignado}
            onChange={(e) => set("tecnicoAsignado", e.target.value)}
          />
        </div>
      </div>

      {/* EVALUACIÓN DE SALUD UNGUEAL */}
      <div className="rounded-xl border border-border dark:border-border p-4">
        <h3 className="text-sm font-bold mb-4">🔍 Evaluación de salud ungueal</h3>

        {/* Manos */}
        <p className="text-xs font-semibold mb-2">Manos</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {([["Mano izquierda", manoIzq, setManoIzq], ["Mano derecha", manoDer, setManoDer]] as const).map(([label, state, setter]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <div className="space-y-1">
                {DEDOS.map(dedo => (
                  <div key={dedo} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{dedo}</span>
                    <select
                      className="flex h-7 w-full rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      value={(state as Record<string, string>)[dedo]}
                      onChange={e => (setter as React.Dispatch<React.SetStateAction<Record<string, string>>>)(prev => ({ ...prev, [dedo]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {CONDICIONES_UNA.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pies */}
        <p className="text-xs font-semibold mb-2">Pies</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {([["Pie izquierdo", pieIzq, setPieIzq], ["Pie derecho", pieDer, setPieDer]] as const).map(([label, state, setter]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <div className="space-y-1">
                {DEDOS.map(dedo => (
                  <div key={dedo} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{dedo}</span>
                    <select
                      className="flex h-7 w-full rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      value={(state as Record<string, string>)[dedo]}
                      onChange={e => (setter as React.Dispatch<React.SetStateAction<Record<string, string>>>)(prev => ({ ...prev, [dedo]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {CONDICIONES_UNA.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label className="">Resumen general de salud ungueal</Label>
          <textarea
            className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Resumen general del estado de las uñas…"
            value={resumenSaludUngueal}
            onChange={e => setResumenSaludUngueal(e.target.value)}
          />
        </div>
      </div>

      {/* PREFERENCIAS DE LA CLIENTA */}
      <div className="rounded-xl border border-border dark:border-border p-4">
        <h3 className="text-sm font-bold mb-3">💅 Preferencias de la clienta</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="">Forma favorita</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-muted px-3 text-sm focus:outline-none"
              value={form.formaPreferida ? form.formaPreferida.charAt(0).toUpperCase() + form.formaPreferida.slice(1) : "Sin seleccionar"}
              readOnly
            />
          </div>
          <div className="space-y-1.5">
            <Label className="">Color recurrente</Label>
            <div className="flex gap-2">
              <input
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Ej. Rojo cereza, Rosa pastel…"
                value={colorRecurrente}
                onChange={e => setColorRecurrente(e.target.value)}
              />
              {colorRecurrente && (
                <div className="h-10 w-10 rounded-lg border border-border shrink-0" style={{ backgroundColor: colorRecurrente.toLowerCase().includes("roj") ? "#DC2626" : colorRecurrente.toLowerCase().includes("rosa") ? "#F9A8D4" : colorRecurrente.toLowerCase().includes("azul") ? "#3B82F6" : colorRecurrente.toLowerCase().includes("negro") ? "#000" : colorRecurrente.toLowerCase().includes("blanc") ? "#FFF" : colorRecurrente.toLowerCase().includes("morad") ? "#8B5CF6" : "#D1D5DB" }} />
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="">Tipo de servicio preferido</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={tipoServicioPref}
              onChange={e => setTipoServicioPref(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {TIPOS_SERVICIO_PREF.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="">Marca de esmalte favorita</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. OPI, Essie, Gelish…"
              value={marcaFavorita}
              onChange={e => setMarcaFavorita(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="">Largo preferido</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={largoPreferido}
              onChange={e => setLargoPreferido(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {LARGOS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label className="">Notas de estilo</Label>
          <textarea
            className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Preferencias de diseño, inspiraciones, estilos favoritos…"
            value={notasEstilo}
            onChange={e => setNotasEstilo(e.target.value)}
          />
        </div>
      </div>

      {/* ALERGIAS Y REACCIONES */}
      <div className="rounded-xl border border-amber-400 dark:border-amber-600 p-4">
        <h3 className="text-sm font-bold mb-3">⚠️ Alergias y reacciones</h3>

        <label className={`flex items-center gap-2 mb-4 p-2 rounded-lg cursor-pointer ${alergiaMetacrilato ? "bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700" : "bg-muted border border-border"}`}>
          <input type="checkbox" checked={alergiaMetacrilato} onChange={e => setAlergiaMetacrilato(e.target.checked)} className="w-4 h-4 accent-red-600" />
          <span className={`text-sm font-medium ${alergiaMetacrilato ? "text-red-700 dark:text-red-400" : ""}`}>Alergia confirmada al metacrilato</span>
        </label>

        {alergias.map((a, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 mb-2 items-end">
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs">Producto/Material</Label>}
              <input
                className="flex h-9 w-full rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Producto…"
                value={a.producto}
                onChange={e => updateAlergia(idx, "producto", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs">Tipo de reacción</Label>}
              <select
                className="flex h-9 w-full rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={a.tipoReaccion}
                onChange={e => updateAlergia(idx, "tipoReaccion", e.target.value)}
              >
                <option value="">Tipo…</option>
                {TIPOS_REACCION.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs">Severidad</Label>}
              <select
                className="flex h-9 w-full rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={a.severidad}
                onChange={e => updateAlergia(idx, "severidad", e.target.value)}
              >
                <option value="">—</option>
                {SEVERIDADES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              {idx === 0 && <Label className="text-xs">Fecha</Label>}
              <input
                type="date"
                className="flex h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={a.fecha}
                onChange={e => updateAlergia(idx, "fecha", e.target.value)}
              />
            </div>
            <button type="button" onClick={() => removeAlergia(idx)} className="h-9 w-9 flex items-center justify-center rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-lg">×</button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addAlergia} className="mt-2">
          + Agregar alergia/reacción
        </Button>
      </div>

      {/* RESULTADO Y NOTAS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Resultado / Evaluación</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Resultado del servicio, observaciones finales…"
            value={form.assessment}
            onChange={(e) => set("assessment", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Notas</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Preferencias del cliente, alergias, próxima cita…"
            value={form.notas}
            onChange={(e) => set("notas", e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de uñas"}
        </Button>
      </div>
    </div>
  );
}
