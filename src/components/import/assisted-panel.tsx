"use client";

// Migración asistida — formulario (subir respaldo + nota + aviso de privacidad)
// y acuse "En revisión, 48 h". El botón "Enviar para revisión" vive en el footer
// del wizard; "Entendido" (estado enviado) se maneja aquí.
import { useRef, useState } from "react";
import { UploadCloud, FileText, ShieldCheck, Clock } from "lucide-react";
import type { TFunction } from "@/i18n/t";

interface Props {
  t: TFunction;
  file: File | null;
  note: string;
  sent: boolean;
  onFile: (f: File) => void;
  onRemove: () => void;
  onNote: (v: string) => void;
  onDone: () => void;
}

export function AssistedPanel({ t, file, note, sent, onFile, onRemove, onNote, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = () => inputRef.current?.click();

  if (sent) {
    return (
      <div className="imp-result">
        <div className="imp-seal imp-seal--brand" aria-hidden><Clock size={38} /></div>
        <h2 className="imp-result__title">{t("shell.importClinic.assisted.sentTitle")}</h2>
        <p className="imp-result__lead">{t("shell.importClinic.assisted.sentLead")}</p>
        <div className="imp-review-strip">
          <span className="imp-review-strip__ic" aria-hidden><Clock size={23} /></span>
          <div>
            <b>{t("shell.importClinic.assisted.sentStripTitle")}</b>
            <p>{t("shell.importClinic.assisted.sentStripDesc")}</p>
          </div>
        </div>
        <div className="imp-result__ctas" style={{ marginTop: 22 }}>
          <button type="button" className="btn-new btn-new--primary" onClick={onDone}>
            {t("shell.importClinic.assisted.done")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.assisted.title")}</h2>
      <p className="imp-sub">{t("shell.importClinic.assisted.sub")}</p>

      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {file ? (
        <div className="imp-file-row">
          <span className="imp-file-row__ic" aria-hidden><FileText size={22} /></span>
          <div className="imp-file-row__body">
            <div className="imp-file-row__nm">{file.name}</div>
            <div className="imp-file-row__meta">{t("shell.importClinic.assisted.ready")}</div>
          </div>
          <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={onRemove}>
            {t("shell.importClinic.step4.remove")}
          </button>
        </div>
      ) : (
        <div
          className={`imp-dropzone${dragging ? " is-drag" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={t("shell.importClinic.assisted.dropTitle")}
          onClick={pick}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        >
          <span className="imp-dz__ic" aria-hidden><UploadCloud size={28} /></span>
          <h4>{t("shell.importClinic.assisted.dropTitle")}</h4>
          <p>{t("shell.importClinic.assisted.dropHint")}</p>
          <p className="imp-dz__formats">{t("shell.importClinic.assisted.formats")}</p>
        </div>
      )}

      <div className="imp-field" style={{ marginTop: 18 }}>
        <label className="field-new__label" htmlFor="imp-assisted-note">
          {t("shell.importClinic.assisted.noteLabel")}
        </label>
        <textarea
          id="imp-assisted-note"
          className="input-new imp-textarea"
          placeholder={t("shell.importClinic.assisted.notePlaceholder")}
          value={note}
          onChange={(e) => onNote(e.target.value)}
        />
      </div>

      <div className="imp-note">
        <ShieldCheck size={20} aria-hidden />
        <p>{t("shell.importClinic.assisted.privacy")}</p>
      </div>
    </div>
  );
}
