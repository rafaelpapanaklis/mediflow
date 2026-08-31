"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, PenLine, Send, Signature, Undo2 } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_RECORD_DIAGNOSIS_MAX,
  EDU_RECORD_TEXT_MAX,
  EDU_SOAP_FIELDS,
  EDU_SOAP_HINTS,
  EDU_SOAP_LABELS,
  eduRecordCanTransition,
  type EduCaseOption,
  type EduRecordRow,
  type EduSoapField,
} from "@/lib/edu/expediente-core";
import {
  EDU_RECORD_STATUS_DESCRIPTIONS,
  EDU_RECORD_STATUS_LABELS,
  type EduRecordStatus,
} from "@/lib/edu/types";
import type { EduIaEstado } from "@/lib/edu/ia-core";
import { EduDictadoMic } from "@/components/edu/expediente/dictado-mic";

/**
 * /instituto/pacientes/[id]/expediente — las notas clínicas.
 *
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO:
 *  · NO decide qué notas se ven. Eso lo resolvió el servidor con el alcance
 *    del expediente (recurso "cases"): un alumno recibe las de SUS casos y
 *    aquí no hay forma de pedir más.
 *  · NO decide quién escribe. `canWrite` llega resuelto y el endpoint lo
 *    vuelve a exigir.
 *
 * 🔴 UNA NOTA FIRMADA NO SE EDITA — y la pantalla no ofrece el botón, pero
 * eso es cortesía: quien la cierra de verdad es el servidor, que rebota un
 * PATCH sobre una firmada con 409 aunque venga de la dirección. Aquí se
 * ofrece "Corregir", que abre una nota NUEVA apuntando a la anterior. Las
 * dos quedan, y ésa es la idea.
 */
export interface EduExpedienteScreenProps {
  patientId: string;
  patientName: string;
  rows: EduRecordRow[];
  cases: EduCaseOption[];
  canWrite: boolean;
  /** El id del EduUser de la sesión, para saber qué notas escribió. */
  meUserId: string;
  /**
   * Si el dictado por voz está disponible, y si no, POR QUÉ. Lo resuelve
   * el SERVIDOR (eduIaEstadoActual), y desde la Ola 8 eso incluye leer el
   * CUPO de IA del instituto y lo que lleva consumido del mes. El
   * navegador no puede decidirlo: ni ve `process.env` ni tiene por qué
   * consultar el presupuesto de la escuela. Llega ya decidido, con el
   * motivo escrito para una persona.
   */
  iaDictado: EduIaEstado;
}

const TAG_BY_STATUS: Record<EduRecordStatus, string> = {
  BORRADOR: "edu-tag--muted",
  ENVIADA: "edu-tag--warn",
  FIRMADA: "edu-tag--ok",
};

const CLASS_BY_STATUS: Record<EduRecordStatus, string> = {
  BORRADOR: "edu-nota--borrador",
  ENVIADA: "edu-nota--enviada",
  FIRMADA: "edu-nota--firmada",
};

type SoapDraft = Record<EduSoapField, string> & { diagnostico: string };

const DRAFT_VACIO: SoapDraft = {
  subjetivo: "",
  objetivo: "",
  analisis: "",
  plan: "",
  diagnostico: "",
};

