"use client";

import { useEffect, useState, useMemo } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import toast from "react-hot-toast";
import {
  QUESTIONNAIRE_GROUPS,
  computeRiskFlags,
  RISK_FLAG_LABELS,
  type Answers,
  type QDef,
} from "@/lib/health-questionnaire";

interface Props {
  patientId: string;
  /** Se llama tras guardar para que el panel (chips de riesgo + aviso) se refresque. */
  onSaved?: () => void;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Fila sí/no con campo de detalle opcional al marcar "Sí". Definida a nivel
 * de MÓDULO (no anidada en el componente) para que su identidad sea estable:
 * un componente anidado se remonta en cada render y los inputs de detalle
 * perderían el foco a cada tecla.
 */
function YesNoRow({ def, answers, onSet }: { def: QDef; answers: Answers; onSet: (k: string, v: any) => void }) {
  const yes = answers[def.key] === true;
  const no = answers[def.key] === false;
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">{def.label}</span>
        <div className="flex gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => onSet(def.key, true)}
            className={`px-2.5 py-1 text-xs font-bold rounded-md border transition-colors ${
              yes
                ? "bg-rose-600 text-white border-rose-600"
                : "bg-transparent text-muted-foreground border-border hover:border-rose-300"
            }`}
          >
            Sí
          </button>
          <button
            type="button"
            onClick={() => onSet(def.key, false)}
            className={`px-2.5 py-1 text-xs font-bold rounded-md border transition-colors ${
              no
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-transparent text-muted-foreground border-border hover:border-emerald-300"
            }`}
          >
            No
          </button>
        </div>
      </div>
      {def.detail && yes && (
        <input
          className="input-new mt-2 w-full"
          placeholder={def.detailLabel ?? "Detalle"}
          value={answers[def.key + "Detail"] ?? ""}
          onChange={(e) => onSet(def.key + "Detail", e.target.value)}
        />
      )}
    </div>
  );
}

