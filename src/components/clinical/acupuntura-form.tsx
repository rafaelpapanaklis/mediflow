"use client";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { MeridianMap } from "@/components/clinical/acupuntura/meridian-map";
import { EvolutionChart } from "@/components/clinical/shared";

interface Props { patientId: string; onSaved: (record: any) => void }

interface PointNote { id: string; notes: string }

export function AcupunturaForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    subjective: "",
    syndrome: "",
    element: "",
    organ: "",
    sessions: { total: "", frequency: "", notes: "" },
  });

  const [usedPoints, setUsedPoints] = useState<string[]>([]);
  const [pointNotes, setPointNotes] = useState<PointNote[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/clinical?patientId=${patientId}`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [patientId]);

  const severityData = useMemo(
    () =>
      history
        .filter(r => r?.specialtyData?.severity !== undefined && r?.specialtyData?.severity !== null && r?.specialtyData?.type === "acupuntura")
        .map(r => ({
          date: new Date(r.visitDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
          value: Number(r.specialtyData.severity),
        }))
        .reverse(),
    [history]
  );

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setSess = (k: string, v: string) => setForm(f => ({ ...f, sessions: { ...f.sessions, [k]: v } }));

  function togglePoint(id: string) {
    setUsedPoints(prev => {
      if (prev.includes(id)) {
        setPointNotes(n => n.filter(p => p.id !== id));
        return prev.filter(p => p !== id);
      }
      setPointNotes(n => [...n, { id, notes: "" }]);
      return [...prev, id];
    });
  }

  function updatePointNote(id: string, notes: string) {
    setPointNotes(n => n.map(p => (p.id === id ? { ...p, notes } : p)));
  }

  async function handleSave() {
    if (!form.subjective && usedPoints.length === 0) {
      toast.error("Agrega motivo o al menos un punto");
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
          assessment: `${form.syndrome}${form.element ? ` · ${form.element}` : ""}${form.organ ? ` · ${form.organ}` : ""}`,
          plan: form.sessions.notes,
          specialtyData: {
            type: "acupuntura",
            mtcDiagnosis: {
              syndrome: form.syndrome,
              element: form.element,
              organ: form.organ,
            },
            usedPoints,
            pointNotes,
            sessions: form.sessions,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success("Consulta de acupuntura guardada");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CardNew title="Motivo de consulta">
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="Dolor lumbar crónico, insomnio, ansiedad…"
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title="Diagnóstico MTC">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Síndrome</label>
            <select className="input-new" value={form.syndrome} onChange={e => set("syndrome", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Vacío">Vacío</option>
              <option value="Plenitud">Plenitud</option>
              <option value="Vacío + Plenitud">Vacío + Plenitud</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Elemento</label>
            <select className="input-new" value={form.element} onChange={e => set("element", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Madera">Madera</option>
              <option value="Fuego">Fuego</option>
              <option value="Tierra">Tierra</option>
              <option value="Metal">Metal</option>
              <option value="Agua">Agua</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Víscera afectada</label>
            <select className="input-new" value={form.organ} onChange={e => set("organ", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Hígado/VB">Hígado / Vesícula biliar</option>
              <option value="Corazón/ID">Corazón / Intestino delgado</option>
              <option value="Bazo/Estómago">Bazo / Estómago</option>
              <option value="Pulmón/IG">Pulmón / Intestino grueso</option>
              <option value="Riñón/Vejiga">Riñón / Vejiga</option>
              <option value="Pericardio/TR">Pericardio / Triple recalentador</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Mapa de meridianos" sub="Haz clic en los puntos para seleccionarlos">
        <MeridianMap editable usedPointIds={usedPoints} onPointToggle={togglePoint} />
      </CardNew>

      <CardNew title="Puntos usados hoy">
        {pointNotes.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
            Selecciona puntos en el mapa para agregar notas de técnica y tiempo.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pointNotes.map(p => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "flex-start" }}>
                <div style={{ padding: "8px 10px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8 }}>
                  <span className="mono" style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600 }}>{p.id}</span>
                </div>
                <textarea
                  className="input-new"
                  style={{ minHeight: 52, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder="Técnica (tonificación/dispersión), tiempo (20 min), moxa…"
                  value={p.notes}
                  onChange={e => updatePointNote(p.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </CardNew>

      <CardNew title="Evolución de síntomas" sub="Severidad 0-10 en consultas anteriores">
        {severityData.length < 2 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", padding: 12 }}>
            Agrega 2+ consultas con severidad registrada para ver evolución
          </div>
        ) : (
          <EvolutionChart data={severityData} metric="Severidad síntomas" color="#fbbf24" />
        )}
      </CardNew>

      <CardNew title="Plan de sesiones">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
          <div className="field-new">
            <label className="field-new__label">Número de sesiones</label>
            <input type="number" min="1" className="input-new mono" placeholder="10" value={form.sessions.total} onChange={e => setSess("total", e.target.value)} />
          </div>
          <div className="field-new">
            <label className="field-new__label">Frecuencia</label>
            <select className="input-new" value={form.sessions.frequency} onChange={e => setSess("frequency", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Semanal">Semanal</option>
              <option value="2x/semana">2x / semana</option>
              <option value="Quincenal">Quincenal</option>
              <option value="Mensual">Mensual</option>
            </select>
          </div>
        </div>
        <div className="field-new">
          <label className="field-new__label">Notas</label>
          <textarea
            className="input-new"
            style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
            placeholder="Evaluar respuesta tras 5ª sesión…"
            value={form.sessions.notes}
            onChange={e => setSess("notes", e.target.value)}
          />
        </div>
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta"}
        </ButtonNew>
      </div>
    </div>
  );
}
