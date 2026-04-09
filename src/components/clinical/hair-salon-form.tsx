"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const SERVICIOS = [
  "corte",
  "color completo",
  "mechas/highlights",
  "balayage",
  "alisado keratina",
  "permanente",
  "tratamiento capilar",
  "barba",
  "corte + barba",
];

const TIPOS_CABELLO = [
  "liso fino",
  "liso grueso",
  "ondulado",
  "rizado",
  "crespo",
];

const VOLUMENES_REVELADOR = ["10", "20", "30", "40"];

const COLOR_SERVICES = ["color completo", "mechas/highlights", "balayage"];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function HairSalonForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    servicio: "",
    tipoCabello: "",
    colors: [{ marca: "", tono: "", proporcion: "", reveladorVolumen: "20" }],
    processingTime: "",
    productosAplicados: "",
    estilista: "",
    notasProximaVisita: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const showColorFormula = COLOR_SERVICES.includes(form.servicio);

  function addColor() {
    set("colors", [
      ...form.colors,
      { marca: "", tono: "", proporcion: "", reveladorVolumen: "20" },
    ]);
  }

  function updateColor(i: number, field: string, value: string) {
    const colors = [...form.colors];
    (colors[i] as any)[field] = value;
    set("colors", colors);
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
            type: "hair_salon",
            servicio: form.servicio,
            tipoCabello: form.tipoCabello,
            colorFormula: showColorFormula
              ? { colors: form.colors, processingTime: form.processingTime }
              : null,
            productosAplicados: form.productosAplicados,
            estilista: form.estilista,
            notasProximaVisita: form.notasProximaVisita,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();

      // Save color formula separately if applicable
      if (showColorFormula) {
        await fetch("/api/formulas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            type: "hair_color",
            formula: {
              colors: form.colors,
              processingTime: form.processingTime,
            },
            notes: form.notasProximaVisita,
          }),
        }).catch(() => {
          /* endpoint may not exist yet */
        });
      }

      onSaved(record);
      toast.success("Registro de salón guardado");
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
            placeholder="¿Qué busca el cliente hoy?"
            value={form.subjective}
            onChange={(e) => set("subjective", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones del cabello</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado actual del cabello, daño, raíces…"
            value={form.objective}
            onChange={(e) => set("objective", e.target.value)}
          />
        </div>
      </div>

      {/* SERVICIO Y TIPO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Servicio</h3>
        <div className="grid grid-cols-2 gap-4">
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
            <Label>Tipo de cabello</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tipoCabello}
              onChange={(e) => set("tipoCabello", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {TIPOS_CABELLO.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* COLOR FORMULA */}
      {showColorFormula && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">Fórmula de color</h3>
            <button
              className="text-xs font-semibold text-brand-600 hover:underline"
              onClick={addColor}
            >
              + Agregar color
            </button>
          </div>
          <div className="space-y-2">
            {form.colors.map((c, i) => (
              <div key={i} className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Marca</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. Wella"
                    value={c.marca}
                    onChange={(e) => updateColor(i, "marca", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tono</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. 7/1"
                    value={c.tono}
                    onChange={(e) => updateColor(i, "tono", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Proporción</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. 1:1.5"
                    value={c.proporcion}
                    onChange={(e) =>
                      updateColor(i, "proporcion", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Revelador volumen</Label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={c.reveladorVolumen}
                    onChange={(e) =>
                      updateColor(i, "reveladorVolumen", e.target.value)
                    }
                  >
                    {VOLUMENES_REVELADOR.map((v) => (
                      <option key={v} value={v}>
                        Vol. {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Tiempo de procesamiento (minutos)</Label>
            <input
              type="number"
              className="flex h-9 w-32 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 35"
              value={form.processingTime}
              onChange={(e) => set("processingTime", e.target.value)}
            />
          </div>
        </div>
      )}

      {/* PRODUCTOS & ESTILISTA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Detalles adicionales</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Productos aplicados</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Shampoo, acondicionador, tratamiento, protector térmico…"
              value={form.productosAplicados}
              onChange={(e) => set("productosAplicados", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Estilista</Label>
              <input
                className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Nombre del estilista"
                value={form.estilista}
                onChange={(e) => set("estilista", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* DIAGNÓSTICO Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Resultado / Observaciones</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Resultado del servicio, satisfacción del cliente…"
            value={form.assessment}
            onChange={(e) => set("assessment", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Notas para próxima visita</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Retocar raíz en 4 semanas, cambiar tono…"
            value={form.notasProximaVisita}
            onChange={(e) => set("notasProximaVisita", e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de salón"}
        </Button>
      </div>
    </div>
  );
}
