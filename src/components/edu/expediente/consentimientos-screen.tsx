"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Copy, FilePlus2, PenLine } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  EDU_CONSENT_CONTENT_MAX,
  EDU_CONSENT_ESTADO_DESCRIPTIONS,
  EDU_CONSENT_ESTADO_LABELS,
  EDU_CONSENT_ESTADO_TAGS,
  EDU_CONSENT_NAME_MAX,
  EDU_CONSENT_REASON_MAX,
  EDU_CONSENT_RELATION_MAX,
  eduConsentTemplates,
  eduConsentTexto,
  type EduConsentRow,
} from "@/lib/edu/consentimientos-core";
import type { EduCaseOption } from "@/lib/edu/expediente-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * /instituto/pacientes/[id]/consentimientos — las cartas NOM-004.
 *
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO:
 *  · NO decide qué cartas se ven. El servidor las recortó con el alcance
 *    del PACIENTE — el único sitio del vertical donde caja llega, porque
 *    recepción entrega la carta.
 *  · NO decide quién contrafirma. `puedeContrafirmarComoAlumno` /
 *    `...Docente` llegan resueltos comparando con el id de la sesión, y el
 *    endpoint lo vuelve a decidir por su cuenta.
 *
 * 🔴 LA VISTA PREVIA LA ARMA EL NAVEGADOR, con el MISMO módulo puro que
 * usa el servidor (`eduConsentTexto`). No es una copia del texto: es la
 * misma función. Así el alumno lee y edita exactamente lo que se va a
 * guardar, sin un viaje de ida y vuelta por cada tecla — y sin que la
 * previsualización pueda decir una cosa y la carta guardada otra.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduConsentimientosScreenProps {
  patientId: string;
  patientName: string;
  patientAge: number | null;
  patientFolio: string;
  institutionName: string;
  institutionCity: string | null;
  timezone: string;
  rows: EduConsentRow[];
  cases: EduCaseOption[];
  canCreate: boolean;
  canRevoke: boolean;
  /** El nombre del docente de cada caso, para la vista previa. */
  supervisorPorCaso: Record<string, string | null>;
}

