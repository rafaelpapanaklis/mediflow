"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Search,
  Mic,
  StopCircle,
  Plus,
  X,
  ChevronDown,
  Paperclip,
  Save,
  CheckCircle2,
  FileDown,
  Stethoscope,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  SOAP_TEMPLATES,
  findTemplateByShortcut,
  type SoapTemplate,
} from "@/lib/clinical/soap-templates";
import { useConfirm } from "@/components/ui/confirm-dialog";
import styles from "./clinical.module.css";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber: string;
  gender?: string | null;
  dob?: string | Date | null;
  isChild?: boolean;
}

interface MedicalRecord {
  id: string;
  visitDate: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  doctor?: { firstName: string; lastName: string } | null;
  specialtyData?: {
    status?: "DRAFT" | "SIGNED";
    icd10?: { code: string; label: string }[];
    attachments?: { id: string; name: string; mime: string }[];
  } | null;
}

interface Props {
  specialty: string;
  clinicCategory?: string;
  patients: Patient[];
  selectedPatient: Patient | null;
  records: MedicalRecord[];
  sessionCount: number;
  currentPatientId?: string;
}

type SoapKey = "subjective" | "objective" | "assessment" | "plan";

interface SoapDraft {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface Icd10Entry {
  code: string;
  label: string;
}

// Templates ahora viven en src/lib/clinical/soap-templates.ts

const COMMON_ICD10: Icd10Entry[] = [
  { code: "K02.1", label: "Caries dental dentinaria" },
  { code: "K04.0", label: "Pulpitis aguda" },
  { code: "K05.0", label: "Gingivitis aguda" },
  { code: "K05.3", label: "Periodontitis crónica" },
  { code: "K08.1", label: "Pérdida de dientes por caries" },
  { code: "K12.0", label: "Aftas recurrentes en boca" },
  { code: "M79.1", label: "Mialgia" },
  { code: "I10",   label: "Hipertensión esencial" },
  { code: "E11.9", label: "Diabetes mellitus tipo 2 sin complicación" },
  { code: "J06.9", label: "Infección aguda vías respiratorias sup., NCOP" },
  { code: "F41.1", label: "Trastorno de ansiedad generalizada" },
  { code: "F32.9", label: "Episodio depresivo no especificado" },
];

const SOAP_META: Record<SoapKey, { letter: string; title: string; subtitle: string; color: string; placeholder: string }> = {
  subjective: { letter: "S", title: "Subjetivo", subtitle: "Lo que el paciente refiere", color: "var(--soap-s)", placeholder: "Motivo de consulta, padecimiento actual, antecedentes…" },
  objective:  { letter: "O", title: "Objetivo", subtitle: "Hallazgos clínicos, signos vitales, exploración", color: "var(--soap-o)", placeholder: "Signos vitales, exploración física, hallazgos clínicos…" },
  assessment: { letter: "A", title: "Análisis (Assessment)", subtitle: "Diagnóstico principal y diferenciales", color: "var(--soap-a)", placeholder: "Diagnóstico principal, dx diferenciales, ICD-10…" },
  plan:       { letter: "P", title: "Plan", subtitle: "Tratamiento, indicaciones, seguimiento", color: "var(--soap-p)", placeholder: "Tratamiento, recetas, procedimientos, seguimiento…" },
};

function formatSec(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(date);
}

function getInitials(p: { firstName: string; lastName: string }) {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

export function ClinicalClient(props: Props) {
  // Defensa: si el server pasa props undefined por cualquier motivo,
  // caemos a arrays/null vacíos para no crashear el render del cliente.
  const patients = props.patients ?? [];
  const selectedPatient = props.selectedPatient ?? null;
  const records = props.records ?? [];
  const currentPatientId = props.currentPatientId;
  const router = useRouter();
  const askConfirm = useConfirm();

  const [draft, setDraft] = useState<SoapDraft>({ subjective: "", objective: "", assessment: "", plan: "" });
  const [collapsed, setCollapsed] = useState<Record<SoapKey, boolean>>({
    subjective: false, objective: false, assessment: false, plan: false,
  });
  const [icd10List, setIcd10List] = useState<Icd10Entry[]>([]);
  const [icdQuery, setIcdQuery] = useState("");
  const [tab, setTab] = useState<"templates" | "history">("templates");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [attachments, setAttachments] = useState<{ id: string; name: string; mime: string }[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Filtered patients
  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      `${p.firstName} ${p.lastName} ${p.patientNumber}`.toLowerCase().includes(q),
    );
  }, [patients, patientSearch]);

