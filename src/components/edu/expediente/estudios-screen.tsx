"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Box, FileText, Image as ImageIcon, Layers, Upload, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_MAX_STUDY_LABEL,
  EDU_SIGNED_URL_TTL_SECONDS,
  EDU_STUDY_ACCEPT,
  eduExtOfName,
  eduFormatBytes,
  type EduStudyRow,
} from "@/lib/edu/estudios-core";
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
 * 🔴 AQUÍ NO SE PREGUNTA "¿QUÉ TIPO DE ESTUDIO ES?". Lo dice el archivo:
 * un .zip o un .dcm es una tomografía, un .stl es una malla, un .pdf es un
 * documento y un .jpg es una imagen. Preguntarlo era pedirle a la persona
 * que clasificara lo que el servidor ya sabe, y abría la puerta a un .zip
 * de 600 MB registrado como "Foto". El `kind` sigue existiendo en la base
 * —lo usan el expediente, la línea de tiempo y la IA— y lo decide la
 * EXTENSIÓN del path que compuso el servidor (`eduResolveStudyKind`); lo
 * que desapareció es la taxonomía de la pantalla.
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
  /**
   * S-9 · Cuándo se firmaron las URLs de los archivos (ISO). Caducan a la
   * hora y esta pantalla se queda abierta toda la sesión clínica: sin este
   * dato, pasado ese rato cada miniatura da un 403 mudo que se lee como
   * "el archivo se perdió".
   */
  signedAt: string;
  canUpload: boolean;
  /** Estado del apoyo de IA, resuelto en el SERVIDOR. */
  iaAnalisis: EduIaEstado;
  canAnalyze: boolean;
  /** El trozo de diccionario que necesita el visor de mallas 3D. */
  dict3d: Dictionary;
  /** Abrir el modal de subida al llegar (viene de ?subir=1, el botón
   *  "Subir estudio" de la ficha). */
  abrirSubida?: boolean;
}

/**
 * El icono de la tarjeta sale de la EXTENSIÓN, no del `kind` de la fila: es
 * el mismo criterio con el que se elige el visor al abrirla, y así la
 * miniatura nunca promete algo distinto de lo que se va a abrir.
 */
function iconoDeArchivo(name: string): typeof ImageIcon {
  switch (eduExtOfName(name)) {
    case "zip":
    case "dcm":
    case "dicom":
      return Layers;
    case "stl":
    case "ply":
    case "obj":
      return Box;
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
      return ImageIcon;
    default:
      return FileText;
  }
}

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
  signedAt,
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

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * S-9 · LA URL FIRMADA CADUCA, Y AHORA SE DICE.
   *
   * Los archivos se sirven con una URL firmada de una hora. El TTL es largo
   * a propósito —esta galería se queda abierta toda la sesión clínica y una
   * URL de cinco minutos convertiría "enséñame la radiografía otra vez" en
   * una recarga— pero una hora TAMBIÉN se acaba, y cuando se acababa cada
   * miniatura y cada "Abrir" contestaban un 403 mudo. Lo que veía el alumno
   * era una galería de imágenes rotas: no "caducó el enlace", sino "se
   * perdieron las radiografías del paciente".
   *
   * Se avisa un minuto ANTES de que expire y se ofrece renovar, que es un
   * `router.refresh()`: la página es `force-dynamic` y vuelve a firmarlo
   * todo. Y si aun así una imagen falla al cargar, el `onError` de la
   * miniatura levanta el mismo aviso — el reloj puede ir corrido, y la
   * prueba de que caducó es que no carga.
   * ═══════════════════════════════════════════════════════════════════════
   */
  const [caducadas, setCaducadas] = useState(false);

  useEffect(() => {
    setCaducadas(false);
    const firmadas = Date.parse(signedAt);
    if (!Number.isFinite(firmadas)) return;
    // Un minuto de margen: mejor avisar de sobra que servir un 403.
    const faltan = firmadas + (EDU_SIGNED_URL_TTL_SECONDS - 60) * 1000 - Date.now();
    if (faltan <= 0) {
      setCaducadas(true);
      return;
    }
    const t = setTimeout(() => setCaducadas(true), faltan);
    return () => clearTimeout(t);
  }, [signedAt]);

  // Al cerrar el modal que llegó abierto se limpia el ?subir=1: si se
  // quedara en la URL, un refresh del teléfono lo volvería a abrir.
  function cerrarSubida() {
    setSubir(false);
    if (abrirSubida && pathname) router.replace(pathname, { scroll: false });
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
            : `${rows.length} ${rows.length === 1 ? "estudio" : "estudios"}${
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

      {caducadas && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Los enlaces de los archivos caducaron</p>
            <p className="edu-banner__detail">
              Por seguridad, los archivos se sirven con un enlace temporal que dura una hora, y esta
              pestaña lleva más abierta. Las miniaturas y los estudios que abras ahora fallarían.
              Actualiza para renovarlos: no se pierde nada, los archivos siguen ahí.
            </p>
            <p>
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => startNav(() => router.refresh())}
                disabled={navigating}
              >
                {navigating ? "Renovando…" : "Renovar los enlaces"}
              </button>
            </p>
          </div>
        </div>
      )}

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Se muestran los {maxRows} estudios más recientes, no todos.
            </p>
            <p className="edu-banner__detail">
              Este paciente tiene más archivos de los que caben en una pantalla. Lo que falta
              son los MÁS VIEJOS: si buscas una panorámica de hace año y medio y no la ves,
              no quiere decir que nadie la haya subido.
            </p>
          </div>
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
      ) : (
        <div className="edu-estudios">
          {rows.map((e) => {
            const Icono = iconoDeArchivo(e.name);
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
                    <img
                      src={e.url}
                      alt={e.name}
                      loading="lazy"
                      // S-9 · La prueba de que el enlace caducó es que no
                      // carga. El reloj del navegador puede ir corrido, así
                      // que el temporizador no es la única señal.
                      onError={() => setCaducadas(true)}
                    />
                  ) : (
                    <Icono size={34} />
                  )}
                </button>

                <span className="edu-estudio__name">{e.name}</span>
                <span className="edu-estudio__meta">
                  {e.sizeLabel} · {e.createdLabel}
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
          patientId={patientId}
          onClose={() => setVer(null)}
          iaAnalisis={iaAnalisis}
          canAnalyze={canAnalyze}
          // S-7 · el permiso de ESCRITURA del expediente. Con solo
          // `estudios.view` la nota se lee y no se ofrece editarla —
          // tampoco la del CBCT, cuyo "Guardar" contestaba 403 siempre.
          canUpload={canUpload}
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
          mallas (.stl .ply .obj). No hace falta decir qué es: lo deduce el archivo.
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
