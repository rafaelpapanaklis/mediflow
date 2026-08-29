"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import {
  EDU_APPROVAL_EMERGENCY_REASON_MIN,
  eduApprovalTargetForStage,
  type EduApprovalRow,
  type EduApprovalTargetOption,
  type EduGateVerdict,
} from "@/lib/edu/autorizaciones-core";
import {
  EDU_APPROVAL_STAGES,
  EDU_APPROVAL_STAGE_DESCRIPTIONS,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_APPROVAL_STATUS_LABELS,
  type EduApprovalStage,
} from "@/lib/edu/types";

/**
 * EL ESTADO DE AUTORIZACIÓN DE UN CASO, dentro de su ficha.
 *
 * Contesta las cuatro preguntas del contrato en el sitio donde se hacen:
 * quién firmó, QUÉ exactamente, a qué hora, y qué falta para que el caso
 * avance. Y trae el botón del alumno.
 *
 * 🔴 NO HAY HISTORIAL APARTE. Lo que se lista abajo SON las filas del caso:
 * cada reenvío creó una nueva y dejó la anterior con su fecha y su motivo.
 * Un historial en otra tabla habría que mantenerlo sincronizado con éste, y
 * el día que discrepen gana el que no tiene firma.
 *
 * ⚠️ Este componente esconde el botón cuando no hay permiso, y eso NO cierra
 * nada: el POST exige "autorizaciones.request" en el servidor. Esconder es
 * cortesía; cerrar es el guard.
 */
export interface EduCasoAutorizacionesProps {
  caseId: string;
  caseLabel: string;
  gates: { stage: EduApprovalStage; verdict: EduGateVerdict }[];
  rows: EduApprovalRow[];
  canRequest: boolean;
}

interface CasoPayload {
  targets: { records: EduApprovalTargetOption[]; appointments: EduApprovalTargetOption[] };
}

const TAG_POR_ESTADO: Record<string, string> = {
  PENDING: "edu-tag--info",
  APPROVED: "edu-tag--ok",
  CHANGES_REQUESTED: "edu-tag--warn",
  REJECTED: "edu-tag--danger",
  EXPIRED: "edu-tag--danger",
};