  // Filtered ICD-10
  const filteredIcd = useMemo(() => {
    const q = icdQuery.trim().toLowerCase();
    if (!q) return COMMON_ICD10;
    return COMMON_ICD10.filter(
      (i) => i.code.toLowerCase().includes(q) || i.label.toLowerCase().includes(q),
    );
  }, [icdQuery]);

  // Apply template — escribe el contenido pre-escrito en los 4 campos S/O/A/P.
  // Si algún campo ya tiene contenido distinto al template y al placeholder,
  // pide confirmación antes de sobreescribir.
  const applyTemplate = useCallback(async (tpl: SoapTemplate) => {
    const hasContent =
      (draft.subjective?.trim().length ?? 0) > 0 ||
      (draft.objective?.trim().length  ?? 0) > 0 ||
      (draft.assessment?.trim().length ?? 0) > 0 ||
      (draft.plan?.trim().length       ?? 0) > 0;

    if (hasContent) {
      const ok = await askConfirm({
        title: "¿Reemplazar contenido?",
        description: `La nota actual tiene texto. La plantilla "${tpl.name}" lo sobrescribirá completamente.`,
        variant: "warning",
        confirmText: "Reemplazar",
      });
      if (!ok) return;
    }

    setDraft({
      subjective: tpl.s,
      objective:  tpl.o,
      assessment: tpl.a,
      plan:       tpl.p,
    });
    toast.success(`Plantilla "${tpl.name}" cargada`);
  }, [draft.subjective, draft.objective, draft.assessment, draft.plan, askConfirm]);

