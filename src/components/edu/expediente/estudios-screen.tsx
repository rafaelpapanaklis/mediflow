"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Layers, Upload, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_MAX_STUDY_LABEL,
  EDU_STUDY_ACCEPT,
  eduFormatBytes,
  type EduStudyRow,
} from "@/lib/edu/estudios-core";
import { EDU_STUDY_KIND_LABELS, type EduStudyKind } from "@/lib/edu/types";
import type { EduCaseOption } from "@/lib/edu/expediente-core";
import { EduEstudioViewer } from "@/components/edu/expediente/estudio-viewer";
import {
  EduUploadCancelled,
  eduUploadStudy,
  type EduUploadPhase,
} from "@/components/edu/expediente/edu-upload-client";

/**
 * /instituto/pacientes/[id]/estudios — radiografías, tomografías, fotos y
 * PDFs del paciente.
 *
 * 🔴 EL ARCHIVO NO PASA POR EL SERVIDOR. Una tomografía pesa cientos de MB
 * y el cuerpo de una petición en Vercel se corta muy por debajo de eso: el
 * navegador pide una URL firmada, sube DIRECTO al bucket y luego avisa. El
 * porcentaje que se ve aquí es real (viene de `xhr.upload.onprogress`), y
 * no un spinner que gira mientras se reza.
 *
 * ⚠️ Lo que se ve aquí son TODOS los estudios del paciente, no solo los del
 * caso propio. Es a propósito: una tomografía de la boca es de la boca, y
 * esconderle al de endodoncia la panorámica que pidió el de ortodoncia
 * significa que se la vuelvan a tomar al paciente.
 */
export interface EduEstudiosScreenProps {
  patientId: string;
  rows: EduStudyRow[];
  cases: EduCaseOption[];
  canUpload: boolean;
}

const ICONO: Record<EduStudyKind, typeof ImageIcon> = {
  RADIOGRAFIA: ImageIcon,
  TOMOGRAFIA: Layers,
  FOTO: ImageIcon,
  PDF: FileText,
  OTRO: FileText,
};

const FASE_LABEL: Record<EduUploadPhase, string> = {
  firmando: "Preparando…",
  subiendo: "Subiendo",
  reintentando: "Reintentando",
  registrando: "Registrando…",
};

