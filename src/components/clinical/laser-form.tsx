"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";

const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"];
const COLORES_VELLO = [
  "Negro",
  "Castaño oscuro",
  "Castaño claro",
  "Rubio",
  "Pelirrojo",
  "Canoso",
];
const GROSORES = ["Fino", "Medio", "Grueso"];
const MAQUINAS = ["Alexandrite", "Diode", "Nd:YAG", "IPL"];
const ZONAS = [
  "Labio superior",
  "Axilas",
  "Brazos",
  "Pecho",
  "Espalda",
  "Abdomen",
  "Bikini clasico",
  "Bikini brasileño",
  "Bikini full",
  "Piernas superiores",
  "Piernas inferiores",
  "Gluteos",
  "Rostro completo",
];
const ENFRIAMIENTO = ["Cryo", "Contacto", "Aire"];
const REACCIONES = [
  "Eritema leve",
  "Eritema moderado",
  "Edema",
  "Ampollas",
  "Hiperpigmentacion",
  "Ninguna",
];
const INTERVALOS = ["4 semanas", "6 semanas", "8 semanas"];

const CHECKLIST_PRE_SESION = [
  "Sin exposición solar directa (2 semanas)",
  "Sin depilación con cera/pinza (4 semanas)",
  "Sin uso de retinoides tópicos (1 semana)",
  "Sin autobronceante (2 semanas)",
  "Sin antibióticos fotosensibilizantes",
  "Zona rasurada previo a sesión",
];

