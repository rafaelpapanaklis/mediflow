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
  type EduApprovalDecision,
  type EduApprovalGroup,
  type EduApprovalRow,
} from "@/lib/edu/autorizaciones-core";
import { EDU_APPROVAL_STATUS_LABELS, type EduRole } from "@/lib/edu/types";

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
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduBandejaScreenProps {
  groups: EduApprovalGroup[];
  total: number;
  emergencies: number;
  truncated: boolean;
  maxRows: number;
  canDecide: boolean;
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

  function cerrar() {
    setAbierta(null);
    setNota("");
  }

  async function decidir(row: EduApprovalRow, decision: EduApprovalDecision, note?: string) {
    setError(null);
    setSkipped([]);
    setBusyId(row.id);
    try {
      await eduRequest(`/api/instituto/autorizaciones/${row.id}`, {
        method: "PATCH",
        body: { decision, note },
      });
      setFlash(
        decision === "APPROVED"
          ? `Autorizado: ${row.stageLabel.toLowerCase()} de ${row.patientName}.`
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
          ? "Escribe por qué lo rechazas. El alumno tiene que poder aprender algo de esto."
          : "Escribe QUÉ hay que cambiar. Devolverlo sin decir qué es devolverlo dos veces.",
      );
      return;
    }
    void decidir(row, abierta!.decision, texto);
  }

  function tarjeta(row: EduApprovalRow) {
    const abiertaAqui = abierta?.id === row.id;
    const ocupada = busyId === row.id;

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
            {row.emergencyReason ?? "El alumno no escribió el motivo."}
          </p>
        )}

        <header className="edu-auth-card__head">
          <span className="edu-auth-card__stage">{row.stageLabel}</span>
          <span className={`edu-tag ${SEVERIDAD_TAG[row.waitSeverity] ?? "edu-tag--muted"}`}>
            {row.waitedLabel}
          </span>
        </header>

        <p className="edu-auth-card__quien">
          {row.patientName} · <span className="edu-auth-card__folio">{row.patientFolio}</span>
        </p>
        <p className="edu-auth-card__meta">
          {row.programName} · {row.studentMatricula} {row.studentName}
          {row.requestedByName !== row.studentName ? ` · lo mandó ${row.requestedByName}` : ""}
        </p>

        {row.contentChanged && (
          <p className="edu-auth-card__aviso">
            Lo editó después de mandarlo. Lo que ves abajo es lo que dice AHORA, y es lo que vas a
            firmar.
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

        {canDecide && !abiertaAqui && (
          <div className="edu-auth-card__acciones">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-auth-btn"
              onClick={() => decidir(row, "APPROVED")}
              disabled={ocupada}
            >
              {EDU_APPROVAL_DECISION_LABELS.APPROVED}
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

        {canDecide && abiertaAqui && (
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
              Una urgencia ya ocurrió: el alumno procedió sin firma previa y quedó constancia. Van
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
              ? "Cuando un alumno tuyo mande un plan o un procedimiento a autorización, aparecerá aquí con su paciente, su especialidad y cuánto lleva esperando."
              : "Lo que mandes a autorización desde la ficha del caso aparecerá aquí hasta que tu docente lo firme."}
          </p>
        </div>
      ) : (
        <>
          <p className="edu-note">
            {total === 1 ? "1 petición" : `${total} peticiones`} ·{" "}
            {groups.length === 1 ? "1 alumno" : `${groups.length} alumnos`}
            {viewerRole === "DIRECCION" ? " · ves las de todo el instituto" : ""}
          </p>

          <div className="edu-stack">
            {groups.map((g) => (
              <section key={g.studentId} className="edu-auth-grupo">
                <header className="edu-auth-grupo__head">
                  <div>
                    <h2 className="edu-auth-grupo__name">{g.studentName}</h2>
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
                    {g.rows.length - g.batchIds.length} de este alumno no entran en el lote: son
                    urgencias, cambiaron después de mandarse o las mandaste tú. Se firman leyéndolas.
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
