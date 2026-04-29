"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  FileDown,
  CheckCircle2,
  Save,
  Paperclip,
  FileText,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import styles from "./patient-detail.module.css";
import { Cie10Selector } from "@/components/dashboard/clinical/cie10-selector";

interface Cie10Code {
  code: string;
  description: string;
  chapter: string;
}
interface Diagnosis {
  id: string;
  cie10Code: string;
  isPrimary: boolean;
  note: string | null;
  cie10?: Cie10Code;
}

interface NoteAttachment {
  id: string;
  name: string;
  mime: string;
  url?: string;
}

export interface ClinicalNote {
  id: string;
  visitDate: string | Date;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  doctor?: { firstName: string; lastName: string } | null;
  /** specialtyData[] guarda { status: 'DRAFT'|'SIGNED', signedAt, attachments[], icd10[] } */
  specialtyData?: {
    status?: "DRAFT" | "SIGNED";
    signedAt?: string;
    attachments?: NoteAttachment[];
    icd10?: { code: string; label: string }[];
    procedures?: string[];
  } | null;
}

export interface NoteDetailModalProps {
  open: boolean;
  note: ClinicalNote | null;
  onClose: () => void;
  /** Cuando es DRAFT y el usuario guarda los cambios. */
  onUpdated?: (updated: ClinicalNote) => void;
}