const REACCIONES_TEST = [
  "Sin reacción",
  "Eritema leve",
  "Eritema moderado",
  "Ampollas",
  "Hiperpigmentación",
];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function LaserForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fitzpatrick: "",
    colorVello: "",
    grosor: "",
    maquina: "",
    zona: "",
    fluencia: "",
    anchoPulso: "",
    spotSize: "",
    enfriamiento: "",
    sesionActual: "",
    sesionesTotal: "",
    reacciones: [] as string[],
    intervalo: "6 semanas",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    notas: "",
    checklistPreSesion: [] as string[],
    reduccionPorZona: {} as Record<string, number>,
    testSpotZona: "",
    testSpotParametros: "",
    testSpotReaccion24: "",
    testSpotReaccion48: "",
    testSpotResultado: "",
    testSpotFecha: "",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleChecklist = (val: string) => {
    setForm((f) => ({
      ...f,
      checklistPreSesion: f.checklistPreSesion.includes(val)
        ? f.checklistPreSesion.filter((c) => c !== val)
        : [...f.checklistPreSesion, val],
    }));
  };

  const allChecklistChecked = CHECKLIST_PRE_SESION.every((c) =>
    form.checklistPreSesion.includes(c)
  );

  const toggleReaccion = (val: string) => {
    setForm((f) => {
      if (val === "Ninguna") return { ...f, reacciones: f.reacciones.includes(val) ? [] : ["Ninguna"] };
      const without = f.reacciones.filter((r) => r !== "Ninguna");
      return {
        ...f,
        reacciones: without.includes(val)
          ? without.filter((r) => r !== val)
          : [...without, val],
      };
    });
  };

  async function handleSave() {
    if (!form.zona || !form.maquina) {
      toast.error("Selecciona zona tratada y maquina");
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
            type: "laser_hair_removal",
            fitzpatrick: form.fitzpatrick,
            colorVello: form.colorVello,
            grosor: form.grosor,
            maquina: form.maquina,
            zona: form.zona,
            parametros: {
              fluencia: form.fluencia ? parseFloat(form.fluencia) : undefined,
              anchoPulso: form.anchoPulso ? parseFloat(form.anchoPulso) : undefined,
              spotSize: form.spotSize ? parseFloat(form.spotSize) : undefined,
              enfriamiento: form.enfriamiento,
            },
            sesionActual: form.sesionActual ? parseInt(form.sesionActual) : undefined,
            sesionesTotal: form.sesionesTotal ? parseInt(form.sesionesTotal) : undefined,
            reacciones: form.reacciones,
            intervalo: form.intervalo,
            notas: form.notas,
            checklistPreSesion: form.checklistPreSesion,
            reduccionPorZona: form.reduccionPorZona,
            testSpot: {
              zona: form.testSpotZona,
              parametros: form.testSpotParametros,
              reaccion24: form.testSpotReaccion24,
              reaccion48: form.testSpotReaccion48,
              resultado: form.testSpotResultado,
              fecha: form.testSpotFecha,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Registro de depilacion laser guardado");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Checklist pre-sesión (confirmar con el cliente)">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
            allChecklistChecked
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-800 dark:text-amber-200"
          }`}>
            {allChecklistChecked ? "Apto \u2705" : "\u26A0\uFE0F Revisar contraindicaciones"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CHECKLIST_PRE_SESION.map((item) => (
            <label
              key={item}
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                form.checklistPreSesion.includes(item)
                  ? "bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-300"
                  : "border-border bg-card hover:bg-muted dark:hover:bg-card"
              }`}
            >
              <input
                type="checkbox"
                className="accent-emerald-600"
                checked={form.checklistPreSesion.includes(item)}
                onChange={() => toggleChecklist(item)}
              />
              {item}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title="Evaluacion del paciente">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">Fototipo Fitzpatrick</label>
            <select
              className="input-new"
              value={form.fitzpatrick}
              onChange={(e) => set("fitzpatrick", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {FITZPATRICK.map((f) => (
                <option key={f} value={f}>
                  Tipo {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Color de vello</label>
            <select
              className="input-new"
              value={form.colorVello}
              onChange={(e) => set("colorVello", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {COLORES_VELLO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Grosor</label>
            <select
              className="input-new"
              value={form.grosor}
              onChange={(e) => set("grosor", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {GROSORES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Maquina</label>
            <select
              className="input-new"
              value={form.maquina}
              onChange={(e) => set("maquina", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {MAQUINAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Zona tratada">
        <div className="field-new">
          <label className="field-new__label">Zona</label>
          <select
            className="input-new"
            value={form.zona}
            onChange={(e) => set("zona", e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </CardNew>

      <CardNew title="Parametros del equipo">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="field-new">
            <label className="field-new__label">Fluencia (J/cm²)</label>
            <input
              type="number"
              step="0.1"
              className="input-new"
              placeholder="Ej: 18.5"
              value={form.fluencia}
              onChange={(e) => set("fluencia", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Ancho de pulso (ms)</label>
            <input
              type="number"
              step="0.1"
              className="input-new"
              placeholder="Ej: 30"
              value={form.anchoPulso}
              onChange={(e) => set("anchoPulso", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Spot size (mm)</label>
            <input
              type="number"
              step="0.1"
              className="input-new"
              placeholder="Ej: 12"
              value={form.spotSize}
              onChange={(e) => set("spotSize", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Metodo de enfriamiento</label>
            <select
              className="input-new"
              value={form.enfriamiento}
              onChange={(e) => set("enfriamiento", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {ENFRIAMIENTO.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Progreso de sesiones">
        <div className="grid grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">Numero de sesion</label>
            <input
              type="number"
              min="1"
              className="input-new"
              placeholder="Ej: 3"
              value={form.sesionActual}
              onChange={(e) => set("sesionActual", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Total de sesiones planeadas</label>
            <input
              type="number"
              min="1"
              className="input-new"
              placeholder="Ej: 8"
              value={form.sesionesTotal}
              onChange={(e) => set("sesionesTotal", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Intervalo proxima sesion</label>
            <select
              className="input-new"
              value={form.intervalo}
              onChange={(e) => set("intervalo", e.target.value)}
            >
              {INTERVALOS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
        </div>
        {form.sesionActual && form.sesionesTotal && (
          <p className="text-xs text-muted-foreground mt-2">
            Sesion {form.sesionActual} de {form.sesionesTotal}
          </p>
        )}
      </CardNew>

      {form.zona && (
        <CardNew title="Estimación de reducción acumulada">
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm min-w-[160px] font-medium">{form.zona}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="input-new"
                  style={{ maxWidth: 100 }}
                  placeholder="0-100"
                  value={form.reduccionPorZona[form.zona] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reduccionPorZona: {
                        ...f.reduccionPorZona,
                        [f.zona]: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
                      },
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground">% reducción estimada</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className="h-3 rounded-full transition-all duration-300"
                  style={{
                    width: `${form.reduccionPorZona[form.zona] ?? 0}%`,
                    backgroundColor:
                      (form.reduccionPorZona[form.zona] ?? 0) >= 75
                        ? "#10b981"
                        : (form.reduccionPorZona[form.zona] ?? 0) >= 40
                          ? "#f59e0b"
                          : "#ef4444",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {form.reduccionPorZona[form.zona] ?? 0}% de reducción estimada
              </p>
            </div>
          </div>
        </CardNew>
      )}

      <CardNew title="Reacciones observadas">
        <div className="flex flex-wrap gap-2">
          {REACCIONES.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                form.reacciones.includes(r)
                  ? r === "Ninguna"
                    ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                    : "bg-amber-50 border-amber-400 text-amber-700"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                className={r === "Ninguna" ? "accent-emerald-600" : "accent-amber-600"}
                checked={form.reacciones.includes(r)}
                onChange={() => toggleReaccion(r)}
              />
              {r}
            </label>
          ))}
        </div>
      </CardNew>

      <CardNew title="Test spot (requerido antes de primera sesión)">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="field-new">
            <label className="field-new__label">Zona probada</label>
            <input
              type="text"
              className="input-new"
              placeholder="Ej: Antebrazo interno"
              value={form.testSpotZona}
              onChange={(e) => set("testSpotZona", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Parámetros del test (fluencia, pulso)</label>
            <input
              type="text"
              className="input-new"
              placeholder="Ej: 15 J/cm², 30ms"
              value={form.testSpotParametros}
              onChange={(e) => set("testSpotParametros", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Fecha del test</label>
            <input
              type="date"
              className="input-new"
              value={form.testSpotFecha}
              onChange={(e) => set("testSpotFecha", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Reacción a 24h</label>
            <select
              className="input-new"
              value={form.testSpotReaccion24}
              onChange={(e) => set("testSpotReaccion24", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {REACCIONES_TEST.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Reacción a 48h</label>
            <select
              className="input-new"
              value={form.testSpotReaccion48}
              onChange={(e) => set("testSpotReaccion48", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {REACCIONES_TEST.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Resultado</label>
            <select
              className="input-new"
              value={form.testSpotResultado}
              onChange={(e) => set("testSpotResultado", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="Apto para tratamiento">Apto para tratamiento</option>
              <option value="Reducir parámetros">Reducir parámetros</option>
              <option value="No apto">No apto</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="SOAP">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            { key: "subjective", label: "Subjetivo", ph: "Sensibilidad, historial…" },
            { key: "objective", label: "Objetivo", ph: "Observaciones de la piel…" },
            { key: "assessment", label: "Evaluacion", ph: "Respuesta al tratamiento…" },
            { key: "plan", label: "Plan", ph: "Ajustes, proxima sesion…" },
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

      <CardNew title="Notas adicionales">
        <div className="field-new">
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
