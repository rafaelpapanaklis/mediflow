"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPE_LABELS,
  EDU_CASE_STATUS_LABELS,
  type EduAppointmentStatus,
} from "@/lib/edu/types";
import {
  EDU_APPOINTMENT_TRANSITIONS,
  eduFormatDayShort,
  type EduAppointmentRow,
} from "@/lib/edu/agenda-core";

/**
 * /instituto/mi-dia — MI AGENDA: la pantalla del alumno.
 *
 * Es la pantalla más importante del vertical para quien de verdad lo usa
 * todos los días, y por eso es la más simple. Dos vistas y nada más:
 *
 *   · HOY    — las citas de hoy, en orden, con los botones grandes de lo
 *     único que hay que apuntar mientras se trabaja (llegó, se sentó, se
 *     le está trabajando, terminamos). Igual que desde la Ola 2.
 *   · SEMANA — (Ola 12) los siete días de un vistazo: qué paciente trae
 *     el jueves, en qué sillón, con qué docente y EN QUÉ VA el caso. Sin
 *     botones de estado: nadie marca "llegó" el jueves desde el lunes, y
 *     quitarlos deja la semana legible en un teléfono.
 *
 * 🔴 POR QUÉ UN ALUMNO PUEDE TOCAR LOS BOTONES DE HOY CON SOLO
 * "agenda.view": registrar lo que está pasando en el sillón no es
 * administrar la agenda. Lo que impide que mueva la cita de otro no es el
 * permiso, es el ALCANCE: el servidor busca la cita con el `where` de
 * visibilidad y una que no le toca contesta 404. Cancelar y "no llegó" sí
 * exigen agenda.manage y por eso no aparecen aquí.
 *
 * La pantalla sirve igual para un DOCENTE (la semana de sus alumnos
 * vigentes) y para la dirección, sin una sola regla nueva: las filas ya
 * venían recortadas.
 */
export interface EduMiDiaScreenProps {
  rows: EduAppointmentRow[];
  dayLabel: string;
  scopeKind: "all" | "supervised" | "own" | "none";
  /** Ola 12. "hoy" = la vista clásica con botones; "semana" = solo lectura. */
  vista: "hoy" | "semana";
  /** Los siete días de la semana (solo en vista semana), en orden. */
  days: string[];
  /** Hoy en el calendario del INSTITUTO, para resaltar su columna. */
  hoyISO: string;
  truncated: boolean;
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

/** "En qué va": el caso del que cuelga la cita, en una línea. */
function casoDe(a: EduAppointmentRow): string | null {
  if (!a.caseProgramName || !a.caseStatus) return null;
  return `Caso de ${a.caseProgramName}: ${EDU_CASE_STATUS_LABELS[a.caseStatus].toLowerCase()}`;
}

export function EduMiDiaScreen({
  rows,
  dayLabel,
  scopeKind,
  vista,
  days,
  hoyISO,
  truncated,
}: EduMiDiaScreenProps) {
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

  function tarjeta(a: EduAppointmentRow, destacada: boolean, conBotones: boolean) {
    const botones = conBotones ? botonesDe(a.status) : [];
    const caso = casoDe(a);
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
          {scopeKind === "own" ? "" : ` · ${a.studentMatricula} ${a.studentName}`}
          {a.supervisorName ? ` · supervisa ${a.supervisorName}` : " · sin docente asignado"}
        </span>
        {/* Ola 12 · en qué va el caso, de un golpe. Una cita suelta lo
            dice también: "sin caso" es información, no un hueco. */}
        <span className="edu-slot__meta">{caso ?? "Sin caso enganchado todavía"}</span>
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

  // ── VISTA SEMANA (Ola 12): un bloque por día, solo lectura ────────────
  if (vista === "semana") {
    const porDia = new Map<string, EduAppointmentRow[]>();
    for (const r of rows) {
      const lista = porDia.get(r.dayISO) ?? [];
      lista.push(r);
      porDia.set(r.dayISO, lista);
    }
    return (
      <>
        {truncated && (
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">La semana tiene más citas de las que caben</p>
              <p className="edu-banner__detail">
                Se muestran las primeras. Abre un día concreto en «Hoy» para verlo completo.
              </p>
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Esta semana no hay nada agendado</p>
            <p className="edu-empty__detail">
              {scopeKind === "own"
                ? "Cuando recepción te agende pacientes, aparecerán aquí día por día."
                : "Cuando haya citas esta semana, aparecerán aquí día por día."}
            </p>
          </div>
        ) : (
          <div className="edu-semana">
            {days.map((d) => {
              const delDia = porDia.get(d) ?? [];
              const esHoy = d === hoyISO;
              // Un día sin citas se pinta CHIQUITO, no se esconde: "el
              // jueves no traes nada" también es la respuesta.
              return (
                <section key={d} className={`edu-semana__dia ${esHoy ? "edu-semana__dia--hoy" : ""}`}>
                  <div className="edu-section__head">
                    <h2 className="edu-section__title" style={{ textTransform: "capitalize" }}>
                      {eduFormatDayShort(d)}
                      {esHoy ? " · hoy" : ""}
                    </h2>
                    <span className="edu-count">{delDia.length}</span>
                  </div>
                  {delDia.length === 0 ? (
                    <p className="edu-note">Sin citas.</p>
                  ) : (
                    <div className="edu-stack edu-stack--tight">
                      {delDia.map((a) => tarjeta(a, false, false))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ── VISTA HOY: la clásica, con botones ────────────────────────────────
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
              ? "Cuando recepción te agende un paciente, aparecerá aquí con su hora y su sillón. Revisa «Semana» para ver lo que viene."
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
                {enSillon.map((a) => tarjeta(a, true, true))}
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
                {resto.map((a) => tarjeta(a, false, true))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
