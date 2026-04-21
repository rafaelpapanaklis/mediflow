"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
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
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="SOAP">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Motivo de consulta</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Síntomas, dolencia principal…"
              value={form.subjective}
              onChange={(e) => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Exploración física</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Hallazgos de la exploración…"
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Modalidad de tratamiento">
        <div className="field-new">
          <label className="field-new__label">Modalidad</label>
          <select
            className="input-new"
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
      </CardNew>

      {isAcupuntura && (
        <CardNew title="Acupuntura">
          <div className="space-y-4">
            <div className="field-new">
              <label className="field-new__label">Puntos aplicados</label>
              <textarea
                className="input-new"
                style={{ minHeight: 80, resize: "vertical" }}
                placeholder="Ej. LI4, ST36, SP6, LR3…"
                value={form.puntosAplicados}
                onChange={(e) => set("puntosAplicados", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="field-new">
                <label className="field-new__label">Profundidad</label>
                <select
                  className="input-new"
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
              <div className="field-new">
                <label className="field-new__label">Tiempo de retención (minutos)</label>
                <input
                  type="number"
                  className="input-new"
                  placeholder="Ej. 20"
                  value={form.tiempoRetencion}
                  onChange={(e) => set("tiempoRetencion", e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardNew>
      )}

      {isHerbolaria && (
        <CardNew title="Herbolaria">
          <div className="field-new">
            <label className="field-new__label">Fórmula herbal</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Ingredientes con dosis: ej. Astragalus 15g, Ginseng 10g…"
              value={form.formulaHerbal}
              onChange={(e) => set("formulaHerbal", e.target.value)}
            />
          </div>
        </CardNew>
      )}

      <CardNew title="Diagnóstico TCM">
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">Observación de lengua</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Color, capa, forma, marcas dentales…"
              value={form.observacionLengua}
              onChange={(e) => set("observacionLengua", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="field-new">
              <label className="field-new__label">Tipo de pulso</label>
              <select
                className="input-new"
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
            <div className="field-new">
              <label className="field-new__label">Tipo constitucional</label>
              <input
                className="input-new"
                placeholder="Dosha o patrón TCM (ej. Vata, Qi deficiente)"
                value={form.tipoConstitucional}
                onChange={(e) => set("tipoConstitucional", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardNew>

      <CardNew title="Evaluación constitucional">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Constitución predominante</label>
            <select
              className="input-new"
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
          <div className="field-new">
            <label className="field-new__label">Exceso/Deficiencia</label>
            <select
              className="input-new"
              value={form.excesoDeficiencia}
              onChange={(e) => set("excesoDeficiencia", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="exceso">Exceso (Shi)</option>
              <option value="deficiencia">Deficiencia (Xu)</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Frío/Calor</label>
            <select
              className="input-new"
              value={form.frioCalor}
              onChange={(e) => set("frioCalor", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="frio">Patrón de frío</option>
              <option value="calor">Patrón de calor</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Humedad</label>
            <select
              className="input-new"
              value={form.humedad}
              onChange={(e) => set("humedad", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="sin_humedad">Sin humedad</option>
              <option value="leve">Humedad leve</option>
              <option value="severa">Humedad severa</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Estancamiento de Qi</label>
            <select
              className="input-new"
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
      </CardNew>

      {isAcupuntura && (
        <CardNew title="Registro de puntos de acupuntura" action={
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
        }>
          <div className="space-y-2">
            {form.puntosDetallados.map((p: any, i: number) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end">
                <div className="field-new">
                  <label className="field-new__label">Punto</label>
                  <input
                    className="input-new"
                    placeholder="Ej. LI4 Hegu"
                    value={p.punto}
                    onChange={(e) => updatePuntoDetallado(i, "punto", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Meridiano</label>
                  <select
                    className="input-new"
                    value={p.meridiano}
                    onChange={(e) => updatePuntoDetallado(i, "meridiano", e.target.value)}
                  >
                    <option value="">Meridiano…</option>
                    {MERIDIANOS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Lateralidad</label>
                  <select
                    className="input-new"
                    value={p.lateralidad}
                    onChange={(e) => updatePuntoDetallado(i, "lateralidad", e.target.value)}
                  >
                    <option value="">Lat…</option>
                    <option value="izq">Izq</option>
                    <option value="der">Der</option>
                    <option value="bilateral">Bilateral</option>
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Técnica</label>
                  <select
                    className="input-new"
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
        </CardNew>
      )}

      <CardNew title="Notas y plan">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Notas de sesión</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Respuesta del paciente, reacciones, evolución…"
              value={form.notasSesion}
              onChange={(e) => set("notasSesion", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Plan de tratamiento</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Frecuencia de sesiones, recomendaciones dietéticas…"
              value={form.planTratamiento}
              onChange={(e) => set("planTratamiento", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Diagnóstico / Evaluación">
        <div className="field-new">
          <label className="field-new__label">Diagnóstico / Evaluación</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Diagnóstico energético, patrón identificado…"
            value={form.assessment}
            onChange={(e) => set("assessment", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Alerta de interacciones">
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">Medicamentos convencionales del paciente</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Listar medicamentos convencionales que toma el paciente…"
              value={form.medicamentosConvencionales}
              onChange={(e) => set("medicamentosConvencionales", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Fórmula herbal prescrita</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Fórmula herbal prescrita en esta sesión…"
              value={form.formulaHerbalPrescrita || form.formulaHerbal}
              onChange={(e) => set("formulaHerbalPrescrita", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="field-new__label">Interacciones conocidas</label>
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
          <div className="field-new">
            <label className="field-new__label">Notas de seguridad</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Precauciones adicionales, contraindicaciones observadas…"
              value={form.notasSeguridad}
              onChange={(e) => set("notasSeguridad", e.target.value)}
            />
          </div>
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
