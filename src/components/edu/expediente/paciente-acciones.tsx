"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CalendarPlus, FolderPlus, Upload } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_TYPE_LABELS,
  EDU_APPOINTMENT_TYPES,
  type EduAppointmentType,
} from "@/lib/edu/types";
import type {
  EduChairOption,
  EduStudentOption,
  EduSupervisorOption,
} from "@/lib/edu/agenda-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * OLA 12 · LAS ACCIONES DE LA FICHA — la ficha deja de ser de solo lectura.
 *
 * Cuatro acciones, cada una detrás de SU permiso (lo resolvió el layout en
 * el servidor; aquí solo se pinta lo que llegó en true):
 *
 *   · AGENDAR CITA  → agenda.manage (caja y dirección). Modal aquí mismo:
 *     recepción agenda con el paciente en el mostrador, sin ir a la agenda.
 *   · ABRIR CASO    → casos.assign (docente y dirección). Caja NO lo ve —
 *     es la línea del contrato: caja no abre expediente clínico.
 *   · SUBIR ESTUDIO → estudios.upload. Es un enlace a la pestaña Estudios
 *     con ?subir=1: el modal de subida YA existe ahí (con su barra de
 *     progreso y su subida directa) y duplicarlo aquí sería la segunda
 *     copia que se desincroniza.
 *   · COBRAR        → caja.charge. Enlace a la caja con el paciente YA
 *     elegido (?cobrar=id): el alumno no lo ve ni de lejos — no lleva la
 *     key, y aunque la llevara, el alcance del dinero le devuelve "none".
 *
 * 🔴 Los desplegables (alumnos, sillones, docentes) SOLO llegan cuando
 * quien mira puede usarlos (canAgendar / canAbrirCaso): es la lección del
 * P1-4 — lo que viaja en el payload RSC ya se filtró en el servidor.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface EduProgramaOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface EduPacienteAccionesProps {
  patientId: string;
  patientName: string;
  base: string;
  todayISO: string;
  canAgendar: boolean;
  canAbrirCaso: boolean;
  canSubirEstudio: boolean;
  canCobrar: boolean;
  /** Vacíos cuando quien mira no puede agendar/abrir caso (no viajan). */
  alumnos: EduStudentOption[];
  sillones: EduChairOption[];
  docentes: EduSupervisorOption[];
  programas: EduProgramaOption[];
}

