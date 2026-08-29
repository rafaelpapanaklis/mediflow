"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPE_LABELS,
  type EduAppointmentStatus,
} from "@/lib/edu/types";
import {
  EDU_APPOINTMENT_TRANSITIONS,
  type EduAppointmentRow,
} from "@/lib/edu/agenda-core";

/**
 * /instituto/mi-dia — lo que ve un alumno al llegar al piso clínico.
 *
 * Es la pantalla más importante del vertical para quien de verdad lo usa
 * todos los días, y por eso es la más simple: sin filtros, sin vista de
 * semana, sin tabla. Las citas de HOY, en orden, y los botones grandes de
 * lo único que hay que apuntar mientras se trabaja — llegó, se sentó, se
 * le está trabajando, terminamos.
 *
 * 🔴 POR QUÉ UN ALUMNO PUEDE TOCAR ESTOS BOTONES CON SOLO "agenda.view":
 * registrar lo que está pasando en el sillón no es administrar la agenda.
 * Lo que impide que mueva la cita de otro no es el permiso, es el ALCANCE:
 * el servidor busca la cita con el `where` de visibilidad y una que no le
 * toca contesta 404. Cancelar y "no llegó" sí exigen agenda.manage y por
 * eso no aparecen aquí.
 *
 * La pantalla sirve igual para un DOCENTE (ve el día de sus alumnos
 * vigentes) y para la dirección (el día entero), sin una sola regla nueva:
 * las filas ya venían recortadas.
 */
export interface EduMiDiaScreenProps {
  rows: EduAppointmentRow[];
  dayLabel: string;
  scopeKind: "all" | "supervised" | "own" | "none";
}

const TAG_BY_STATUS: Record<EduAppointmentStatus, string> = {
  SCHEDULED: "edu-tag--info",
  CHECKED_IN: "edu-tag--info",
  IN_CHAIR: "edu-tag--warn",
  IN_PROGRESS: "edu-tag--warn",
  COMPLETED: "edu-tag--ok",
  CANCELLED: "edu-tag--muted",
  NO_SHOW: "edu-tag--danger",
};

/** Los estados que se pueden mover desde aquí: los CLÍNICOS. Cancelar y
 *  dar por no presentado son decisiones administrativas y viven en la
 *  agenda, no en la pantalla de quien está trabajando. */
function botonesDe(status: EduAppointmentStatus): EduAppointmentStatus[] {
  return (EDU_APPOINTMENT_TRANSITIONS[status] ?? []).filter(
    (s) => s !== "CANCELLED" && s !== "NO_SHOW",
  );
}

export function EduMiDiaScreen({ rows, dayLabel, scopeKind }: EduMiDiaScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // "Tu paciente en el sillón": el que está sentado ahora mismo. Se saca
  // arriba porque es la única pregunta que alguien de pie tiene de verdad.
  const enSillon = rows.filter((r) => r.status === "IN_CHAIR" || r.status === "IN_PROGRESS");
  const resto = rows.filter((r) => !enSillon.includes(r));

  async function mover(row: EduAppointmentRow, status: EduAppointmentStatus) {
    setError(null);
    setBusyId(row.id);
    try {
      await eduRequest(`/api/instituto/agenda/${row.id}/estado`, {
        method: "PATCH",
        body: { status },
      });
      setFlash(`${row.patientName}: ${EDU_APPOINTMENT_STATUS_LABELS[status].toLowerCase()}.`);
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    } finally {
      setBusyId(null);
    }
  }

  function tarjeta(a: EduAppointmentRow, destacada: boolean) {
    const botones = botonesDe(a.status);
    return (
      <article
        key={a.id}
        className={`edu-slot ${destacada ? "edu-slot--tamizaje" : ""} ${
          a.status === "COMPLETED" ? "edu-slot--done" : ""
        } ${a.status === "CANCELLED" || a.status === "NO_SHOW" ? "edu-slot--off" : ""}`}
        style={{ cursor: "default" }}
      >
        <span className="edu-slot__time">
          {a.startLabel}–{a.endLabel} · {a.chairName}
        </span>
        <span className="edu-slot__name">{a.patientName}</span>
        <span className="edu-slot__meta">
          Folio {a.patientFolio}
          {scopeKind === "own" ? "" : ` · ${a.studentMatricula}`}
          {a.supervisorName ? ` · supervisa ${a.supervisorName}` : " · sin docente asignado"}
        </span>
        {a.notes && <span className="edu-slot__meta">{a.notes}</span>}

        <span className="edu-slot__tags">
          <span className="edu-tag edu-tag--muted">{EDU_APPOINTMENT_TYPE_LABELS[a.type]}</span>
          <span className={`edu-tag ${TAG_BY_STATUS[a.status]}`}>
            {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
          </span>
        </span>

        {botones.length > 0 && (
          <div className="edu-actions" style={{ marginTop: 8 }}>
            {botones.map((s) => (
              <button
                key={s}
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => mover(a, s)}
                disabled={busyId === a.id}
              >
                {EDU_APPOINTMENT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
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

      <p className="edu-note" style={{ textTransform: "capitalize" }}>
        {dayLabel}
      </p>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Hoy no tienes nada agendado</p>
          <p className="edu-empty__detail">
            {scopeKind === "own"
              ? "Cuando recepción te agende un paciente, aparecerá aquí con su hora y su sillón."
              : "Cuando haya citas para hoy, aparecerán aquí en orden."}
          </p>
        </div>
      ) : (
        <>
          {enSillon.length > 0 && (
            <section className="edu-section">
              <div className="edu-section__head">
                <h2 className="edu-section__title">En el sillón ahora</h2>
                <span className="edu-count">{enSillon.length}</span>
              </div>
              <div className="edu-stack edu-stack--tight">
                {enSillon.map((a) => tarjeta(a, true))}
              </div>
            </section>
          )}

          <section className="edu-section">
            <div className="edu-section__head">
              <h2 className="edu-section__title">
                {enSillon.length > 0 ? "El resto del día" : "Tus citas de hoy"}
              </h2>
              <span className="edu-count">{resto.length}</span>
            </div>
            {resto.length === 0 ? (
              <p className="edu-note">Nada más por hoy.</p>
            ) : (
              <div className="edu-stack edu-stack--tight">
                {resto.map((a) => tarjeta(a, false))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