export function EduExpedienteScreen({
  patientId,
  patientName,
  rows,
  cases,
  canWrite,
  meUserId,
  iaDictado,
}: EduExpedienteScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState<{ corrects: EduRecordRow | null } | null>(null);
  const [editar, setEditar] = useState<EduRecordRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const casosAbiertos = useMemo(() => cases.filter((c) => c.isOpen), [cases]);

  // Índice id → nota, para poder decir a QUÉ nota corrige una corrección.
  //
  // 🔴 Hace falta porque la lista va de la MÁS RECIENTE a la más vieja, y
  // una corrección es siempre posterior a lo que corrige: sale ARRIBA de su
  // nota. El sangrado sugiere "cuelga de la de encima", que es justo la de
  // al lado equivocada. Escribir la fecha de la nota corregida quita la
  // ambigüedad sin invertir el orden — que un expediente clínico se lee
  // empezando por lo último.
  const porId = useMemo(() => {
    const m = new Map<string, EduRecordRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  /** Mueve una nota de estado (entregar, firmar, devolver). */
  async function mover(nota: EduRecordRow, to: EduRecordStatus, mensaje: string) {
    setError(null);
    setBusyId(nota.id);
    try {
      await eduRequest(`/api/instituto/expediente/${nota.id}`, {
        method: "PATCH",
        body: { status: to },
      });
      recargar(mensaje);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusyId(null);
    }
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
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Actualizando…"
            : `${rows.length} ${rows.length === 1 ? "nota" : "notas"}`}
        </span>
        {canWrite && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setError(null);
              setNueva({ corrects: null });
            }}
            disabled={cases.length === 0}
          >
            <FilePlus2 size={16} />
            Nota nueva
          </button>
        )}
      </div>

      {cases.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Este paciente todavía no tiene un caso tuyo</p>
          <p className="edu-empty__detail">
            Una nota clínica cuelga de un CASO —este paciente, contigo, en esta especialidad—
            porque es el registro de un acto clínico y un acto clínico tiene responsable. El caso se
            abre en el tamizaje.
          </p>
        </div>
      )}

      {cases.length > 0 && rows.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay notas</p>
          <p className="edu-empty__detail">
            Aquí queda lo que pasó en cada sesión, en formato SOAP y con el autor identificable.
            Una nota firmada ya no se edita: se corrige con una nota nueva.
          </p>
        </div>
      )}

      {rows.map((n) => {
        const mia = n.authorUserId === meUserId;
        const trabajando = busyId === n.id;
        const corregida = n.correctsId ? porId.get(n.correctsId) : null;
        return (
          <article
            key={n.id}
            className={`edu-nota ${CLASS_BY_STATUS[n.status]} ${n.correctsId ? "edu-nota--correccion" : ""}`}
          >
            <div className="edu-nota__head">
              <div>
                <span className="edu-nota__when">
                  {n.correctsId ? "Corrección · " : ""}
                  {n.appointmentLabel ?? n.createdLabel}
                </span>
                <span className="edu-nota__who">
                  {n.caseProgramName} · {n.studentMatricula} · escribió {n.authorName} (
                  {n.authorRoleLabel}
                  {mia ? ", tú" : ""})
                </span>
                {n.correctsId && (
                  // La lista va de lo más nuevo a lo más viejo, así que una
                  // corrección sale ARRIBA de la nota que corrige. Sin esta
                  // línea, el sangrado la haría parecer hija de la de encima.
                  <span className="edu-nota__who">
                    Corrige la nota firmada
                    {corregida ? ` del ${corregida.appointmentLabel ?? corregida.createdLabel}` : ""}.
                    Aquella no se borró: se leen las dos.
                  </span>
                )}
              </div>
              <span className={`edu-tag ${TAG_BY_STATUS[n.status]}`}>
                {EDU_RECORD_STATUS_LABELS[n.status]}
              </span>
            </div>

            {n.diagnostico && (
              <div className="edu-nota__dx">
                <span className="edu-kv__k">Diagnóstico</span>
                <span className="edu-kv__v">{n.diagnostico}</span>
              </div>
            )}

            <dl className="edu-nota__soap">
              {EDU_SOAP_FIELDS.map((f) =>
                n[f] ? (
                  <div className="edu-nota__campo" key={f}>
                    <dt>{EDU_SOAP_LABELS[f]}</dt>
                    <dd>{n[f]}</dd>
                  </div>
                ) : null,
              )}
            </dl>

            <div className="edu-nota__foot">
              <span className="edu-nota__firma">
                {n.status === "FIRMADA"
                  ? `Firmada por ${n.signedByName ?? "—"}`
                  : EDU_RECORD_STATUS_DESCRIPTIONS[n.status]}
                {n.correctionsCount > 0
                  ? ` · ${n.correctionsCount} ${n.correctionsCount === 1 ? "corrección" : "correcciones"}`
                  : ""}
              </span>

              {canWrite && (
                <div className="edu-actions">
                  {/* Editar y entregar solo mientras se puede: el servidor
                      rebota igual, pero un botón que siempre falla es peor
                      que no tenerlo. */}
                  {n.status !== "FIRMADA" && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setError(null);
                        setEditar(n);
                      }}
                      disabled={trabajando}
                    >
                      <PenLine size={15} />
                      Editar
                    </button>
                  )}

                  {eduRecordCanTransition(n.status, "ENVIADA") && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => mover(n, "ENVIADA", "La nota quedó entregada para revisión.")}
                      disabled={trabajando}
                    >
                      <Send size={15} />
                      Entregar
                    </button>
                  )}

                  {n.status === "ENVIADA" && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => mover(n, "BORRADOR", "La nota volvió a borrador.")}
                      disabled={trabajando}
                    >
                      <Undo2 size={15} />
                      Devolver
                    </button>
                  )}

                  {eduRecordCanTransition(n.status, "FIRMADA") && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--primary edu-btn--sm"
                      onClick={() => mover(n, "FIRMADA", "La nota quedó firmada. Ya no se edita.")}
                      disabled={trabajando}
                    >
                      <Signature size={15} />
                      Firmar
                    </button>
                  )}

                  {n.status === "FIRMADA" && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setError(null);
                        setNueva({ corrects: n });
                      }}
                      disabled={trabajando}
                    >
                      <PenLine size={15} />
                      Corregir
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}

      {nueva && (
        <NotaNueva
          patientId={patientId}
          patientName={patientName}
          cases={cases}
          casosAbiertos={casosAbiertos}
          corrige={nueva.corrects}
          iaDictado={iaDictado}
          onClose={() => setNueva(null)}
          onDone={(msg) => {
            setNueva(null);
            recargar(msg);
          }}
        />
      )}

      {editar && (
        <NotaEditar
          nota={editar}
          iaDictado={iaDictado}
          onClose={() => setEditar(null)}
          onDone={(msg) => {
            setEditar(null);
            recargar(msg);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// El formulario SOAP, compartido por el alta y la edición
// ═══════════════════════════════════════════════════════════════════════

/**
 * Agrega lo dictado AL FINAL de lo que ya había, sin pisarlo.
 *
 * 🔴 Nunca reemplaza. Un dictado que borra el párrafo que el alumno acababa
 * de teclear es la forma más rápida de que nadie vuelva a tocar el
 * micrófono. Se separa con un espacio si el campo tenía algo, y el tope del
 * campo se respeta aquí y no en el `maxLength` del textarea, que no aplica a
 * un cambio por código.
 */
function agregarDictado(actual: string, dictado: string, max: number): string {
  const base = actual.trimEnd();
  const junto = base ? `${base} ${dictado}` : dictado;
  return junto.slice(0, max);
}

function CamposSoap({
  draft,
  setDraft,
  disabled,
  idPrefix,
  iaDictado,
  caseId,
}: {
  draft: SoapDraft;
  setDraft: (d: SoapDraft) => void;
  disabled: boolean;
  idPrefix: string;
  iaDictado: EduIaEstado;
  /**
   * Ola 8: a qué CASO se le imputa el gasto del dictado. Viaja solo para
   * el libro de consumo de IA —no cambia lo que se transcribe— y el
   * servidor lo vuelve a comprobar dentro del alcance antes de guardarlo.
   * null en una nota que todavía no tiene caso elegido: se dicta igual.
   */
  caseId: string | null;
}) {
  return (
    <>
      <div className="edu-field">
        <div className="edu-field__head">
          <label className="edu-field__label" htmlFor={`${idPrefix}-dx`}>
            Diagnóstico
          </label>
          <EduDictadoMic
            estado={iaDictado}
            caseId={caseId}
            disabled={disabled}
            onText={(t) =>
              setDraft({
                ...draft,
                diagnostico: agregarDictado(draft.diagnostico, t, EDU_RECORD_DIAGNOSIS_MAX),
              })
            }
          />
        </div>
        <input
          id={`${idPrefix}-dx`}
          className="edu-input"
          value={draft.diagnostico}
          maxLength={EDU_RECORD_DIAGNOSIS_MAX}
          onChange={(e) => setDraft({ ...draft, diagnostico: e.target.value })}
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {EDU_SOAP_FIELDS.map((f) => (
        <div className="edu-field" key={f}>
          {/* El micrófono va POR CAMPO y no uno solo arriba: el SOAP son
              cuatro apartados distintos y un dictado que cae siempre en el
              mismo sitio obligaría a cortar y pegar cuatro veces. */}
          <div className="edu-field__head">
            <label className="edu-field__label" htmlFor={`${idPrefix}-${f}`}>
              {EDU_SOAP_LABELS[f]}
            </label>
            <EduDictadoMic
              estado={iaDictado}
              caseId={caseId}
              disabled={disabled}
              onText={(t) =>
                setDraft({ ...draft, [f]: agregarDictado(draft[f], t, EDU_RECORD_TEXT_MAX) })
              }
            />
          </div>
          <textarea
            id={`${idPrefix}-${f}`}
            className="edu-input"
            rows={3}
            value={draft[f]}
            maxLength={EDU_RECORD_TEXT_MAX}
            onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
            disabled={disabled}
          />
          <span className="edu-field__hint">{EDU_SOAP_HINTS[f]}</span>
        </div>
      ))}
    </>
  );
}

function tieneAlgo(d: SoapDraft): boolean {
  return EDU_SOAP_FIELDS.some((f) => d[f].trim().length > 0) || d.diagnostico.trim().length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Alta
// ═══════════════════════════════════════════════════════════════════════

function NotaNueva({
  patientId,
  patientName,
  cases,
  casosAbiertos,
  corrige,
  iaDictado,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  cases: EduCaseOption[];
  casosAbiertos: EduCaseOption[];
  corrige: EduRecordRow | null;
  iaDictado: EduIaEstado;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  // Corregir es una nota del MISMO caso, y no se elige: dejar cambiarlo
  // convertiría "corrección de la nota X" en "nota suelta que dice que
  // corrige a X", que es otra cosa.
  const casoFijo = corrige?.caseId ?? null;
  const [caseId, setCaseId] = useState(
    casoFijo ?? (casosAbiertos.length === 1 ? casosAbiertos[0].id : ""),
  );
  const [draft, setDraft] = useState<SoapDraft>(DRAFT_VACIO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/expediente`, {
        method: "POST",
        body: {
          caseId: casoFijo ?? caseId,
          correctsId: corrige?.id,
          subjetivo: draft.subjetivo.trim() || null,
          objetivo: draft.objetivo.trim() || null,
          analisis: draft.analisis.trim() || null,
          plan: draft.plan.trim() || null,
          diagnostico: draft.diagnostico.trim() || null,
        },
      });
      onDone(
        corrige
          ? "La corrección quedó guardada como borrador. Fírmala cuando esté lista."
          : "La nota quedó guardada como borrador.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={corrige ? "Corregir una nota firmada" : "Nota clínica nueva"}
      subtitle={patientName}
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
            disabled={busy || !(casoFijo ?? caseId) || !tieneAlgo(draft)}
          >
            {busy ? "Guardando…" : "Guardar borrador"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {corrige && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">Esto NO borra la nota anterior</p>
            <p className="edu-banner__detail">
              Una nota firmada no se edita ni se elimina: queda tal cual y esta nueva se guarda
              apuntando a ella. En el expediente se leerán las dos, en ese orden. Es la NOM-004, y
              es lo mismo que hacer una anotación aclaratoria en papel.
            </p>
          </div>
        </div>
      )}

      {!casoFijo && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-nota-caso">
            Caso
          </label>
          <select
            id="edu-nota-caso"
            className="edu-input"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            <option value="">Elige el caso</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isOpen}>
                {c.programName} · {c.studentMatricula}
                {c.isOpen ? "" : " (cerrado)"}
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            La nota cuelga del caso, no del paciente: es el registro de un acto clínico y un acto
            clínico tiene responsable.
          </span>
        </div>
      )}

      <CamposSoap
        draft={draft}
        setDraft={setDraft}
        disabled={busy}
        idPrefix="edu-nueva"
        iaDictado={iaDictado}
        caseId={casoFijo ?? caseId ?? null}
      />
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Edición
// ═══════════════════════════════════════════════════════════════════════

function NotaEditar({
  nota,
  iaDictado,
  onClose,
  onDone,
}: {
  nota: EduRecordRow;
  iaDictado: EduIaEstado;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [draft, setDraft] = useState<SoapDraft>({
    subjetivo: nota.subjetivo ?? "",
    objetivo: nota.objetivo ?? "",
    analisis: nota.analisis ?? "",
    plan: nota.plan ?? "",
    diagnostico: nota.diagnostico ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(firmar: boolean) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/expediente/${nota.id}`, {
        method: "PATCH",
        body: {
          subjetivo: draft.subjetivo.trim() || null,
          objetivo: draft.objetivo.trim() || null,
          analisis: draft.analisis.trim() || null,
          plan: draft.plan.trim() || null,
          diagnostico: draft.diagnostico.trim() || null,
          // El texto y la firma van en la MISMA petición cuando se firma:
          // guardar y firmar por separado deja una ventana en la que la
          // nota quedó firmada con el texto viejo si la segunda falla.
          ...(firmar ? { status: "FIRMADA" } : {}),
        },
      });
      onDone(firmar ? "La nota quedó firmada. Ya no se edita." : "La nota quedó guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Editar la nota"
      subtitle={`${nota.caseProgramName} · ${EDU_RECORD_STATUS_LABELS[nota.status]}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--ghost"
            onClick={() => guardar(false)}
            disabled={busy}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={() => guardar(true)}
            disabled={busy || !tieneAlgo(draft)}
          >
            Guardar y firmar
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}
      <p className="edu-note">
        Al firmar, esta nota queda cerrada: no se vuelve a editar ni a borrar. Si después hay algo
        que corregir, se escribe una nota nueva que apunte a ésta.
      </p>
      <CamposSoap
        draft={draft}
        setDraft={setDraft}
        disabled={busy}
        idPrefix="edu-editar"
        iaDictado={iaDictado}
        caseId={nota.caseId ?? null}
      />
    </EduModal>
  );
}
