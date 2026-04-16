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
    // Evaluación constitucional TCM
    constitucionPredominante: "",
    excesoDeficiencia: "",
    frioCalor: "",
    humedad: "",
    estancamientoQi: "",
    // Mapa de puntos de acupuntura
    puntosDetallados: [{ punto: "", meridiano: "", lateralidad: "", tecnica: "" }] as { punto: string; meridiano: string; lateralidad: string; tecnica: string }[],
    // Interacciones hierba-medicamento
    medicamentosConvencionales: "",
    formulaHerbalPrescrita: "",
    interaccionesConocidas: [] as string[],
    notasSeguridad: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const isAcupuntura = form.modalidad === "acupuntura";
  const isHerbolaria = form.modalidad === "herbolaria";

  const MERIDIANOS = [
    "Pulmón (LU)", "Intestino Grueso (LI)", "Estómago (ST)", "Bazo (SP)",
    "Corazón (HT)", "Intestino Delgado (SI)", "Vejiga (BL)", "Riñón (KI)",
    "Pericardio (PC)", "Triple Calentador (TE)", "Vesícula Biliar (GB)",
    "Hígado (LR)", "Du Mai (GV)", "Ren Mai (CV)", "Extra",
  ];

  const INTERACCIONES_COMUNES = [
    "Anticoagulantes + Ginkgo/Ginseng/Dong Quai",
    "Antidepresivos ISRS + Hierba de San Juan",
    "Antidiabéticos + Ginseng/Aloe vera",
    "Antihipertensivos + Regaliz (Glycyrrhiza)",
    "Inmunosupresores + Echinacea/Astrágalo",
  ];

  function addPuntoDetallado() {
    set("puntosDetallados", [
      ...form.puntosDetallados,
      { punto: "", meridiano: "", lateralidad: "", tecnica: "" },
    ]);
  }

  function removePuntoDetallado(i: number) {
    set("puntosDetallados", form.puntosDetallados.filter((_: any, idx: number) => idx !== i));
  }

  function updatePuntoDetallado(i: number, field: string, value: string) {
    const pts = [...form.puntosDetallados];
    (pts[i] as any)[field] = value;
    set("puntosDetallados", pts);
  }

  function toggleInteraccion(interaccion: string) {
    const current = form.interaccionesConocidas;
    if (current.includes(interaccion)) {
      set("interaccionesConocidas", current.filter((i: string) => i !== interaccion));
    } else {
      set("interaccionesConocidas", [...current, interaccion]);
    }
  }

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
            evaluacionConstitucional: {
              constitucionPredominante: form.constitucionPredominante,
              excesoDeficiencia: form.excesoDeficiencia,
              frioCalor: form.frioCalor,
              humedad: form.humedad,
              estancamientoQi: form.estancamientoQi,
            },
            puntosDetallados: form.puntosDetallados,
            interaccionesHierbaMedicamento: {
              medicamentosConvencionales: form.medicamentosConvencionales,
              formulaHerbalPrescrita: form.formulaHerbalPrescrita,
              interaccionesConocidas: form.interaccionesConocidas,
              notasSeguridad: form.notasSeguridad,
            },
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
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Síntomas, dolencia principal…"
            value={form.subjective}
            onChange={(e) => set("subjective", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Exploración física</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
            className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
                className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
                placeholder="Ej. LI4, ST36, SP6, LR3…"
                value={form.puntosAplicados}
                onChange={(e) => set("puntosAplicados", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Profundidad</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
              className="flex min-h-[100px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Color, capa, forma, marcas dentales…"
              value={form.observacionLengua}
              onChange={(e) => set("observacionLengua", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tipo de pulso</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Dosha o patrón TCM (ej. Vata, Qi deficiente)"
                value={form.tipoConstitucional}
                onChange={(e) => set("tipoConstitucional", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* EVALUACIÓN CONSTITUCIONAL TCM */}
      <div className="rounded-xl border border-border dark:border-border p-4">
        <h3 className="text-sm font-bold mb-3">☯ Evaluación constitucional</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Constitución predominante</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.constitucionPredominante}
              onChange={(e) => set("constitucionPredominante", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="madera">Madera (Hígado/Vesícula)</option>
              <option value="fuego">Fuego (Corazón/Intestino D.)</option>
              <option value="tierra">Tierra (Bazo/Estómago)</option>
              <option value="metal">Metal (Pulmón/Intestino G.)</option>
              <option value="agua">Agua (Riñón/Vejiga)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Exceso/Deficiencia</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.excesoDeficiencia}
              onChange={(e) => set("excesoDeficiencia", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="exceso">Exceso (Shi)</option>
              <option value="deficiencia">Deficiencia (Xu)</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Frío/Calor</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.frioCalor}
              onChange={(e) => set("frioCalor", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="frio">Patrón de frío</option>
              <option value="calor">Patrón de calor</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Humedad</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.humedad}
              onChange={(e) => set("humedad", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="sin_humedad">Sin humedad</option>
              <option value="leve">Humedad leve</option>
              <option value="severa">Humedad severa</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Estancamiento de Qi</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.estancamientoQi}
              onChange={(e) => set("estancamientoQi", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="sin_estancamiento">Sin estancamiento</option>
              <option value="leve">Leve</option>
              <option value="moderado">Moderado</option>
              <option value="severo">Severo</option>
            </select>
          </div>
        </div>
      </div>

      {/* MAPA DE PUNTOS DE ACUPUNTURA */}
      {isAcupuntura && (
        <div className="rounded-xl border border-border dark:border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">📍 Registro de puntos de acupuntura</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Total de agujas: <span className="font-bold text-foreground">{form.puntosDetallados.filter((p: any) => p.punto).length}</span>
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-brand-600 hover:underline"
                onClick={addPuntoDetallado}
              >
                + Agregar punto
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {form.puntosDetallados.map((p: any, i: number) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Punto</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. LI4 Hegu"
                    value={p.punto}
                    onChange={(e) => updatePuntoDetallado(i, "punto", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Meridiano</Label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-border bg-card dark:border-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={p.meridiano}
                    onChange={(e) => updatePuntoDetallado(i, "meridiano", e.target.value)}
                  >
                    <option value="">Meridiano…</option>
                    {MERIDIANOS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Lateralidad</Label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-border bg-card dark:border-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={p.lateralidad}
                    onChange={(e) => updatePuntoDetallado(i, "lateralidad", e.target.value)}
                  >
                    <option value="">Lat…</option>
                    <option value="izq">Izq</option>
                    <option value="der">Der</option>
                    <option value="bilateral">Bilateral</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Técnica</Label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-border bg-card dark:border-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={p.tecnica}
                    onChange={(e) => updatePuntoDetallado(i, "tecnica", e.target.value)}
                  >
                    <option value="">Técnica…</option>
                    <option value="tonificacion">Tonificación</option>
                    <option value="sedacion">Sedación</option>
                    <option value="neutra">Neutra</option>
                  </select>
                </div>
                {form.puntosDetallados.length > 1 && (
                  <button
                    type="button"
                    className="h-9 px-2 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    onClick={() => removePuntoDetallado(i)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NOTAS Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Notas de sesión</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Respuesta del paciente, reacciones, evolución…"
            value={form.notasSesion}
            onChange={(e) => set("notasSesion", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Plan de tratamiento</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
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
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
          placeholder="Diagnóstico energético, patrón identificado…"
          value={form.assessment}
          onChange={(e) => set("assessment", e.target.value)}
        />
      </div>

      {/* INTERACCIONES HIERBA-MEDICAMENTO */}
      <div className="rounded-xl border border-amber-400 dark:border-amber-600 p-4">
        <h3 className="text-sm font-bold mb-3">⚠️ Alerta de interacciones</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Medicamentos convencionales del paciente</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-card dark:border-border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Listar medicamentos convencionales que toma el paciente…"
              value={form.medicamentosConvencionales}
              onChange={(e) => set("medicamentosConvencionales", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fórmula herbal prescrita</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-card dark:border-border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Fórmula herbal prescrita en esta sesión…"
              value={form.formulaHerbalPrescrita || form.formulaHerbal}
              onChange={(e) => set("formulaHerbalPrescrita", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Interacciones conocidas</Label>
            <div className="space-y-2">
              {INTERACCIONES_COMUNES.map((interaccion) => (
                <label key={interaccion} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-600/20"
                    checked={form.interaccionesConocidas.includes(interaccion)}
                    onChange={() => toggleInteraccion(interaccion)}
                  />
                  <span className="text-sm">{interaccion}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas de seguridad</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-card dark:border-border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Precauciones adicionales, contraindicaciones observadas…"
              value={form.notasSeguridad}
              onChange={(e) => set("notasSeguridad", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de medicina alternativa"}
        </Button>
      </div>
    </div>
  );
}