function formatDateLong(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function isImageMime(m: string) {
  return m.startsWith("image/");
}

export function NoteDetailModal({ open, note, onClose, onUpdated }: NoteDetailModalProps) {
  const [draft, setDraft] = useState<{
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  }>({ subjective: "", objective: "", assessment: "", plan: "" });
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // NOM-024 — diagnósticos estructurados con FK a CIE-10.
  const [dxs, setDxs] = useState<Diagnosis[]>([]);

  // Resync local state cuando se cambia de nota.
  useEffect(() => {
    if (!note) return;
    setDraft({
      subjective: note.subjective ?? "",
      objective: note.objective ?? "",
      assessment: note.assessment ?? "",
      plan: note.plan ?? "",
    });
    // Carga diagnósticos estructurados desde el endpoint nuevo.
    let cancelled = false;
    fetch(`/api/medical-records/${note.id}/diagnoses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.diagnoses) setDxs(d.diagnoses); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [note]);

  const reloadDxs = useCallback(async () => {
    if (!note) return;
    const res = await fetch(`/api/medical-records/${note.id}/diagnoses`);
    if (res.ok) {
      const d = await res.json();
      setDxs(d.diagnoses ?? []);
    }
  }, [note]);

  const handleAddDx = useCallback(async (input: { cie10Code: string; isPrimary: boolean; note?: string }) => {
    if (!note) return;
    const res = await fetch(`/api/medical-records/${note.id}/diagnoses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "No se pudo agregar el diagnóstico");
      return;
    }
    await reloadDxs();
  }, [note, reloadDxs]);

  const handleRemoveDx = useCallback(async (dxId: string) => {
    if (!note) return;
    const res = await fetch(`/api/medical-records/${note.id}/diagnoses/${dxId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("No se pudo eliminar el diagnóstico");
      return;
    }
    setDxs((prev) => prev.filter((d) => d.id !== dxId));
  }, [note]);

  // Cierre con Escape (no interfiere si se está escribiendo en textarea).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSave = useCallback(async (signAfter = false) => {
    if (!note) return;
    const action = signAfter ? "firmar" : "guardar";
    if (signAfter) setSigning(true);
    else setSaving(true);
    try {
      const res = await fetch(`/api/clinical-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          ...(signAfter ? { status: "SIGNED" } : {}),
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Error al ${action}`);
      }
      const data = await res.json().catch(() => null);
      const updated: ClinicalNote = {
        ...note,
        ...draft,
        specialtyData: {
          ...(note.specialtyData ?? {}),
          ...(data?.note?.specialtyData ?? {}),
          ...(signAfter ? { status: "SIGNED", signedAt: new Date().toISOString() } : {}),
        },
      };
      onUpdated?.(updated);
      toast.success(signAfter ? "Nota firmada" : "Cambios guardados");
      if (signAfter) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `No se pudo ${action}`);
    } finally {
      setSaving(false);
      setSigning(false);
    }
  }, [note, draft, onUpdated, onClose]);

  const handleDownloadPdf = useCallback(async () => {
    if (!note) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/clinical-notes/${note.id}/pdf`);
      if (!res.ok) {
        // Si no hay endpoint todavía, fallback a window.print().
        window.print();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nota-${note.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.print();
    } finally {
      setDownloading(false);
    }
  }, [note]);

  if (!open || !note) return null;

  const status: "DRAFT" | "SIGNED" = note.specialtyData?.status ?? "DRAFT";
  const isSigned = status === "SIGNED";
  const attachments = note.specialtyData?.attachments ?? [];
  const icd10 = note.specialtyData?.icd10 ?? [];
  const signedAt = note.specialtyData?.signedAt;
  const doctorLabel = note.doctor
    ? `Dr/a. ${note.doctor.firstName} ${note.doctor.lastName}`
    : "Doctor no asignado";

  return (
    <div
      className={styles.noteModalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="note-detail-title"
      onClick={onClose}
    >
      <div
        className={styles.noteModal}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.noteModalHeader}>
          <div className={styles.noteModalHeaderInfo}>
            <h2 id="note-detail-title" className={styles.noteModalTitle}>
              Consulta · {formatDateLong(note.visitDate)}
            </h2>
            <div className={styles.noteModalSubtitle}>
              <span>{doctorLabel}</span>
              <span
                className={`${styles.noteStatusBadge} ${
                  isSigned ? styles.noteStatusSigned : styles.noteStatusDraft
                }`}
              >
                {isSigned ? "Firmada" : "Borrador"}
              </span>
              {isSigned && signedAt && (
                <span className={styles.noteSignedAt}>
                  · firmada {formatDateLong(signedAt)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className={styles.noteModalClose}
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className={styles.noteModalBody}>
          {isSigned ? (
            // ─── Read-only S/O/A/P ───
            <div className={styles.noteSoapView}>
              <SoapSection label="S — Subjetivo" value={note.subjective} />
              <SoapSection label="O — Objetivo" value={note.objective} />
              <SoapSection label="A — Diagnóstico (Assessment)" value={note.assessment} />
              <SoapSection label="P — Plan" value={note.plan} />
            </div>
          ) : (
            // ─── Editor inline ───
            <div className={styles.noteSoapEdit}>
              <SoapField
                label="S — Subjetivo"
                value={draft.subjective}
                onChange={(v) => setDraft((d) => ({ ...d, subjective: v }))}
              />
              <SoapField
                label="O — Objetivo"
                value={draft.objective}
                onChange={(v) => setDraft((d) => ({ ...d, objective: v }))}
              />
              <SoapField
                label="A — Diagnóstico (Assessment)"
                value={draft.assessment}
                onChange={(v) => setDraft((d) => ({ ...d, assessment: v }))}
              />
              <SoapField
                label="P — Plan"
                value={draft.plan}
                onChange={(v) => setDraft((d) => ({ ...d, plan: v }))}
              />
            </div>
          )}

          {/* Adjuntos */}
          {attachments.length > 0 && (
            <section className={styles.noteSection}>
              <h3 className={styles.noteSectionTitle}>
                <Paperclip size={12} aria-hidden /> Adjuntos ({attachments.length})
              </h3>
              <ul className={styles.noteAttachmentsList}>
                {attachments.map((a) => (
                  <li key={a.id}>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        {isImageMime(a.mime) ? (
                          <ImageIcon size={11} aria-hidden />
                        ) : (
                          <FileText size={11} aria-hidden />
                        )}
                        <span>{a.name}</span>
                      </a>
                    ) : (
                      <span>
                        {isImageMime(a.mime) ? (
                          <ImageIcon size={11} aria-hidden />
                        ) : (
                          <FileText size={11} aria-hidden />
                        )}
                        <span>{a.name}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* CIE-10 estructurados (NOM-024) */}
          <section className={styles.noteSection}>
            <h3 className={styles.noteSectionTitle}>Diagnósticos CIE-10 (NOM-024)</h3>
            {isSigned ? (
              dxs.length > 0 ? (
                <ul className={styles.noteIcdList}>
                  {dxs.map((d) => (
                    <li key={d.id}>
                      {d.isPrimary && <span style={{ color: "#7c3aed", fontWeight: 700 }}>★ </span>}
                      <code>{d.cie10Code}</code> — {d.cie10?.description ?? ""}
                      {d.note && <span style={{ color: "var(--text-3)", marginLeft: 6 }}>· {d.note}</span>}
                    </li>
                  ))}
                </ul>
              ) : icd10.length > 0 ? (
                <ul className={styles.noteIcdList}>
                  {icd10.map((c) => (
                    <li key={c.code}>
                      <code>{c.code}</code> — {c.label}
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-4)" }}>(legacy)</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 12, color: "var(--text-3)" }}>Sin diagnósticos.</p>
              )
            ) : (
              <Cie10Selector
                diagnoses={dxs}
                onAdd={handleAddDx}
                onRemove={handleRemoveDx}
              />
            )}
          </section>

          {!isSigned && (
            <div className={styles.noteDraftHint}>
              <AlertCircle size={12} aria-hidden />
              Una vez firmada, esta nota queda inalterable y formará parte
              del expediente clínico legal del paciente.
            </div>
          )}
        </div>

        <footer className={styles.noteModalFooter}>
          {isSigned ? (
            <>
              <span className={styles.noteFooterLeft}>
                Read-only · expediente firmado
              </span>
              <button
                type="button"
                className={styles.noteBtnPrimary}
                onClick={handleDownloadPdf}
                disabled={downloading}
              >
                <FileDown size={12} aria-hidden />
                {downloading ? "Generando…" : "Descargar PDF"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.noteBtnGhost}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.noteBtnSecondary}
                onClick={() => handleSave(false)}
                disabled={saving || signing}
              >
                <Save size={12} aria-hidden />
                {saving ? "Guardando…" : "Guardar borrador"}
              </button>
              <button
                type="button"
                className={styles.noteBtnPrimary}
                onClick={() => handleSave(true)}
                disabled={saving || signing}
              >
                <CheckCircle2 size={12} aria-hidden />
                {signing ? "Firmando…" : "Firmar nota"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function SoapSection({ label, value }: { label: string; value: string | null }) {
  return (
    <section className={styles.noteSoapBlock}>
      <h3 className={styles.noteSoapBlockLabel}>{label}</h3>
      {value && value.trim().length > 0 ? (
        <p className={styles.noteSoapBlockText}>{value}</p>
      ) : (
        <p className={styles.noteSoapBlockEmpty}>Sin registro</p>
      )}
    </section>
  );
}

function SoapField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={styles.noteSoapFieldWrap}>
      <span className={styles.noteSoapFieldLabel}>{label}</span>
      <textarea
        className={styles.noteSoapFieldInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={`Describe ${label.split(" — ")[1]?.toLowerCase() ?? "..."}`}
      />
    </label>
  );
}
