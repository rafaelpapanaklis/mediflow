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
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Qué servicio busca el cliente?"
            value={form.subjective}
            onChange={(e) => set("subjective", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones previas</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Gel UV, Acrílico Mia Secret…"
              value={form.materialProducto}
              onChange={(e) => set("materialProducto", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color/diseño aplicado</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Rojo cereza #45, french tips…"
              value={form.colorDiseno}
              onChange={(e) => set("colorDiseno", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Condición de uñas</Label>
          <textarea
            className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Observaciones: hongos, fragilidad, manchas, estrías, daño previo…"
            value={form.condicionUnas}
            onChange={(e) => set("condicionUnas", e.target.value)}
          />
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Técnico asignado</Label>
          <input
            className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            placeholder="Nombre del técnico"
            value={form.tecnicoAsignado}
            onChange={(e) => set("tecnicoAsignado", e.target.value)}
          />
        </div>
      </div>

      {/* RESULTADO Y NOTAS */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Resultado / Evaluación</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Resultado del servicio, observaciones finales…"
            value={form.assessment}
            onChange={(e) => set("assessment", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Notas</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