export function EduCasoAutorizaciones({
  caseId,
  caseLabel,
  gates,
  rows,
  canRequest,
}: EduCasoAutorizacionesProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [stage, setStage] = useState<EduApprovalStage>("PLAN");
  const [targetId, setTargetId] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [opciones, setOpciones] = useState<CasoPayload["targets"] | null>(null);

  const quiereCita = eduApprovalTargetForStage(stage) === "EduAppointment";
  const lista = opciones ? (quiereCita ? opciones.appointments : opciones.records) : [];

  async function abrir() {
    setError(null);
    setAbierto(true);
    setStage("PLAN");
    setTargetId("");
    setUrgente(false);
    setMotivo("");
    if (opciones) return;
    setCargando(true);
    try {
      // Las opciones se piden AL ABRIR y no con la página: la ficha de un
      // paciente puede tener tres casos, y cargar las notas y las citas de
      // los tres para un botón que casi nunca se pulsa es tráfico que paga
      // un teléfono en el piso clínico.
      const data = await eduRequest<CasoPayload>(
        `/api/instituto/autorizaciones?caso=${encodeURIComponent(caseId)}`,
      );
      setOpciones(data.targets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar qué mandar a autorizar.");
    } finally {
      setCargando(false);
    }
  }

  async function enviar() {
    setError(null);
    if (!targetId) {
      setError(
        quiereCita
          ? "Elige la cita que mandas a autorizar."
          : "Elige la nota donde escribiste lo que propones.",
      );
      return;
    }
    if (urgente && motivo.trim().length < EDU_APPROVAL_EMERGENCY_REASON_MIN) {
      setError(
        "Escribe por qué es urgente. No se te va a impedir seguir: queda escrito, y eso es lo que te protege a ti y al paciente.",
      );
      return;
    }
    setGuardando(true);
    try {
      await eduRequest("/api/instituto/autorizaciones", {
        method: "POST",
        body: {
          caseId,
          stage,
          targetId,
          isEmergency: urgente,
          emergencyReason: urgente ? motivo.trim() : undefined,
        },
      });
      setFlash(
        urgente
          ? "Mandado como urgencia. Puedes seguir: quedó constancia y tu docente lo verá destacado."
          : "Mandado a autorización. Tu docente lo ve en su bandeja.",
      );
      setAbierto(false);
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mandar a autorización.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="edu-auth-caso">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-auth-puertas">
        {gates.map((g) => (
          <div
            key={g.stage}
            className={`edu-auth-puerta ${g.verdict.ok ? "edu-auth-puerta--ok" : "edu-auth-puerta--falta"}`}
          >
            <p className="edu-auth-puerta__k">{EDU_APPROVAL_STAGE_LABELS[g.stage]}</p>
            <p className="edu-auth-puerta__v">{g.verdict.detail}</p>
            {g.verdict.ok && g.verdict.viaEmergency && (
              <p className="edu-auth-puerta__nota">
                Pasó por urgencia. Sigue faltando la firma del docente.
              </p>
            )}
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <ul className="edu-auth-historial">
          {rows.map((r) => (
            <li key={r.id} className="edu-auth-historial__item">
              <div className="edu-auth-historial__head">
                <span className="edu-auth-historial__stage">
                  {r.stageLabel}
                  {r.isEmergency ? " · urgencia" : ""}
                </span>
                <span className={`edu-tag ${TAG_POR_ESTADO[r.status] ?? "edu-tag--muted"}`}>
                  {EDU_APPROVAL_STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="edu-auth-historial__meta">
                {/* QUÉ exactamente: el título del contenido que se firmó, no
                    un "documento #3". */}
                {r.summary.title}
              </p>
              <p className="edu-auth-historial__meta">
                Pedida por {r.requestedByName} el {r.requestedAtLabel}
                {r.decidedByName && r.decidedAtLabel
                  ? ` · ${r.status === "APPROVED" ? "firmada" : "decidida"} por ${r.decidedByName} el ${r.decidedAtLabel}`
                  : ""}
              </p>
              {r.decisionNote && <p className="edu-auth-historial__nota">“{r.decisionNote}”</p>}
              {r.status === "EXPIRED" && r.storedStatus === "APPROVED" && (
                <p className="edu-auth-historial__nota">
                  Estaba firmada y se editó lo que decía. La firma cubría el texto anterior, así que
                  dejó de valer: hay que mandarla otra vez.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canRequest && (
        <button type="button" className="edu-btn edu-btn--primary edu-btn--sm" onClick={abrir}>
          Enviar a autorización
        </button>
      )}

      {abierto && (
        <EduModal
          title="Enviar a autorización"
          subtitle={caseLabel}
          busy={guardando}
          onClose={() => setAbierto(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setAbierto(false)}
                disabled={guardando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={enviar}
                disabled={guardando || cargando}
              >
                {urgente ? "Mandar como urgencia" : "Mandar"}
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
            <label className="edu-field__label" htmlFor="auth-stage">
              ¿Qué mandas?
            </label>
            <select
              id="auth-stage"
              className="edu-input"
              value={stage}
              onChange={(e) => {
                setStage(e.target.value as EduApprovalStage);
                // El tipo de fila cambia con la etapa: dejar el id anterior
                // mandaría el id de una nota como si fuera una cita.
                setTargetId("");
              }}
            >
              {EDU_APPROVAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {EDU_APPROVAL_STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="edu-field__hint">{EDU_APPROVAL_STAGE_DESCRIPTIONS[stage]}</p>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="auth-target">
              {quiereCita ? "¿Qué sesión?" : "¿En qué nota lo escribiste?"}
            </label>
            {cargando ? (
              <p className="edu-note">Cargando…</p>
            ) : lista.length === 0 ? (
              <p className="edu-note">
                {quiereCita
                  ? "Este caso no tiene citas enganchadas. Engancha la cita al caso desde la agenda y vuelve."
                  : "Este caso no tiene notas todavía. Escribe la nota con lo que propones en el expediente y vuelve: se autoriza lo que está escrito, no una intención."}
              </p>
            ) : (
              <select
                id="auth-target"
                className="edu-input"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">Elige…</option>
                {lista.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} — {o.detail}
                  </option>
                ))}
              </select>
            )}
          </div>

          <label className="edu-check">
            <input
              type="checkbox"
              checked={urgente}
              onChange={(e) => setUrgente(e.target.checked)}
            />
            <span className="edu-check__body">
              <span className="edu-check__label">Es una urgencia y ya procedí</span>
              <span className="edu-check__hint">
                No se te impide seguir. Se marca, sale primero en la bandeja del docente y queda con
                tu motivo escrito — eso es lo que te protege a ti y al paciente.
              </span>
            </span>
          </label>

          {urgente && (
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="auth-motivo">
                ¿Por qué no podía esperar?
              </label>
              <textarea
                id="auth-motivo"
                className="edu-input"
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: absceso con dolor agudo, el docente supervisor estaba en quirófano."
              />
            </div>
          )}
        </EduModal>
      )}
    </div>
  );
}