export function EduPacienteAcciones(props: EduPacienteAccionesProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [agendar, setAgendar] = useState(false);
  const [abrirCaso, setAbrirCaso] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const hayAcciones =
    props.canAgendar || props.canAbrirCaso || props.canSubirEstudio || props.canCobrar;
  if (!hayAcciones) return null;

  function hecho(mensaje: string) {
    setAgendar(false);
    setAbrirCaso(false);
    setFlash(mensaje);
    startNav(() => router.refresh());
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

      <div className="edu-acciones-ficha" role="group" aria-label="Acciones del paciente">
        {props.canAgendar && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAgendar(true);
            }}
          >
            <CalendarPlus size={15} />
            Agendar cita
          </button>
        )}
        {props.canAbrirCaso && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAbrirCaso(true);
            }}
          >
            <FolderPlus size={15} />
            Abrir caso
          </button>
        )}
        {props.canSubirEstudio && (
          <Link href={`${props.base}/estudios?subir=1`} className="edu-btn edu-btn--ghost edu-btn--sm">
            <Upload size={15} />
            Subir estudio
          </Link>
        )}
        {props.canCobrar && (
          <Link
            href={`/instituto/caja?cobrar=${props.patientId}`}
            className="edu-btn edu-btn--ghost edu-btn--sm"
          >
            <Banknote size={15} />
            Cobrar
          </Link>
        )}
      </div>

      {agendar && (
        <AgendarCita
          patientId={props.patientId}
          patientName={props.patientName}
          todayISO={props.todayISO}
          alumnos={props.alumnos}
          sillones={props.sillones}
          docentes={props.docentes}
          onClose={() => setAgendar(false)}
          onDone={hecho}
        />
      )}
      {abrirCaso && (
        <AbrirCaso
          patientId={props.patientId}
          patientName={props.patientName}
          alumnos={props.alumnos}
          programas={props.programas}
          onClose={() => setAbrirCaso(false)}
          onDone={hecho}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AGENDAR — el paciente ya está elegido: es el de la ficha.
// ═══════════════════════════════════════════════════════════════════════

const DURACIONES = [30, 45, 60, 90, 120];

function AgendarCita({
  patientId,
  patientName,
  todayISO,
  alumnos,
  sillones,
  docentes,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  todayISO: string;
  alumnos: EduStudentOption[];
  sillones: EduChairOption[];
  docentes: EduSupervisorOption[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [chairId, setChairId] = useState("");
  const [supervisorUserId, setSupervisorUserId] = useState("");
  const [supervisorTocado, setSupervisorTocado] = useState(false);
  const [day, setDay] = useState(todayISO);
  const [hora, setHora] = useState("09:00");
  const [minutes, setMinutes] = useState(60);
  const [type, setType] = useState<EduAppointmentType>("TRATAMIENTO");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activos = useMemo(() => sillones.filter((s) => s.isActive), [sillones]);
  // La sede solo se dice cuando hay más de una en la lista (regla de la
  // Ola 11: con una sola, nadie debe enterarse de que existen).
  const multiSede = useMemo(() => new Set(activos.map((s) => s.campusId)).size > 1, [activos]);

  function elegirAlumno(id: string) {
    setStudentId(id);
    // El titular VIGENTE del alumno se propone solo (viaja en la opción):
    // si hubiera que elegirlo a mano en cada cita, la mitad quedarían sin
    // supervisor. Quien lo tocó a mano, manda.
    if (!supervisorTocado) {
      const alumno = alumnos.find((a) => a.id === id);
      setSupervisorUserId(alumno?.supervisorUserId ?? "");
    }
  }

  async function guardar() {
    setError(null);
    if (!studentId) return setError("Elige al alumno que va a atender.");
    if (!chairId) return setError("Elige el sillón.");
    if (!day) return setError("Elige la fecha.");
    if (!hora) return setError("Elige la hora.");
    setBusy(true);
    try {
      await eduRequest("/api/instituto/agenda", {
        method: "POST",
        body: {
          patientId,
          studentId,
          chairId,
          supervisorUserId: supervisorUserId || undefined,
          day,
          startMinute: hora,
          minutes,
          type,
          notes: notes.trim() || undefined,
        },
      });
      onDone(`Cita agendada para ${patientName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agendar.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Agendar cita"
      subtitle={`Para ${patientName}. El caso se engancha solo en el servidor cuando el alumno tiene uno vivo con este paciente.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Agendando…" : "Agendar"}
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
        <label className="edu-field__label" htmlFor="edu-acc-alumno">
          Alumno
        </label>
        <select
          id="edu-acc-alumno"
          className="edu-input"
          value={studentId}
          disabled={busy}
          onChange={(e) => elegirAlumno(e.target.value)}
        >
          <option value="">Elige…</option>
          {alumnos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.matricula} · {a.name} · {a.programName}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-acc-sillon">
          Sillón
        </label>
        <select
          id="edu-acc-sillon"
          className="edu-input"
          value={chairId}
          disabled={busy}
          onChange={(e) => setChairId(e.target.value)}
        >
          <option value="">Elige…</option>
          {activos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {multiSede ? ` · ${s.campusName}` : ""}
            </option>
          ))}
        </select>
        {multiSede && (
          <span className="edu-field__hint">
            La hora se interpreta con el reloj de la sede del sillón.
          </span>
        )}
      </div>

      <div className="edu-kv edu-kv--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-dia">
            Fecha
          </label>
          <input
            id="edu-acc-dia"
            className="edu-input"
            type="date"
            value={day}
            disabled={busy}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-hora">
            Hora
          </label>
          <input
            id="edu-acc-hora"
            className="edu-input"
            type="time"
            value={hora}
            disabled={busy}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-min">
            Duración
          </label>
          <select
            id="edu-acc-min"
            className="edu-input"
            value={minutes}
            disabled={busy}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            {DURACIONES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-tipo">
            Tipo
          </label>
          <select
            id="edu-acc-tipo"
            className="edu-input"
            value={type}
            disabled={busy}
            onChange={(e) => setType(e.target.value as EduAppointmentType)}
          >
            {EDU_APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EDU_APPOINTMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-acc-sup">
          Docente que supervisa
        </label>
        <select
          id="edu-acc-sup"
          className="edu-input"
          value={supervisorUserId}
          disabled={busy}
          onChange={(e) => {
            setSupervisorTocado(true);
            setSupervisorUserId(e.target.value);
          }}
        >
          <option value="">Sin docente asignado</option>
          {docentes
            .filter((d) => d.isActive)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <span className="edu-field__hint">
          Se propone solo el titular vigente del alumno al elegirlo.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-acc-notas">
          Notas (opcional)
        </label>
        <textarea
          id="edu-acc-notas"
          className="edu-input"
          rows={2}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABRIR CASO — alumno + especialidad; el supervisor lo resuelve el
// servidor (el titular vigente del alumno), igual que en el tamizaje.
// ═══════════════════════════════════════════════════════════════════════

function AbrirCaso({
  patientId,
  patientName,
  alumnos,
  programas,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  alumnos: EduStudentOption[];
  programas: EduProgramaOption[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [programId, setProgramId] = useState("");
  const [programTocado, setProgramTocado] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activas = useMemo(() => programas.filter((p) => p.isActive), [programas]);

  function elegirAlumno(id: string) {
    setStudentId(id);
    // La especialidad se propone sola: es la del alumno. Se puede cambiar
    // (dirección abre casos cruzados), pero el default es el correcto en
    // casi todos.
    if (!programTocado) {
      const alumno = alumnos.find((a) => a.id === id);
      setProgramId(alumno?.programId ?? "");
    }
  }

  async function guardar() {
    setError(null);
    if (!studentId) return setError("Elige al alumno responsable.");
    if (!programId) return setError("Elige la especialidad del caso.");
    setBusy(true);
    try {
      await eduRequest("/api/instituto/casos", {
        method: "POST",
        body: { patientId, studentId, programId, notes: notes.trim() || undefined },
      });
      onDone(`Caso abierto para ${patientName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el caso.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Abrir caso"
      subtitle={`${patientName} queda asignado a un alumno en una especialidad. El docente responsable se toma del titular vigente del alumno.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Abriendo…" : "Abrir caso"}
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
        <label className="edu-field__label" htmlFor="edu-caso-alumno">
          Alumno responsable
        </label>
        <select
          id="edu-caso-alumno"
          className="edu-input"
          value={studentId}
          disabled={busy}
          onChange={(e) => elegirAlumno(e.target.value)}
        >
          <option value="">Elige…</option>
          {alumnos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.matricula} · {a.name} · {a.programName}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-caso-programa">
          Especialidad
        </label>
        <select
          id="edu-caso-programa"
          className="edu-input"
          value={programId}
          disabled={busy}
          onChange={(e) => {
            setProgramTocado(true);
            setProgramId(e.target.value);
          }}
        >
          <option value="">Elige…</option>
          {activas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-caso-notas">
          Notas (opcional)
        </label>
        <textarea
          id="edu-caso-notas"
          className="edu-input"
          rows={2}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}
