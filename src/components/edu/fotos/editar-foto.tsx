"use client";

import { useState } from "react";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import { eduDiaISOaInstante, eduInstanteADiaInput } from "@/lib/edu/estudios-core";
import type { EduPhotoRow } from "@/lib/edu/fotos-core";
import {
  EDU_PHOTO_STAGE_DESCRIPTIONS,
  EDU_PHOTO_STAGE_LABELS,
  EDU_PHOTO_STAGES,
  EDU_PHOTO_TYPE_LABELS,
  EDU_PHOTO_TYPES,
  type EduPhotoStage,
  type EduPhotoType,
} from "@/lib/edu/types";

/** El tope del motivo: el `@db.VarChar(500)` de `deleteReason`. */
export const EDU_FOTO_MOTIVO_MAX = 500;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CORREGIR una foto: etapa, vista, fecha de toma y nota.
 *
 * 🔴 EXISTE PORQUE EL ERROR QUE SE COMETE ES ÉSE. Marcar «Antes» lo que
 * era «Después» rompe el comparador EN SILENCIO: enseña dos «antes» y
 * parece que el tratamiento no hizo nada. Nadie ve un error; ven un
 * resultado malo.
 *
 * El archivo no se toca: lo que se corrige es cómo está etiquetada.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduCorregirFoto({
  patientId,
  foto,
  onClose,
  onDone,
}: {
  patientId: string;
  foto: EduPhotoRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [stage, setStage] = useState<EduPhotoStage>(foto.stage);
  const [vista, setVista] = useState<EduPhotoType>(foto.photoType);
  const [dia, setDia] = useState(eduInstanteADiaInput(foto.capturedAt));
  const [notas, setNotas] = useState(foto.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/fotos/${foto.id}`, {
        method: "PATCH",
        body: {
          etapa: stage,
          vista,
          // Mediodía UTC: con medianoche, leída en la zona del instituto,
          // la fecha se corre un día hacia atrás.
          capturedAt: dia ? eduDiaISOaInstante(dia) : undefined,
          notas,
        },
      });
      onDone(`La foto quedó en "${EDU_PHOTO_STAGE_LABELS[stage]}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo corregir la foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Corregir la foto"
      subtitle="El archivo no cambia: se corrige cómo está etiquetada en el expediente."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy}
          >
            {busy ? "Guardando…" : "Guardar"}
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
        <label className="edu-field__label" htmlFor={`edu-foto-etapa-${foto.id}`}>
          Etapa
        </label>
        <select
          id={`edu-foto-etapa-${foto.id}`}
          className="edu-input"
          value={stage}
          disabled={busy}
          onChange={(e) => setStage(e.target.value as EduPhotoStage)}
        >
          {EDU_PHOTO_STAGES.map((s) => (
            <option key={s} value={s}>
              {EDU_PHOTO_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">{EDU_PHOTO_STAGE_DESCRIPTIONS[stage]}</span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-foto-vista-${foto.id}`}>
          Vista
        </label>
        <select
          id={`edu-foto-vista-${foto.id}`}
          className="edu-input"
          value={vista}
          disabled={busy}
          onChange={(e) => setVista(e.target.value as EduPhotoType)}
        >
          {EDU_PHOTO_TYPES.map((t) => (
            <option key={t} value={t}>
              {EDU_PHOTO_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-foto-fecha-${foto.id}`}>
          Fecha de toma
        </label>
        <input
          id={`edu-foto-fecha-${foto.id}`}
          className="edu-input"
          type="date"
          value={dia}
          disabled={busy}
          onChange={(e) => setDia(e.target.value)}
        />
        <span className="edu-field__hint">
          Es por la que se ordena el antes/después. Una fecha en el futuro se rechaza: dejaría el
          comparador mal ordenado para siempre.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-foto-nota-${foto.id}`}>
          Nota
        </label>
        <textarea
          id={`edu-foto-nota-${foto.id}`}
          className="edu-input"
          rows={3}
          value={notas}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setNotas(e.target.value)}
        />
        <span className="edu-field__hint">Vacía borra la nota.</span>
      </div>
    </EduModal>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * RETIRAR una foto del expediente. Baja SUAVE, con autor y con MOTIVO.
 *
 * 🔴 NO BORRA NADA: ni la fila ni el archivo. Una foto que se retira sigue
 * siendo la constancia de que alguien la subió al paciente equivocado —
 * que es exactamente el caso para el que existe este botón—, y esa
 * constancia es lo que un expediente clínico no puede perder.
 *
 * El motivo es obligatorio: sin él, «retirar» y «borrar» son la misma cosa
 * con distinto nombre.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduRetirarFoto({
  patientId,
  foto,
  onClose,
  onDone,
}: {
  patientId: string;
  foto: EduPhotoRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retirar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/fotos/${foto.id}`, {
        method: "DELETE",
        body: { motivo },
      });
      onDone("La foto se retiró del expediente. Queda la constancia de por qué.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo retirar la foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Retirar la foto"
      subtitle={`${EDU_PHOTO_STAGE_LABELS[foto.stage]} · ${EDU_PHOTO_TYPE_LABELS[foto.photoType]} · ${foto.capturedLabel}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--danger"
            onClick={retirar}
            disabled={busy || motivo.trim().length === 0}
          >
            {busy ? "Retirando…" : "Retirar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-banner">
        <div>
          <p className="edu-banner__title">Nada se borra</p>
          <p className="edu-banner__detail">
            La foto deja de salir en la galería y deja de contar para el almacenamiento
            contratado, pero la fila y el archivo se conservan: queda quién la retiró, cuándo y por
            qué. Si se subió al paciente equivocado, esa constancia es justo lo que hay que
            guardar.
          </p>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-foto-motivo-${foto.id}`}>
          Por qué se retira
        </label>
        <textarea
          id={`edu-foto-motivo-${foto.id}`}
          className="edu-input"
          rows={3}
          value={motivo}
          maxLength={EDU_FOTO_MOTIVO_MAX}
          disabled={busy}
          placeholder="Se subió al paciente equivocado · salió movida y se repitió · es duplicado"
          onChange={(e) => setMotivo(e.target.value)}
        />
        <span className="edu-field__hint">
          Obligatorio. Es lo que contesta la pregunta dentro de un año.
        </span>
      </div>
    </EduModal>
  );
}
