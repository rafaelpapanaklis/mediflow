"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPROVAL_BATCH_MAX,
  EDU_APPROVAL_BATCH_SKIP_LABELS,
  EDU_APPROVAL_DECISION_LABELS,
  EDU_APPROVAL_NOTE_MIN,
  EDU_APPROVAL_SELF_SIGNED_MARK,
  eduApprovalRoleSignsOwn,
  eduApprovalSelfMark,
  type EduApprovalDecision,
  type EduApprovalGroup,
  type EduApprovalRow,
} from "@/lib/edu/autorizaciones-core";
import { EDU_APPROVAL_STATUS_LABELS, type EduRole } from "@/lib/edu/types";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * LA BANDEJA. La pantalla más importante de la Ola 4.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 CÓMO SE USA ESTO DE VERDAD, que es lo que manda todo el diseño:
 * un docente DE PIE, CON GUANTES, en un teléfono, con un paciente en el
 * sillón y un alumno esperando a su lado. De ahí sale cada decisión:
 *
 *  · TARJETAS, no tabla. Una tabla en un teléfono es scroll horizontal, y
 *    un precio o un diagnóstico leídos de lado se leen mal.
 *  · TRES BOTONES GRANDES por tarjeta, con la etiqueta escrita. Un icono de
 *    palomita y otro de cruz, con guantes, son el mismo botón.
 *  · CERO modales de confirmación para autorizar. El "¿estás seguro?" que
 *    se contesta cincuenta veces al día es un clic más, no una barrera —
 *    lo que de verdad protege es que se pueda LEER lo que se firma, y eso
 *    está en la tarjeta.
 *  · Pedir cambios y rechazar SÍ piden motivo, y el campo se abre EN LA
 *    TARJETA, no en un modal: el teclado del teléfono tapa medio modal y
 *    quien escribe pierde de vista lo que estaba juzgando.
 *  · AGRUPADO POR ALUMNO, porque el docente no piensa "¿qué hay de la
 *    señora Ramírez?" sino "¿qué me debe firmar Sofía?".
 *
 * 🔴 EL LOTE, Y POR QUÉ NO SE LO LLEVA TODO. Sin lote, un docente con
 * quince alumnos firma sin leer en dos semanas y el gate se vuelve un sello
 * de goma. Pero el botón dice "Autorizar las N que se pueden" y las que NO
 * se pueden se quedan a la vista con su motivo: las urgencias (ya
 * ocurrieron), las que el alumno editó después de mandarlas y las que pidió
 * uno mismo. El servidor vuelve a comprobarlo — esto de aquí solo lo pinta.
 *
 * 🔴 LO PROPIO, Y LA DIRECCIÓN. "Nadie firma su propia petición" sigue en pie
 * para el docente y para cualquier otro rol. La DIRECCIÓN está exenta por
 * ROL (no por permiso), así que sus peticiones le llegan firmables y entran
 * al lote; lo que las acompaña es la MARCA: firmarlas deja escrito, aquí y
 * en el caso, que quien firmó fue quien pidió.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduBandejaScreenProps {
  groups: EduApprovalGroup[];
  total: number;
  emergencies: number;
  truncated: boolean;
  maxRows: number;
  canDecide: boolean;
  /**
   * Ola 14. Decidir una RECETA exige además "recetas.issue": expedirla
   * pone la cédula del firmante en el papel. Sin esta llave, la tarjeta
   * de una receta no pinta botones (el endpoint la rebotaría igual).
   */
  canIssueRecetas: boolean;
  /** La cédula guardada del firmante, para PREllenar el campo al expedir. */
  issueCedula: string | null;
  viewerRole: EduRole;
}

interface Skipped {
  id: string;
  reason: keyof typeof EDU_APPROVAL_BATCH_SKIP_LABELS;
  detail: string;
}

const SEVERIDAD_TAG: Record<string, string> = {
  ok: "edu-tag--muted",
  warn: "edu-tag--warn",
  late: "edu-tag--danger",
};

