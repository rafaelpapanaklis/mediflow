"use client";
import { useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
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

const DEDOS = ["Pulgar", "Índice", "Medio", "Anular", "Meñique"] as const;
const CONDICIONES_UNA = ["Sana", "Hongos", "Estriada", "Manchada", "Frágil/Quebradiza", "Onicólisis", "Encarnada", "Engrosada"] as const;
const TIPOS_SERVICIO_PREF = ["Manicure clásico", "Gel", "Acrílico", "Dip powder", "Nail art", "Natural"] as const;
const LARGOS = ["Muy corto (natural)", "Corto", "Medio", "Largo", "Extra largo"] as const;
const TIPOS_REACCION = ["Enrojecimiento", "Descamación", "Ampollas", "Dolor", "Hinchazón", "Reacción alérgica"] as const;
const SEVERIDADES = ["Leve", "Moderada", "Severa"] as const;

interface AlergiaEntry {
  producto: string;
  tipoReaccion: string;
  severidad: string;
  fecha: string;
}

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

  // Nail health evaluation state
  const createFingerMap = () => Object.fromEntries(DEDOS.map(d => [d, ""]));
  const [manoIzq, setManoIzq] = useState<Record<string, string>>(createFingerMap());
  const [manoDer, setManoDer] = useState<Record<string, string>>(createFingerMap());
  const [pieIzq, setPieIzq] = useState<Record<string, string>>(createFingerMap());
  const [pieDer, setPieDer] = useState<Record<string, string>>(createFingerMap());
  const [resumenSaludUngueal, setResumenSaludUngueal] = useState("");

  // Preferences state
  const [colorRecurrente, setColorRecurrente] = useState("");
  const [tipoServicioPref, setTipoServicioPref] = useState("");
  const [marcaFavorita, setMarcaFavorita] = useState("");
  const [largoPreferido, setLargoPreferido] = useState("");
  const [notasEstilo, setNotasEstilo] = useState("");

  // Allergies state
  const [alergias, setAlergias] = useState<AlergiaEntry[]>([]);
  const [alergiaMetacrilato, setAlergiaMetacrilato] = useState(false);

  function addAlergia() {
    setAlergias(prev => [...prev, { producto: "", tipoReaccion: "", severidad: "", fecha: "" }]);
  }
  function removeAlergia(idx: number) {
    setAlergias(prev => prev.filter((_, i) => i !== idx));
  }
  function updateAlergia(idx: number, field: keyof AlergiaEntry, value: string) {
    setAlergias(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
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
            type: "nail_salon",
            servicio: form.servicio,
            manoPie: form.manoPie,
            formaPreferida: form.formaPreferida,
            materialProducto: form.materialProducto,
            colorDiseno: form.colorDiseno,
            condicionUnas: form.condicionUnas,
            tecnicoAsignado: form.tecnicoAsignado,
            notas: form.notas,
            saludUngueal: { manoIzq, manoDer, pieIzq, pieDer, resumen: resumenSaludUngueal },
            preferencias: { colorRecurrente, tipoServicioPref, marcaFavorita, largoPreferido, notasEstilo, formaFavorita: form.formaPreferida },
            alergias: { lista: alergias, alergiaMetacrilato },
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
    <form onSubmit={e => { e.preventDefault(); handleSave(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="SOAP inicial">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Motivo de visita</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="¿Qué servicio busca el cliente?"
              value={form.subjective}
              onChange={(e) => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Observaciones previas</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Estado previo de las uñas, historial…"
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Servicio">
        <div className="grid grid-cols-3 gap-4">
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
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Mano/pie</label>
            <select
              className="input-new"
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
          <div className="field-new">
            <label className="field-new__label">Forma preferida</label>
            <select
              className="input-new"
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
      </CardNew>

      <CardNew title="Detalles del servicio">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Material/producto usado</label>
            <input
              className="input-new"
              placeholder="Ej. Gel UV, Acrílico Mia Secret…"
              value={form.materialProducto}
              onChange={(e) => set("materialProducto", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Color/diseño aplicado</label>
            <input
              className="input-new"
              placeholder="Ej. Rojo cereza #45, french tips…"
              value={form.colorDiseno}
              onChange={(e) => set("colorDiseno", e.target.value)}
            />
          </div>
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">Condición de uñas</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Observaciones: hongos, fragilidad, manchas, estrías, daño previo…"
            value={form.condicionUnas}
            onChange={(e) => set("condicionUnas", e.target.value)}
          />
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">Técnico asignado</label>
          <input
            className="input-new"
            placeholder="Nombre del técnico"
            value={form.tecnicoAsignado}
            onChange={(e) => set("tecnicoAsignado", e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Evaluación de salud ungueal">
        {/* Manos */}
        <p className="text-xs font-semibold mb-2">Manos</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {([["Mano izquierda", manoIzq, setManoIzq], ["Mano derecha", manoDer, setManoDer]] as const).map(([label, state, setter]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <div className="space-y-1">
                {DEDOS.map(dedo => (
                  <div key={dedo} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{dedo}</span>
                    <select
                      className="input-new"
                      value={(state as Record<string, string>)[dedo]}
                      onChange={e => (setter as React.Dispatch<React.SetStateAction<Record<string, string>>>)(prev => ({ ...prev, [dedo]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {CONDICIONES_UNA.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pies */}
        <p className="text-xs font-semibold mb-2">Pies</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {([["Pie izquierdo", pieIzq, setPieIzq], ["Pie derecho", pieDer, setPieDer]] as const).map(([label, state, setter]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <div className="space-y-1">
                {DEDOS.map(dedo => (
                  <div key={dedo} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0">{dedo}</span>
                    <select
                      className="input-new"
                      value={(state as Record<string, string>)[dedo]}
                      onChange={e => (setter as React.Dispatch<React.SetStateAction<Record<string, string>>>)(prev => ({ ...prev, [dedo]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {CONDICIONES_UNA.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="field-new">
          <label className="field-new__label">Resumen general de salud ungueal</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Resumen general del estado de las uñas…"
            value={resumenSaludUngueal}
            onChange={e => setResumenSaludUngueal(e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Preferencias de la clienta">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="field-new">
            <label className="field-new__label">Forma favorita</label>
            <input
              className="input-new"
              value={form.formaPreferida ? form.formaPreferida.charAt(0).toUpperCase() + form.formaPreferida.slice(1) : "Sin seleccionar"}
              readOnly
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Color recurrente</label>
            <div className="flex gap-2">
              <input
                className="input-new"
                placeholder="Ej. Rojo cereza, Rosa pastel…"
                value={colorRecurrente}
                onChange={e => setColorRecurrente(e.target.value)}
              />
              {colorRecurrente && (
                <div className="h-10 w-10 rounded-lg border border-border shrink-0" style={{ backgroundColor: colorRecurrente.toLowerCase().includes("roj") ? "#DC2626" : colorRecurrente.toLowerCase().includes("rosa") ? "#F9A8D4" : colorRecurrente.toLowerCase().includes("azul") ? "#3B82F6" : colorRecurrente.toLowerCase().includes("negro") ? "#000" : colorRecurrente.toLowerCase().includes("blanc") ? "#FFF" : colorRecurrente.toLowerCase().includes("morad") ? "#8B5CF6" : "#D1D5DB" }} />
              )}
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">Tipo de servicio preferido</label>
            <select
              className="input-new"
              value={tipoServicioPref}
              onChange={e => setTipoServicioPref(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {TIPOS_SERVICIO_PREF.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Marca de esmalte favorita</label>
            <input
              className="input-new"
              placeholder="Ej. OPI, Essie, Gelish…"
              value={marcaFavorita}
              onChange={e => setMarcaFavorita(e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Largo preferido</label>
            <select
              className="input-new"
              value={largoPreferido}
              onChange={e => setLargoPreferido(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {LARGOS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="field-new mt-4">
          <label className="field-new__label">Notas de estilo</label>
          <textarea
            className="input-new"
            style={{ minHeight: 80, resize: "vertical" }}
            placeholder="Preferencias de diseño, inspiraciones, estilos favoritos…"
            value={notasEstilo}
            onChange={e => setNotasEstilo(e.target.value)}
          />
        </div>
      </CardNew>

      <CardNew title="Alergias y reacciones">
        <label className={`flex items-center gap-2 mb-4 p-2 rounded-lg cursor-pointer ${alergiaMetacrilato ? "bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700" : "bg-muted border border-border"}`}>
          <input type="checkbox" checked={alergiaMetacrilato} onChange={e => setAlergiaMetacrilato(e.target.checked)} className="w-4 h-4 accent-red-600" />
          <span className={`text-sm font-medium ${alergiaMetacrilato ? "text-red-700 dark:text-red-400" : ""}`}>Alergia confirmada al metacrilato</span>
        </label>

        {alergias.map((a, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 mb-2 items-end">
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">Producto/Material</label>}
              <input
                className="input-new"
                placeholder="Producto…"
                value={a.producto}
                onChange={e => updateAlergia(idx, "producto", e.target.value)}
              />
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">Tipo de reacción</label>}
              <select
                className="input-new"
                value={a.tipoReaccion}
                onChange={e => updateAlergia(idx, "tipoReaccion", e.target.value)}
              >
                <option value="">Tipo…</option>
                {TIPOS_REACCION.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">Severidad</label>}
              <select
                className="input-new"
                value={a.severidad}
                onChange={e => updateAlergia(idx, "severidad", e.target.value)}
              >
                <option value="">—</option>
                {SEVERIDADES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field-new">
              {idx === 0 && <label className="field-new__label">Fecha</label>}
              <input
                type="date"
                className="input-new"
                value={a.fecha}
                onChange={e => updateAlergia(idx, "fecha", e.target.value)}
              />
            </div>
            <button type="button" onClick={() => removeAlergia(idx)} className="h-9 w-9 flex items-center justify-center rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-lg">×</button>
          </div>
        ))}
        <ButtonNew variant="secondary" type="button" onClick={addAlergia}>
          + Agregar alergia/reacción
        </ButtonNew>
      </CardNew>

      <CardNew title="Resultado y notas">
        <div className="grid grid-cols-2 gap-4">
          <div className="field-new">
            <label className="field-new__label">Resultado / Evaluación</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Resultado del servicio, observaciones finales…"
              value={form.assessment}
              onChange={(e) => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Notas</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, resize: "vertical" }}
              placeholder="Preferencias del cliente, alergias, próxima cita…"
              value={form.notas}
              onChange={(e) => set("notas", e.target.value)}
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