export function EduConsentimientosScreen(props: EduConsentimientosScreenProps) {
  const { patientId, rows, cases, canCreate, canRevoke } = props;
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [revocar, setRevocar] = useState<EduConsentRow | null>(null);
  const [firmar, setFirmar] = useState<{ row: EduConsentRow; comoDocente: boolean } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const casosAbiertos = useMemo(() => cases.filter((c) => c.isOpen), [cases]);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  async function copiarLiga(row: EduConsentRow) {
    if (!row.publicPath) return;
    const url = `${window.location.origin}${row.publicPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(row.id);
      setTimeout(() => setCopiado(null), 4000);
    } catch {
      setError(`No se pudo copiar. La liga es: ${url}`);
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
            : `${rows.length} ${rows.length === 1 ? "carta" : "cartas"}`}
        </span>
        {canCreate && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setError(null);
              setNueva(true);
            }}
            disabled={casosAbiertos.length === 0}
          >
            <FilePlus2 size={16} />
            Carta nueva
          </button>
        )}
      </div>

      {canCreate && casosAbiertos.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Este paciente no tiene un caso abierto tuyo</p>
          <p className="edu-empty__detail">
            La carta tiene que decir QUÉ estudiante va a atender y QUÉ docente responde, y eso sale del
            caso: no se teclea a mano. El caso se abre en la valoración, y su docente responsable se
            asigna desde la ficha del caso.
          </p>
        </div>
      )}

      {rows.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay consentimientos</p>
          <p className="edu-empty__detail">
            Aquí van las cartas de consentimiento informado (NOM-004). El paciente las firma desde su
            teléfono con una liga, y las contrafirman el estudiante que lo va a atender y su docente
            responsable.
          </p>
        </div>
      )}

      {rows.map((c) => (
        <article key={c.id} className={`edu-consent edu-consent--${c.estado.toLowerCase()}`}>
          <div className="edu-consent__head">
            <div>
              <span className="edu-consent__proc">{c.procedure}</span>
              <span className="edu-nota__who">
                {c.caseProgramName ? `${c.caseProgramName} · ` : ""}
                {c.studentName}
                {c.studentMatricula ? ` (${c.studentMatricula})` : ""}
                {c.supervisorName ? ` · responsable ${c.supervisorName}` : ""}
              </span>
              <span className="edu-nota__who">
                Emitida el {c.createdLabel} por {c.createdByName}
              </span>
            </div>
            <span className={`edu-tag ${EDU_CONSENT_ESTADO_TAGS[c.estado]}`}>
              {EDU_CONSENT_ESTADO_LABELS[c.estado]}
            </span>
          </div>

          <p className="edu-consent__estado">{EDU_CONSENT_ESTADO_DESCRIPTIONS[c.estado]}</p>

          <dl className="edu-consent__firmas">
            <div>
              <dt>Paciente</dt>
              <dd>
                {c.signedLabel
                  ? `Firmó el ${c.signedLabel}${c.signerName ? ` · representante legal: ${c.signerName} (${c.signerRelation ?? "—"})` : ""}`
                  : c.viewedLabel
                    ? `Abrió la carta el ${c.viewedLabel} y todavía no firma`
                    : "Todavía no abre la carta"}
              </dd>
            </div>
            <div>
              <dt>Estudiante</dt>
              <dd>{c.studentSignedAt ? "Contrafirmada" : "Pendiente"}</dd>
            </div>
            <div>
              <dt>Docente</dt>
              <dd>
                {c.supervisorSignedAt
                  ? `Contrafirmada${c.supervisorSignedByName ? ` por ${c.supervisorSignedByName}` : ""}`
                  : "Pendiente"}
              </dd>
            </div>
            <div>
              <dt>Testigos</dt>
              <dd>
                {[c.witness1Name, c.witness2Name].filter(Boolean).join(" · ") || "Sin testigos"}
              </dd>
            </div>
          </dl>

          {c.estado === "REVOCADO" && (
            <div className="edu-banner edu-banner--warn">
              <div>
                <p className="edu-banner__title">
                  Revocado el {c.revokedLabel}
                  {c.revokedByName ? ` · lo registró ${c.revokedByName}` : ""}
                </p>
                <p className="edu-banner__detail">
                  {c.revokedReason} — La carta no se borró: queda como constancia de que existió y de
                  que el paciente se retractó.
                </p>
              </div>
            </div>
          )}

          <div className="edu-actions">
            {c.publicPath && (
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => copiarLiga(c)}
              >
                <Copy size={15} />
                {copiado === c.id ? "Liga copiada" : "Copiar liga de firma"}
              </button>
            )}
            {c.puedeContrafirmarComoAlumno && (
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => setFirmar({ row: c, comoDocente: false })}
              >
                <PenLine size={15} />
                Contrafirmar como estudiante
              </button>
            )}
            {c.puedeContrafirmarComoDocente && (
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => setFirmar({ row: c, comoDocente: true })}
              >
                <Check size={15} />
                Contrafirmar como docente
              </button>
            )}
            {canRevoke && c.estado !== "REVOCADO" && (
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => {
                  setFlash(null);
                  setError(null);
                  setRevocar(c);
                }}
              >
                <Ban size={15} />
                Revocar
              </button>
            )}
          </div>
        </article>
      ))}

      {nueva && (
        <CartaNueva
          {...props}
          casosAbiertos={casosAbiertos}
          onClose={() => setNueva(false)}
          onDone={(msg) => {
            setNueva(false);
            recargar(msg);
          }}
        />
      )}

      {revocar && (
        <Revocar
          row={revocar}
          onClose={() => setRevocar(null)}
          onDone={(msg) => {
            setRevocar(null);
            recargar(msg);
          }}
        />
      )}

      {firmar && (
        <Contrafirmar
          row={firmar.row}
          comoDocente={firmar.comoDocente}
          onClose={() => setFirmar(null)}
          onDone={(msg) => {
            setFirmar(null);
            recargar(msg);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Emitir
// ═══════════════════════════════════════════════════════════════════════

function CartaNueva({
  patientId,
  patientName,
  patientAge,
  patientFolio,
  institutionName,
  institutionCity,
  timezone,
  casosAbiertos,
  supervisorPorCaso,
  onClose,
  onDone,
}: EduConsentimientosScreenProps & {
  casosAbiertos: EduCaseOption[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const plantillas = useMemo(() => eduConsentTemplates(), []);
  const [caseId, setCaseId] = useState(casosAbiertos.length === 1 ? casosAbiertos[0].id : "");
  const [procedureKey, setProcedureKey] = useState(plantillas[0]?.key ?? "");
  const [signerName, setSignerName] = useState("");
  const [signerRelation, setSignerRelation] = useState("");
  const [editado, setEditado] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const caso = casosAbiertos.filter((c) => c.id === caseId)[0] ?? null;

  // La vista previa se recalcula con el MISMO módulo puro que usa el
  // servidor. Si alguien tocó el texto (`editado`), manda lo suyo: la
  // plantilla es una base, no un molde.
  const textoBase = useMemo(
    () =>
      eduConsentTexto({
        procedureKey: procedureKey || null,
        procedure: "",
        institutionName,
        institutionCity,
        timezone,
        patientName,
        patientAge,
        patientFolio,
        studentName: caso ? caso.studentName : "—",
        studentMatricula: caso ? caso.studentMatricula : null,
        programName: caso ? caso.programName : null,
        supervisorName: caso ? (supervisorPorCaso[caso.id] ?? null) : null,
        signerName: signerName.trim() || null,
        signerRelation: signerRelation.trim() || null,
      }),
    [
      procedureKey,
      institutionName,
      institutionCity,
      timezone,
      patientName,
      patientAge,
      patientFolio,
      caso,
      supervisorPorCaso,
      signerName,
      signerRelation,
    ],
  );

  const texto = editado ?? textoBase;
  const etiqueta = plantillas.filter((p) => p.key === procedureKey)[0]?.label ?? "";

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/consentimientos`, {
        method: "POST",
        body: {
          caseId,
          procedureKey,
          procedure: etiqueta,
          content: texto,
          signerName: signerName.trim() || null,
          signerRelation: signerRelation.trim() || null,
        },
      });
      onDone("La carta quedó lista. Copia la liga y pásasela al paciente para que la firme.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo emitir la carta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Carta de consentimiento informado"
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
            disabled={busy || !caseId}
          >
            {busy ? "Emitiendo…" : "Emitir carta"}
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
          <p className="edu-banner__title">La carta dice que te va a atender un estudiante</p>
          <p className="edu-banner__detail">
            El primer bloque del texto nombra al estudiante, su especialidad y al docente que responde
            del acto. Es lo que más le importa saber a quien firma en una clínica de enseñanza, así
            que va antes que nada y no en un anexo.
          </p>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cons-caso">
          Caso
        </label>
        <select
          id="edu-cons-caso"
          className="edu-input"
          value={caseId}
          disabled={busy}
          onChange={(e) => {
            setCaseId(e.target.value);
            setEditado(null);
          }}
        >
          <option value="">Elige el caso</option>
          {casosAbiertos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.programName} · {c.studentName} ({c.studentMatricula})
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          De aquí salen el estudiante que atiende y el docente responsable. No se teclean.
        </span>
      </div>

      {caso && !supervisorPorCaso[caso.id] && (
        <div className="edu-alert" role="alert">
          Ese caso no tiene docente responsable asignado. Un consentimiento informado tiene que decir
          quién responde del acto: asígnale supervisor al caso antes de emitir la carta.
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cons-proc">
          Procedimiento
        </label>
        <select
          id="edu-cons-proc"
          className="edu-input"
          value={procedureKey}
          disabled={busy}
          onChange={(e) => {
            setProcedureKey(e.target.value);
            setEditado(null);
          }}
        >
          {plantillas.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          Cada plantilla trae sus riesgos, alternativas y cuidados. Es una BASE: revísala y
          complétala para este paciente antes de emitirla.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cons-rep">
          Representante legal (solo si el paciente no firma por sí mismo)
        </label>
        <input
          id="edu-cons-rep"
          className="edu-input"
          value={signerName}
          maxLength={EDU_CONSENT_NAME_MAX}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => {
            setSignerName(e.target.value);
            setEditado(null);
          }}
        />
        <span className="edu-field__hint">
          Menor de edad o paciente sin capacidad de decidir (NOM-004 10.1.1.3). Al llenarlo, el texto
          de la carta cambia solo.
        </span>
      </div>

      {signerName.trim() && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-cons-par">
            Parentesco o relación con el paciente
          </label>
          <input
            id="edu-cons-par"
            className="edu-input"
            value={signerRelation}
            maxLength={EDU_CONSENT_RELATION_MAX}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => {
              setSignerRelation(e.target.value);
              setEditado(null);
            }}
          />
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cons-texto">
          Texto que va a firmar el paciente
        </label>
        <textarea
          id="edu-cons-texto"
          className="edu-input edu-consent__editor"
          rows={14}
          value={texto}
          maxLength={EDU_CONSENT_CONTENT_MAX}
          disabled={busy}
          onChange={(e) => setEditado(e.target.value)}
        />
        <span className="edu-field__hint">
          Esto es exactamente lo que se guarda y lo que el paciente va a leer. Una vez emitida, la
          carta no se edita: si hay que cambiarla, se revoca y se emite otra.
          {editado !== null && (
            <>
              {" "}
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                onClick={() => setEditado(null)}
              >
                Volver a la plantilla
              </button>
            </>
          )}
        </span>
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Revocar
// ═══════════════════════════════════════════════════════════════════════

function Revocar({
  row,
  onClose,
  onDone,
}: {
  row: EduConsentRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/consentimientos/${row.id}/revocar`, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      onDone("Quedó constancia de la revocación. La carta no se borró.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo revocar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Revocar el consentimiento"
      subtitle={row.procedure}
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
            onClick={guardar}
            disabled={busy || reason.trim().length < 5}
          >
            {busy ? "Registrando…" : "Registrar la revocación"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}
      <div className="edu-banner edu-banner--warn">
        <div>
          <p className="edu-banner__title">Esto NO borra la carta</p>
          <p className="edu-banner__detail">
            La carta y su firma se quedan exactamente como están, marcadas como revocadas, con tu
            nombre, la fecha y el motivo. Es lo que pide la NOM-004: el paciente puede retirar su
            consentimiento en cualquier momento y eso se registra, no se hace desaparecer.
          </p>
        </div>
      </div>
      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cons-motivo">
          Motivo
        </label>
        <textarea
          id="edu-cons-motivo"
          className="edu-input"
          rows={3}
          value={reason}
          maxLength={EDU_CONSENT_REASON_MAX}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="edu-field__hint">
          Quién lo pidió y por qué. Sin esto la constancia no sirve de nada dentro de un año.
        </span>
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Contrafirmar
// ═══════════════════════════════════════════════════════════════════════

function Contrafirmar({
  row,
  comoDocente,
  onClose,
  onDone,
}: {
  row: EduConsentRow;
  comoDocente: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [firma, setFirma] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!firma) return;
    setError(null);
    setBusy(true);
    try {
      // 🔴 No se manda a QUÉ hueco va: eso lo decide el servidor
      // comparando la sesión con las dos personas de la carta. `comoDocente`
      // solo cambia lo que dice este modal.
      await eduRequest(`/api/instituto/consentimientos/${row.id}/contrafirma`, {
        method: "POST",
        body: { signatureDataUrl: firma },
      });
      onDone("Tu contrafirma quedó registrada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la contrafirma.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={comoDocente ? "Contrafirmar como docente responsable" : "Contrafirmar como estudiante"}
      subtitle={row.procedure}
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
            disabled={busy || !firma}
          >
            {busy ? "Guardando…" : "Firmar"}
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
        {comoDocente
          ? "Firmas como responsable del acto: que se le explicó al paciente, que aceptó y que el procedimiento se realiza bajo tu supervisión."
          : "Firmas como quien explicó el procedimiento y lo va a realizar. Tu docente responsable firma aparte."}
      </p>
      <SignaturePad
        theme="light"
        onChange={setFirma}
        ariaLabel="Firma"
        hintLabel="Firma aquí con el dedo o con el ratón"
      />
    </EduModal>
  );
}
