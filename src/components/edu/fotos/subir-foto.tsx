"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { EDU_PHOTO_ACCEPT, eduValidarFotoSubida } from "@/lib/edu/fotos-core";
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
import { EduFotoIlegible, eduPrepararFoto, type EduFotoPreparada } from "@/components/edu/fotos/comprimir";
import {
  EduFotoUploadCancelled,
  eduUploadPhoto,
  type EduFotoUploadPhase,
} from "@/components/edu/fotos/subir-foto-client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * SUBIR UNA FOTO CLÍNICA — desde el teléfono, con el paciente delante.
 *
 * 🔴 N-2 · EL BINARIO YA NO PASA POR EL SERVIDOR. Sube DIRECTO al bucket,
 * en los mismos tres pasos que un estudio de 2 GB, porque el cuerpo de un
 * route handler se corta muy por debajo de lo que pesa una foto de teléfono
 * y el `bodySizeLimit` de `next.config.mjs` solo cubre las server actions.
 *
 * 🔴 Y POR ESO LA COMPRESIÓN ES OBLIGATORIA Y VIVE AQUÍ. Sharp no va a ver
 * esta foto nunca: lo que sale del canvas es exactamente lo que queda en el
 * expediente. Si el navegador no puede decodificar el archivo (HEIC en un
 * escritorio), NO se manda el original — se dice por qué y se ofrece la
 * salida. Subir un binario que después nadie sabe pintar es sembrar la
 * tarjeta rota de N-5.
 *
 * 🔴 LA ETAPA ES OBLIGATORIA Y NO TIENE VALOR POR DEFECTO EN LA PANTALLA.
 * Es el ÚNICO campo del que depende el comparador: sin etapa no hay antes
 * ni después. El servidor sí tiene un default (PRE) para una fila escrita
 * a mano, pero dejarlo preseleccionado aquí produciría galerías enteras de
 * "Antes" que nadie eligió — y un comparador que enseña dos "antes" parece
 * que dice que no hubo tratamiento.
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

const FASE_LABEL: Record<EduFotoUploadPhase, string> = {
  preparando: "Preparando la foto…",
  firmando: "Preparando la subida…",
  subiendo: "Subiendo",
  reintentando: "Reintentando",
  registrando: "Registrando…",
};

