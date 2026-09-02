"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Box, FileText, Image as ImageIcon, Layers, Upload, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_MAX_STUDY_LABEL,
  EDU_STUDY_ACCEPT,
  eduExtOfName,
  eduFormatBytes,
  eduStudyKindForExt,
  type EduStudyRow,
} from "@/lib/edu/estudios-core";
import { EDU_STUDY_KIND_LABELS, type EduStudyKind } from "@/lib/edu/types";
import type { EduCaseOption } from "@/lib/edu/expediente-core";
import type { EduIaEstado } from "@/lib/edu/ia-core";
import type { Dictionary } from "@/i18n/t";
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
  /**
   * true = la galería se topó con el techo y hay estudios MÁS VIEJOS que no
   * viajaron. Igual que en el expediente: sin el aviso, "no está" y "no
   * cupo" se ven exactamente igual, y lo que se concluye es que la
   * panorámica de hace año y medio nunca se subió.
   */
  truncated: boolean;
  /** El techo, para poder decir el número en vez de "hay más". */
  maxRows: number;
  cases: EduCaseOption[];
  canUpload: boolean;
  /** Ola 3B: estado del apoyo de IA, resuelto en el SERVIDOR. */
  iaAnalisis: EduIaEstado;
  canAnalyze: boolean;
  /** Ola 12: el trozo de diccionario que necesita el visor de mallas 3D. */
  dict3d: Dictionary;
  /** Ola 12: abrir el modal de subida al llegar (viene de ?subir=1, el
   *  botón "Subir estudio" de la ficha). */
  abrirSubida?: boolean;
}

const ICONO: Record<EduStudyKind, typeof ImageIcon> = {
  RADIOGRAFIA: ImageIcon,
  TOMOGRAFIA: Layers,
  FOTO: ImageIcon,
  PDF: FileText,
  OTRO: FileText,
  MODELO_3D: Box,
};

/**
 * Ola 12 — la galería se parte COMO EL DENTAL (radiografías · fotos ·
 * archivos · modelos 3D), pero en UNA pestaña con filtros y no en cuatro
 * pestañas: esta pantalla se usa en un teléfono, de pie, y cuatro pestañas
 * más dentro de una ficha que ya tiene nueve son un carrusel de toques. El
 * CBCT vive en "Modelos 3D" junto a las mallas —igual que en el dental—
 * porque los dos se abren en visor 3D; el corte suelto .dcm también.
 */
type EduEstudioFiltro = "todos" | "radiografias" | "fotos" | "archivos" | "modelos3d";

const FILTRO_KINDS: Record<Exclude<EduEstudioFiltro, "todos">, EduStudyKind[]> = {
  radiografias: ["RADIOGRAFIA"],
  fotos: ["FOTO"],
  archivos: ["PDF", "OTRO"],
  modelos3d: ["TOMOGRAFIA", "MODELO_3D"],
};

const FILTRO_LABELS: Record<EduEstudioFiltro, string> = {
  todos: "Todos",
  radiografias: "Radiografías",
  fotos: "Fotos",
  archivos: "Archivos",
  modelos3d: "Modelos 3D",
};

const FILTRO_ORDEN: EduEstudioFiltro[] = [
  "todos",
  "radiografias",
  "fotos",
  "archivos",
  "modelos3d",
];

const FASE_LABEL: Record<EduUploadPhase, string> = {
  firmando: "Preparando…",
  subiendo: "Subiendo",
  reintentando: "Reintentando",
  registrando: "Registrando…",
};

