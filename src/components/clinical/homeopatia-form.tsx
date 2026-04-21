"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Repertorization } from "@/components/clinical/homeopatia/repertorization";

interface Props { patientId: string; onSaved: (record: any) => void }

export function HomeopatiaForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    subjective: "",
    biotipo: "",
    temperamento: "",
    miasma: "",
    modalities: { better: "", worse: "", desires: "", aversions: "" },
    remedy: { name: "", potency: "30CH", dosage: "" },
    follow: { notes: "", weeks: "" },
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setMod = (k: string, v: string) => setForm(f => ({ ...f, modalities: { ...f.modalities, [k]: v } }));
  const setRemedy = (k: string, v: string) => setForm(f => ({ ...f, remedy: { ...f.remedy, [k]: v } }));
  const setFollow = (k: string, v: string) => setForm(f => ({ ...f, follow: { ...f.follow, [k]: v } }));

  const constitutional = [form.biotipo, form.temperamento].filter(Boolean).join(" · ");

  function handleRemedySelect(remedy: { name: string; potency: string; score: number; rationale: string }) {
    setForm(f => ({
      ...f,
      remedy: { ...f.remedy, name: remedy.name, potency: remedy.potency || f.remedy.potency },
    }));
    toast.success(`Remedio cargado: ${remedy.name}`);
  }

  async function handleSave() {
    if (!form.subjective && !form.remedy.name) {
      toast.error("Agrega motivo de consulta o remedio");
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
          assessment: [form.biotipo, form.temperamento, form.miasma].filter(Boolean).join(" · "),
          plan: form.follow.notes,
          specialtyData: {
            type: "homeopatia",
            constitutional: {
              biotipo: form.biotipo,
              temperamento: form.temperamento,
              miasma: form.miasma,
            },
            modalities: form.modalities,
            remedy: form.remedy,
            followUp: form.follow,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success("Consulta de homeopatía guardada");
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
          placeholder="Síntomas principales, tiempo de evolución…"
          value={form.subjective}
          onChange={e => set("subjective", e.target.value)}
        />
      </CardNew>

      <CardNew title="Datos constitucionales">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Biotipo</label>
            <select className="input-new" value={form.biotipo} onChange={e => set("biotipo", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Carbónico">Carbónico</option>
              <option value="Fosfórico">Fosfórico</option>
              <option value="Fluórico">Fluórico</option>
              <option value="Sulfúrico">Sulfúrico</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Temperamento</label>
            <select className="input-new" value={form.temperamento} onChange={e => set("temperamento", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Sanguíneo">Sanguíneo</option>
              <option value="Flemático">Flemático</option>
              <option value="Colérico">Colérico</option>
              <option value="Melancólico">Melancólico</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Miasma</label>
            <select className="input-new" value={form.miasma} onChange={e => set("miasma", e.target.value)}>
              <option value="">Seleccionar…</option>
              <option value="Psórico">Psórico</option>
              <option value="Sicótico">Sicótico</option>
              <option value="Sifilítico">Sifilítico</option>
              <option value="Tuberculínico">Tuberculínico</option>
            </select>
          </div>
        </div>
      </CardNew>

      <CardNew title="Modalidades">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Mejor con</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Calor, reposo, presión…"
              value={form.modalities.better}
              onChange={e => setMod("better", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Peor con</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Frío, movimiento, noche…"
              value={form.modalities.worse}
              onChange={e => setMod("worse", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Deseos</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Dulces, sal, bebidas frías…"
              value={form.modalities.desires}
              onChange={e => setMod("desires", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Aversiones</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Grasas, leche, carne…"
              value={form.modalities.aversions}
              onChange={e => setMod("aversions", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Repertorización">
        <Repertorization constitutional={constitutional || undefined} onRemedySelect={handleRemedySelect} />
      </CardNew>

      <CardNew title="Remedio elegido">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Nombre</label>
            <input
              className="input-new"
              placeholder="Sulphur, Lycopodium, Natrum muriaticum…"
              value={form.remedy.name}
              onChange={e => setRemedy("name", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Potencia</label>
            <select className="input-new" value={form.remedy.potency} onChange={e => setRemedy("potency", e.target.value)}>
              <option value="6CH">6CH</option>
              <option value="30CH">30CH</option>
              <option value="200CH">200CH</option>
              <option value="1M">1M</option>
              <option value="10M">10M</option>
              <option value="50M">50M</option>
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">Dosificación</label>
            <input
              className="input-new"
              placeholder="5 glóbulos sublinguales cada 8h…"
              value={form.remedy.dosage}
              onChange={e => setRemedy("dosage", e.target.value)}
            />
          </div>
        </div>
      </CardNew>

      <CardNew title="Plan de seguimiento">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px 14px" }}>
          <div className="field-new">
            <label className="field-new__label">Notas de seguimiento</label>
            <textarea
              className="input-new"
              style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
              placeholder="Evaluar respuesta, síntomas nuevos, agravación inicial…"
              value={form.follow.notes}
              onChange={e => setFollow("notes", e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Próxima cita (semanas)</label>
            <input type="number" min="1" className="input-new mono" placeholder="4" value={form.follow.weeks} onChange={e => setFollow("weeks", e.target.value)} />
          </div>
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
