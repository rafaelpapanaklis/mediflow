"use client";
import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";

const SERVICIOS = [
  "Extensiones clásicas",
  "Volumen",
  "Híbridas",
  "Lash lift",
  "Tinte pestañas",
  "Microblading",
  "Laminado cejas",
  "Henna cejas",
];

const FORMAS_OJO = ["Almendrado", "Redondo", "Encapotado", "Caído", "Prominente"];

const CURL_TYPES = ["J", "B", "C", "D"];
const LONGITUDES = Array.from({ length: 9 }, (_, i) => i + 8); // 8-16mm
const GROSORES = ["0.05", "0.07", "0.10", "0.12", "0.15", "0.18", "0.20", "0.25"];

const REFILL_INTERVALS = ["2 semanas", "3 semanas", "4 semanas"];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function BrowLashForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    servicio: "",
    formaOjo: "",
    lashMap: {
      inner: { curl: "C", longitud: "10", grosor: "0.10" },
      middle: { curl: "C", longitud: "12", grosor: "0.10" },
      outer: { curl: "C", longitud: "11", grosor: "0.10" },
    },
    adhesivo: "",
    adhesivoBatch: "",
    formulaColor: "",
    patchTestDate: "",
    refillInterval: "3 semanas",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    notas: "",
    // Natural lash evaluation
    longitudNatural: "",
    densidad: "",
    curvaturaNatural: "",
    condicionPestanas: [] as string[],
    // Retention rate
    semanasDesdeUltima: "",
    porcentajeRetencion: "",
    // Sensitivity history
    historialSensibilidad: [] as Array<{
      fecha: string;
      producto: string;
      reaccion: string;
      notas: string;
    }>,
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  function toggleCondicion(c: string) {
    setForm((f) => ({
      ...f,
      condicionPestanas: f.condicionPestanas.includes(c)
        ? f.condicionPestanas.filter((x) => x !== c)
        : [...f.condicionPestanas, c],
    }));
  }

  function addSensibilidad() {
    setForm((f) => ({
      ...f,
      historialSensibilidad: [
        ...f.historialSensibilidad,
        { fecha: "", producto: "", reaccion: "", notas: "" },
      ],
    }));
  }

  function removeSensibilidad(index: number) {
    setForm((f) => ({
      ...f,
      historialSensibilidad: f.historialSensibilidad.filter((_, i) => i !== index),
    }));
  }

  function updateSensibilidad(index: number, key: string, value: string) {
    setForm((f) => ({
      ...f,
      historialSensibilidad: f.historialSensibilidad.map((item, i) =>
        i === index ? { ...item, [key]: value } : item
      ),
    }));
  }

  const retencionPct = Number(form.porcentajeRetencion) || 0;
  const retencionColor =
    retencionPct > 70
      ? "bg-green-500"
      : retencionPct >= 40
      ? "bg-amber-500"
      : "bg-red-500";
  const setLash = (zone: string, k: string, v: string) =>
    setForm((f) => ({
      ...f,
      lashMap: { ...f.lashMap, [zone]: { ...(f.lashMap as any)[zone], [k]: v } },
    }));

  const patchWarning = useMemo(() => {
    if (!form.patchTestDate) return "Sin patch test registrado";
    const diff = Date.now() - new Date(form.patchTestDate).getTime();
    const sixMonths = 1000 * 60 * 60 * 24 * 180;
    if (diff > sixMonths) return "Patch test vencido (> 6 meses)";
    return "";
  }, [form.patchTestDate]);

  async function handleSave() {
    if (!form.servicio) {
      toast.error("Selecciona un servicio");
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
            type: "brow_lash",
            servicio: form.servicio,
            formaOjo: form.formaOjo,
            lashMap: form.lashMap,
            adhesivo: form.adhesivo,
            adhesivoBatch: form.adhesivoBatch,
            formulaColor: form.formulaColor,
            patchTestDate: form.patchTestDate,
            refillInterval: form.refillInterval,
            notas: form.notas,
            longitudNatural: form.longitudNatural,
            densidad: form.densidad,
            curvaturaNatural: form.curvaturaNatural,
            condicionPestanas: form.condicionPestanas,
            semanasDesdeUltima: form.semanasDesdeUltima,
            porcentajeRetencion: form.porcentajeRetencion,
            historialSensibilidad: form.historialSensibilidad,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Registro de cejas/pestañas guardado");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Servicio">
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">Servicio</label>
            <select
              className="input-new"
              value={form.servicio}
              onChange={(e) => set("servicio", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {SERVICIOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Forma de ojo</label>
            <select
              className="input-new"
              value={form.formaOjo}
              onChange={(e) => set("formaOjo", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {FORMAS_OJO.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Mapa de pestañas">
        <div className="grid grid-cols-3 gap-4">
          {(["inner", "middle", "outer"] as const).map((zone) => {
            const labels: Record<string, string> = {
              inner: "Interior",
              middle: "Medio",
              outer: "Exterior",
            };
            return (
              <div key={zone} className="space-y-2">
                <p className="text-xs font-semibold text-brand-600">{labels[zone]}</p>
                <div className="field-new">
                  <label className="field-new__label">Curvatura</label>
                  <select
                    className="input-new"
                    value={(form.lashMap as any)[zone].curl}
                    onChange={(e) => setLash(zone, "curl", e.target.value)}
                  >
                    {CURL_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Longitud (mm)</label>
                  <select
                    className="input-new"
                    value={(form.lashMap as any)[zone].longitud}
                    onChange={(e) => setLash(zone, "longitud", e.target.value)}
                  >
                    {LONGITUDES.map((l) => (
                      <option key={l} value={String(l)}>
                        {l} mm
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Grosor (mm)</label>
                  <select
                    className="input-new"
                    value={(form.lashMap as any)[zone].grosor}
                    onChange={(e) => setLash(zone, "grosor", e.target.value)}
                  >
                    {GROSORES.map((g) => (
                      <option key={g} value={g}>
                        {g} mm
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </CardNew>

      <CardNew title="Materiales">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">Adhesivo usado</label>
            <input
              className="input-new"
              placeholder="Nombre del adhesivo"
              value={form.adhesivo}
              onChange={(e) => set("adhesivo", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Lote del adhesivo</label>
            <input
              className="input-new"
              placeholder="N.o de lote"
              value={form.adhesivoBatch}
              onChange={(e) => set("adhesivoBatch", e.target.value)}
            />
          </div>
          <div className="field-new col-span-2">
            <label className="field-new__label">Formula de color (marca + mezcla)</label>
            <input
              className="input-new"
              placeholder="Ej: RefectoCil #3 + #3.1 (50/50)"
              value={form.formulaColor}
              onChange={(e) => set("formulaColor", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Seguridad y seguimiento">
        <div className="grid grid-cols-2 gap-3">
          <div className="field-new">
            <label className="field-new__label">Fecha de patch test</label>
            <input
              type="date"
              className="input-new"
              value={form.patchTestDate}
              onChange={(e) => set("patchTestDate", e.target.value)}
            />
            {patchWarning && (
              <p className="text-xs font-semibold text-red-600 mt-1">{patchWarning}</p>
            )}
          </div>
          <div className="field-new">
            <label className="field-new__label">Intervalo de refill recomendado</label>
            <select
              className="input-new"
              value={form.refillInterval}
              onChange={(e) => set("refillInterval", e.target.value)}
            >
              {REFILL_INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Evaluación de pestañas naturales">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div className="field-new">
            <label className="field-new__label">Longitud natural</label>
            <select
              className="input-new"
              value={form.longitudNatural}
              onChange={(e) => set("longitudNatural", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="Cortas (<8mm)">Cortas (&lt;8mm)</option>
              <option value="Medias (8-11mm)">Medias (8-11mm)</option>
              <option value="Largas (>11mm)">Largas (&gt;11mm)</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Densidad</label>
            <select
              className="input-new"
              value={form.densidad}
              onChange={(e) => set("densidad", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="Escasa">Escasa</option>
              <option value="Normal">Normal</option>
              <option value="Abundante">Abundante</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Curvatura natural</label>
            <select
              className="input-new"
              value={form.curvaturaNatural}
              onChange={(e) => set("curvaturaNatural", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="Recta">Recta</option>
              <option value="Ligeramente curvada">Ligeramente curvada</option>
              <option value="Curvada">Curvada</option>
            </select>
          </div>
        </div>
        <div className="field-new">
          <label className="field-new__label">Condición</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {["Sanas", "Quebradizas", "Con gaps/huecos", "Debilitadas por extensiones previas"].map((c) => (
              <label key={c} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.condicionPestanas.includes(c)}
                  onChange={() => toggleCondicion(c)}
                  className="w-4 h-4 accent-brand-600"
                />
                <span className="text-sm">{c}</span>
              </label>
            ))}
          </div>
        </div>
      </CardNew>

      <CardNew title="Tasa de retención">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="field-new">
            <label className="field-new__label">Semanas desde última aplicación</label>
            <input
              type="number"
              min={0}
              className="input-new"
              placeholder="0"
              value={form.semanasDesdeUltima}
              onChange={(e) => set("semanasDesdeUltima", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">% de extensiones retenidas</label>
            <input
              type="number"
              min={0}
              max={100}
              className="input-new"
              placeholder="0"
              value={form.porcentajeRetencion}
              onChange={(e) => set("porcentajeRetencion", e.target.value)}
            />
          </div>
        </div>
        {form.porcentajeRetencion && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Nivel de retención</span>
              <span className="font-semibold">{retencionPct}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${retencionColor}`}
                style={{ width: `${Math.min(Math.max(retencionPct, 0), 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {retencionPct > 70
                ? "Retención buena"
                : retencionPct >= 40
                ? "Retención moderada — evaluar adhesivo o cuidado"
                : "Retención baja — revisar técnica o productos"}
            </p>
          </div>
        )}
      </CardNew>

      <CardNew title="Historial de sensibilidad">
        {form.historialSensibilidad.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">Sin reacciones registradas.</p>
        )}
        <div className="space-y-3">
          {form.historialSensibilidad.map((entry, idx) => (
            <div key={idx} className="rounded-lg border border-border p-3 space-y-2 bg-neutral-50 dark:bg-neutral-800/50">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="field-new">
                  <label className="field-new__label">Fecha</label>
                  <input
                    type="date"
                    className="input-new"
                    value={entry.fecha}
                    onChange={(e) => updateSensibilidad(idx, "fecha", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Producto/Adhesivo</label>
                  <input
                    className="input-new"
                    placeholder="Producto…"
                    value={entry.producto}
                    onChange={(e) => updateSensibilidad(idx, "producto", e.target.value)}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Reacción</label>
                  <select
                    className="input-new"
                    value={entry.reaccion}
                    onChange={(e) => updateSensibilidad(idx, "reaccion", e.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    <option value="Irritación leve">Irritación leve</option>
                    <option value="Enrojecimiento">Enrojecimiento</option>
                    <option value="Hinchazón">Hinchazón</option>
                    <option value="Reacción alérgica severa">Reacción alérgica severa</option>
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label">Notas</label>
                  <input
                    className="input-new"
                    placeholder="Notas…"
                    value={entry.notas}
                    onChange={(e) => updateSensibilidad(idx, "notas", e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeSensibilidad(idx)}
                className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
              >
                Eliminar reacción
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addSensibilidad}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          + Agregar reacción
        </button>
      </CardNew>

      <CardNew title="SOAP y notas">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", label: "Subjetivo" },
            { key: "objective", label: "Objetivo" },
            { key: "assessment", label: "Evaluacion" },
            { key: "plan", label: "Plan" },
          ] as const).map((f) => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 80, resize: "vertical" }}
                placeholder={f.label}
                value={(form as any)[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 field-new">
          <label className="field-new__label">Notas adicionales</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Observaciones del procedimiento…"
            value={form.notas}
            onChange={(e) => set("notas", e.target.value)}
          />
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
