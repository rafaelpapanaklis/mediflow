"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Paperclip,
  Sparkles,
  Save,
  CheckCircle2,
  Trash2,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import styles from "./patient-detail.module.css";

export interface SoapDraft {
  id?: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  attachments: { id: string; name: string; mime: string }[];
}

export interface SoapEditorInlineProps {
  appointment: {
    id: string;
    patientName: string;
    type?: string;
  };
  initialDraft: SoapDraft;
  onSaveDraft?: (draft: SoapDraft) => Promise<void>;
  onComplete: (draft: SoapDraft) => Promise<void>;
  onAttach?: (file: File) => Promise<{ id: string; name: string; mime: string } | null>;
}

const QUICK_TEMPLATES: { label: string; field: keyof Omit<SoapDraft, "id" | "attachments">; value: string }[] = [
  { label: "Limpieza profilaxis", field: "plan", value: "Profilaxis con ultrasonido. Aplicación tópica de flúor. Reforzar técnica de cepillado y uso de hilo dental." },
  { label: "Sin hallazgos",       field: "objective", value: "Tejidos blandos sin alteraciones. Higiene oral adecuada. Sin lesiones cariosas activas." },
  { label: "Control 6 meses",     field: "plan", value: "Control en 6 meses. Reforzar higiene." },
  { label: "Anestesia bloqueo",   field: "plan", value: "Anestesia infiltrativa con lidocaína 2% sin epinefrina (paciente con contraindicación). Verificar bloqueo antes del procedimiento." },
];

