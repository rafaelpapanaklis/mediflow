"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import { EDU_APPROVAL_NOTE_MIN, type EduApprovalRow } from "@/lib/edu/autorizaciones-core";
import type { EduCaseStatus } from "@/lib/edu/types";

/**
 * LAS ACCIONES DEL CASO, en su ficha (ola de Casos).
 *
 * Hasta esta ola, desde el caso no se podía HACER nada: el gate de la
 * Ola 4 existía en el servidor y ninguna pantalla mandaba `{ status }` —
 * los casos se quedaban en "Asignado" para siempre. Aquí viven:
 *
 *   · INICIAR TRATAMIENTO / DAR DE ALTA — el PATCH que dispara el gate.
 *     El botón solo se pinta ACTIVO cuando la puerta ya está firmada; si
 *     falta la firma, se dice qué falta en vez de pintar un botón que va
 *     a rebotar con 409.
 *   · PAUSAR / REANUDAR / MARCAR ABANDONADO — sin firma, a propósito
 *     (pedir permiso para PARAR es cómo nadie registra que paró).
 *   · FIRMAR — decidir una autorización PENDIENTE sin ir a la bandeja.
 *     Lo propio no se ofrece (nadie firma su propia petición) y la RECETA
 *     tampoco (pide cédula: se firma en la bandeja, que tiene ese campo).
 *   · REGISTRAR SESIÓN — una nota SOAP que nace BORRADOR en el
 *     expediente, colgada de ESTE caso.
 *   · TRASPASAR — cierra este caso como TRANSFERRED y abre uno nuevo con
 *     el alumno destino (el servidor exige misma especialidad).
 *
 * ⚠️ Cada `can*` viene DERIVADO DEL SERVIDOR (permiso + estado): esconder
 * no cierra nada — el candado es el guard de cada endpoint — pero a nadie
 * se le pinta un botón que va a rebotar con 403.
 */
export interface EduCasoAccionesProps {
  caseId: string;
  patientId: string;
  caseLabel: string;
  status: EduCaseStatus;
  cerrado: boolean;
  /** ¿La puerta del PLAN ya está firmada? (verdict del gate, del server). */
  gatePlanOk: boolean;
  /** ¿La puerta del ALTA ya está firmada? */
  gateAltaOk: boolean;
  canMoverEstado: boolean;
  canRegistrarSesion: boolean;
  canTraspasar: boolean;
  canFirmar: boolean;
  /** Las PENDIENTES del caso (sin recetas), tal como las armó el server. */
  pendientes: EduApprovalRow[];
  alumnosDestino: { id: string; matricula: string; name: string }[];
}