export function HealthQuestionnaireTab({ patientId, onSaved }: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/patients/${patientId}/health-questionnaire`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar"))))
      .then((data) => {
        if (cancelled) return;
        setCurrent(data.current ?? null);
        setHistory(Array.isArray(data.history) ? data.history : []);
        if (data.current?.answers && typeof data.current.answers === "object") {
          setAnswers(data.current.answers);
        }
        if (typeof data.current?.notes === "string") setNotes(data.current.notes);
      })
      .catch(() => { if (!cancelled) toast.error("No se pudo cargar el cuestionario"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  const setA = (key: string, value: any) => setAnswers((a) => ({ ...a, [key]: value }));

  const liveFlags = useMemo(() => computeRiskFlags(answers), [answers]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/health-questionnaire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, notes }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo guardar");
      const data = await res.json();
      setCurrent(data.questionnaire ?? null);
      setHistory((prev) => [data.questionnaire, ...prev]);
      toast.success("Cuestionario guardado");
      onSaved?.();
    } catch (err: any) {
      toast.error(err.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        Cargando cuestionario…
      </div>
    );
  }

  const painLevel = Number(answers.painLevel ?? 0);

  return (
    <div className="space-y-4">
      {/* Encabezado + estado vigente + preview de banderas */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-brand-600" />
            <h2 className="text-sm font-bold">Cuestionario de salud</h2>
          </div>
          {current ? (
            <span className="text-xs text-muted-foreground">
              Vigente · llenado {fmtDate(current.filledAt)}
              {current.filledByName ? ` por ${current.filledByName}` : ""}
            </span>
          ) : (
            <span className="text-xs font-semibold text-amber-600">Sin cuestionario previo</span>
          )}
        </div>
        {liveFlags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {liveFlags.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 text-xs font-bold bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-800"
              >
                <AlertTriangle className="w-3 h-3" /> {RISK_FLAG_LABELS[f] ?? f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Grupos sí/no (padecimientos, alergias, hábitos) */}
      {QUESTIONNAIRE_GROUPS.map((group) => (
        <div key={group.id} className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">{group.title}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.questions.map((q) => <YesNoRow key={q.key} def={q} answers={answers} onSet={setA} />)}
          </div>
        </div>
      ))}

      {/* Antecedentes médicos */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Antecedentes médicos</div>
        <div className="space-y-3">
          <div className="field-new">
            <label className="field-new__label">Medicación actual (separa con comas o saltos de línea)</label>
            <textarea
              className="input-new"
              style={{ minHeight: 60, resize: "vertical" }}
              placeholder="Ej. Metformina 850mg, Losartán 50mg…"
              value={answers.currentMedications ?? ""}
              onChange={(e) => setA("currentMedications", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="field-new">
              <label className="field-new__label">Médico tratante (nombre)</label>
              <input className="input-new" value={answers.treatingDoctorName ?? ""} onChange={(e) => setA("treatingDoctorName", e.target.value)} />
            </div>
            <div className="field-new">
              <label className="field-new__label">Teléfono del médico tratante</label>
              <input className="input-new" value={answers.treatingDoctorPhone ?? ""} onChange={(e) => setA("treatingDoctorPhone", e.target.value)} />
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">Hospitalizaciones o cirugías previas</label>
            <textarea
              className="input-new"
              style={{ minHeight: 50, resize: "vertical" }}
              value={answers.hospitalizations ?? ""}
              onChange={(e) => setA("hospitalizations", e.target.value)}
            />
          </div>
          <YesNoRow
            def={{ key: "anesthesiaComplications", label: "Complicaciones previas con anestesia dental", detail: true, detailLabel: "Describe la complicación" }}
            answers={answers}
            onSet={setA}
          />
        </div>
      </div>

      {/* Motivo y estado dental */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Motivo y estado dental</div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="field-new">
              <label className="field-new__label">Motivo principal de consulta</label>
              <input className="input-new" value={answers.chiefComplaint ?? ""} onChange={(e) => setA("chiefComplaint", e.target.value)} />
            </div>
            <div className="field-new">
              <label className="field-new__label">Última visita al dentista</label>
              <input className="input-new" placeholder="Ej. hace 6 meses" value={answers.lastDentalVisit ?? ""} onChange={(e) => setA("lastDentalVisit", e.target.value)} />
            </div>
          </div>
          <YesNoRow def={{ key: "bleedingGums", label: "Sangrado de encías" }} answers={answers} onSet={setA} />
          <div className="field-new">
            <label className="field-new__label">Dolor actual: <span className="font-bold text-foreground">{painLevel}/10</span></label>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={painLevel}
              onChange={(e) => setA("painLevel", Number(e.target.value))}
              className="w-full accent-brand-600"
            />
          </div>
        </div>
      </div>

      {/* Notas libres */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="field-new">
          <label className="field-new__label">Notas adicionales</label>
          <textarea
            className="input-new"
            style={{ minHeight: 60, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Al guardar, las alergias, padecimientos y medicamentos se suman al expediente del paciente (sin borrar lo ya capturado).
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Guardando…" : current ? "Guardar nueva versión" : "Guardar cuestionario"}
        </button>
      </div>

      {/* Historial de versiones anteriores */}
      {history.length > 1 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
          >
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              Historial ({history.length - 1} {history.length - 1 === 1 ? "versión anterior" : "versiones anteriores"})
            </span>
            {historyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {historyOpen && (
            <div className="border-t border-border divide-y divide-border">
              {history.slice(1).map((q) => (
                <div key={q.id} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(q.filledAt)}{q.filledByName ? ` · ${q.filledByName}` : ""}
                  </span>
                  {Array.isArray(q.riskFlags) && q.riskFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {q.riskFlags.map((f: string) => (
                        <span key={f} className="text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded">
                          {RISK_FLAG_LABELS[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