export function EduEstudiosScreen({
  patientId,
  rows,
  truncated,
  maxRows,
  cases,
  canUpload,
  iaAnalisis,
  canAnalyze,
  dict3d,
  abrirSubida,
}: EduEstudiosScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  // El modal puede llegar ABIERTO (?subir=1: el botón de la ficha). Solo el
  // estado inicial — después manda la persona.
  const [subir, setSubir] = useState(Boolean(abrirSubida && canUpload));
  const [ver, setVer] = useState<EduStudyRow | null>(null);
  const [filtro, setFiltro] = useState<EduEstudioFiltro>("todos");

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  // Al cerrar el modal que llegó abierto se limpia el ?subir=1: si se
  // quedara en la URL, un refresh del teléfono lo volvería a abrir.
  function cerrarSubida() {
    setSubir(false);
    if (abrirSubida && pathname) router.replace(pathname, { scroll: false });
  }

  const cuentas = useMemo(() => {
    const c: Record<EduEstudioFiltro, number> = {
      todos: rows.length,
      radiografias: 0,
      fotos: 0,
      archivos: 0,
      modelos3d: 0,
    };
    for (const r of rows) {
      for (const f of ["radiografias", "fotos", "archivos", "modelos3d"] as const) {
        if (FILTRO_KINDS[f].includes(r.kind)) c[f] += 1;
      }
    }
    return c;
  }, [rows]);

  const visibles = useMemo(
    () => (filtro === "todos" ? rows : rows.filter((r) => FILTRO_KINDS[filtro].includes(r.kind))),
    [rows, filtro],
  );

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
            : `${visibles.length} ${visibles.length === 1 ? "estudio" : "estudios"}${
                truncated ? ` (se muestran los ${maxRows} más recientes)` : ""
              }`}
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

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Se muestran los {maxRows} estudios más recientes, no todos.
            </p>
            <p className="edu-banner__detail">
              Este paciente tiene más archivos de los que caben en una pantalla. Los filtros de
              aquí abajo ordenan lo que ya llegó, así que un tipo puede salir en cero aunque el
              paciente sí tenga estudios viejos de ese tipo.
            </p>
          </div>
        </div>
      )}

      {/* Los filtros solo se pintan cuando hay algo que filtrar: con la
          galería vacía serían cinco botones sobre la nada. */}
      {rows.length > 0 && (
        <div className="edu-filtros" role="group" aria-label="Filtrar por tipo de estudio">
          {FILTRO_ORDEN.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              className={`edu-filtro ${filtro === f ? "edu-filtro--on" : ""}`}
              onClick={() => setFiltro(f)}
            >
              {FILTRO_LABELS[f]}
              <span className="edu-filtro__n">{cuentas[f]}</span>
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay estudios</p>
          <p className="edu-empty__detail">
            Aquí van las radiografías, las tomografías CBCT, las fotos intraorales, los reportes en
            PDF y las mallas 3D del escáner. Hasta {EDU_MAX_STUDY_LABEL} por archivo: el binario
            sube directo al almacenamiento, sin pasar por el servidor.
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Nada de este tipo</p>
          <p className="edu-empty__detail">
            Este paciente no tiene {FILTRO_LABELS[filtro].toLowerCase()} todavía. Cambia el filtro
            o sube el primero.
          </p>
        </div>
      ) : (
        <div className="edu-estudios">
          {visibles.map((e) => {
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
          onClose={cerrarSubida}
          onDone={(nombre) => {
            cerrarSubida();
            recargar(`"${nombre}" quedó en el expediente.`);
          }}
        />
      )}

      {ver && (
        <EduEstudioViewer
          estudio={ver}
          onClose={() => setVer(null)}
          iaAnalisis={iaAnalisis}
          canAnalyze={canAnalyze}
          dict3d={dict3d}
        />
      )}
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
  // Ola 12 — radiografía y foto intraoral llegan como la MISMA imagen y no
  // hay forma de distinguirlas por el archivo: se pregunta aquí, solo para
  // imágenes. Para todo lo demás el tipo lo decide la extensión en el
  // servidor y esta elección se ignora (eduResolveStudyKind).
  const [kindImagen, setKindImagen] = useState<"RADIOGRAFIA" | "FOTO">("RADIOGRAFIA");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [fase, setFase] = useState<EduUploadPhase | null>(null);
  const [intento, setIntento] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // El AbortController vive en una ref y no en el estado: cambiarlo no
  // tiene por qué repintar, y en el estado se perdería entre renders justo
  // cuando alguien pulsa "Cancelar".
  const abortRef = useRef<AbortController | null>(null);

  // ¿El archivo elegido es una IMAGEN? Solo entonces se pregunta qué es.
  // La misma regla que aplica el servidor, importada del mismo módulo puro.
  const esImagen = file ? eduStudyKindForExt(eduExtOfName(file.name)) === "RADIOGRAFIA" : false;

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
        kind: esImagen ? kindImagen : null,
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

      {esImagen && (
        <div className="edu-field">
          <span className="edu-field__label">¿Qué es esta imagen?</span>
          <div className="edu-filtros" role="radiogroup" aria-label="Tipo de la imagen">
            {(["RADIOGRAFIA", "FOTO"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kindImagen === k}
                disabled={busy}
                className={`edu-filtro ${kindImagen === k ? "edu-filtro--on" : ""}`}
                onClick={() => setKindImagen(k)}
              >
                {k === "RADIOGRAFIA" ? "Radiografía" : "Fotografía"}
              </button>
            ))}
          </div>
          <span className="edu-field__hint">
            Una placa exportada y una foto intraoral llegan como la misma imagen: dinos cuál es
            para que la galería la acomode en su filtro.
          </span>
        </div>
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
