"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"];
const COLORES_VELLO = [
  "Negro",
  "Castaño oscuro",
  "Castaño claro",
  "Rubio",
  "Pelirrojo",
  "Canoso",
];
const GROSORES = ["Fino", "Medio", "Grueso"];
const MAQUINAS = ["Alexandrite", "Diode", "Nd:YAG", "IPL"];
const ZONAS = [
  "Labio superior",
  "Axilas",
  "Brazos",
  "Pecho",
  "Espalda",
  "Abdomen",
  "Bikini clasico",
  "Bikini brasileño",
  "Bikini full",
  "Piernas superiores",
  "Piernas inferiores",
  "Gluteos",
  "Rostro completo",
];
const ENFRIAMIENTO = ["Cryo", "Contacto", "Aire"];
const REACCIONES = [
  "Eritema leve",
  "Eritema moderado",
  "Edema",
  "Ampollas",
  "Hiperpigmentacion",
  "Ninguna",
];
const INTERVALOS = ["4 semanas", "6 semanas", "8 semanas"];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function LaserForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fitzpatrick: "",
    colorVello: "",
    grosor: "",
    maquina: "",
    zona: "",
    fluencia: "",
    anchoPulso: "",
    spotSize: "",
    enfriamiento: "",
    sesionActual: "",
    sesionesTotal: "",
    reacciones: [] as string[],
    intervalo: "6 semanas",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    notas: "",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleReaccion = (val: string) => {
    setForm((f) => {
      if (val === "Ninguna") return { ...f, reacciones: f.reacciones.includes(val) ? [] : ["Ninguna"] };
      const without = f.reacciones.filter((r) => r !== "Ninguna");
      return {
        ...f,
        reacciones: without.includes(val)
          ? without.filter((r) => r !== val)
          : [...without, val],
      };
    });
  };

  async function handleSave() {
    if (!form.zona || !form.maquina) {
      toast.error("Selecciona zona tratada y maquina");
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
            type: "laser_hair_removal",
            fitzpatrick: form.fitzpatrick,
            colorVello: form.colorVello,
            grosor: form.grosor,
            maquina: form.maquina,
            zona: form.zona,
            parametros: {
              fluencia: form.fluencia ? parseFloat(form.fluencia) : undefined,
              anchoPulso: form.anchoPulso ? parseFloat(form.anchoPulso) : undefined,
              spotSize: form.spotSize ? parseFloat(form.spotSize) : undefined,
              enfriamiento: form.enfriamiento,
            },
            sesionActual: form.sesionActual ? parseInt(form.sesionActual) : undefined,
            sesionesTotal: form.sesionesTotal ? parseInt(form.sesionesTotal) : undefined,
            reacciones: form.reacciones,
            intervalo: form.intervalo,
            notas: form.notas,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Registro de depilacion laser guardado");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20";
  const selectCls = inputCls;
  const textareaCls =
    "flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none";

  return (
    <div className="space-y-6">
      {/* Evaluacion del paciente */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluacion del paciente</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Fototipo Fitzpatrick</Label>
            <select
              className={selectCls}
              value={form.fitzpatrick}
              onChange={(e) => set("fitzpatrick", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {FITZPATRICK.map((f) => (
                <option key={f} value={f}>
                  Tipo {f}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Color de vello</Label>
            <select
              className={selectCls}
              value={form.colorVello}
              onChange={(e) => set("colorVello", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {COLORES_VELLO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Grosor</Label>
            <select
              className={selectCls}
              value={form.grosor}
              onChange={(e) => set("grosor", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {GROSORES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Maquina</Label>
            <select
              className={selectCls}
              value={form.maquina}
              onChange={(e) => set("maquina", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {MAQUINAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Zona tratada */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Zona tratada</h3>
        <div className="space-y-1">
          <Label className="text-xs">Zona</Label>
          <select
            className={selectCls}
            value={form.zona}
            onChange={(e) => set("zona", e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Parametros */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Parametros del equipo</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Fluencia (J/cm²)</Label>
            <input
              type="number"
              step="0.1"
              className={inputCls}
              placeholder="Ej: 18.5"
              value={form.fluencia}
              onChange={(e) => set("fluencia", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ancho de pulso (ms)</Label>
            <input
              type="number"
              step="0.1"
              className={inputCls}
              placeholder="Ej: 30"
              value={form.anchoPulso}
              onChange={(e) => set("anchoPulso", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Spot size (mm)</Label>
            <input
              type="number"
              step="0.1"
              className={inputCls}
              placeholder="Ej: 12"
              value={form.spotSize}
              onChange={(e) => set("spotSize", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Metodo de enfriamiento</Label>
            <select
              className={selectCls}
              value={form.enfriamiento}
              onChange={(e) => set("enfriamiento", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {ENFRIAMIENTO.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Sesiones */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Progreso de sesiones</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Numero de sesion</Label>
            <input
              type="number"
              min="1"
              className={inputCls}
              placeholder="Ej: 3"
              value={form.sesionActual}
              onChange={(e) => set("sesionActual", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Total de sesiones planeadas</Label>
            <input
              type="number"
              min="1"
              className={inputCls}
              placeholder="Ej: 8"
              value={form.sesionesTotal}
              onChange={(e) => set("sesionesTotal", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Intervalo proxima sesion</Label>
            <select
              className={selectCls}
              value={form.intervalo}
              onChange={(e) => set("intervalo", e.target.value)}
            >
              {INTERVALOS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
        </div>
        {form.sesionActual && form.sesionesTotal && (
          <p className="text-xs text-muted-foreground mt-2">
            Sesion {form.sesionActual} de {form.sesionesTotal}
          </p>
        )}
      </div>

      {/* Reacciones observadas */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Reacciones observadas</h3>
        <div className="flex flex-wrap gap-2">
          {REACCIONES.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.reacciones.includes(r)
                  ? r === "Ninguna"
                    ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                    : "bg-amber-50 border-amber-400 text-amber-700"
                  : "border-border hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className={r === "Ninguna" ? "accent-emerald-600" : "accent-amber-600"}
                checked={form.reacciones.includes(r)}
                onChange={() => toggleReaccion(r)}
              />
              {r}
            </label>
          ))}
        </div>
      </div>

      {/* SOAP */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { key: "subjective", label: "Subjetivo", ph: "Sensibilidad, historial…" },
          { key: "objective", label: "Objetivo", ph: "Observaciones de la piel…" },
          { key: "assessment", label: "Evaluacion", ph: "Respuesta al tratamiento…" },
          { key: "plan", label: "Plan", ph: "Ajustes, proxima sesion…" },
        ] as const).map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label>{f.label}</Label>
            <textarea
              className={textareaCls}
              placeholder={f.ph}
              value={(form as any)[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {/* Notas */}
      <div className="space-y-1.5">
        <Label>Notas adicionales</Label>
        <textarea
          className={textareaCls}
          placeholder="Observaciones del procedimiento…"
          value={form.notas}
          onChange={(e) => set("notas", e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de depilacion laser"}
        </Button>
      </div>
    </div>
  );
}
