"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";

const TECHNIQUES = ["FUE", "FUT", "PRP capilar", "micropigmentación", "LLLT"] as const;
const NORWOOD = ["Norwood I", "Norwood II", "Norwood III", "Norwood III Vertex", "Norwood IV", "Norwood V", "Norwood VI", "Norwood VII"] as const;
const LUDWIG = ["Ludwig I", "Ludwig II", "Ludwig III"] as const;
const TREATED_ZONES = ["frontal", "temporal", "vertex", "occipital", "línea capilar"] as const;
const FOLLOWUP_MONTHS = ["3", "6", "12"] as const;
const DENSITY_ZONES = ["Frontal", "Temporal", "Vertex", "Occipital (donante)"] as const;
const TIMELINE_MILESTONES = ["1 mes", "3 meses", "6 meses", "9 meses", "12 meses"] as const;
const SURVIVAL_ZONES = ["Frontal", "Temporal", "Vertex", "Línea de implantación"] as const;

interface Props { patientId: string; onSaved: (record: any) => void }

export function HairRestorationForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    clasificacion: "",
    tecnica: "",
    densidadDonante: "",
    graftsCosechados: "",
    graftsImplantados: "",
    zonas: [] as string[],
    disenoLinea: "",
    seguimientoMeses: "",
    supervivencia: "",
    notasQuirurgicas: "",
    densidadZonas: Object.fromEntries(DENSITY_ZONES.map(z => [z, { antes: "", despues: "" }])) as Record<string, { antes: string; despues: string }>,
    timelineMilestones: {} as Record<string, { checked: boolean; observaciones: string }>,
    supervivenciaInjertos: Object.fromEntries(SURVIVAL_ZONES.map(z => [z, { implantados: "", supervivencia: "" }])) as Record<string, { implantados: string; supervivencia: string }>,
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  function toggleZona(z: string) {
    setForm(f => ({ ...f, zonas: f.zonas.includes(z) ? f.zonas.filter(x => x !== z) : [...f.zonas, z] }));
  }

  async function handleSave() {
    if (!form.subjective && !form.assessment) { toast.error("Agrega al menos el motivo de consulta o diagnóstico"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective, objective: form.objective,
          assessment: form.assessment, plan: form.plan,
          specialtyData: {
            type: "hair_restoration",
            clasificacion: form.clasificacion, tecnica: form.tecnica,
            densidadDonante: form.densidadDonante,
            graftsCosechados: form.graftsCosechados, graftsImplantados: form.graftsImplantados,
            zonas: form.zonas, disenoLinea: form.disenoLinea,
            seguimientoMeses: form.seguimientoMeses, supervivencia: form.supervivencia,
            notasQuirurgicas: form.notasQuirurgicas,
            densidadZonas: form.densidadZonas,
            timelineMilestones: form.timelineMilestones,
            supervivenciaInjertos: form.supervivenciaInjertos,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      toast.success("Expediente capilar guardado");
    } catch (err: any) { toast.error(err.message ?? "Error al guardar"); } finally { setSaving(false); }
  }

  // Tag button estilo toggle
  const tagButtonStyle = (isActive: boolean): React.CSSProperties => ({
    cursor: "pointer",
    background: isActive ? "var(--brand-soft)" : "rgba(255,255,255,0.04)",
    color: isActive ? "#c4b5fd" : "var(--text-2)",
    borderColor: isActive ? "rgba(124,58,237,0.3)" : "var(--border-soft)",
    textTransform: "capitalize",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Motivo + exploración */}
      <CardNew title="Motivo de consulta y exploración">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Motivo de consulta / HEA</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="¿Por qué viene el paciente hoy?"
              value={form.subjective}
              onChange={e => set("subjective", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Exploración física / Observaciones</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Estado del cuero cabelludo, densidad visual…"
              value={form.objective}
              onChange={e => set("objective", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Clasificación & técnica */}
      <CardNew title="Clasificación y técnica">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Clasificación</label>
            <select className="input-new" value={form.clasificacion} onChange={e => set("clasificacion", e.target.value)}>
              <option value="">Seleccionar…</option>
              <optgroup label="Hombres (Norwood)">
                {NORWOOD.map(n => <option key={n} value={n}>{n}</option>)}
              </optgroup>
              <optgroup label="Mujeres (Ludwig)">
                {LUDWIG.map(l => <option key={l} value={l}>{l}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Técnica</label>
            <select className="input-new" value={form.tecnica} onChange={e => set("tecnica", e.target.value)}>
              <option value="">Seleccionar…</option>
              {TECHNIQUES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </CardNew>

      {/* Densidad baseline por zona */}
      <CardNew title="Densidad folicular por zona" sub="Folículos/cm²">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {DENSITY_ZONES.map(zone => {
            const antes = Number(form.densidadZonas[zone]?.antes) || 0;
            const despues = Number(form.densidadZonas[zone]?.despues) || 0;
            const pctChange = antes > 0 ? (((despues - antes) / antes) * 100).toFixed(1) : null;
            return (
              <div
                key={zone}
                style={{
                  padding: 10,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{zone}</span>
                <div className="field-new">
                  <label className="field-new__label">Antes</label>
                  <input
                    type="number" min={0}
                    className="input-new mono"
                    style={{ height: 28 }}
                    placeholder="0"
                    value={form.densidadZonas[zone]?.antes ?? ""}
                    onChange={e => setForm(f => ({ ...f, densidadZonas: { ...f.densidadZonas, [zone]: { ...f.densidadZonas[zone], antes: e.target.value } } }))}
                  />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Después</label>
                  <input
                    type="number" min={0}
                    className="input-new mono"
                    style={{ height: 28 }}
                    placeholder="0"
                    value={form.densidadZonas[zone]?.despues ?? ""}
                    onChange={e => setForm(f => ({ ...f, densidadZonas: { ...f.densidadZonas, [zone]: { ...f.densidadZonas[zone], despues: e.target.value } } }))}
                  />
                </div>
                {pctChange !== null && (
                  <span className="mono" style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: Number(pctChange) >= 0 ? "var(--success)" : "var(--danger)",
                  }}>
                    {Number(pctChange) >= 0 ? "+" : ""}{pctChange}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardNew>

      {/* Datos del procedimiento */}
      <CardNew title="Datos del procedimiento">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Densidad zona donante (folículos/cm²)</label>
            <input
              type="number"
              className="input-new mono"
              placeholder="80"
              value={form.densidadDonante}
              onChange={e => set("densidadDonante", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Grafts cosechados</label>
            <input
              type="number"
              className="input-new mono"
              placeholder="2500"
              value={form.graftsCosechados}
              onChange={e => set("graftsCosechados", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Grafts implantados</label>
            <input
              type="number"
              className="input-new mono"
              placeholder="2400"
              value={form.graftsImplantados}
              onChange={e => set("graftsImplantados", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Zonas tratadas */}
      <CardNew title="Zonas tratadas">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TREATED_ZONES.map(z => (
            <button
              key={z}
              type="button"
              className="tag-new"
              style={tagButtonStyle(form.zonas.includes(z))}
              onClick={() => toggleZona(z)}
            >
              {form.zonas.includes(z) && "✓ "}{z}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Diseño línea capilar */}
      <CardNew title="Diseño de línea capilar">
        <textarea
          className="input-new"
          style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
          placeholder="Descripción del diseño de la línea capilar…"
          value={form.disenoLinea}
          onChange={e => set("disenoLinea", e.target.value)}
        />
      </CardNew>

      {/* Seguimiento */}
      <CardNew title="Seguimiento">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Seguimiento (meses)</label>
            <select
              className="input-new"
              value={form.seguimientoMeses}
              onChange={e => set("seguimientoMeses", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {FOLLOWUP_MONTHS.map(m => <option key={m} value={m}>{m} meses</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">% supervivencia grafts</label>
            <input
              type="number"
              className="input-new mono"
              placeholder="92"
              value={form.supervivencia}
              onChange={e => set("supervivencia", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Timeline de evolución */}
      <CardNew title="Timeline de evolución post-procedimiento" sub="Las fotos comparativas se registran en Antes/Después">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {TIMELINE_MILESTONES.map(milestone => {
            const entry = form.timelineMilestones[milestone];
            const isChecked = entry?.checked ?? false;
            return (
              <div key={milestone}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => setForm(f => ({
                      ...f,
                      timelineMilestones: {
                        ...f.timelineMilestones,
                        [milestone]: { checked: !isChecked, observaciones: entry?.observaciones ?? "" },
                      },
                    }))}
                  />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)" }}>{milestone}</span>
                </label>
                {isChecked && (
                  <textarea
                    className="input-new"
                    style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical", marginLeft: 24, marginTop: 6, width: "calc(100% - 24px)" }}
                    placeholder={`Observaciones a los ${milestone}…`}
                    value={entry?.observaciones ?? ""}
                    onChange={e => setForm(f => ({
                      ...f,
                      timelineMilestones: {
                        ...f.timelineMilestones,
                        [milestone]: { ...f.timelineMilestones[milestone], checked: true, observaciones: e.target.value },
                      },
                    }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardNew>

      {/* Diagnóstico & plan */}
      <CardNew title="Diagnóstico y plan">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Diagnóstico / Evaluación</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Diagnóstico, hallazgos clínicos…"
              value={form.assessment}
              onChange={e => set("assessment", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Plan de tratamiento</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Plan de tratamiento futuro…"
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">Notas quirúrgicas</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Detalles del procedimiento quirúrgico, complicaciones…"
              value={form.notasQuirurgicas}
              onChange={e => set("notasQuirurgicas", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      {/* Supervivencia de injertos */}
      <CardNew title="Supervivencia de injertos" sub="Por zona anatómica">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {SURVIVAL_ZONES.map(zone => (
            <div
              key={zone}
              style={{
                padding: 10,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>{zone}</span>
              <div className="field-new">
                <label className="field-new__label">Implantados</label>
                <input
                  type="number" min={0}
                  className="input-new mono"
                  style={{ height: 28 }}
                  placeholder="0"
                  value={form.supervivenciaInjertos[zone]?.implantados ?? ""}
                  onChange={e => setForm(f => ({ ...f, supervivenciaInjertos: { ...f.supervivenciaInjertos, [zone]: { ...f.supervivenciaInjertos[zone], implantados: e.target.value } } }))}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Supervivencia %</label>
                <input
                  type="number" min={0} max={100}
                  className="input-new mono"
                  style={{ height: 28 }}
                  placeholder="0"
                  value={form.supervivenciaInjertos[zone]?.supervivencia ?? ""}
                  onChange={e => setForm(f => ({ ...f, supervivenciaInjertos: { ...f.supervivenciaInjertos, [zone]: { ...f.supervivenciaInjertos[zone], supervivencia: e.target.value } } }))}
                />
              </div>
            </div>
          ))}
        </div>
        {(() => {
          const entries = Object.values(form.supervivenciaInjertos);
          const totalInjertos = entries.reduce((sum, e) => sum + (Number(e.implantados) || 0), 0);
          const weightedSum = entries.reduce((sum, e) => sum + (Number(e.implantados) || 0) * (Number(e.supervivencia) || 0), 0);
          const avgSurvival = totalInjertos > 0 ? (weightedSum / totalInjertos).toFixed(1) : null;
          return totalInjertos > 0 ? (
            <div style={{
              marginTop: 14,
              padding: 12,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 10,
              display: "flex",
              gap: 20,
              fontSize: 12,
              color: "var(--text-2)",
            }}>
              <span>Total injertos: <strong className="mono" style={{ color: "var(--text-1)" }}>{totalInjertos}</strong></span>
              <span>Supervivencia promedio ponderada: <strong className="mono" style={{ color: "var(--text-1)" }}>{avgSurvival}%</strong></span>
            </div>
          ) : null;
        })()}
      </CardNew>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar expediente capilar"}
        </ButtonNew>
      </div>
    </div>
  );
}