export function EduEstudiosScreen({
  patientId,
  rows,
  cases,
  canUpload,
}: EduEstudiosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [subir, setSubir] = useState(false);
  const [ver, setVer] = useState<EduStudyRow | null>(null);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  return (
    <div className="edu-stack">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Actualizando…"
            : `${rows.length} ${rows.length === 1 ? "estudio" : "estudios"}`}
        </span>
        {canUpload && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setSubir(true);
            }}
          >
            <Upload size={16} />
            Subir estudio
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay estudios</p>
          <p className="edu-empty__detail">
            Aquí van las radiografías, las tomografías CBCT, las fotos intraorales y los reportes en
            PDF. Hasta {EDU_MAX_STUDY_LABEL} por archivo: el binario sube directo al almacenamiento,
            sin pasar por el servidor.
          </p>
        </div>
      ) : (
        <div className="edu-estudios">
          {rows.map((e) => {
            const Icono = ICONO[e.kind] ?? FileText;
            return (
              <article key={e.id} className="edu-estudio">
                <button
                  type="button"
                  className="edu-estudio__thumb"
                  onClick={() => setVer(e)}
                  aria-label={`Abrir ${e.name}`}
                  style={{ cursor: "pointer", padding: 0, font: "inherit" }}
                >
                  {e.isImage && e.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.url} alt={e.name} loading="lazy" />
                  ) : (
                    <Icono size={34} />
                  )}
                </button>

                <span className="edu-estudio__name">{e.name}</span>
                <span className="edu-estudio__meta">
                  {EDU_STUDY_KIND_LABELS[e.kind]} · {e.sizeLabel} · {e.createdLabel}
                </span>
                <span className="edu-estudio__meta">
                  {e.uploadedByName}
                  {e.caseProgramName ? ` · ${e.caseProgramName}` : ""}
                </span>
                {e.notes && <span className="edu-estudio__notes">{e.notes}</span>}

                <div className="edu-actions">
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => setVer(e)}
                  >
                    Abrir
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {subir && (
        <SubirEstudio
          patientId={patientId}
          cases={cases}
          onClose={() => setSubir(false)}
          onDone={(nombre) => {
            setSubir(false);
            recargar(`"${nombre}" quedó en el expediente.`);
          }}
        />
      )}

      {ver && <EduEstudioViewer estudio={ver} onClose={() => setVer(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Subida
// ═══════════════════════════════════════════════════════════════════════

function SubirEstudio({
  patientId,
  cases,
  onClose,
  onDone,
}: {
  patientId: string;
  cases: EduCaseOption[];
  onClose: () => void;
  onDone: (nombre: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [caseId, setCaseId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [fase, setFase] = useState<EduUploadPhase | null>(null);
  const [intento, setIntento] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // El AbortController vive en una ref y no en el estado: cambiarlo no
  // tiene por qué repintar, y en el estado se perdería entre renders justo
  // cuando alguien pulsa "Cancelar".
  const abortRef = useRef<AbortController | null>(null);

  async function subir() {
    if (!file) return;
    setError(null);
    setBusy(true);
    setPct(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await eduUploadStudy({
        patientId,
        file,
        caseId: caseId || null,
        notes: notes.trim() || null,
        onProgress: setPct,
        onPhase: (f, i) => {
          setFase(f);
          setIntento(i);
        },
        signal: controller.signal,
      });
      onDone(file.name);
    } catch (err) {
      if (err instanceof EduUploadCancelled) {
        setError("Subida cancelada. No quedó nada en el expediente.");
      } else {
        setError(err instanceof Error ? err.message : "No se pudo subir el estudio.");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setFase(null);
    }
  }

  return (
    <EduModal
      title="Subir un estudio"
      subtitle={`Hasta ${EDU_MAX_STUDY_LABEL} por archivo. El archivo sube directo al almacenamiento.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {busy ? (
            <button
              type="button"
              className="edu-btn edu-btn--danger"
              onClick={() => abortRef.current?.abort()}
            >
              <X size={16} />
              Cancelar subida
            </button>
          ) : (
            <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose}>
              Cancelar
            </button>
          )}
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={subir}
            disabled={busy || !file}
          >
            {busy ? "Subiendo…" : "Subir"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-est-file">
          Archivo
        </label>
        <input
          id="edu-est-file"
          className="edu-input"
          type="file"
          accept={EDU_STUDY_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            setError(null);
            setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null);
          }}
        />
        <span className="edu-field__hint">
          Imágenes (.jpg .png .webp), tomografías (.zip de cortes DICOM, .dcm), reportes (.pdf) y
          mallas (.stl .ply .obj).
        </span>
      </div>

      {file && (
        <p className="edu-note">
          {file.name} · {eduFormatBytes(file.size)}
        </p>
      )}

      {busy && (
        <div className="edu-upload">
          <span className="edu-estudio__meta">
            {fase ? FASE_LABEL[fase] : "Subiendo"}
            {fase === "reintentando" ? ` (${intento}/3)` : ""}
            {fase === "subiendo" ? ` · ${pct}%` : ""}
          </span>
          <div
            className="edu-progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="edu-progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="edu-estudio__meta">
            No cierres esta ventana. Si se corta la conexión se reintenta solo, hasta tres veces.
          </span>
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-est-caso">
          Caso (opcional)
        </label>
        <select
          id="edu-est-caso"
          className="edu-input"
          value={caseId}
          disabled={busy}
          onChange={(e) => setCaseId(e.target.value)}
        >
          <option value="">Sin caso · del paciente</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.programName} · {c.studentMatricula}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          Engancharlo a un caso ayuda a encontrarlo después. El estudio se ve igual desde cualquier
          caso del paciente: la boca es una sola.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-est-notas">
          Notas (opcional)
        </label>
        <textarea
          id="edu-est-notas"
          className="edu-input"
          rows={2}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}