export function EduBandejaScreen({
  groups,
  total,
  emergencies,
  truncated,
  maxRows,
  canDecide,
  canIssueRecetas,
  issueCedula,
  viewerRole,
}: EduBandejaScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  /** Qué tarjeta tiene el campo de motivo abierto, y para qué decisión. */
  const [abierta, setAbierta] = useState<{ id: string; decision: EduApprovalDecision } | null>(null);
  const [nota, setNota] = useState("");
  /**
   * Ola 14. La cédula con la que se EXPIDE una receta. Se abre como campo
   * (prellenado con la guardada) en vez de mandarse invisible: lo que sale
   * impreso en el papel es lo que el docente tuvo delante al firmar.
   */
  const [cedula, setCedula] = useState("");

  function cerrar() {
    setAbierta(null);
    setNota("");
  }

  async function decidir(
    row: EduApprovalRow,
    decision: EduApprovalDecision,
    note?: string,
    cedulaFirma?: string,
  ) {
    setError(null);
    setSkipped([]);
    setBusyId(row.id);
    try {
      await eduRequest(`/api/instituto/autorizaciones/${row.id}`, {
        method: "PATCH",
        body: { decision, note, cedula: cedulaFirma },
      });
      setFlash(
        decision === "APPROVED"
          ? row.stage === "PRESCRIPTION"
            ? `Receta de ${row.patientName} expedida con tu cédula. Ya se puede imprimir desde su ficha.`
            : `Autorizado: ${row.stageLabel.toLowerCase()} de ${row.patientName}.`
          : decision === "CHANGES_REQUESTED"
            ? `Se le pidieron cambios a ${row.studentName}.`
            : `Rechazado: ${row.stageLabel.toLowerCase()} de ${row.patientName}.`,
      );
      cerrar();
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la decisión.");
    } finally {
      setBusyId(null);
    }
  }

  async function autorizarLote(g: EduApprovalGroup) {
    setError(null);
    setSkipped([]);
    setBusyId(`lote:${g.studentId}`);
    try {
      const out = await eduRequest<{ approved: number; skipped: Skipped[] }>(
        "/api/instituto/autorizaciones/lote",
        { method: "POST", body: { ids: g.batchIds.slice(0, EDU_APPROVAL_BATCH_MAX) } },
      );
      setFlash(
        out.approved === 1
          ? `Autorizada 1 de ${g.studentName}.`
          : `Autorizadas ${out.approved} de ${g.studentName}.`,
      );
      setSkipped(out.skipped ?? []);
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo autorizar el lote.");
    } finally {
      setBusyId(null);
    }
  }

  function confirmarConNota(row: EduApprovalRow) {
    const texto = nota.trim();
    if (texto.length < EDU_APPROVAL_NOTE_MIN) {
      setError(
        abierta?.decision === "REJECTED"
          ? "Escribe por qué lo rechazas. El estudiante tiene que poder aprender algo de esto."
          : "Escribe QUÉ hay que cambiar. Devolverlo sin decir qué es devolverlo dos veces.",
      );
      return;
    }
    void decidir(row, abierta!.decision, texto);
  }

  /** Ola 14. Expedir la receta: la cédula viaja con la firma. */
  function confirmarExpedir(row: EduApprovalRow) {
    const c = cedula.trim();
    if (c.length < 5) {
      setError(
        "Escribe tu cédula profesional. La receta sale impresa con ella y con tu nombre — es lo que hace que exista.",
      );
      return;
    }
    void decidir(row, "APPROVED", undefined, c);
  }

  function tarjeta(row: EduApprovalRow) {
    const abiertaAqui = abierta?.id === row.id;
    const ocupada = busyId === row.id;
    // La DIRECCIÓN sí firma lo suyo (el servidor la exime por ROL), y por
    // eso la tarjeta se lo dice ANTES de firmar: lo que va a quedar escrito
    // es que quien firmó fue quien pidió. `own` es el HECHO ("la mandaste
    // tú") y `batchSkip` la consecuencia; al docente le sigue saliendo
    // "propia" y esta línea no la ve nunca.
    const propiaFirmable = row.own && canDecide && row.batchSkip !== "propia";
    // Ola 14. Una RECETA se decide con la segunda llave (recetas.issue):
    // expedirla pone la cédula del firmante en el papel. Sin la llave no
    // se pintan los botones — el endpoint los rebotaría igual; esto solo
    // evita ofrecer un botón que va a fallar.
    const esReceta = row.stage === "PRESCRIPTION";
    const puedeDecidirEsta = canDecide && (!esReceta || canIssueRecetas);

    return (
      <article
        key={row.id}
        className={`edu-auth-card ${row.isEmergency ? "edu-auth-card--urgente" : ""} ${
          row.contentChanged ? "edu-auth-card--cambio" : ""
        }`}
      >
        {row.isEmergency && (
          <p className="edu-auth-card__urgencia">
            <strong>Urgencia · ya se hizo sin firma.</strong>{" "}
            {row.emergencyReason ?? "El estudiante no escribió el motivo."}
          </p>
        )}

        <header className="edu-auth-card__head">
          <span className="edu-auth-card__stage">{row.stageLabel}</span>
          <span className={`edu-tag ${SEVERIDAD_TAG[row.waitSeverity] ?? "edu-tag--muted"}`}>
            {row.waitedLabel}
          </span>
        </header>

        <p className="edu-auth-card__quien">
          <EduPersonaLink kind="paciente" id={row.patientId}>
            {row.patientName}
          </EduPersonaLink>{" "}
          · <span className="edu-auth-card__folio">{row.patientFolio}</span>
        </p>
        <p className="edu-auth-card__meta">
          {row.programName} ·{" "}
          <EduPersonaLink kind="estudiante" id={row.studentId}>
            {row.studentMatricula} {row.studentName}
          </EduPersonaLink>
          {row.requestedByName !== row.studentName ? ` · lo mandó ${row.requestedByName}` : ""}
        </p>

        {row.contentChanged && (
          <p className="edu-auth-card__aviso">
            Lo editó después de mandarlo. Lo que ves abajo es lo que dice AHORA, y es lo que vas a
            firmar.
          </p>
        )}

        {/* La petición propia de la DIRECCIÓN: no se le cierra nada, se le
            dice qué va a quedar escrito si la firma. Va en gris (meta) y no
            en el amarillo del aviso a propósito — no es una advertencia,
            es la traza que ella misma está eligiendo dejar. */}
        {propiaFirmable && (
          <p className="edu-auth-card__meta">
            La mandaste tú. Puedes decidirla: quedará marcada «{EDU_APPROVAL_SELF_SIGNED_MARK}».
          </p>
        )}

        <div className="edu-auth-card__que">
          <p className="edu-auth-card__titulo">{row.summary.title}</p>
          <dl className="edu-auth-card__campos">
            {row.summary.lines.map((l) => (
              <div key={l.label} className="edu-auth-card__campo">
                <dt>{l.label}</dt>
                <dd>{l.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="edu-auth-card__meta">
          Pedida {row.requestedAtLabel} ·{" "}
          <Link href={`/instituto/pacientes/${row.patientId}/expediente`} className="edu-auth-card__link">
            Ver el expediente completo
          </Link>
        </p>

        {canDecide && esReceta && !canIssueRecetas && (
          <p className="edu-auth-card__aviso">
            Decidir una receta exige el permiso de expedirla (sale con tu cédula). Pídele a la
            dirección que revise tus permisos.
          </p>
        )}

        {puedeDecidirEsta && !abiertaAqui && (
          <div className="edu-auth-card__acciones">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-auth-btn"
              onClick={() => {
                if (esReceta) {
                  // La receta NO se firma de un clic: se abre el campo de
                  // la cédula (prellenado con la guardada) y se confirma
                  // viéndola — es lo que va a salir impreso.
                  setError(null);
                  setCedula(issueCedula ?? "");
                  setAbierta({ id: row.id, decision: "APPROVED" });
                } else {
                  void decidir(row, "APPROVED");
                }
              }}
              disabled={ocupada}
            >
              {esReceta ? "Expedir" : EDU_APPROVAL_DECISION_LABELS.APPROVED}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-auth-btn"
              onClick={() => {
                setError(null);
                setNota("");
                setAbierta({ id: row.id, decision: "CHANGES_REQUESTED" });
              }}
              disabled={ocupada}
            >
              {EDU_APPROVAL_DECISION_LABELS.CHANGES_REQUESTED}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--danger edu-auth-btn"
              onClick={() => {
                setError(null);
                setNota("");
                setAbierta({ id: row.id, decision: "REJECTED" });
              }}
              disabled={ocupada}
            >
              {EDU_APPROVAL_DECISION_LABELS.REJECTED}
            </button>
          </div>
        )}

        {puedeDecidirEsta && abiertaAqui && abierta.decision === "APPROVED" && (
          <div className="edu-auth-card__motivo">
            <label className="edu-field__label" htmlFor={`cedula-${row.id}`}>
              Tu cédula profesional (sale impresa en la receta)
            </label>
            <input
              id={`cedula-${row.id}`}
              className="edu-input"
              value={cedula}
              autoFocus
              onChange={(e) => setCedula(e.target.value)}
              placeholder="Ej.: 1234567"
              inputMode="text"
              autoComplete="off"
            />
            <p className="edu-field__hint">
              Expedirla la deja lista para imprimir, con tu nombre y esta cédula. Queda guardada
              para la próxima firma.
            </p>
            <div className="edu-auth-card__acciones">
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-auth-btn"
                onClick={() => confirmarExpedir(row)}
                disabled={ocupada}
              >
                Expedir con esta cédula
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-auth-btn"
                onClick={cerrar}
                disabled={ocupada}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {puedeDecidirEsta && abiertaAqui && abierta.decision !== "APPROVED" && (
          <div className="edu-auth-card__motivo">
            <label className="edu-field__label" htmlFor={`motivo-${row.id}`}>
              {abierta.decision === "REJECTED"
                ? "¿Por qué lo rechazas?"
                : "¿Qué tiene que cambiar?"}
            </label>
            <textarea
              id={`motivo-${row.id}`}
              className="edu-input"
              rows={3}
              value={nota}
              autoFocus
              onChange={(e) => setNota(e.target.value)}
              placeholder={
                abierta.decision === "REJECTED"
                  ? "Ej.: el diente 26 no tiene indicación de endodoncia con esa radiografía."
                  : "Ej.: falta la radiografía periapical y el plan no dice cuántas sesiones."
              }
            />
            <div className="edu-auth-card__acciones">
              <button
                type="button"
                className={`edu-btn edu-auth-btn ${
                  abierta.decision === "REJECTED" ? "edu-btn--danger" : "edu-btn--primary"
                }`}
                onClick={() => confirmarConNota(row)}
                disabled={ocupada}
              >
                {abierta.decision === "REJECTED" ? "Rechazar" : "Devolver con cambios"}
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-auth-btn"
                onClick={cerrar}
                disabled={ocupada}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!canDecide && (
          <p className="edu-auth-card__meta">
            {EDU_APPROVAL_STATUS_LABELS[row.status]}
            {row.decidedByName ? ` por ${row.decidedByName}` : ""}
          </p>
        )}

        {/* La TRAZA, en la bandeja: si quien decidió es quien pidió, se lee
            aquí y no hay que abrir el caso para enterarse. */}
        {row.selfDecided && (
          <p className="edu-auth-card__aviso">{eduApprovalSelfMark(row.status)}</p>
        )}
      </article>
    );
  }

  return (
    <>
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

      {skipped.length > 0 && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              {skipped.length === 1
                ? "Una se quedó fuera del lote"
                : `${skipped.length} se quedaron fuera del lote`}
            </p>
            <p className="edu-banner__detail">
              {/* Se agrupan por motivo para no repetir el mismo párrafo cinco
                  veces en una pantalla de teléfono. */}
              {Array.from(new Set(skipped.map((s) => s.detail))).join(" ")}
            </p>
          </div>
        </div>
      )}

      {emergencies > 0 && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              {emergencies === 1
                ? "1 urgencia esperando tu firma"
                : `${emergencies} urgencias esperando tu firma`}
            </p>
            <p className="edu-banner__detail">
              Una urgencia ya ocurrió: el estudiante procedió sin firma previa y quedó constancia. Van
              primero y no entran en el lote — ésas se leen.
            </p>
          </div>
        </div>
      )}

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Hay más de {maxRows} esperando</p>
            <p className="edu-banner__detail">
              Se están mostrando las {maxRows} más antiguas. Si la bandeja llegó hasta aquí, el
              problema no es la pantalla: habla con la dirección.
            </p>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {canDecide ? "No tienes nada que firmar" : "No tienes nada esperando"}
          </p>
          <p className="edu-empty__detail">
            {canDecide
              ? "Cuando un estudiante tuyo mande un plan o un procedimiento a autorización, aparecerá aquí con su paciente, su especialidad y cuánto lleva esperando."
              : "Lo que mandes a autorización desde la ficha del caso aparecerá aquí hasta que tu docente lo firme."}
          </p>
        </div>
      ) : (
        <>
          <p className="edu-note">
            {total === 1 ? "1 petición" : `${total} peticiones`} ·{" "}
            {groups.length === 1 ? "1 estudiante" : `${groups.length} estudiantes`}
            {viewerRole === "DIRECCION" ? " · ves las de todo el instituto" : ""}
          </p>

          <div className="edu-stack">
            {groups.map((g) => (
              <section key={g.studentId} className="edu-auth-grupo">
                <header className="edu-auth-grupo__head">
                  <div>
                    <h2 className="edu-auth-grupo__name">
                      <EduPersonaLink kind="estudiante" id={g.studentId}>
                        {g.studentName}
                      </EduPersonaLink>
                    </h2>
                    <p className="edu-auth-grupo__sub">
                      {g.studentMatricula} · {g.rows.length}{" "}
                      {g.rows.length === 1 ? "esperando" : "esperando"}
                      {g.emergencies > 0
                        ? ` · ${g.emergencies} ${g.emergencies === 1 ? "urgencia" : "urgencias"}`
                        : ""}
                    </p>
                  </div>
                  {canDecide && g.batchIds.length > 1 && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--primary edu-btn--sm"
                      onClick={() => autorizarLote(g)}
                      disabled={busyId === `lote:${g.studentId}`}
                    >
                      Autorizar las {Math.min(g.batchIds.length, EDU_APPROVAL_BATCH_MAX)} que se
                      pueden
                    </button>
                  )}
                </header>

                {canDecide && g.batchIds.length < g.rows.length && (
                  <p className="edu-auth-grupo__nota">
                    {g.rows.length - g.batchIds.length} de este estudiante no entran en el lote: son
                    urgencias o recetas
                    {eduApprovalRoleSignsOwn(viewerRole)
                      ? // A la dirección lo suyo SÍ le entra al lote: dejarle
                        // "o las mandaste tú" sería decirle que algo la
                        // frena cuando ya no la frena nada.
                        ", o cambiaron después de mandarse"
                      : ", cambiaron después de mandarse o las mandaste tú"}
                    . Se firman leyéndolas.
                  </p>
                )}

                <div className="edu-stack edu-stack--tight">{g.rows.map(tarjeta)}</div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
