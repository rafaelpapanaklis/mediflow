"use client";

// Paso 4 · Subir — dropzone con 4 estados (vacío, arrastrando, cargado, error).
// Acepta clic, teclado (Enter/Espacio) y drag & drop. La validación (tipo/peso)
// la hace el wizard; aquí solo se emite el File y se pintan estados por props.
import { useRef, useState } from "react";
import { UploadCloud, AlertCircle, FileText, Check } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { MAX_FILE_MB } from "./import-client";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface Props {
  t: TFunction;
  file: File | null;
  /** Mensaje de error del último intento inválido (null = sin error). */
  error: string | null;
  onFile: (f: File) => void;
  onRemove: () => void;
}

export function StepUpload({ t, file, error, onFile, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = () => inputRef.current?.click();

  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.step4.title")}</h2>
      <p className="imp-sub">{t("shell.importClinic.step4.sub")}</p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ""; // permite re-elegir el mismo archivo
        }}
      />

      {file ? (
        <>
          <div className="imp-file-row">
            <span className="imp-file-row__ic" aria-hidden><FileText size={22} /></span>
            <div className="imp-file-row__body">
              <div className="imp-file-row__nm">{file.name}</div>
              <div className="imp-file-row__meta">{formatSize(file.size)}</div>
              <div className="imp-file-row__bar"><i style={{ width: "100%" }} /></div>
            </div>
            <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={onRemove}>
              {t("shell.importClinic.step4.remove")}
            </button>
          </div>
          <div className="imp-inline-msg is-ok">
            <Check size={17} aria-hidden /> {t("shell.importClinic.step4.validMsg")}
          </div>
        </>
      ) : (
        <>
          <div
            className={`imp-dropzone${dragging ? " is-drag" : ""}${error ? " is-error" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={t("shell.importClinic.step4.dropTitle")}
            onClick={pick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
            }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
          >
            <span className="imp-dz__ic" aria-hidden>
              {error ? <AlertCircle size={28} /> : <UploadCloud size={28} />}
            </span>
            <h4>{error ? t("shell.importClinic.step4.errorTitle") : t("shell.importClinic.step4.dropTitle")}</h4>
            <p>{error ? t("shell.importClinic.step4.errorHint") : t("shell.importClinic.step4.dropHint")}</p>
            <p className="imp-dz__formats">
              {error ? t("shell.importClinic.step4.errorRetry") : t("shell.importClinic.step4.formats", { mb: MAX_FILE_MB })}
            </p>
          </div>
          {error && (
            <div className="imp-inline-msg">
              <AlertCircle size={17} aria-hidden /> {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
