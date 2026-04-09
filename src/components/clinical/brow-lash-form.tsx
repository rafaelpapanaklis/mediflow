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
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
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