export function SoapEditorInline({
  appointment,
  initialDraft,
  onSaveDraft,
  onComplete,
  onAttach,
}: SoapEditorInlineProps) {
  const [draft, setDraft] = useState<SoapDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateField = useCallback(
    <K extends keyof SoapDraft>(field: K, value: SoapDraft[K]) => {
      setDraft((d) => ({ ...d, [field]: value }));
    },
    [],
  );

  // Auto-save con debounce 1.5s tras la última edición
  useEffect(() => {
    if (!onSaveDraft) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await onSaveDraft(draft);
        setSavedAt(new Date());
      } catch {
        /* el caller maneja toast */
      } finally {
        setSaving(false);
      }
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, onSaveDraft]);

  async function handleFileSelect(file: File) {
    if (!onAttach) return;
    setAttaching(true);
    try {
      const result = await onAttach(file);
      if (result) {
        setDraft((d) => ({ ...d, attachments: [...d.attachments, result] }));
      }
    } finally {
      setAttaching(false);
    }
  }

  async function manualSave() {
    if (!onSaveDraft) return;
    setSaving(true);
    try {
      await onSaveDraft(draft);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await onComplete(draft);
    } finally {
      setCompleting(false);
    }
  }

  function applyTemplate(tpl: typeof QUICK_TEMPLATES[number]) {
    setDraft((d) => ({
      ...d,
      [tpl.field]: d[tpl.field] ? `${d[tpl.field]}\n${tpl.value}` : tpl.value,
    }));
  }

  function removeAttachment(id: string) {
    setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) }));
  }

  function fmtSavedAt(): string {
    if (!savedAt) return "Sin guardar todavía";
    const diff = Math.floor((Date.now() - savedAt.getTime()) / 1000);
    if (diff < 5) return "Borrador guardado";
    if (diff < 60) return `Borrador guardado · hace ${diff}s`;
    return `Borrador guardado · hace ${Math.floor(diff / 60)}m`;
  }

  return (
    <section className={styles.soapEditor} aria-label="Editor de notas de consulta">
      <header className={styles.soapEditorHead}>
        <div className={styles.soapEditorTitleBlock}>
          <span className={styles.soapEditorChip}>● En curso</span>
          <h3 className={styles.soapEditorTitle}>Notas de consulta</h3>
          <span className={styles.soapEditorSub}>
            {appointment.type ?? "Consulta"} · {appointment.patientName}
          </span>
        </div>
      </header>

      <div className={styles.soapBody}>
        <div className={styles.soapFields}>
          {(["subjective", "objective", "assessment", "plan"] as const).map((field, idx) => {
            const meta = SOAP_META[field];
            const letter = ["S", "O", "A", "P"][idx]!;
            return (
              <div key={field} className={styles.soapBlock}>
                <div className={styles.soapLabel}>
                  <span className={styles.soapLetter}>{letter}</span>
                  <span>{meta.label}</span>
                  <span className={styles.soapHint}>{meta.hint}</span>
                </div>
                <textarea
                  className={styles.soapInput}
                  value={draft[field]}
                  placeholder={meta.placeholder}
                  onChange={(e) => updateField(field, e.target.value)}
                  rows={3}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                />
              </div>
            );
          })}
        </div>

        <aside
          className={`${styles.soapDock} ${dragActive ? styles.dragActive : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileSelect(file);
          }}
        >
          <div className={styles.dockSection}>
            <div className={styles.dockSectionLabel}>Adjuntos</div>
            <button
              type="button"
              className={styles.dockUploadBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={attaching}
            >
              <Paperclip size={13} aria-hidden />
              <span>
                {attaching
                  ? "Subiendo…"
                  : dragActive
                  ? "Suelta el archivo aquí"
                  : "Arrastra archivos o click para subir"}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept="image/*,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelect(file);
                e.target.value = "";
              }}
            />
            {draft.attachments.length > 0 && (
              <ul className={styles.dockAttachList}>
                {draft.attachments.map((a) => (
                  <li key={a.id} className={styles.dockAttach}>
                    {a.mime.startsWith("image/") ? (
                      <ImageIcon size={11} aria-hidden />
                    ) : (
                      <FileText size={11} aria-hidden />
                    )}
                    <span className={styles.dockAttachName} title={a.name}>{a.name}</span>
                    <button
                      type="button"
                      className={styles.dockAttachRemove}
                      onClick={() => removeAttachment(a.id)}
                      aria-label={`Quitar ${a.name}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.dockSection}>
            <div className={styles.dockSectionLabel}>Plantillas rápidas</div>
            <div className={styles.dockTemplates}>
              {QUICK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  className={styles.dockTemplate}
                  onClick={() => applyTemplate(tpl)}
                  title={`Inserta en ${SOAP_META[tpl.field].label}`}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.dockSection}>
            <button
              type="button"
              className={styles.dockAiBtn}
              disabled
              title="Próximamente"
            >
              <Sparkles size={12} aria-hidden />
              <span>IA sugerir plan</span>
            </button>
          </div>
        </aside>
      </div>

      <footer className={styles.soapFoot}>
        <span className={styles.soapSavedLabel}>
          {saving ? "Guardando…" : fmtSavedAt()}
        </span>
        <div className={styles.soapFootActions}>
          <button
            type="button"
            className={styles.soapBtn}
            onClick={() => void manualSave()}
            disabled={saving}
          >
            <Save size={12} aria-hidden /> Guardar borrador
          </button>
          <button
            type="button"
            className={`${styles.soapBtn} ${styles.soapBtnPrimary}`}
            onClick={() => void handleComplete()}
            disabled={completing}
          >
            <CheckCircle2 size={12} aria-hidden />
            {completing ? "Firmando…" : "Firmar y completar consulta"}
          </button>
        </div>
      </footer>
    </section>
  );
}

const SOAP_META: Record<
  keyof Pick<SoapDraft, "subjective" | "objective" | "assessment" | "plan">,
  { label: string; hint: string; placeholder: string }
> = {
  subjective: {
    label: "Subjetivo",
    hint: "Lo que el paciente reporta",
    placeholder: "Motivo de consulta, síntomas reportados…",
  },
  objective: {
    label: "Objetivo",
    hint: "Hallazgos clínicos",
    placeholder: "Examen físico, signos vitales, observaciones clínicas…",
  },
  assessment: {
    label: "Evaluación",
    hint: "Diagnóstico",
    placeholder: "Diagnóstico, diferencial, evaluación clínica…",
  },
  plan: {
    label: "Plan",
    hint: "Tratamiento + siguiente paso",
    placeholder: "Tratamiento, prescripción, control, derivación…",
  },
};
