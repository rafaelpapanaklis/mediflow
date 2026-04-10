"use client";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

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

  const inputCls =
    "flex h-9 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20";
  const selectCls = inputCls;
  const textareaCls =
    "flex min-h-[70px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none";

  return (
    <div className="space-y-6">
      {/* Servicio y Forma de ojo */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Servicio</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Servicio</Label>
            <select
              className={selectCls}
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
          <div className="space-y-1">
            <Label className="text-xs">Forma de ojo</Label>
            <select
              className={selectCls}
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
      </div>

      {/* Mapa de pestañas */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Mapa de pestañas</h3>
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
                <div className="space-y-1">
                  <Label className="text-xs">Curvatura</Label>
                  <select
                    className={selectCls}
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
                <div className="space-y-1">
                  <Label className="text-xs">Longitud (mm)</Label>
                  <select
                    className={selectCls}
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
                <div className="space-y-1">
                  <Label className="text-xs">Grosor (mm)</Label>
                  <select
                    className={selectCls}
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
      </div>

      {/* Adhesivo y Color */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Materiales</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Adhesivo usado</Label>
            <input
              className={inputCls}
              placeholder="Nombre del adhesivo"
              value={form.adhesivo}
              onChange={(e) => set("adhesivo", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lote del adhesivo</Label>
            <input
              className={inputCls}
              placeholder="N.o de lote"
              value={form.adhesivoBatch}
              onChange={(e) => set("adhesivoBatch", e.target.value)}
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Formula de color (marca + mezcla)</Label>
            <input
              className={inputCls}
              placeholder="Ej: RefectoCil #3 + #3.1 (50/50)"
              value={form.formulaColor}
              onChange={(e) => set("formulaColor", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Patch test + Refill */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Seguridad y seguimiento</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Fecha de patch test</Label>
            <input
              type="date"
              className={inputCls}
              value={form.patchTestDate}
              onChange={(e) => set("patchTestDate", e.target.value)}
            />
            {patchWarning && (
              <p className="text-xs font-semibold text-red-600 mt-1">{patchWarning}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Intervalo de refill recomendado</Label>
            <select
              className={selectCls}
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
      </div>

      {/* EVALUACIÓN DE PESTAÑAS NATURALES */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Evaluación de pestañas naturales</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div className="space-y-1">
            <Label className="text-xs">Longitud natural</Label>
            <select
              className={selectCls + " dark:bg-neutral-900"}
              value={form.longitudNatural}
              onChange={(e) => set("longitudNatural", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="Cortas (<8mm)">Cortas (&lt;8mm)</option>
              <option value="Medias (8-11mm)">Medias (8-11mm)</option>
              <option value="Largas (>11mm)">Largas (&gt;11mm)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Densidad</Label>
            <select
              className={selectCls + " dark:bg-neutral-900"}
              value={form.densidad}
              onChange={(e) => set("densidad", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="Escasa">Escasa</option>
              <option value="Normal">Normal</option>
              <option value="Abundante">Abundante</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Curvatura natural</Label>
            <select
              className={selectCls + " dark:bg-neutral-900"}
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
        <div className="space-y-1">
          <Label className="text-xs">Condición</Label>
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
      </div>

      {/* TASA DE RETENCIÓN */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Tasa de retención</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="space-y-1">
            <Label className="text-xs">Semanas desde última aplicación</Label>
            <input
              type="number"
              min={0}
              className={inputCls + " dark:bg-neutral-900"}
              placeholder="0"
              value={form.semanasDesdeUltima}
              onChange={(e) => set("semanasDesdeUltima", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">% de extensiones retenidas</Label>
            <input
              type="number"
              min={0}
              max={100}
              className={inputCls + " dark:bg-neutral-900"}
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
      </div>

      {/* HISTORIAL DE SENSIBILIDAD */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Historial de sensibilidad</h3>
        {form.historialSensibilidad.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">Sin reacciones registradas.</p>
        )}
        <div className="space-y-3">
          {form.historialSensibilidad.map((entry, idx) => (
            <div key={idx} className="rounded-lg border border-border p-3 space-y-2 bg-neutral-50 dark:bg-neutral-800/50">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Fecha</Label>
                  <input
                    type="date"
                    className={inputCls + " dark:bg-neutral-900"}
                    value={entry.fecha}
                    onChange={(e) => updateSensibilidad(idx, "fecha", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Producto/Adhesivo</Label>
                  <input
                    className={inputCls + " dark:bg-neutral-900"}
                    placeholder="Producto…"
                    value={entry.producto}
                    onChange={(e) => updateSensibilidad(idx, "producto", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reacción</Label>
                  <select
                    className={selectCls + " dark:bg-neutral-900"}
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
                <div className="space-y-1">
                  <Label className="text-xs">Notas</Label>
                  <input
                    className={inputCls + " dark:bg-neutral-900"}
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
      </div>

      {/* SOAP + Notas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { key: "subjective", label: "Subjetivo" },
          { key: "objective", label: "Objetivo" },
          { key: "assessment", label: "Evaluacion" },
          { key: "plan", label: "Plan" },
        ] as const).map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label>{f.label}</Label>
            <textarea
              className={textareaCls}
              placeholder={f.label}
              value={(form as any)[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

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
          {saving ? "Guardando…" : "Guardar registro cejas/pestañas"}
        </Button>
      </div>
    </div>
  );
}
