"use client";

import { useEffect, useState, useMemo } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import toast from "react-hot-toast";
import {
  QUESTIONNAIRE_GROUPS,
  computeRiskFlags,
  grupoValores,
  normalizeAnswers,
  ponerEnGrupo,
  RISK_FLAG_LABELS,
  type Answers,
  type QDef,
  type QGroup,
} from "@/lib/health-questionnaire";
import { useT } from "@/i18n/i18n-provider";

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

/**
 * Grupo de CASILLAS plegable (NOM-004: heredo-familiares e interrogatorio por
 * aparatos y sistemas). Sus respuestas viven ANIDADAS en
 * `answers[group.namespace]`, no como claves sueltas.
 *
 * A nivel de MÓDULO por lo mismo que `YesNoRow`: anidarlo lo remontaría en
 * cada render y el campo de texto libre perdería el foco a cada tecla.
 */
function CheckGroup({ group, answers, onSet }: { group: QGroup; answers: Answers; onSet: (k: string, v: any) => void }) {
  const t = useT();
  const [open, setOpen] = useState(!group.plegado);
  const valores = grupoValores(answers, group);
  const marcadas = group.questions.filter((q) => valores[q.key] === true).length;
  const libre = group.libre;
  const textoLibre = libre ? (valores[libre.key] ?? "") : "";
  // Una sección con solo texto libre tampoco está vacía: si no, plegada y sin
  // marca, parece que nadie la llenó.
  const conContenido = marcadas > 0 || String(textoLibre).trim() !== "";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
      >
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide text-left">
          {group.titleKey ? t(group.titleKey) : group.title}
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {conContenido && (
            <span className="text-[10px] font-bold bg-brand-600/15 text-brand-700 dark:text-brand-400 px-1.5 py-0.5 rounded">
              {marcadas > 0
                ? t("clinical.nom004.marcadas", { count: marcadas })
                : t("clinical.nom004.conNota")}
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border">
          {group.ayudaKey && <p className="text-xs text-muted-foreground mb-3">{t(group.ayudaKey)}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {group.questions.map((q) => {
              const marcada = valores[q.key] === true;
              return (
                <label
                  key={q.key}
                  style={{ minHeight: 44 }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                    marcada ? "border-brand-600 bg-brand-600/10" : "border-border bg-card hover:bg-muted/20"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-brand-600 flex-shrink-0"
                    checked={marcada}
                    onChange={(e) => onSet(q.key, e.target.checked)}
                  />
                  {q.labelKey ? t(q.labelKey) : q.label}
                </label>
              );
            })}
          </div>
          {libre && (
            <div className="field-new mt-3">
              <label className="field-new__label" htmlFor={`hq-${group.id}-libre`}>
                {libre.labelKey ? t(libre.labelKey) : libre.label}
              </label>
              <textarea
                id={`hq-${group.id}-libre`}
                className="input-new"
                style={{ minHeight: 60, resize: "vertical" }}
                placeholder={libre.placeholderKey ? t(libre.placeholderKey) : (libre.placeholder ?? "")}
                value={textoLibre}
                onChange={(e) => onSet(libre.key, e.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HealthQuestionnaireTab({ patientId, onSaved }: Props) {
  const t = useT();
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
  /** Setter de un grupo anidado: desmarcar o vaciar BORRA, no guarda `false`. */
  const setEnGrupo = (group: QGroup) => (key: string, value: any) =>
    setAnswers((a) => ponerEnGrupo(a, group, key, value));

  const liveFlags = useMemo(() => computeRiskFlags(answers), [answers]);

  async function handleSave() {
    setSaving(true);
    // Lo que viaja es lo NORMALIZADO: solo casillas marcadas y texto con algo.
    const limpias = normalizeAnswers(answers);
    try {
      const res = await fetch(`/api/patients/${patientId}/health-questionnaire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: limpias, notes }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo guardar");
      const data = await res.json();
      // Solo si nadie escribió mientras la petición viajaba: ver la nota de
      // `cuestionario.tsx`.
      setAnswers((actual) => (actual === answers ? limpias : actual));
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

      {/* Grupos del cuestionario. Los de siempre (padecimientos, alergias,
          hábitos) son filas Sí/No con sus claves planas; los de NOM-004
          (heredo-familiares, aparatos y sistemas) son casillas plegadas y
          anidadas. Lo decide el propio catálogo, no esta pantalla. */}
      {QUESTIONNAIRE_GROUPS.map((group) =>
        group.casillas ? (
          <CheckGroup key={group.id} group={group} answers={answers} onSet={setEnGrupo(group)} />
        ) : (
          <div key={group.id} className="bg-card border border-border rounded-xl p-4">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
              {group.titleKey ? t(group.titleKey) : group.title}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.questions.map((q) => <YesNoRow key={q.key} def={q} answers={answers} onSet={setA} />)}
            </div>
          </div>
        ),
      )}

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