  // Keyboard shortcuts ⇧1-9 for templates, Ctrl+S save, Ctrl+Enter sign
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void handleSave();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void handleSign();
          return;
        }
        return;
      }
      if (e.shiftKey && /^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10);
        const tpl = findTemplateByShortcut(n);
        if (tpl) {
          e.preventDefault();
          applyTemplate(tpl);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyTemplate]);

  // Load draft cuando cambia paciente
  useEffect(() => {
    if (!selectedPatient) {
      setDraft({ subjective: "", objective: "", assessment: "", plan: "" });
      setIcd10List([]);
      setAttachments([]);
      return;
    }
    // Carga el draft más reciente del paciente si existe
    const latestDraft = records.find((r) => r.specialtyData?.status !== "SIGNED");
    if (latestDraft) {
      setDraft({
        subjective: latestDraft.subjective ?? "",
        objective:  latestDraft.objective  ?? "",
        assessment: latestDraft.assessment ?? "",
        plan:       latestDraft.plan       ?? "",
      });
      setIcd10List(latestDraft.specialtyData?.icd10 ?? []);
      setAttachments(latestDraft.specialtyData?.attachments ?? []);
    }
  }, [selectedPatient?.id, records]);

  const updateField = useCallback((k: SoapKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedPatient) {
      toast.error("Selecciona un paciente primero");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          ...draft,
          specialtyData: { status: "DRAFT", icd10: icd10List, attachments },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al guardar");
      }
      setSavedAt(new Date());
      toast.success("Borrador guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }, [selectedPatient, draft, icd10List, attachments]);

  const handleSign = useCallback(async () => {
    if (!selectedPatient) {
      toast.error("Selecciona un paciente primero");
      return;
    }
    if (!draft.subjective && !draft.objective && !draft.assessment && !draft.plan) {
      toast.error("La nota está vacía. Llena al menos S/O/A/P antes de firmar.");
      return;
    }
    if (!(await askConfirm({
      title: "¿Firmar y cerrar nota?",
      description: "Una vez firmada queda inalterable y se registra como nota oficial en el expediente.",
      variant: "warning",
      confirmText: "Firmar y cerrar",
    }))) return;

    setSigning(true);
    try {
      const res = await fetch("/api/clinical-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          ...draft,
          specialtyData: { status: "SIGNED", icd10: icd10List, attachments, signedAt: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al firmar");
      }
      toast.success("Nota firmada y cerrada");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al firmar");
    } finally {
      setSigning(false);
    }
  }, [selectedPatient, draft, icd10List, attachments, router, askConfirm]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        if (recIntervalRef.current) clearInterval(recIntervalRef.current);
        setRecording(false);
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(recChunksRef.current, { type: "audio/webm" });
        setTranscribing(true);
        toast("Transcribiendo audio…", { icon: "🎙️" });
        try {
          const form = new FormData();
          form.append("audio", blob, "consult.webm");
          const res = await fetch("/api/clinical-notes/transcribe", { method: "POST", body: form });
          if (!res.ok) {
            toast("Audio guardado. Configura OPENAI_API_KEY para transcripción automática.", { icon: "ℹ️" });
            return;
          }
          const data = await res.json();
          if (data.soap) {
            setDraft({
              subjective: data.soap.subjective ?? draft.subjective,
              objective:  data.soap.objective  ?? draft.objective,
              assessment: data.soap.assessment ?? draft.assessment,
              plan:       data.soap.plan       ?? draft.plan,
            });
            toast.success("SOAP rellenado desde audio");
          } else if (data.text) {
            setDraft((d) => ({ ...d, subjective: `${d.subjective}\n${data.text}`.trim() }));
            toast.success("Transcripción agregada en Subjetivo");
          }
        } catch {
          toast.error("Error al transcribir");
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecSeconds(0);
      recIntervalRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("No se pudo acceder al micrófono");
    }
  }, [draft]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const addIcd = useCallback((entry: Icd10Entry) => {
    if (icd10List.find((i) => i.code === entry.code)) return;
    setIcd10List((prev) => [...prev, entry]);
    toast(`Añadido ${entry.code}`, { icon: "➕" });
  }, [icd10List]);

  const removeIcd = useCallback((code: string) => {
    setIcd10List((prev) => prev.filter((i) => i.code !== code));
  }, []);

  const selectPatient = useCallback((p: Patient) => {
    router.push(`/dashboard/clinical?patientId=${p.id}`);
  }, [router]);

  return (
    <div className={styles.page}>
      {/* ── Topbar ── */}
      <div className={styles.topbar}>
        <div className={styles.topbarTitle}>
          <span className={styles.topbarTitleIcon}><Stethoscope size={14} aria-hidden /></span>
          Notas clínicas
        </div>
        {savedAt && (
          <span className={styles.savedIndicator}>
            <span className={styles.savedDot} aria-hidden />
            Guardado {new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(savedAt)}
          </span>
        )}
        <div className={styles.topbarSpacer} />
        {recording ? (
          <span className={styles.audioBadge}>
            <span className={styles.audioBadgeDot} aria-hidden />
            Grabando · {formatSec(recSeconds)}
          </span>
        ) : transcribing ? (
          <span className={styles.savedIndicator}>Transcribiendo…</span>
        ) : null}
        {selectedPatient && (
          <div className={styles.patientChip}>
            <span className={styles.patientChipAvatar}>{getInitials(selectedPatient)}</span>
            <strong>{selectedPatient.firstName} {selectedPatient.lastName}</strong>
            <span className={styles.patientChipId}>· {selectedPatient.patientNumber}</span>
          </div>
        )}
        <button
          type="button"
          className={recording ? `${styles.topbarBtn} ${styles.topbarBtnDanger}` : styles.topbarBtn}
          onClick={recording ? stopRecording : startRecording}
        >
          {recording ? <StopCircle size={13} aria-hidden /> : <Mic size={13} aria-hidden />}
          {recording ? "Detener grabación" : "Grabar consulta"}
        </button>
        <button
          type="button"
          className={styles.topbarBtn}
          onClick={handleSave}
          disabled={!selectedPatient || saving}
        >
          <Save size={13} aria-hidden /> {saving ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          className={`${styles.topbarBtn} ${styles.topbarBtnSuccess}`}
          onClick={handleSign}
          disabled={!selectedPatient || signing}
        >
          <CheckCircle2 size={13} aria-hidden /> {signing ? "Firmando…" : "Firmar y cerrar"}
        </button>
      </div>

      {/* ── Sidebar izquierdo ── */}
      <aside className={styles.leftPanel}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === "templates" ? styles.tabActive : ""}`}
            onClick={() => setTab("templates")}
          >
            Plantillas
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "history" ? styles.tabActive : ""}`}
            onClick={() => setTab("history")}
          >
            Historial
          </button>
        </div>

        <div className={styles.tabBody}>
          {tab === "templates" && (
            <>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Buscar paciente…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
              />
              {filteredPatients.length > 0 && !selectedPatient && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {filteredPatients.slice(0, 6).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.noteHistoryCard}
                      onClick={() => selectPatient(p)}
                    >
                      <span className={styles.noteHistoryTitle}>{p.firstName} {p.lastName}</span>
                      <span className={styles.noteHistoryMeta}>{p.patientNumber}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-3)", textTransform: "uppercase", marginTop: 4 }}>
                Plantillas SOAP
              </div>
              {SOAP_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.code}
                  type="button"
                  className={styles.templateCard}
                  onClick={() => applyTemplate(tpl)}
                  title={tpl.desc}
                >
                  <span className={styles.templateName}>
                    {tpl.name}
                    {tpl.shortcut !== null && (
                      <span className={styles.templateKbd}>⇧{tpl.shortcut}</span>
                    )}
                  </span>
                  <span className={styles.templateDesc}>{tpl.desc}</span>
                </button>
              ))}
            </>
          )}

          {tab === "history" && (
            <>
              {records.length === 0 ? (
                <div style={{ padding: "30px 12px", fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
                  {selectedPatient ? "Sin consultas previas" : "Selecciona un paciente"}
                </div>
              ) : (
                records.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={styles.noteHistoryCard}
                    onClick={() => router.push(`/dashboard/patients/${selectedPatient?.id}`)}
                  >
                    <span className={styles.noteHistoryMeta}>
                      {formatDate(r.visitDate)}
                      {r.doctor ? ` · Dr/a. ${r.doctor.firstName} ${r.doctor.lastName}` : ""}
                    </span>
                    <span className={styles.noteHistoryTitle}>
                      {r.specialtyData?.status === "SIGNED" && <span className={styles.signedDot} aria-hidden />}
                      {r.assessment?.split("\n")[0] ?? "Consulta"}
                    </span>
                    <span className={styles.noteHistoryPreview}>
                      {r.subjective ?? "—"}
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </aside>

      {/* ── Editor central ── */}
      <main className={styles.editor}>
        <div className={styles.editorScroll}>
          <div className={styles.editorInner}>
            {!selectedPatient && (
              <div
                style={{
                  padding: "12px 16px",
                  marginBottom: 12,
                  border: "1px dashed rgba(217,119,6,0.4)",
                  background: "rgba(217,119,6,0.06)",
                  borderRadius: 10,
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "var(--st-warning)" }}>Sin paciente</strong> —
                puedes escribir o aplicar plantillas, pero necesitas seleccionar
                un paciente del panel izquierdo antes de guardar o firmar.
              </div>
            )}

            {(["subjective", "objective", "assessment", "plan"] as SoapKey[]).map((k) => {
              const meta = SOAP_META[k];
              const value = draft[k];
              const isCollapsed = collapsed[k];
              return (
                <section
                  key={k}
                  className={styles.soapSection}
                  data-collapsed={isCollapsed}
                  style={{ ["--mf-soap-color" as never]: meta.color }}
                >
                  <button
                    type="button"
                    className={styles.soapHeader}
                    onClick={() => setCollapsed((c) => ({ ...c, [k]: !c[k] }))}
                  >
                    <span className={styles.soapLetter}>{meta.letter}</span>
                    <span className={styles.soapHeaderInfo}>
                      <span className={styles.soapTitle}>{meta.title}</span>
                      <span className={styles.soapSubtitle}>{meta.subtitle}</span>
                    </span>
                    <ChevronDown size={14} aria-hidden className={styles.soapChevron} />
                  </button>
                  <div className={styles.soapBody} data-empty={value.length === 0}>
                    <textarea
                      className={styles.soapTextarea}
                      value={value}
                      onChange={(e) => updateField(k, e.target.value)}
                      placeholder={meta.placeholder}
                    />
                    {k === "assessment" && icd10List.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {icd10List.map((i) => (
                          <span key={i.code} className={`${styles.pill} ${styles.pillIcd}`}>
                            <code style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{i.code}</code>
                            {i.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}

            {selectedPatient && (
              <div className={styles.attachmentsBlock}>
                <span className={styles.attachmentsLabel}>
                  <Paperclip size={11} aria-hidden style={{ display: "inline-block", marginRight: 4 }} />
                  Adjuntos ({attachments.length})
                </span>
                <div className={styles.attachmentsRow}>
                  {attachments.length === 0 ? (
                    <span className={styles.attachmentDropHint}>
                      Sube radiografías, fotos o documentos arrastrándolos aquí (próximamente).
                    </span>
                  ) : (
                    attachments.map((a) => (
                      <span key={a.id} className={styles.attachmentChip}>
                        {a.name}
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                          aria-label={`Quitar ${a.name}`}
                        >
                          <X size={10} aria-hidden />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Sidebar derecho ── */}
      <aside className={styles.rightPanel}>
        <div className={styles.icdSearch}>
          <Search size={13} aria-hidden className={styles.icdSearchIcon} />
          <input
            type="text"
            className={styles.icdSearchInput}
            placeholder="Buscar diagnóstico ICD-10…"
            value={icdQuery}
            onChange={(e) => setIcdQuery(e.target.value)}
          />
        </div>
        <div className={styles.icdListWrap}>
          <div className={styles.icdGroupLabel}>
            <Sparkles size={11} aria-hidden /> Sugeridos
            <span className={styles.aiBadge}>IA</span>
          </div>
          {filteredIcd.slice(0, 3).map((i) => (
            <button key={`s-${i.code}`} type="button" className={styles.icdItem} onClick={() => addIcd(i)}>
              <span className={styles.icdCode}>{i.code}</span>
              <span className={styles.icdLabel}>{i.label}</span>
              <span className={styles.icdAddBtn}><Plus size={11} aria-hidden /></span>
            </button>
          ))}
          <div className={styles.icdGroupLabel}>Más comunes</div>
          {filteredIcd.slice(3).map((i) => (
            <button key={`c-${i.code}`} type="button" className={styles.icdItem} onClick={() => addIcd(i)}>
              <span className={styles.icdCode}>{i.code}</span>
              <span className={styles.icdLabel}>{i.label}</span>
              <span className={styles.icdAddBtn}><Plus size={11} aria-hidden /></span>
            </button>
          ))}
        </div>

        {icd10List.length > 0 && (
          <div className={styles.selectedDx}>
            <span className={styles.selectedDxLabel}>Diagnósticos seleccionados</span>
            {icd10List.map((i) => (
              <div key={i.code} className={styles.selectedDxItem}>
                <span><code>{i.code}</code> · {i.label}</span>
                <button type="button" onClick={() => removeIcd(i.code)} aria-label={`Quitar ${i.code}`}>
                  <X size={11} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
