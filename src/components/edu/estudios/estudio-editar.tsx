"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_STUDY_MOTIVO_MAX,
  eduDiaISOaInstante,
  eduInstanteADiaInput,
  eduReclasificacionesPosibles,
  type EduStudyRow,
} from "@/lib/edu/estudios-core";
import type { EduCaseOption } from "@/lib/edu/expediente-core";
import { EDU_STUDY_KIND_DESCRIPTIONS, EDU_STUDY_KIND_LABELS } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CORREGIR Y RETIRAR UN ESTUDIO — H-14, la mitad que faltaba.
 *
 * Hasta hoy un estudio subido al paciente equivocado se quedaba en su
 * expediente para siempre. Lo único editable era la nota. El alumno subía
 * `panoramica.jpg` con el apellido de otro paciente, o el servidor
 * registraba como "Radiografía" una foto de la sonrisa —porque para TODA
 * imagen asume radiografía—, y no había ni renombrar, ni reclasificar, ni
 * mover de caso, ni fechar, ni sacar.
 *
 * 🔴 RETIRAR NO BORRA. Es una baja suave con autor y con MOTIVO
 * OBLIGATORIO, y el binario se conserva: un estudio retirado es la
 * constancia de que alguien lo subió al paciente equivocado. Por eso el
 * botón dice «Retirar» y no «Eliminar», y por eso el motivo no es opcional.
 *
 * ⚠️ SIN `estudios.upload` LOS BOTONES SE VEN Y ESTÁN APAGADOS, con el
 * motivo escrito al lado (el patrón de paciente-whatsapp.tsx:23-24). Un
 * botón que no está no se puede preguntar por qué no está — y uno que
 * está y no hace nada es peor.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduEstudioEditarProps {
  estudio: EduStudyRow;
  cases: EduCaseOption[];
  /** `estudios.upload`. Sin él: todo apagado, con su motivo. */
  canUpload: boolean;
  /** Se corrigió algo: la pantalla recarga y dice qué pasó. */
  onCorregido: (mensaje: string) => void;
  /** Se retiró: la pantalla cierra el visor y recarga. */
  onRetirado: (nombre: string) => void;
}

const SIN_PERMISO =
  "Tu cuenta puede mirar el expediente, no escribir en él (te falta el permiso estudios.upload). " +
  "Lo da la dirección del instituto.";

