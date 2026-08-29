"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_APPOINTMENT_STATUS_LABELS } from "@/lib/edu/types";
import { eduFormatDayShort, type EduAppointmentRow, type EduStudentOption, type EduSupervisorOption } from "@/lib/edu/agenda-core";

/**
 * /instituto/agenda/tamizaje — LA VALORACIÓN INICIAL.
 *
 * Es la puerta de entrada de la clínica: aquí un paciente deja de ser "el
 * señor que llegó" y pasa a ser el caso de alguien. Esta pantalla hace UNA
 * cosa — asignar el paciente a un alumno y abrir su EduCase — y por eso no
 * tiene ni tabla ni filtros.
 *
 * Se entra de dos maneras, porque las dos ocurren de verdad:
 *  · desde una CITA de tamizaje ya agendada (lo normal: el paciente está
 *    sentado y alguien lo está valorando);
 *  · desde un paciente registrado sin cita, porque la valoración a veces
 *    pasa en el pasillo y obligar a agendarla primero haría que nadie la
 *    registrara.
 *
 * Exige "casos.assign" (dirección y docentes): decidir quién trata a quién
 * es la decisión académica de esta ola, no un trámite de recepción.
 */
export interface EduTamizajeScreenProps {
  pendientes: EduAppointmentRow[];
  patients: { id: string; folio: string; name: string; status: string }[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  programs: { id: string; name: string; code: string }[];
}

export function EduTamizajeScreen({
  pendientes,
  patients,
  students,
  supervisors,
  programs,
}: EduTamizajeScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [abierto, setAbierto] = useState<EduAppointmentRow | "libre" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {pendientes.length} {pendientes.length === 1 ? "valoración agendada" : "valoraciones agendadas"}
        </span>
        <button
          type="button"
          className="edu-btn edu-btn--primary edu-btn--sm"
          onClick={() => {
            setFlash(null);
            setAbierto("libre");
          }}
        >
          <Stethoscope size={16} />
          Valorar sin cita
        </button>
      </div>

      {pendientes.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">No hay valoraciones agendadas</p>
          <p className="edu-empty__detail">
            Aquí salen las citas de tipo <strong>Tamizaje</strong> de los próximos días.
            Recepción las agenda desde la Agenda; si ya valoraste a alguien sin cita, usa
            &quot;Valorar sin cita&quot;.
          </p>
        </div>
      ) : (
        <div className="edu-stack edu-stack--tight">
          {pendientes.map((a) => (
            <article key={a.id} className="edu-slot edu-slot--tamizaje" style={{ cursor: "default" }}>
              <span className="edu-slot__time">
                {eduFormatDayShort(a.dayISO)} {a.startLabel}–{a.endLabel} · {a.chairName}
              </span>
              <span className="edu-slot__name">{a.patientName}</span>
              <span className="edu-slot__meta">
                Folio {a.patientFolio} · valora {a.studentMatricula}
                {a.caseId ? " · ya tiene caso abierto" : ""}
              </span>
              <span className="edu-slot__tags">
                <span className="edu-tag edu-tag--muted">
                  {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
                </span>
              </span>
              <div className="edu-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  onClick={() => {
                    setFlash(null);
                    setAbierto(a);
                  }}
                >
                  Asignar y abrir caso
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {abierto && (
        <FormularioTamizaje
          cita={abierto === "libre" ? null : abierto}
          patients={patients}
          students={students}
          supervisors={supervisors}
          programs={programs}
          onClose={() => setAbierto(null)}
          onDone={(mensaje) => {
            setAbierto(null);
            setFlash(mensaje);
            startNav(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

function FormularioTamizaje({
  cita,
  patients,
  students,
  supervisors,
  programs,
  onClose,
  onDone,
}: {
  cita: EduAppointmentRow | null;
  patients: { id: string; folio: string; name: string; status: string }[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  programs: { id: string; name: string; code: string }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [patientId, setPatientId] = useState(cita?.patientId ?? "");
  const [studentId, setStudentId] = useState("");
  const [programId, setProgramId] = useState("");
  const [supervisorUserId, setSupervisorUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alumno = students.find((s) => s.id === studentId) ?? null;
  const supervisorEfectivo = supervisorUserId || alumno?.supervisorUserId || "";
  const nombrePaciente =
    cita?.patientName ?? patients.find((p) => p.id === patientId)?.name ?? "El paciente";

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/tamizaje", {
        method: "POST",
        body: {
          // Cuando hay cita, el paciente sale de LA CITA en el servidor: no
          // se manda desde aquí para que no puedan discrepar.
          appointmentId: cita?.id,
          patientId: cita ? undefined : patientId,
          studentId,
          programId,
          supervisorUserId: supervisorEfectivo || null,
          notes: notes.trim() || null,
        },
      });
      onDone(`${nombrePaciente} quedó asignado y su caso está abierto.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el caso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Tamizaje"
      subtitle={
        cita
          ? `${cita.patientName} · folio ${cita.patientFolio}`
          : "Valoración sin cita: elige el paciente que valoraste."
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
            disabled={busy || (!cita && !patientId) || !studentId || !programId}
          >
            {busy ? "Abriendo…" : "Asignar y abrir caso"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!cita && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-tz-paciente">
            Paciente
          </label>
          <select
            id="edu-tz-paciente"
            className="edu-input"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">Elige…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.folio} · {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-tz-programa">
            Especialidad
          </label>
          <select
            id="edu-tz-programa"
            className="edu-input"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
          >
            <option value="">Elige…</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            Un paciente puede tener un caso por especialidad, pero solo uno abierto en cada
            una.
          </span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-tz-alumno">
            Alumno que lo va a tratar
          </label>
          <select
            id="edu-tz-alumno"
            className="edu-input"
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setSupervisorUserId("");
            }}
          >
            <option value="">Elige…</option>
            {students
              .filter((s) => !programId || s.programId === programId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.matricula} · {s.name}
                </option>
              ))}
          </select>
          <span className="edu-field__hint">
            {programId
              ? "Solo los alumnos de esa especialidad."
              : "Elige antes la especialidad para acotar la lista."}
          </span>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-tz-sup">
          Docente responsable
        </label>
        <select
          id="edu-tz-sup"
          className="edu-input"
          value={supervisorEfectivo}
          onChange={(e) => setSupervisorUserId(e.target.value)}
        >
          <option value="">Sin docente asignado</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.isActive}>
              {s.name}
              {s.isActive ? "" : " (baja)"}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">
          {alumno?.supervisorName
            ? `Se propone el titular vigente de ${alumno.matricula}: ${alumno.supervisorName}. Queda guardado como el responsable del caso en este momento; quién ve el caso lo sigue decidiendo la asignación vigente del padrón.`
            : "Este alumno no tiene titular vigente. El caso se puede abrir igual y el docente se pone después."}
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-tz-notas">
          Qué se encontró en la valoración
        </label>
        <textarea
          id="edu-tz-notas"
          className="edu-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Lo que justifica la asignación. La historia clínica completa es de otra ola."
        />
      </div>
    </EduModal>
  );
}
