"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
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

const TRIGGER_POINTS = [
  "Trapecio superior",
  "Trapecio medio",
  "Elevador de la escápula",
  "Infraespinoso",
  "Romboides",
  "Suboccipitales",
  "Esternocleidomastoideo",
  "Piriforme",
  "Psoas ilíaco",
  "Cuadrado lumbar",
  "Glúteo medio",
  "Tensor de la fascia lata",
];

const EVALUACION_POSTURAL = [
  "Cabeza adelantada",
  "Hombros desnivelados",
  "Hombros protruidos (redondeados)",
  "Hipercifosis dorsal",
  "Hiperlordosis lumbar",
  "Escoliosis funcional",
  "Pelvis en anteversión",
  "Pelvis desnivelada",
  "Genu valgum (rodillas en X)",
  "Pie plano/cavo",
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
    dolorAntes: null as number | null,
    dolorDespues: null as number | null,
    triggerPoints: [] as string[],
    triggerPointTipo: {} as Record<string, string>,
    evaluacionPostural: [] as string[],
    notasPosturales: "",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleArr = (key: "zonasEnfoque" | "zonasDolor" | "contraindicaciones" | "triggerPoints" | "evaluacionPostural", val: string) => {
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
            dolorAntes: form.dolorAntes,
            dolorDespues: form.dolorDespues,
            triggerPoints: form.triggerPoints,
            triggerPointTipo: form.triggerPointTipo,
            evaluacionPostural: form.evaluacionPostural,
            notasPosturales: form.notasPosturales,
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

  const PRESION_LABELS = ["1 - Suave", "2 - Ligera", "3 - Media", "4 - Profunda", "5 - Firme"];

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Tipo de masaje">
        <div className="space-y-3">
          <div className="field-new">
            <label className="field-new__label">Tipo</label>
            <select
              className="input-new"
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
          <div className="field-new">
            <label className="field-new__label">Presion preferida</label>
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
      </CardNew>

      <CardNew title="Zonas de enfoque">
        <div className="flex flex-wrap gap-2">
          {ZONAS.map((z) => (
            <label
              key={z}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.zonasEnfoque.includes(z)
                  ? "bg-brand-600/10 border-brand-600 text-brand-600"
                  : "border-border hover:bg-muted"
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
      </CardNew>

      <CardNew title="Trigger points identificados">
        <div className="flex flex-wrap gap-2">
          {TRIGGER_POINTS.map((tp) => (
            <label
              key={tp}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.triggerPoints.includes(tp)
                  ? "bg-purple-50 border-purple-400 text-purple-700 dark:bg-purple-900/30 dark:border-purple-500 dark:text-purple-300"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-purple-600"
                checked={form.triggerPoints.includes(tp)}
                onChange={() => toggleArr("triggerPoints", tp)}
              />
              {tp}
            </label>
          ))}
        </div>
        {form.triggerPoints.length > 0 && (
          <div className="mt-3 space-y-2">
            {form.triggerPoints.map((tp) => (
              <div key={tp} className="flex items-center gap-3">
                <span className="text-sm min-w-[180px]">{tp}</span>
                <select
                  className="input-new"
                  value={form.triggerPointTipo[tp] || "Activo"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      triggerPointTipo: { ...f.triggerPointTipo, [tp]: e.target.value },
                    }))
                  }
                >
                  <option value="Activo">Activo</option>
                  <option value="Latente">Latente</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      <CardNew title="Evaluación postural">
        <div className="flex flex-wrap gap-2">
          {EVALUACION_POSTURAL.map((ep) => (
            <label
              key={ep}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.evaluacionPostural.includes(ep)
                  ? "bg-sky-50 border-sky-400 text-sky-700 dark:bg-sky-900/30 dark:border-sky-500 dark:text-sky-300"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className="accent-sky-600"
                checked={form.evaluacionPostural.includes(ep)}
                onChange={() => toggleArr("evaluacionPostural", ep)}
              />
              {ep}
            </label>
          ))}
        </div>
        <div className="field-new mt-3">
          <label className="field-new__label">Notas posturales</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Observaciones adicionales sobre la postura..."
            value={form.notasPosturales}
            onChange={(e) => set("notasPosturales", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Zonas de dolor reportadas">
        <div className="flex flex-wrap gap-2">
          {ZONAS.map((z) => (
            <label
              key={z}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.zonasDolor.includes(z)
                  ? "bg-red-50 border-red-400 text-red-600"
                  : "border-border hover:bg-muted"
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
      </CardNew>

      <CardNew title="Tecnicas aplicadas">
        <div className="field-new">
          <label className="field-new__label">Tecnicas aplicadas por zona</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Ej: Espalda alta — fricciones + amasamiento profundo…"
            value={form.tecnicas}
            onChange={(e) => set("tecnicas", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Contraindicaciones revisadas">
        <div className="flex flex-wrap gap-2">
          {CONTRAINDICACIONES.map((c) => (
            <label
              key={c}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.contraindicaciones.includes(c)
                  ? "bg-amber-50 border-amber-400 text-amber-700"
                  : "border-border hover:bg-muted"
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
      </CardNew>

      <CardNew title="Escala Visual Análoga de Dolor">
        <div className="space-y-4">
          <div className="field-new">
            <label className="field-new__label">Dolor antes de la sesión</label>
            <div className="flex gap-1">
              {Array.from({ length: 11 }, (_, i) => {
                const hue = 120 - i * 12;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => set("dolorAntes", i)}
                    className={`w-9 h-9 rounded-lg text-xs font-bold border-2 transition-all ${
                      form.dolorAntes === i
                        ? "ring-2 ring-offset-2 ring-brand-600 scale-110 dark:ring-offset-gray-900"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: `hsl(${hue}, 80%, ${form.dolorAntes === i ? "45%" : "55%"})`,
                      borderColor: `hsl(${hue}, 80%, 35%)`,
                      color: "white",
                    }}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">Dolor después de la sesión</label>
            <div className="flex gap-1">
              {Array.from({ length: 11 }, (_, i) => {
                const hue = 120 - i * 12;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => set("dolorDespues", i)}
                    className={`w-9 h-9 rounded-lg text-xs font-bold border-2 transition-all ${
                      form.dolorDespues === i
                        ? "ring-2 ring-offset-2 ring-brand-600 scale-110 dark:ring-offset-gray-900"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: `hsl(${hue}, 80%, ${form.dolorDespues === i ? "45%" : "55%"})`,
                      borderColor: `hsl(${hue}, 80%, 35%)`,
                      color: "white",
                    }}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </div>
          {form.dolorAntes !== null && form.dolorDespues !== null && (
            <div className={`text-sm font-semibold px-3 py-2 rounded-lg ${
              form.dolorAntes > form.dolorDespues
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : form.dolorAntes === form.dolorDespues
                  ? "bg-muted text-muted-foreground"
                  : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"
            }`}>
              {form.dolorAntes > form.dolorDespues
                ? `Reducción de ${form.dolorAntes - form.dolorDespues} puntos`
                : form.dolorAntes === form.dolorDespues
                  ? "Sin cambio en el dolor"
                  : `Aumento de ${form.dolorDespues - form.dolorAntes} puntos`}
            </div>
          )}
        </div>
      </CardNew>

      <CardNew title="Notas SOAP">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", label: "Subjetivo", ph: "Motivo de consulta, molestias…" },
            { key: "objective", label: "Objetivo", ph: "Hallazgos palpatorios, tension…" },
            { key: "assessment", label: "Evaluacion", ph: "Valoracion del terapeuta…" },
            { key: "plan", label: "Plan", ph: "Proxima sesion, ejercicios…" },
          ] as const).map((f) => (
            <div key={f.key} className="field-new">
              <label className="field-new__label">{f.label}</label>
              <textarea
                className="input-new"
                style={{ minHeight: 80, resize: "vertical" }}
                placeholder={f.ph}
                value={(form as any)[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </CardNew>

      <CardNew title="Recomendaciones post-masaje">
        <div className="field-new">
          <label className="field-new__label">Recomendaciones post-masaje</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Hidratacion, reposo, estiramientos…"
            value={form.recomendaciones}
            onChange={(e) => set("recomendaciones", e.target.value)}
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