export function EduSubirFoto({
  patientId,
  cases,
  todayISO,
  onClose,
  onDone,
}: EduSubirFotoProps) {
  /**
   * N-12 · CON UN SOLO CASO ABIERTO, LA FOTO SE ENGANCHA A ÉL.
   *
   * El comentario de esta pantalla ya decía «con uno, la respuesta es
   * obvia y preguntarla es un trámite» — pero el código no aplicaba esa
   * respuesta: escondía el desplegable y dejaba `caseId` vacío, así que en
   * el caso más común de una escuela (un paciente, un caso) NINGUNA foto
   * quedaba ligada a su caso.
   *
   * Y se cuentan los ABIERTOS, no todos: `cases` incluye los cerrados, así
   * que «más de uno» no describía ni lo que contaba ni lo que permitía.
   */
  const abiertos = useMemo(() => cases.filter((c) => c.isOpen), [cases]);
  const unico = abiertos.length === 1 ? abiertos[0] : null;

  const [file, setFile] = useState<File | null>(null);
  const [prep, setPrep] = useState<EduFotoPreparada | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [stage, setStage] = useState<EduPhotoStage | "">("");
  const [photoType, setPhotoType] = useState<EduPhotoType>("OTRA");
  const [dia, setDia] = useState(todayISO);
  const [caseId, setCaseId] = useState(unico ? unico.id : "");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [fase, setFase] = useState<EduFotoUploadPhase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const archivoRef = useRef<HTMLInputElement | null>(null);
  const camaraRef = useRef<HTMLInputElement | null>(null);
  // El AbortController vive en una ref y no en el estado: cambiarlo no
  // tiene por qué repintar, y en el estado se perdería entre renders justo
  // cuando alguien pulsa "Cancelar".
  const abortRef = useRef<AbortController | null>(null);

  async function elegir(f: File | null) {
    setError(null);
    setPrep(null);
    setFile(null);
    if (!f) return;
    // La validación de CORTESÍA sobre el archivo ELEGIDO: formato y tope.
    // El servidor vuelve a comprobarlo todo sobre el binario que de verdad
    // llega al bucket.
    //
    // 🔴 El archivo malo NO se queda seleccionado: si se quedara, «Subir»
    // seguiría encendido debajo del error y quien lo pulsara volvería a
    // esperar para leer lo mismo.
    const malo = eduValidarFotoSubida({ mime: f.type, size: f.size });
    if (malo) {
      setError(malo);
      return;
    }
    setPreparando(true);
    try {
      // 🔴 SE PREPARA AL ELEGIR, no al pulsar «Subir»: así el «este
      // navegador no puede leer HEIC» sale ANTES de que la persona rellene
      // etapa, vista, fecha y nota para nada.
      const listo = await eduPrepararFoto(f);
      setFile(f);
      setPrep(listo);
    } catch (e) {
      setError(
        e instanceof EduFotoIlegible
          ? e.message
          : "No se pudo preparar la foto. Vuelve a elegirla.",
      );
    } finally {
      setPreparando(false);
    }
  }

  async function subir() {
    if (!file || !prep || !stage) return;
    setError(null);
    setBusy(true);
    setPct(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await eduUploadPhoto({
        patientId,
        file,
        preparada: prep,
        stage,
        photoType,
        // Mediodía UTC para que el día no se corra al leerlo en la zona del
        // instituto (eduDiaISOaInstante lo explica).
        capturedAt: dia ? eduDiaISOaInstante(dia) : null,
        caseId: caseId || null,
        notes: notas.trim() || null,
        onProgress: setPct,
        onPhase: (f) => setFase(f),
        signal: controller.signal,
      });
      onDone(
        `La foto quedó en el expediente, en "${EDU_PHOTO_STAGE_LABELS[stage as EduPhotoStage]}".`,
      );
    } catch (e) {
      if (e instanceof EduFotoUploadCancelled) {
        setError("Subida cancelada. No quedó nada en el expediente.");
      } else {
        // 🔴 El mensaje del servidor se enseña TAL CUAL: dice el tope, o
        // que el contenido no es una imagen, o —en un 507— cuánto le queda
        // a la escuela y a quién avisarle. Un "Error 413" no le sirve a nadie.
        setError(e instanceof Error ? e.message : "No se pudo subir la foto.");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setFase(null);
    }
  }

  return (
    <EduModal
      title="Subir una foto clínica"
      /* 🔴 N-2 · EL SUBTÍTULO YA NO PROMETE 25 MB. Prometía un tope que la
         tubería no aguantaba; ahora dice lo que de verdad pasa. */
      subtitle="Se encoge aquí, en tu dispositivo, y sube directo al almacenamiento sin pasar por el servidor."
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
            onClick={() => void subir()}
            disabled={busy || preparando || !prep || !stage}
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

      {prep && !preparando && (
        <p className="edu-note">
          {prep.fileName} · {eduFormatBytes(prep.size)}
          {prep.originalSize > prep.size
            ? ` (se encogió aquí desde ${eduFormatBytes(prep.originalSize)})`
            : ""}
          {prep.thumb ? "" : " · sin miniatura: este navegador no genera WebP"}
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

      {/* N-12 · El desplegable sale cuando hay MÁS DE UN caso entre los que
          elegir. Con uno solo abierto no se pregunta, pero la foto SÍ se
          engancha a él —lo que este bloque siempre dijo que hacía— y se
          dice a cuál, para que nadie tenga que adivinarlo. */}
      {cases.length > 1 ? (
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
      ) : (
        unico && (
          <p className="edu-note">
            Se guarda en el caso de {unico.programName} · {unico.studentMatricula}, el único
            abierto de este paciente.
          </p>
        )
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
          <span className="edu-estudio__meta">
            {fase ? FASE_LABEL[fase] : "Subiendo"} · {pct}%
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
            No cierres esta ventana. Al terminar, el servidor mide el archivo y comprueba que de
            verdad es una imagen antes de dejarlo en el expediente.
          </span>
        </div>
      )}
    </EduModal>
  );
}
