"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Copy, FileDown, FilePlus2, FileText, PenLine } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  EDU_CONSENT_CONTENT_MAX,
  EDU_CONSENT_EDAD_MAYORIA,
  EDU_CONSENT_ESTADO_DESCRIPTIONS,
  EDU_CONSENT_ESTADO_LABELS,
  EDU_CONSENT_ESTADO_TAGS,
  EDU_CONSENT_INTEGRIDAD_LABELS,
  EDU_CONSENT_NAME_MAX,
  EDU_CONSENT_REASON_MAX,
  EDU_CONSENT_RELATION_MAX,
  eduConsentTemplates,
  eduConsentTexto,
  type EduConsentRow,
} from "@/lib/edu/consentimientos-core";
import type { EduCaseOption } from "@/lib/edu/expediente-core";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

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
  /**
   * ═══════════════════════════════════════════════════════════════════
   * H-08 · EL TUTOR, TRAÍDO DE LA FICHA DEL PACIENTE.
   *
   * El representante legal vivía en CADA carta y en ningún sitio más: un
   * niño de nueve años con cuatro cartas obligaba a teclear cuatro veces a
   * su madre, y bastaba un dedazo en la tercera para que las cuatro dijeran
   * cosas distintas sobre quién responde por él. Desde la Ola B el tutor
   * vive en el paciente y aquí llega PRECARGADO.
   *
   * ⚠️ SIGUE SIENDO EDITABLE en la carta, a propósito: quien firma un
   * consentimiento concreto puede no ser el tutor habitual (el padre está
   * de viaje y viene la abuela con permiso). Lo que se guarda en la carta
   * es quien firmó ESA vez; lo de la ficha es el valor por omisión.
   *
   * ⚠️ Y el servidor sigue EXIGIÉNDOLO cuando el paciente es menor. Esto
   * es comodidad, no es el candado.
   * ═══════════════════════════════════════════════════════════════════
   */
  guardianName: string | null;
  guardianRelation: string | null;
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
  /** H-12: qué carta tiene abierta su ficha (el texto firmado y las firmas). */
  const [leyendo, setLeyendo] = useState<EduConsentRow | null>(null);

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
                <EduPersonaLink kind="estudiante" id={c.studentId}>
                  {c.studentName}
                  {c.studentMatricula ? ` (${c.studentMatricula})` : ""}
                </EduPersonaLink>
                {c.supervisorName ? (
                  <>
                    {" · responsable "}
                    <EduPersonaLink kind="docente" id={c.supervisorUserId}>
                      {c.supervisorName}
                    </EduPersonaLink>
                  </>
                ) : (
                  ""
                )}
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

          {/* H-12 · `expiresLabel` se calculaba y NO SE PINTABA en ninguna
              parte, así que nadie sabía cuándo caduca la liga que acaba de
              copiar y mandar por WhatsApp. Va pegado al botón de copiar,
              que es el momento en que importa. */}
          {c.publicPath && (
            <p className="edu-note">
              La liga para firmar caduca el <strong>{c.expiresLabel}</strong>. Después de esa fecha
              el paciente ya no puede firmarla y hay que emitir una carta nueva.
            </p>
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
            {/* H-12 · Releer lo que el paciente firmó. Antes, firmada la
                carta, el texto no volvía nunca a una pantalla del
                instituto. */}
            {c.content && (
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => {
                  setFlash(null);
                  setError(null);
                  setLeyendo(c);
                }}
              >
                <FileText size={15} />
                Ver la carta firmada
              </button>
            )}
            {/* 🔴 H-12 · EL PDF, con las firmas dentro. El permiso de caja
                sobre esta pestaña está justificado en que «la carta se
                imprime y se entrega en el mostrador», y hasta ahora no
                había nada que imprimir. Es un <a> y no un fetch: el
                navegador lo abre en una pestaña con sus cookies, y de ahí
                se imprime o se guarda — que es lo que hace recepción de pie
                con el paciente delante.

                Sale con la MISMA condición que el texto (`c.content`), que
                es la del gate del servidor: firmada o revocada. */}
            {c.content && (
              <a
                className="edu-btn edu-btn--ghost edu-btn--sm"
                href={`/api/instituto/consentimientos/${c.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileDown size={15} />
                PDF
              </a>
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

      {leyendo && <CartaFirmada row={leyendo} onClose={() => setLeyendo(null)} />}

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
  guardianName,
  guardianRelation,
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
  // 🔴 H-08 · precargados desde la ficha. `useState` con valor inicial y no
  // un efecto: el efecto pisaría lo que la persona ya hubiera tecleado en
  // cuanto el componente volviera a renderizarse por cualquier otra razón.
  const [signerName, setSignerName] = useState(guardianName ?? "");
  const [signerRelation, setSignerRelation] = useState(guardianRelation ?? "");
  const [editado, setEditado] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const caso = casosAbiertos.filter((c) => c.id === caseId)[0] ?? null;

  // ── H-08 · MENOR DE EDAD ────────────────────────────────────────────
  //
  // `patientAge` ya viajaba (se imprime dentro del texto) y NADIE lo
  // miraba. La pantalla ahora exige el representante legal antes de dejar
  // emitir, con el MISMO número que el servidor (EDU_CONSENT_EDAD_MAYORIA):
  // el servidor rebota igual, pero rebotar después de teclear la carta
  // entera es rebotar tarde.
  //
  // `patientAge` null = no hay fecha de nacimiento. No se puede afirmar que
  // sea menor, así que no se bloquea; se avisa, que es lo honesto.
  const esMenor = patientAge !== null && patientAge < EDU_CONSENT_EDAD_MAYORIA;
  const faltaRepresentante = esMenor && !signerName.trim();
  const faltaParentesco = Boolean(signerName.trim()) && !signerRelation.trim();

  // ── S-17 · UN CASO SIN DOCENTE NO PRODUCE CARTA ─────────────────────
  //
  // La pantalla ya lo SABÍA y lo avisaba en rojo debajo del desplegable
  // (`supervisorPorCaso[caso.id]` null), pero el botón no lo contemplaba:
  // se pulsaba "Emitir carta", se esperaba, y volvía el 409 del servidor
  // con el mismo texto que ya estaba en pantalla.
  const sinDocente = Boolean(caso) && !supervisorPorCaso[caso!.id];

  const motivoBloqueo = !caseId
    ? "Elige el caso: de ahí salen el estudiante que atiende y el docente que responde."
    : sinDocente
      ? "Ese caso no tiene docente responsable. Asígnale supervisor al caso antes de emitir la carta."
      : faltaRepresentante
        ? `Este paciente tiene ${patientAge} ${patientAge === 1 ? "año" : "años"}: no puede firmar su propio consentimiento. Escribe el nombre de su representante legal.`
        : faltaParentesco
          ? "Falta el parentesco del representante legal: la NOM-004 pide quién firma y qué relación tiene con el paciente."
          : null;

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
      subtitle={
        <EduPersonaLink kind="paciente" id={patientId}>
          {patientName}
        </EduPersonaLink>
      }
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
            disabled={busy || motivoBloqueo !== null}
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

      {/* El motivo se ESCRIBE junto al botón apagado, no se deja en un
          tooltip: en un teléfono no hay `hover`. Mismo patrón que WhatsApp. */}
      {!busy && motivoBloqueo && (
        <p className="edu-note">No se puede emitir todavía: {motivoBloqueo}</p>
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

      {/* 🔴 H-08 · Para un MENOR el campo deja de ser opcional: se marca
          obligatorio, se avisa arriba, y el botón no deja emitir hasta que
          esté. El servidor rebota igual — los dos, como siempre. */}
      {esMenor && (
        <div className="edu-alert" role="alert">
          Este paciente tiene {patientAge} {patientAge === 1 ? "año" : "años"}: no puede firmar su
          propio consentimiento. Lo firma su representante legal (madre, padre o tutor), y hay que
          escribir aquí abajo quién es y qué parentesco tiene.
        </div>
      )}
      {patientAge === null && (
        <p className="edu-note">
          Este paciente no tiene fecha de nacimiento registrada, así que no se puede comprobar si es
          menor de edad. Si lo es, la carta la tiene que firmar su representante legal: escríbelo
          abajo.
        </p>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cons-rep">
          Representante legal{" "}
          {esMenor ? "(obligatorio: el paciente es menor de edad)" : "(solo si el paciente no firma por sí mismo)"}
        </label>
        <input
          id="edu-cons-rep"
          className="edu-input"
          value={signerName}
          maxLength={EDU_CONSENT_NAME_MAX}
          disabled={busy}
          autoComplete="off"
          required={esMenor}
          aria-required={esMenor}
          aria-invalid={faltaRepresentante}
          onChange={(e) => {
            setSignerName(e.target.value);
            setEditado(null);
          }}
        />
        <span className="edu-field__hint">
          Menor de edad o paciente sin capacidad de decidir (NOM-004 10.1.1.3). Al llenarlo, el texto
          de la carta cambia solo.
          {guardianName
            ? " Viene precargado del tutor de la ficha; puedes cambiarlo si hoy firma otra persona."
            : " No hay tutor en la ficha del paciente: si lo capturas en la pestaña Datos, la próxima carta lo trae solo."}
        </span>
      </div>

      {(signerName.trim() || esMenor) && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-cons-par">
            Parentesco o relación con el paciente{esMenor ? " (obligatorio)" : ""}
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
// H-12 · LA CARTA FIRMADA, para volver a leerla
// ═══════════════════════════════════════════════════════════════════════

/** Una firma con su imagen. `url` null = no hay PNG que enseñar. */
function Firma({
  quien,
  url,
  cuando,
}: {
  quien: string;
  url: string | null;
  cuando: string | null;
}) {
  if (!cuando) return null;
  return (
    <div className="edu-integ-firma">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="edu-integ-firma__img" src={url} alt={`Firma de ${quien}`} />
      ) : (
        <span className="edu-integ-firma__cuando">
          (sin imagen: la firma se registró, el PNG no está disponible)
        </span>
      )}
      <span className="edu-integ-firma__quien">{quien}</span>
      <span className="edu-integ-firma__cuando">{cuando}</span>
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL TEXTO QUE EL PACIENTE FIRMÓ (H-12).
 *
 * Lo que se enseña aquí es `EduConsent.content` tal cual está guardado —el
 * mismo que se digirió para el hash— con su HUELLA RECALCULADA en el
 * servidor, la fecha de firma y las imágenes de las firmas con URL firmada.
 *
 * Hasta ahora esto no existía: firmada la carta, la liga pública se apagaba
 * y el texto no volvía a ninguna pantalla del instituto. El permiso de caja
 * está justificado en que "la carta se imprime y se entrega en el
 * mostrador", y no había nada que imprimir.
 *
 * ⚠️ Y desde la Ola B hay PDF: el mismo texto, las firmas manuscritas
 * incrustadas y el pie de integridad, por
 * `GET /api/instituto/consentimientos/[id]/pdf`. Esta hoja sigue siendo
 * para LEER en pantalla; el PDF es para entregar.
 * ═══════════════════════════════════════════════════════════════════════
 */
function CartaFirmada({ row, onClose }: { row: EduConsentRow; onClose: () => void }) {
  return (
    <EduModal
      title="La carta que firmó el paciente"
      subtitle={row.procedure}
      onClose={onClose}
      footer={
        <button type="button" className="edu-btn edu-btn--primary" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="edu-integ-carta">
        {/* 🔴 La integridad, primero. Si el texto guardado ya no coincide
            con la huella que se calculó al emitir, todo lo que se lee
            debajo hay que leerlo con eso puesto delante. */}
        {row.integridad === "alterado" && (
          <div className="edu-alert" role="alert">
            {EDU_CONSENT_INTEGRIDAD_LABELS.alterado}
          </div>
        )}
        {row.integridad === "ok" && (
          <p className="edu-note">{EDU_CONSENT_INTEGRIDAD_LABELS.ok}</p>
        )}
        {row.integridad === "sin_hash" && (
          <p className="edu-note">{EDU_CONSENT_INTEGRIDAD_LABELS.sin_hash}</p>
        )}

        <div className="edu-kv edu-kv--2">
          <div>
            <span className="edu-kv__k">Firmada</span>
            <span className="edu-kv__v">{row.signedLabel ?? "No llegó a firmarse"}</span>
          </div>
          <div>
            <span className="edu-kv__k">Quién firmó</span>
            <span className="edu-kv__v">
              {row.signerName
                ? `${row.signerName} (${row.signerRelation ?? "representante legal"})`
                : "El paciente"}
            </span>
          </div>
        </div>

        {row.revokedLabel && (
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">Revocada el {row.revokedLabel}</p>
              <p className="edu-banner__detail">
                {row.revokedReason} — La carta no se borró: se lee tal como se firmó, y eso es lo
                que hay debajo.
              </p>
            </div>
          </div>
        )}

        <div className="edu-integ-carta__texto">{row.content}</div>

        <div className="edu-integ-firmas">
          <Firma quien="Paciente" url={row.signatureUrl} cuando={row.signedLabel} />
          <Firma
            quien={row.witness1Name ?? "Testigo 1"}
            url={row.witness1SignatureUrl}
            cuando={row.witness1SignedAt ? "Testigo" : null}
          />
          <Firma
            quien={row.witness2Name ?? "Testigo 2"}
            url={row.witness2SignatureUrl}
            cuando={row.witness2SignedAt ? "Testigo" : null}
          />
          <Firma
            quien={row.studentName}
            url={row.studentSignatureUrl}
            cuando={row.studentSignedAt ? "Estudiante que atiende" : null}
          />
          <Firma
            quien={row.supervisorSignedByName ?? row.supervisorName ?? "Docente responsable"}
            url={row.supervisorSignatureUrl}
            cuando={row.supervisorSignedAt ? "Docente responsable" : null}
          />
        </div>

        <p className="edu-note">
          Esto es el texto guardado, palabra por palabra: lo mismo que se digirió para calcular la
          huella. Para dárselo al paciente,{" "}
          <a
            className="edu-link"
            href={`/api/instituto/consentimientos/${row.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            descarga el PDF
          </a>
          : trae este mismo texto, las firmas manuscritas de todos los que firmaron y el pie de
          integridad.
        </p>
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