type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export function EduCasoAcciones({
  caseId,
  patientId,
  caseLabel,
  status,
  cerrado,
  gatePlanOk,
  gateAltaOk,
  canMoverEstado,
  canRegistrarSesion,
  canTraspasar,
  canFirmar,
  pendientes,
  alumnosDestino,
}: EduCasoAccionesProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Confirmación en dos pasos para lo que no tiene vuelta fácil
  // (abandonar). Sin window.confirm: un diálogo del navegador no explica
  // nada y no se puede leer con calma en un teléfono.
  const [confirmando, setConfirmando] = useState<EduCaseStatus | null>(null);

  const [modalSesion, setModalSesion] = useState(false);
  const [subjetivo, setSubjetivo] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [analisis, setAnalisis] = useState("");
  const [plan, setPlan] = useState("");

  const [modalTraspaso, setModalTraspaso] = useState(false);
  const [destino, setDestino] = useState("");
  const [motivoTraspaso, setMotivoTraspaso] = useState("");

  // La decisión de una pendiente: cuál está abierta y qué se escribe.
  const [decidiendo, setDecidiendo] = useState<string | null>(null);
  const [nota, setNota] = useState("");

  async function moverEstado(nuevo: EduCaseStatus, mensaje: string) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/casos/${caseId}`, {
        method: "PATCH",
        body: { status: nuevo },
      });
      setFlash(mensaje);
      setConfirmando(null);
      startNav(() => router.refresh());
    } catch (err) {
      // El 409 del gate llega con su texto ("Falta la autorización de…"):
      // se enseña tal cual, que para eso está escrito.
      setError(err instanceof Error ? err.message : "No se pudo mover el caso.");
      setConfirmando(null);
    } finally {
      setBusy(false);
    }
  }

  async function registrarSesion() {
    setError(null);
    if (!subjetivo.trim() && !objetivo.trim() && !analisis.trim() && !plan.trim()) {
      setError("Escribe al menos un campo de la nota: una sesión sin nada escrito no se registra.");
      return;
    }
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/expediente`, {
        method: "POST",
        body: { caseId, subjetivo, objetivo, analisis, plan },
      });
      setModalSesion(false);
      setSubjetivo("");
      setObjetivo("");
      setAnalisis("");
      setPlan("");
      setFlash(
        "Sesión registrada como nota en BORRADOR. Desde la pestaña Expediente se envía y se firma.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function traspasar() {
    setError(null);
    if (!destino) {
      setError("Elige al estudiante que recibe el caso.");
      return;
    }
    setBusy(true);
    try {
      await eduRequest("/api/instituto/traspasos", {
        method: "POST",
        body: { caseId, toStudentId: destino, reason: motivoTraspaso.trim() || undefined },
      });
      setModalTraspaso(false);
      setFlash(
        "Caso traspasado: éste queda como Transferido y el estudiante nuevo abre el suyo con el mismo paciente.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo traspasar el caso.");
    } finally {
      setBusy(false);
    }
  }

  async function decidir(approvalId: string, decision: Decision) {
    setError(null);
    if (decision !== "APPROVED" && nota.trim().length < EDU_APPROVAL_NOTE_MIN) {
      setError(
        "Escribe el motivo (mínimo " +
          EDU_APPROVAL_NOTE_MIN +
          " caracteres): un rechazo sin motivo deja al estudiante adivinando.",
      );
      return;
    }
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/autorizaciones/${approvalId}`, {
        method: "PATCH",
        body: { decision, note: nota.trim() || undefined },
      });
      setDecidiendo(null);
      setNota("");
      setFlash(
        decision === "APPROVED"
          ? "Firmado. El estudiante ya puede avanzar con lo autorizado."
          : "Decisión registrada con tu motivo.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  const firmables = canFirmar
    ? // Lo PROPIO no se ofrece (batchSkip "propia" viene del server con el
      // id de la sesión) y la RECETA se firma en la bandeja, donde está el
      // campo de la cédula.
      pendientes.filter((p) => p.stage !== "PRESCRIPTION")
    : [];

  const hayAcciones =
    (!cerrado && (canMoverEstado || canRegistrarSesion || canTraspasar)) || firmables.length > 0;
  if (!hayAcciones && !flash && !error) return null;

  return (
    <div className="edu-caso-acciones">
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

      {/* ── Firmar lo pendiente, sin ir a la bandeja ──────────────────── */}
      {firmables.length > 0 && (
        <ul className="edu-caso-firmas">
          {firmables.map((p) => (
            <li key={p.id} className="edu-caso-firmas__item">
              <div className="edu-caso-firmas__que">
                <strong>{p.stageLabel}</strong>
                {p.isEmergency ? " · URGENCIA" : ""} · pedida por {p.requestedByName} el{" "}
                {p.requestedAtLabel}
                <span className="edu-caso-firmas__detalle">{p.summary.title}</span>
              </div>
              {p.batchSkip === "propia" ? (
                <p className="edu-note">La mandaste tú: la firma tu docente supervisor.</p>
              ) : decidiendo === p.id ? (
                <div className="edu-caso-firmas__decidir">
                  <textarea
                    className="edu-input"
                    rows={2}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Motivo (obligatorio para pedir cambios o rechazar)"
                  />
                  <div className="edu-form-acciones">
                    <button
                      type="button"
                      className="edu-btn edu-btn--quiet edu-btn--sm"
                      disabled={busy}
                      onClick={() => {
                        setDecidiendo(null);
                        setNota("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      disabled={busy}
                      onClick={() => decidir(p.id, "REJECTED")}
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      disabled={busy}
                      onClick={() => decidir(p.id, "CHANGES_REQUESTED")}
                    >
                      Pedir cambios
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--primary edu-btn--sm"
                      disabled={busy}
                      onClick={() => decidir(p.id, "APPROVED")}
                    >
                      Autorizar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setDecidiendo(p.id);
                    setNota("");
                    setError(null);
                  }}
                >
                  Firmar / decidir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Mover el caso: los botones del gate ───────────────────────── */}
      {!cerrado && (
        <div className="edu-caso-acciones__fila">
          {canMoverEstado && (status === "ASSIGNED" || status === "SCREENING") && (
            <>
              {gatePlanOk ? (
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    moverEstado("IN_TREATMENT", "El caso pasó a EN TRATAMIENTO con su plan firmado.")
                  }
                >
                  Iniciar tratamiento
                </button>
              ) : (
                <span className="edu-note">
                  Para iniciar el tratamiento falta el plan autorizado — el estudiante lo manda con
                  «Enviar a autorización», aquí arriba.
                </span>
              )}
            </>
          )}

          {canMoverEstado && status === "IN_TREATMENT" && (
            <>
              {gateAltaOk ? (
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    moverEstado("COMPLETED", "Caso TERMINADO. Su alta quedó firmada y con fecha.")
                  }
                >
                  Dar de alta
                </button>
              ) : (
                <span className="edu-note">
                  Para dar de alta falta la autorización del alta — el estudiante la manda con
                  «Enviar a autorización», aquí arriba.
                </span>
              )}
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                disabled={busy}
                onClick={() => moverEstado("ON_HOLD", "El caso quedó EN PAUSA.")}
              >
                Pausar
              </button>
            </>
          )}

          {canMoverEstado && status === "ON_HOLD" && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              disabled={busy}
              onClick={() => moverEstado("IN_TREATMENT", "El caso volvió a EN TRATAMIENTO.")}
            >
              Reanudar tratamiento
            </button>
          )}

          {canMoverEstado &&
            (confirmando === "ABANDONED" ? (
              <span className="edu-caso-acciones__confirm">
                ¿Marcar ABANDONADO? El paciente dejó de venir; el caso se cierra sin alta.
                <button
                  type="button"
                  className="edu-btn edu-btn--danger edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    moverEstado("ABANDONED", "Caso marcado como ABANDONADO. Reabrirlo es posible si el paciente vuelve.")
                  }
                >
                  Sí, marcarlo
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet edu-btn--sm"
                  disabled={busy}
                  onClick={() => setConfirmando(null)}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                disabled={busy}
                onClick={() => setConfirmando("ABANDONED")}
              >
                Marcar abandonado
              </button>
            ))}

          {canRegistrarSesion && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => {
                setModalSesion(true);
                setError(null);
              }}
            >
              Registrar sesión
            </button>
          )}

          {canTraspasar && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => {
                setModalTraspaso(true);
                setDestino("");
                setMotivoTraspaso("");
                setError(null);
              }}
            >
              Traspasar
            </button>
          )}
        </div>
      )}

      {modalSesion && (
        <EduModal
          title="Registrar sesión"
          subtitle={caseLabel}
          busy={busy}
          onClose={() => setModalSesion(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setModalSesion(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={registrarSesion}
                disabled={busy}
              >
                Guardar la nota
              </button>
            </>
          }
        >
          <p className="edu-note">
            La sesión se registra como nota SOAP del caso. Nace en BORRADOR: desde la pestaña
            Expediente se completa, se envía y se firma (NOM-004: nota por cada acto).
          </p>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-s">
              Subjetivo — qué refiere el paciente
            </label>
            <textarea
              id="ses-s"
              className="edu-input"
              rows={2}
              value={subjetivo}
              onChange={(e) => setSubjetivo(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-o">
              Objetivo — qué se encontró
            </label>
            <textarea
              id="ses-o"
              className="edu-input"
              rows={2}
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-a">
              Análisis
            </label>
            <textarea
              id="ses-a"
              className="edu-input"
              rows={2}
              value={analisis}
              onChange={(e) => setAnalisis(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-p">
              Plan — qué se hizo y qué sigue
            </label>
            <textarea
              id="ses-p"
              className="edu-input"
              rows={2}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            />
          </div>
        </EduModal>
      )}

      {modalTraspaso && (
        <EduModal
          title="Traspasar el caso"
          subtitle={caseLabel}
          busy={busy}
          onClose={() => setModalTraspaso(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setModalTraspaso(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={traspasar}
                disabled={busy}
              >
                Traspasar
              </button>
            </>
          }
        >
          <p className="edu-note">
            Esto NO reasigna: cierra este caso como TRANSFERIDO y abre uno nuevo con el estudiante
            destino (misma especialidad — el servidor lo exige). El estudiante que entrega pierde el
            acceso al paciente en el mismo acto; su expediente se queda donde ocurrió.
          </p>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="tras-destino">
              ¿Quién lo recibe?
            </label>
            <select
              id="tras-destino"
              className="edu-input"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            >
              <option value="">Elige un estudiante…</option>
              {alumnosDestino.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.matricula} · {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="tras-motivo">
              Motivo (opcional, queda en el caso nuevo)
            </label>
            <input
              id="tras-motivo"
              className="edu-input"
              value={motivoTraspaso}
              onChange={(e) => setMotivoTraspaso(e.target.value)}
              placeholder="Ej.: rotación de semestre, egreso"
            />
          </div>
        </EduModal>
      )}
    </div>
  );
}
