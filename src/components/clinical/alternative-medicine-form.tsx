"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const MODALIDADES = [
  "acupuntura",
  "ventosas/cupping",
  "moxibustión",
  "electroacupuntura",
  "quiropráctica",
  "naturopatía",
  "herbolaria",
  "homeopatía",
];

const PROFUNDIDADES = ["superficial", "media", "profunda"];

const TIPOS_PULSO = [
  "superficial",
  "profundo",
  "rápido",
  "lento",
  "resbaladizo",
  "áspero",
  "de cuerda",
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function AlternativeMedicineForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    modalidad: "",
    // Acupuntura fields
    puntosAplicados: "",
    profundidad: "",
    tiempoRetencion: "",
    // Herbolaria fields
    formulaHerbal: "",
    // TCM diagnosis
    observacionLengua: "",
    tipoPulso: "",
    tipoConstitucional: "",
    notasSesion: "",
    planTratamiento: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const isAcupuntura = form.modalidad === "acupuntura";
  const isHerbolaria = form.modalidad === "herbolaria";

  async function handleSave() {
    if (!form.modalidad) {
      toast.error("Selecciona la modalidad de tratamiento");
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
            type: "alternative_medicine",
            modalidad: form.modalidad,
            acupuntura: isAcupuntura
              ? {
                  puntosAplicados: form.puntosAplicados,
                  profundidad: form.profundidad,
                  tiempoRetencion: form.tiempoRetencion,
                }
              : null,
            formulaHerbal: isHerbolaria ? form.formulaHerbal : null,
            diagnosticoTCM: {
              observacionLengua: form.observacionLengua,
              tipoPulso: form.tipoPulso,
            },
            tipoConstitucional: form.tipoConstitucional,
            notasSesion: form.notasSesion,
            planTratamiento: form.planTratamiento,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();

      // Save herbal formula separately if applicable
      if (isHerbolaria && form.formulaHerbal) {
        await fetch("/api/formulas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            type: "herbal",
            formula: { ingredients: form.formulaHerbal },
            notes: form.notasSesion,
          }),
        }).catch(() => {
          /* endpoint may not exist yet */
        });
      }

      onSaved(record);
      toast.success("Registro de medicina alternativa guardado");
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
          <Label>Motivo de consulta</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Síntomas, dolencia principal…"
            value={form.subjective}
            onChange={(e) => set("subjective", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Hallazgos de la exploración…"
            value={form.objective}
            onChange={(e) => set("objective", e.target.value)}
          />
        </div>
      </div>

      {/* MODALIDAD */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Modalidad de tratamiento</h3>
        <div className="space-y-1.5">
          <Label>Modalidad</Label>
          <select
            className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            value={form.modalidad}
            onChange={(e) => set("modalidad", e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {MODALIDADES.map((m) => (
              <option key={m} value={m}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ACUPUNTURA FIELDS */}
      {isAcupuntura && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold mb-3">Acupuntura</h3>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Puntos aplicados</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder="Ej. LI4, ST36, SP6, LR3…"
                value={form.puntosAplicados}
                onChange={(e) => set("puntosAplicados", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Profundidad</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={form.profundidad}
                  onChange={(e) => set("profundidad", e.target.value)}
                >
                  <option value="">Seleccionar…</option>
                  {PROFUNDIDADES.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Tiempo de retención (minutos)</Label>
                <input
                  type="number"
                  className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ej. 20"
                  value={form.tiempoRetencion}
                  onChange={(e) => set("tiempoRetencion", e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HERBOLARIA FIELDS */}
      {isHerbolaria && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold mb-3">Herbolaria</h3>
          <div className="space-y-1.5">
            <Label>Fórmula herbal</Label>
            <textarea
              className="flex min-h-[100px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Ingredientes con dosis: ej. Astragalus 15g, Ginseng 10g…"
              value={form.formulaHerbal}
              onChange={(e) => set("formulaHerbal", e.target.value)}
            />
          </div>
        </div>
      )}

      {/* DIAGNÓSTICO TCM */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Diagnóstico TCM</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Observación de lengua</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Color, capa, forma, marcas dentales…"
              value={form.observacionLengua}
              onChange={(e) => set("observacionLengua", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tipo de pulso</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={form.tipoPulso}
                onChange={(e) => set("tipoPulso", e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {TIPOS_PULSO.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo constitucional</Label>
              <input
                className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Dosha o patrón TCM (ej. Vata, Qi deficiente)"
                value={form.tipoConstitucional}
                onChange={(e) => set("tipoConstitucional", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* NOTAS Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Notas de sesión</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Respuesta del paciente, reacciones, evolución…"
            value={form.notasSesion}
            onChange={(e) => set("notasSesion", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Plan de tratamiento</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Frecuencia de sesiones, recomendaciones dietéticas…"
            value={form.planTratamiento}
            onChange={(e) => set("planTratamiento", e.target.value)}
          />
        </div>
      </div>

      {/* ASSESSMENT */}
      <div className="space-y-1.5">
        <Label>Diagnóstico / Evaluación</Label>
        <textarea
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Diagnóstico energético, patrón identificado…"
          value={form.assessment}
          onChange={(e) => set("assessment", e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de medicina alternativa"}
        </Button>
      </div>
    </div>
  );
}