export function EduEstudioEditar({
  estudio,
  cases,
  canUpload,
  onCorregido,
  onRetirado,
}: EduEstudioEditarProps) {
  const [corregir, setCorregir] = useState(false);
  const [retirar, setRetirar] = useState(false);

  return (
    <div className="edu-estudios-rastro">
      <div className="edu-actions">
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          disabled={!canUpload}
          onClick={() => setCorregir(true)}
        >
          <Pencil size={15} />
          Corregir
        </button>
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          disabled={!canUpload}
          onClick={() => setRetirar(true)}
        >
          <Trash2 size={15} />
          Retirar
        </button>
      </div>

      {!canUpload && <p className="edu-field__hint">{SIN_PERMISO}</p>}

      {corregir && canUpload && (
        <CorregirEstudio
          estudio={estudio}
          cases={cases}
          onClose={() => setCorregir(false)}
          onDone={(m) => {
            setCorregir(false);
            onCorregido(m);
          }}
        />
      )}

      {retirar && canUpload && (
        <RetirarEstudio
          estudio={estudio}
          onClose={() => setRetirar(false)}
          onDone={() => {
            setRetirar(false);
            onRetirado(estudio.name);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CORREGIR
// ═══════════════════════════════════════════════════════════════════════

function CorregirEstudio({
  estudio,
  cases,
  onClose,
  onDone,
}: {
  estudio: EduStudyRow;
  cases: EduCaseOption[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState(estudio.name);
  const [kind, setKind] = useState(estudio.kind);
  const [caseId, setCaseId] = useState(estudio.caseId ?? "");
  const [dia, setDia] = useState(eduInstanteADiaInput(estudio.takenAt));
  const [notes, setNotes] = useState(estudio.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔴 Los tipos que se OFRECEN salen de la extensión, no de la lista
  // entera del enum: un desplegable con seis opciones de las que cinco
  // rebotan con un 400 no es una elección, es una trampa. La regla es la
  // misma función que valida el servidor (eduResolveStudyKind), así que la
  // pantalla y el servidor no se pueden separar.
  //
  // Y la extensión es la del PATH (llega en `row.ext`), no la del nombre
  // que se ve: renombrar el archivo no cambia lo que el archivo ES, y el
  // servidor decide con la misma. Si se leyera del nombre, uno corregido a
  // «panorámica de Ana» ofrecería solo «Otro archivo» y el servidor lo
  // rechazaría — un callejón sin salida para quien acaba de renombrarlo.
  const posibles = eduReclasificacionesPosibles(estudio.ext);
  // Si por lo que sea el tipo actual no está en la lista, se añade para no
  // perderlo de vista al abrir el desplegable.
  const opciones = posibles.includes(estudio.kind) ? posibles : [estudio.kind, ...posibles];

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/estudios/${estudio.id}`, {
        method: "PATCH",
        body: {
          name,
          kind,
          // "" = desengancharlo del caso. `null` y "" significan lo mismo
          // para el servidor y los dos están escritos en su contrato.
          caseId,
          // Mediodía UTC para que el día no se corra al leerlo en la zona
          // del instituto (eduDiaISOaInstante lo explica). Vacío borra la
          // fecha de toma y la galería vuelve a ordenar por la de subida.
          takenAt: dia ? eduDiaISOaInstante(dia) : "",
          notes,
        },
      });
      onDone(`"${name}" quedó corregido.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo corregir el estudio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Corregir el estudio"
      subtitle="El archivo no cambia: lo que se corrige es cómo está registrado en el expediente."
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
            disabled={busy || !name.trim()}
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
        <label className="edu-field__label" htmlFor={`edu-est-nombre-${estudio.id}`}>
          Nombre
        </label>
        <input
          id={`edu-est-nombre-${estudio.id}`}
          className="edu-input"
          value={name}
          maxLength={160}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="edu-field__hint">
          Es por lo que se encuentra después. No puede quedar vacío.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-est-tipo-${estudio.id}`}>
          Qué es
        </label>
        <select
          id={`edu-est-tipo-${estudio.id}`}
          className="edu-input"
          value={kind}
          disabled={busy || opciones.length < 2}
          onChange={(e) => setKind(e.target.value as EduStudyRow["kind"])}
        >
          {opciones.map((k) => (
            <option key={k} value={k}>
              {EDU_STUDY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          {opciones.length < 2
            ? `Lo dice el archivo: un .${estudio.ext} solo puede ser ${
                EDU_STUDY_KIND_LABELS[estudio.kind]
              }.`
            : EDU_STUDY_KIND_DESCRIPTIONS[kind]}
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-est-toma-${estudio.id}`}>
          Fecha de toma
        </label>
        <input
          id={`edu-est-toma-${estudio.id}`}
          className="edu-input"
          type="date"
          value={dia}
          disabled={busy}
          onChange={(e) => setDia(e.target.value)}
        />
        <span className="edu-field__hint">
          Cuándo se TOMÓ, que no es cuándo se subió. La galería ordena por ella; si se deja vacía,
          ordena por la fecha de subida ({estudio.createdLabel}).
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-est-caso-mov-${estudio.id}`}>
          Caso
        </label>
        <select
          id={`edu-est-caso-mov-${estudio.id}`}
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
          Solo los casos que te tocan. El estudio se sigue viendo desde cualquier caso del
          paciente: la boca es una sola.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-est-nota-corr-${estudio.id}`}>
          Notas
        </label>
        <textarea
          id={`edu-est-nota-corr-${estudio.id}`}
          className="edu-input"
          rows={3}
          value={notes}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// RETIRAR
// ═══════════════════════════════════════════════════════════════════════

function RetirarEstudio({
  estudio,
  onClose,
  onDone,
}: {
  estudio: EduStudyRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retirar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/estudios/${estudio.id}`, {
        method: "DELETE",
        body: { motivo },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo retirar el estudio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Retirar del expediente"
      subtitle={estudio.name}
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
            El estudio deja de salir en la galería y deja de contar para el almacenamiento
            contratado, pero la fila y el archivo se conservan: queda la constancia de quién lo
            retiró, cuándo y por qué. Es lo que contesta la pregunta dentro de un año.
          </p>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`edu-est-motivo-${estudio.id}`}>
          Por qué se retira
        </label>
        <textarea
          id={`edu-est-motivo-${estudio.id}`}
          className="edu-input"
          rows={3}
          value={motivo}
          maxLength={EDU_STUDY_MOTIVO_MAX}
          disabled={busy}
          placeholder="Se subió al paciente equivocado · salió movida y se repitió · es duplicado"
          onChange={(e) => setMotivo(e.target.value)}
        />
        <span className="edu-field__hint">
          Obligatorio. Sin motivo, «retirar» y «borrar» serían la misma cosa con distinto nombre.
        </span>
      </div>
    </EduModal>
  );
}
