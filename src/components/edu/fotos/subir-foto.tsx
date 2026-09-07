"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_MAX_PHOTO_LABEL,
  EDU_PHOTO_ACCEPT,
  eduValidarFotoSubida,
} from "@/lib/edu/fotos-core";
import { eduDiaISOaInstante, eduFormatBytes } from "@/lib/edu/estudios-core";
import type { EduCaseOption } from "@/lib/edu/expediente-core";
import {
  EDU_PHOTO_STAGE_DESCRIPTIONS,
  EDU_PHOTO_STAGE_LABELS,
  EDU_PHOTO_STAGES,
  EDU_PHOTO_TYPE_LABELS,
  EDU_PHOTO_TYPES,
  type EduPhotoStage,
  type EduPhotoType,
} from "@/lib/edu/types";
import {
  EDU_FOTO_UMBRAL_LABEL,
  eduPrepararFoto,
  type EduFotoPreparada,
} from "@/components/edu/fotos/comprimir";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * SUBIR UNA FOTO CLÍNICA — desde el teléfono, con el paciente delante.
 *
 * 🔴 AQUÍ EL BINARIO SÍ PASA POR EL SERVIDOR, al revés que los estudios.
 * Una foto cabe en 25 MB y a cambio el servidor puede comprobar el MIME
 * por número mágico, encogerla a 2 400 px y sacarle miniatura — tres cosas
 * que un estudio de 2 GB no puede pagar porque sube directo al bucket.
 *
 * 🔴 LA ETAPA ES OBLIGATORIA Y NO TIENE VALOR POR DEFECTO EN LA PANTALLA.
 * Es el ÚNICO campo del que depende el comparador: sin etapa no hay antes
 * ni después. El servidor sí tiene un default (PRE) para una fila escrita
 * a mano, pero dejarlo preseleccionado aquí produciría galerías enteras de
 * "Antes" que nadie eligió — y un comparador que enseña dos "antes" parece
 * que dice que no hubo tratamiento.
 *
 * 🔴 EL PUT VA POR XMLHttpRequest Y NO POR fetch: `fetch` todavía no
 * expone progreso de SUBIDA, y una foto de 20 MB por 4G sin porcentaje es
 * indistinguible de una colgada. Es la misma razón que en
 * edu-upload-client.ts, y por eso este archivo lo repite en tres líneas en
 * vez de importar aquel, que orquesta los tres pasos de los estudios.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduSubirFotoProps {
  patientId: string;
  cases: EduCaseOption[];
  /** HOY en el calendario del INSTITUTO, no en el del navegador. */
  todayISO: string;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}

