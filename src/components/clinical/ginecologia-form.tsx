"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { PrenatalTracker } from "@/components/clinical/ginecologia/prenatal-tracker";

interface Props { patientId: string; patient?: any; onSaved: (record: any) => void }

type Mode = "normal" | "prenatal";

interface Ultrasound { date: string; findings: string }

const TRIMESTER_LABS: { id: string; label: string; trimester: 1 | 2 | 3 }[] = [
  { id: "bhcg", label: "β-hCG cuantitativa", trimester: 1 },
  { id: "grupoRh", label: "Grupo sanguíneo y Rh", trimester: 1 },
  { id: "bhT1", label: "Biometría hemática", trimester: 1 },
  { id: "egoT1", label: "EGO + urocultivo", trimester: 1 },
  { id: "vih", label: "VIH / VDRL / HBsAg", trimester: 1 },
  { id: "glucosa", label: "Glucemia en ayuno", trimester: 1 },
  { id: "ctog", label: "CTOG 75g (24-28 sem)", trimester: 2 },
  { id: "bhT2", label: "Biometría hemática T2", trimester: 2 },
  { id: "egoT2", label: "EGO T2", trimester: 2 },
  { id: "bhT3", label: "Biometría hemática T3", trimester: 3 },
  { id: "sgb", label: "Cultivo estreptococo grupo B", trimester: 3 },
  { id: "egoT3", label: "EGO T3", trimester: 3 },
];

