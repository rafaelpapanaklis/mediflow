"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const TIPOS_MASAJE = [
  "Sueco",
  "Tejido profundo",
  "Deportivo",
  "Drenaje linfatico",
  "Piedras calientes",
  "Thai",
  "Prenatal",
  "Miofascial",
  "Relajante",
];

const ZONAS = [
  "Cabeza/cuello",
  "Hombros",
  "Espalda alta",
  "Espalda baja",
  "Brazos",
  "Manos",
  "Gluteos",
  "Piernas",
  "Pies",
];

const CONTRAINDICACIONES = [
  "Fiebre",
  "Infeccion",
  "Trombosis",
  "Fracturas recientes",
  "Embarazo primer trimestre",
  "Heridas abiertas",
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function MassageForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    tipo: "",
    presion: 3,
    zonasEnfoque: [] as string[],
    zonasDolor: [] as string[],
    tecnicas: "",
    contraindicaciones: [] as string[],
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    recomendaciones: "",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleArr = (key: "zonasEnfoque" | "zonasDolor" | "contraindicaciones", val: string) => {
    setForm((f) => {
      const arr = f[key] as string[];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  };

  async function handleSave() {
    if (!form.tipo) {
      toast.error("Selecciona el tipo de masaje");
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
            type: "massage",
            tipo: form.tipo,
            presion: form.presion,
            zonasEnfoque: form.zonasEnfoque,
            zonasDolor: form.zonasDolor,
            tecnicas: form.tecnicas,
            contraindicaciones: form.contraindicaciones,
            recomendaciones: form.recomendaciones,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Registro de masaje guardado");
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

  const PRESION_LABELS = ["1 - Suave", "2 - Ligera", "3 - Media", "4 - Profunda", "5 - Firme"];

  return (
    <div className="space-y-6">
      {/* Tipo y Presion */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tipo de masaje</h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <select
              className={selectCls}
              value={form.tipo}
              onChange={(e) => set("tipo", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {TIPOS_MASAJE.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Presion preferida</Label>
            <div className="flex gap-4">
              {PRESION_LABELS.map((label, i) => (
                <label key={i} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="presion"
                    className="accent-brand-600"
                    checked={form.presion === i + 1}
                    onChange={() => set("presion", i + 1)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Zonas de enfoque */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Zonas de enfoque</h3>
        <div className="flex flex-wrap gap-2">
          {ZONAS.map((z) => (
            <label
              key={z}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.zonasEnfoque.includes(z)
                  ? "bg-brand-600/10 border-brand-600 text-brand-600"
                  : "border-border hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={form.zonasEnfoque.includes(z)}
                onChange={() => toggleArr("zonasEnfoque", z)}
              />
              {z}
            </label>
          ))}
        </div>
      </div>

      {/* Zonas de dolor */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3 text-red-600">Zonas de dolor reportadas</h3>
        <div className="flex flex-wrap gap-2">
          {ZONAS.map((z) => (
            <label
              key={z}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.zonasDolor.includes(z)
                  ? "bg-red-50 border-red-400 text-red-600"
                  : "border-border hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className="accent-red-600"
                checked={form.zonasDolor.includes(z)}
                onChange={() => toggleArr("zonasDolor", z)}
              />
              {z}
            </label>
          ))}
        </div>
      </div>

      {/* Tecnicas aplicadas */}
      <div className="space-y-1.5">
        <Label>Tecnicas aplicadas por zona</Label>
        <textarea
          className={textareaCls}
          placeholder="Ej: Espalda alta — fricciones + amasamiento profundo…"
          value={form.tecnicas}
          onChange={(e) => set("tecnicas", e.target.value)}
        />
      </div>

      {/* Contraindicaciones */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Contraindicaciones revisadas</h3>
        <div className="flex flex-wrap gap-2">
          {CONTRAINDICACIONES.map((c) => (
            <label
              key={c}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.contraindicaciones.includes(c)
                  ? "bg-amber-50 border-amber-400 text-amber-700"
                  : "border-border hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className="accent-amber-600"
                checked={form.contraindicaciones.includes(c)}
                onChange={() => toggleArr("contraindicaciones", c)}
              />
              {c}
            </label>
          ))}
        </div>
      </div>

      {/* Notas SOAP */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Notas SOAP</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", label: "Subjetivo", ph: "Motivo de consulta, molestias…" },
            { key: "objective", label: "Objetivo", ph: "Hallazgos palpatorios, tension…" },
            { key: "assessment", label: "Evaluacion", ph: "Valoracion del terapeuta…" },
            { key: "plan", label: "Plan", ph: "Proxima sesion, ejercicios…" },
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
      </div>

      {/* Recomendaciones post-masaje */}
      <div className="space-y-1.5">
        <Label>Recomendaciones post-masaje</Label>
        <textarea
          className={textareaCls}
          placeholder="Hidratacion, reposo, estiramientos…"
          value={form.recomendaciones}
          onChange={(e) => set("recomendaciones", e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de masaje"}
        </Button>
      </div>
    </div>
  );
}