export function EduSubirFoto({
  patientId,
  cases,
  todayISO,
  onClose,
  onDone,
}: EduSubirFotoProps) {
  const [file, setFile] = useState<File | null>(null);
  const [prep, setPrep] = useState<EduFotoPreparada | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [stage, setStage] = useState<EduPhotoStage | "">("");
  const [photoType, setPhotoType] = useState<EduPhotoType>("OTRA");
  const [dia, setDia] = useState(todayISO);
  const [caseId, setCaseId] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const archivoRef = useRef<HTMLInputElement | null>(null);
  const camaraRef = useRef<HTMLInputElement | null>(null);
  // El XHR vive en una ref y no en el estado: cambiarlo no tiene por qué
  // repintar, y en el estado se perdería entre renders justo cuando
  // alguien pulsa "Cancelar".
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  async function elegir(f: File | null) {
    setError(null);
    setPrep(null);
    setFile(null);
    if (!f) return;
    // La validación de CORTESÍA: el servidor vuelve a comprobarlo todo, y
    // además contra el contenido real. Esto solo evita que alguien espere
    // una subida que iba a rebotar igual.
    //
    // 🔴 El archivo malo NO se queda seleccionado: si se quedara, «Subir»
    // seguiría encendido debajo del error y quien lo pulsara volvería a
    // esperar para leer lo mismo desde el servidor.
    const malo = eduValidarFotoSubida({ mime: f.type, size: f.size });
    if (malo) {
      setError(malo);
      return;
    }
    setFile(f);
    setPreparando(true);
    try {
      setPrep(await eduPrepararFoto(f));
    } finally {
      setPreparando(false);
    }
  }

  function subir() {
    if (!file || !stage) return;
    const listo = prep ?? { blob: file, fileName: file.name, size: file.size, comprimida: false };
    setError(null);
    setBusy(true);
    setPct(0);

    const form = new FormData();
    // El tercer argumento del `append` es el NOMBRE del archivo: sin él, un
    // Blob comprimido viaja como "blob" y el path del bucket se queda con
    // ese nombre para siempre.
    form.append("file", listo.blob, listo.fileName);
    form.append("etapa", stage);
    form.append("vista", photoType);
    // Mediodía UTC para que el día no se corra al leerlo en la zona del
    // instituto (eduDiaISOaInstante lo explica).
    if (dia) form.append("capturedAt", eduDiaISOaInstante(dia));
    if (caseId) form.append("caseId", caseId);
    if (notas.trim()) form.append("notas", notas.trim());

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `/api/instituto/pacientes/${patientId}/fotos`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setPct(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      setBusy(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        onDone(
          `La foto quedó en el expediente, en "${EDU_PHOTO_STAGE_LABELS[stage as EduPhotoStage]}".`,
        );
        return;
      }
      // 🔴 El mensaje del servidor se enseña TAL CUAL: dice el tope (25 MB),
      // o que el contenido no es una imagen, o —en un 507— cuánto le queda
      // a la escuela y a quién avisarle. Un "Error 413" no le sirve a nadie.
      setError(mensajeDelServidor(xhr));
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setBusy(false);
      setError("Se cortó la conexión al subir la foto. Vuelve a intentarlo.");
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      setBusy(false);
      setError("Subida cancelada. No quedó nada en el expediente.");
    };
    xhr.send(form);
  }

  const pesoFinal = prep ? prep.size : file ? file.size : 0;

  return (
    <EduModal
      title="Subir una foto clínica"
      subtitle={`Hasta ${EDU_MAX_PHOTO_LABEL} por foto. Se encoge en el teléfono y otra vez en el servidor.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {busy ? (
            <button
              type="button"
              className="edu-btn edu-btn--danger"
              onClick={() => xhrRef.current?.abort()}
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
            disabled={busy || preparando || !file || !stage}
          >
            {busy ? "Subiendo…" : "Subir la foto"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {/* ── El archivo, o la cámara ─────────────────────────────────────
          Dos entradas y no una: en un teléfono, `capture="environment"`
          abre la cámara TRASERA directamente, que es la que se usa para la
          boca de otra persona. El mismo input sin `capture` deja elegir de
          la galería, que es lo que hace quien sube desde el escritorio. */}
      <div className="edu-fotos-subir__origen">
        <button
          type="button"
          className="edu-btn edu-btn--ghost"
          disabled={busy}
          onClick={() => camaraRef.current?.click()}
        >
          <Camera size={16} />
          Tomar la foto
        </button>
        <button
          type="button"
          className="edu-btn edu-btn--ghost"
          disabled={busy}
          onClick={() => archivoRef.current?.click()}
        >
          <ImagePlus size={16} />
          Elegir del teléfono
        </button>
      </div>

      <input
        ref={camaraRef}
        className="edu-fotos-oculto"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Tomar la foto con la cámara"
        onChange={(e) => void elegir(e.target.files?.[0] ?? null)}
      />
      <input
        ref={archivoRef}
        className="edu-fotos-oculto"
        type="file"
        accept={EDU_PHOTO_ACCEPT}
        aria-label="Elegir una foto del dispositivo"
        onChange={(e) => void elegir(e.target.files?.[0] ?? null)}
      />

      {preparando && <p className="edu-note">Preparando la foto…</p>}

      {file && !preparando && (
        <p className="edu-note">
          {prep ? prep.fileName : file.name} · {eduFormatBytes(pesoFinal)}
          {prep?.comprimida
            ? ` (se encogió aquí desde ${eduFormatBytes(file.size)}: pesaba más de ${EDU_FOTO_UMBRAL_LABEL})`
            : ""}
        </p>
      )}

      {/* ── La ETAPA: lo único de lo que depende el comparador ────────── */}
      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-foto-etapa">
          Etapa <span className="edu-fotos-obl">obligatoria</span>
        </label>
        <select
          id="edu-foto-etapa"
          className="edu-input"
          value={stage}
          disabled={busy}
          onChange={(e) => setStage(e.target.value as EduPhotoStage | "")}
        >
          <option value="">Elige una…</option>
          {EDU_PHOTO_STAGES.map((s) => (
            <option key={s} value={s}>
              {EDU_PHOTO_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          {stage
            ? EDU_PHOTO_STAGE_DESCRIPTIONS[stage as EduPhotoStage]
            : "Es lo único que el comparador mira para saber cuál es el «antes» y cuál el «después». Por eso no viene puesta."}
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-foto-vista">
          Vista
        </label>
        <select
          id="edu-foto-vista"
          className="edu-input"
          value={photoType}
          disabled={busy}
          onChange={(e) => setPhotoType(e.target.value as EduPhotoType)}
        >
          {EDU_PHOTO_TYPES.map((t) => (
            <option key={t} value={t}>
              {EDU_PHOTO_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          Desde dónde se tomó. Se corrige después sin volver a subir nada.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-foto-fecha">
          Fecha de toma
        </label>
        <input
          id="edu-foto-fecha"
          className="edu-input"
          type="date"
          value={dia}
          max={todayISO}
          disabled={busy}
          onChange={(e) => setDia(e.target.value)}
        />
        <span className="edu-field__hint">
          Por defecto hoy. Es por la que se ordena el antes/después: si esta foto es de otra
          sesión, cámbiala.
        </span>
      </div>

      {/* El caso solo se pregunta si hay más de uno abierto: con uno, la
          respuesta es obvia y preguntarla es un trámite. */}
      {cases.length > 1 && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-foto-caso">
            Caso (opcional)
          </label>
          <select
            id="edu-foto-caso"
            className="edu-input"
            value={caseId}
            disabled={busy}
            onChange={(e) => setCaseId(e.target.value)}
          >
            <option value="">Sin caso · del paciente</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.programName} · {c.studentMatricula}
                {c.isOpen ? "" : " (cerrado)"}
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            La foto se ve igual desde cualquier caso del paciente: la cara es una sola.
          </span>
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-foto-notas">
          Nota (opcional)
        </label>
        <textarea
          id="edu-foto-notas"
          className="edu-input"
          rows={2}
          value={notas}
          maxLength={1000}
          disabled={busy}
          placeholder="Qué se ve, de qué sesión es."
          onChange={(e) => setNotas(e.target.value)}
        />
      </div>

      {busy && (
        <div className="edu-upload">
          <span className="edu-estudio__meta">Subiendo · {pct}%</span>
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
            No cierres esta ventana. Al llegar, el servidor comprueba que de verdad es una imagen y
            la vuelve a encoger.
          </span>
        </div>
      )}
    </EduModal>
  );
}

/**
 * El mensaje que escribió el servidor, o uno honesto si no llegó ninguno.
 *
 * Los tres que importan y por qué se distinguen:
 *   · 413 → la FOTO es demasiado grande (25 MB);
 *   · 507 → la ESCUELA no tiene sitio (cuota del contrato). Son dos topes
 *           distintos y confundirlos manda a la persona a encoger una foto
 *           que no era el problema;
 *   · 400 → el contenido no es una imagen (número mágico).
 */
function mensajeDelServidor(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* respuesta sin JSON */
  }
  if (xhr.status === 403) return "Tu cuenta no tiene permiso para subir fotos a este expediente.";
  if (xhr.status === 401) return "Tu sesión caducó. Vuelve a entrar.";
  return `No se pudo subir la foto (HTTP ${xhr.status}). Intenta de nuevo.`;
}