export function GinecologiaForm({ patientId, patient, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("normal");

  const [form, setForm] = useState({
    subjective: "",
    history: {
      menarca: "",
      ivsa: "",
      gesta: "",
      para: "",
      aborto: "",
      cesarea: "",
      fur: "",
      method: "",
    },
    exam: { breasts: "", pelvic: "", cytology: "" },
    plan: "",
    fum: "",
    prenatal: { weight: "", bp: "", fundalHeight: "", fhr: "", movements: "" },
  });

  const [ultrasounds, setUltrasounds] = useState<Ultrasound[]>([]);
  const [labs, setLabs] = useState<Record<string, boolean>>({});

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const setH = (k: string, v: string) => setForm(f => ({ ...f, history: { ...f.history, [k]: v } }));
  const setE = (k: string, v: string) => setForm(f => ({ ...f, exam: { ...f.exam, [k]: v } }));
  const setP = (k: string, v: string) => setForm(f => ({ ...f, prenatal: { ...f.prenatal, [k]: v } }));

  const addUS = () => setUltrasounds(us => [...us, { date: "", findings: "" }]);
  const removeUS = (i: number) => setUltrasounds(us => us.filter((_, j) => j !== i));
  const updateUS = (i: number, k: keyof Ultrasound, v: string) =>
    setUltrasounds(us => us.map((u, j) => (j === i ? { ...u, [k]: v } : u)));

  const toggleLab = (id: string) => setLabs(l => ({ ...l, [id]: !l[id] }));

  async function handleSave() {
    if (!form.subjective && !form.plan && mode === "normal") {
      toast.error("Agrega motivo de consulta o plan");
      return;
    }
    if (mode === "prenatal" && !form.fum) {
      toast.error("Captura la FUM");
      return;
    }
    setSaving(true);
    try {
      const specialtyData: any = {
        type: "ginecologia",
        mode,
      };
      if (mode === "normal") {
        specialtyData.history = form.history;
        specialtyData.exam = form.exam;
      } else {
        specialtyData.fum = form.fum;
        specialtyData.prenatal = form.prenatal;
        specialtyData.ultrasounds = ultrasounds.filter(u => u.date || u.findings);
        specialtyData.labs = Object.entries(labs).filter(([, v]) => v).map(([k]) => k);
      }

      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          assessment: "",
          plan: form.plan,
          specialtyData,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const saved = await res.json();
      onSaved(saved);
      toast.success(mode === "prenatal" ? "Control prenatal guardado" : "Consulta ginecológica guardada");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  const prenatalMeasurements = ultrasounds
    .filter(u => u.date && u.findings)
    .map(u => ({ weeks: 0, fundal: 0 }))
    .filter(m => m.weeks > 0);

  const fundalHeightNum = parseFloat(form.prenatal.fundalHeight) || undefined;
  const weightNum = parseFloat(form.prenatal.weight) || undefined;
  const fhrNum = parseFloat(form.prenatal.fhr) || undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="segment-new">
        <button
          type="button"
          className={`segment-new__btn ${mode === "normal" ? "segment-new__btn--active" : ""}`}
          onClick={() => setMode("normal")}
        >
          Consulta normal
        </button>
        <button
          type="button"
          className={`segment-new__btn ${mode === "prenatal" ? "segment-new__btn--active" : ""}`}
          onClick={() => setMode("prenatal")}
        >
          Prenatal
        </button>
      </div>

      {mode === "normal" ? (
        <>
          <CardNew title="Motivo de consulta">
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Revisión anual, sangrado anormal, dolor pélvico…"
              value={form.subjective}
              onChange={e => set("subjective", e.target.value)}
            />
          </CardNew>

          <CardNew title="Historia ginecológica">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">Menarca (edad)</label>
                <input type="number" className="input-new mono" placeholder="12" value={form.history.menarca} onChange={e => setH("menarca", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">IVSA (edad)</label>
                <input type="number" className="input-new mono" placeholder="18" value={form.history.ivsa} onChange={e => setH("ivsa", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Gesta</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.gesta} onChange={e => setH("gesta", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Para</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.para} onChange={e => setH("para", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Abortos</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.aborto} onChange={e => setH("aborto", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Cesáreas</label>
                <input type="number" className="input-new mono" placeholder="0" value={form.history.cesarea} onChange={e => setH("cesarea", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">FUR</label>
                <input type="date" className="input-new" value={form.history.fur} onChange={e => setH("fur", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Método anticonceptivo</label>
                <select className="input-new" value={form.history.method} onChange={e => setH("method", e.target.value)}>
                  <option value="">Ninguno</option>
                  <option value="ACO">Anticonceptivo oral</option>
                  <option value="DIU">DIU</option>
                  <option value="Implante">Implante subdérmico</option>
                  <option value="Inyectable">Inyectable</option>
                  <option value="Parche">Parche</option>
                  <option value="Barrera">Barrera</option>
                  <option value="OTB">OTB</option>
                  <option value="Vasectomía pareja">Vasectomía pareja</option>
                </select>
              </div>
            </div>
          </CardNew>

          <CardNew title="Exploración">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">Mamas</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder="Simétricas, sin nódulos palpables…"
                  value={form.exam.breasts}
                  onChange={e => setE("breasts", e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Exploración pélvica</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder="Genitales externos, vagina, cérvix…"
                  value={form.exam.pelvic}
                  onChange={e => setE("pelvic", e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Citología</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 70, padding: "8px 12px", height: "auto", resize: "vertical" }}
                  placeholder="Resultado Papanicolaou…"
                  value={form.exam.cytology}
                  onChange={e => setE("cytology", e.target.value)}
                />
              </div>
            </div>
          </CardNew>

          <CardNew title="Plan">
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Indicaciones, estudios, próxima cita…"
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </CardNew>
        </>
      ) : (
        <>
          <CardNew title="FUM y seguimiento">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px 14px", marginBottom: 16 }}>
              <div className="field-new">
                <label className="field-new__label">Fecha última menstruación (FUM)</label>
                <input type="date" className="input-new" value={form.fum} onChange={e => set("fum", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Motivo / notas</label>
                <input
                  className="input-new"
                  placeholder="Control prenatal rutinario…"
                  value={form.subjective}
                  onChange={e => set("subjective", e.target.value)}
                />
              </div>
            </div>
            {form.fum && (
              <PrenatalTracker
                fum={form.fum}
                currentWeight={weightNum}
                fundalHeight={fundalHeightNum}
                fetalHeartRate={fhrNum}
                measurements={prenatalMeasurements}
              />
            )}
          </CardNew>

          <CardNew title="Controles de la visita">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px 14px" }}>
              <div className="field-new">
                <label className="field-new__label">Peso (kg)</label>
                <input type="number" step="0.1" className="input-new mono" placeholder="65" value={form.prenatal.weight} onChange={e => setP("weight", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">TA (mmHg)</label>
                <input className="input-new mono" placeholder="110/70" value={form.prenatal.bp} onChange={e => setP("bp", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Altura uterina (cm)</label>
                <input type="number" step="0.1" className="input-new mono" placeholder="24" value={form.prenatal.fundalHeight} onChange={e => setP("fundalHeight", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">FCF (lpm)</label>
                <input type="number" className="input-new mono" placeholder="140" value={form.prenatal.fhr} onChange={e => setP("fhr", e.target.value)} />
              </div>
              <div className="field-new">
                <label className="field-new__label">Movimientos fetales</label>
                <select className="input-new" value={form.prenatal.movements} onChange={e => setP("movements", e.target.value)}>
                  <option value="">Seleccionar…</option>
                  <option value="Presentes">Presentes</option>
                  <option value="Disminuidos">Disminuidos</option>
                  <option value="Ausentes">Ausentes</option>
                  <option value="N/A">No aplica</option>
                </select>
              </div>
            </div>
          </CardNew>

          <CardNew
            title="Ultrasonidos"
            action={<ButtonNew size="sm" variant="ghost" onClick={addUS}>+ Agregar US</ButtonNew>}
          >
            {ultrasounds.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
                Sin ultrasonidos. Haz clic en &quot;+ Agregar US&quot; para añadir.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ultrasounds.map((u, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "170px 1fr auto", gap: 8, alignItems: "flex-end" }}>
                    <div className="field-new">
                      <label className="field-new__label">Fecha</label>
                      <input type="date" className="input-new" value={u.date} onChange={e => updateUS(i, "date", e.target.value)} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">Hallazgos</label>
                      <input className="input-new" placeholder="Producto único vivo, 22 SDG, PFE 500g…" value={u.findings} onChange={e => updateUS(i, "findings", e.target.value)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeUS(i)}
                      className="btn-new btn-new--ghost btn-new--sm"
                      style={{ padding: 0, width: 28, color: "var(--danger)", alignSelf: "flex-end" }}
                      aria-label="Eliminar"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </CardNew>

          <CardNew title="Laboratorios por trimestre">
            {[1, 2, 3].map(tri => (
              <div key={tri} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>
                  Trimestre {tri}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {TRIMESTER_LABS.filter(l => l.trimester === tri).map(l => (
                    <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: labs[l.id] ? "rgba(52,211,153,0.08)" : "transparent" }}>
                      <input type="checkbox" checked={!!labs[l.id]} onChange={() => toggleLab(l.id)} />
                      <span style={{ fontSize: 12, color: "var(--text-1)" }}>{l.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </CardNew>

          <CardNew title="Plan">
            <textarea
              className="input-new"
              style={{ minHeight: 80, padding: "10px 12px", height: "auto", resize: "vertical" }}
              placeholder="Ácido fólico, hierro, control en 4 semanas…"
              value={form.plan}
              onChange={e => set("plan", e.target.value)}
            />
          </CardNew>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ButtonNew variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar consulta"}
        </ButtonNew>
      </div>
    </div>
  );
}
