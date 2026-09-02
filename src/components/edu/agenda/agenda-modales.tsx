"use client";

import { useState } from "react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPES,
  EDU_APPOINTMENT_TYPE_LABELS,
  EDU_CASE_STATUS_LABELS,
  type EduAppointmentStatus,
  type EduAppointmentType,
} from "@/lib/edu/types";
import {
  EDU_APPOINTMENT_DEFAULT_MINUTES,
  EDU_APPOINTMENT_TRANSITIONS,
  eduFormatDayShort,
  type EduAppointmentRow,
  type EduChairOption,
  type EduStudentOption,
  type EduSupervisorOption,
} from "@/lib/edu/agenda-core";
import { eduAgendaRowIsClosed, type EduAgendaDrop } from "@/lib/edu/agenda-rejilla";

/**
 * Los tres diálogos de la agenda: AGENDAR, el DETALLE de una cita y la
 * CONFIRMACIÓN de un arrastre.
 *
 * Viven fuera de la rejilla y no dentro, por una razón de maquetación que
 * ya costó cara en este repo: el envoltorio de la rejilla lleva
 * `container-type: inline-size` para poder medirse con `@container`, y un
 * contenedor de consulta ATRAPA a sus descendientes `position: fixed`
 * dentro de su caja. Un modal montado ahí adentro se quedaría encerrado en
 * la columna de la agenda en vez de cubrir la pantalla.
 *
 * 🔴 Las tres escrituras pegan contra los MISMOS endpoints de siempre. El
 * arrastre no tiene una ruta propia: termina en el mismo
 * `PATCH /api/instituto/agenda/[id]` que el formulario de reagendar, con
 * las mismas validaciones del servidor (horario del sillón, choque, cita
 * cerrada, sede) y cancelando el mismo recordatorio viejo.
 */

export const EDU_AG_TAG_BY_STATUS: Record<EduAppointmentStatus, string> = {
  SCHEDULED: "edu-tag--info",
  CHECKED_IN: "edu-tag--info",
  IN_CHAIR: "edu-tag--warn",
  IN_PROGRESS: "edu-tag--warn",
  COMPLETED: "edu-tag--ok",
  CANCELLED: "edu-tag--muted",
  NO_SHOW: "edu-tag--danger",
};

// ═══════════════════════════════════════════════════════════════════════
// Agendar
// ═══════════════════════════════════════════════════════════════════════

export function EduAgendaAlta({
  chairs,
  students,
  supervisors,
  patients,
  dayISO,
  slot,
  onClose,
  onDone,
}: {
  chairs: EduChairOption[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  patients: { id: string; folio: string; name: string }[];
  dayISO: string;
  /** El hueco que se tocó en la rejilla, si el alta nace de ahí. */
  slot: { chairId: string; startLabel: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const activos = chairs.filter((c) => c.isActive);
  // Ola 11: el nombre de la sede solo se pinta cuando hay más de una.
  // Con dos sedes hay dos "Sillón 1" y el desplegable diría dos veces lo
  // mismo; con una sola, mencionarla es ruido.
  const variasSedes = new Set(chairs.map((c) => c.campusId)).size > 1;
  const [patientId, setPatientId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [chairId, setChairId] = useState(slot?.chairId ?? activos[0]?.id ?? "");
  const [supervisorUserId, setSupervisorUserId] = useState("");
  const [day, setDay] = useState(dayISO);
  const [hora, setHora] = useState(slot?.startLabel ?? "09:00");
  const [minutos, setMinutos] = useState(String(EDU_APPOINTMENT_DEFAULT_MINUTES));
  const [tipo, setTipo] = useState<EduAppointmentType>("TRATAMIENTO");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alumno = students.find((s) => s.id === studentId) ?? null;

  // El supervisor se propone solo con el titular VIGENTE del alumno. Si
  // hubiera que elegirlo a mano en cada cita, la mitad quedarían sin
  // supervisor y la otra mitad con el que no era.
  const supervisorEfectivo = supervisorUserId || alumno?.supervisorUserId || "";

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/agenda", {
        method: "POST",
        body: {
          patientId,
          studentId,
          chairId,
          supervisorUserId: supervisorEfectivo || null,
          day,
          startMinute: hora,
          minutes: minutos,
          type: tipo,
          notes: notes.trim() || null,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Agendar cita"
      subtitle="El servidor comprueba que el sillón esté abierto a esa hora y que no choque con nada."
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
            disabled={busy || !patientId || !studentId || !chairId || !day || !hora}
          >
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

      {activos.length === 0 && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">No hay sillones activos</p>
            <p className="edu-banner__detail">
              Da de alta al menos una unidad dental en <strong>Sillones</strong> antes de
              agendar.
            </p>
          </div>
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-ac-paciente">
          Paciente
        </label>
        <select
          id="edu-ac-paciente"
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

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ac-alumno">
            Estudiante
          </label>
          <select
            id="edu-ac-alumno"
            className="edu-input"
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setSupervisorUserId("");
            }}
          >
            <option value="">Elige…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.matricula} · {s.name}
              </option>
            ))}
          </select>
          {alumno && <span className="edu-field__hint">{alumno.programName}</span>}
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ac-sillon">
            Sillón
          </label>
          <select
            id="edu-ac-sillon"
            className="edu-input"
            value={chairId}
            onChange={(e) => setChairId(e.target.value)}
          >
            <option value="">Elige…</option>
            {activos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {variasSedes ? ` · ${c.campusName}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ac-dia">
            Día
          </label>
          <input
            id="edu-ac-dia"
            className="edu-input"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ac-hora">
            Hora
          </label>
          <input
            id="edu-ac-hora"
            className="edu-input"
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
          <span className="edu-field__hint">En la hora del instituto.</span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ac-min">
            Duración (minutos)
          </label>
          <input
            id="edu-ac-min"
            className="edu-input"
            type="number"
            min={10}
            max={480}
            step={5}
            value={minutos}
            onChange={(e) => setMinutos(e.target.value)}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ac-tipo">
            Tipo
          </label>
          <select
            id="edu-ac-tipo"
            className="edu-input"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as EduAppointmentType)}
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
        <label className="edu-field__label" htmlFor="edu-ac-sup">
          Docente que supervisa
        </label>
        <select
          id="edu-ac-sup"
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
            ? `Se propone el titular vigente de ${alumno.matricula}: ${alumno.supervisorName}.`
            : "Este estudiante no tiene titular vigente. Asígnale uno en Estudiantes si hace falta."}
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-ac-notas">
          Notas
        </label>
        <textarea
          id="edu-ac-notas"
          className="edu-input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Detalle de una cita
// ═══════════════════════════════════════════════════════════════════════

/**
 * El detalle hace DOS cosas y las separa a propósito:
 *  · mover el ESTADO (llegó, se sentó, terminó) — lo puede hacer quien ve
 *    la cita, porque es apuntar lo que está pasando en el sillón;
 *  · REAGENDAR — exige "agenda.manage", porque es repartir huecos.
 *
 * Cancelar y "no llegó" van con el segundo grupo: son decisiones
 * administrativas y el servidor las rebota sin agenda.manage.
 */
export function EduAgendaDetalle({
  row,
  chairs,
  students,
  supervisors,
  canManage,
  onClose,
  onDone,
}: {
  row: EduAppointmentRow;
  chairs: EduChairOption[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  canManage: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reagendando, setReagendando] = useState(false);
  const [day, setDay] = useState(row.dayISO);
  const [hora, setHora] = useState(row.startLabel);
  const [minutos, setMinutos] = useState(String(row.minutes));
  const [chairId, setChairId] = useState(row.chairId);
  // Ola 11: el nombre de la sede solo se pinta cuando hay más de una.
  const variasSedes = new Set(chairs.map((c) => c.campusId)).size > 1;
  const [studentId, setStudentId] = useState(row.studentId);
  const [supervisorUserId, setSupervisorUserId] = useState(row.supervisorUserId ?? "");

  const siguientes = EDU_APPOINTMENT_TRANSITIONS[row.status] ?? [];
  const clinicos = siguientes.filter((s) => s !== "CANCELLED" && s !== "NO_SHOW");
  const administrativos = siguientes.filter((s) => s === "CANCELLED" || s === "NO_SHOW");
  const cerrada = eduAgendaRowIsClosed(row.status);

  async function mover(status: EduAppointmentStatus) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/agenda/${row.id}/estado`, {
        method: "PATCH",
        body: { status },
      });
      onDone(`${row.patientName}: ${EDU_APPOINTMENT_STATUS_LABELS[status].toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function reagendar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/agenda/${row.id}`, {
        method: "PATCH",
        body: {
          day,
          startMinute: hora,
          minutes: minutos,
          chairId,
          studentId,
          supervisorUserId: supervisorUserId || null,
        },
      });
      onDone("La cita quedó reagendada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reagendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={row.patientName}
      subtitle={`${eduFormatDayShort(row.dayISO)} · ${row.startLabel}–${row.endLabel} · ${row.chairName}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
          {reagendando && (
            <button type="button" className="edu-btn edu-btn--primary" onClick={reagendar} disabled={busy}>
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Folio</span>
          <span className="edu-kv__v">{row.patientFolio}</span>
        </div>
        <div>
          <span className="edu-kv__k">Estado</span>
          <span className="edu-kv__v">
            <span className={`edu-tag ${EDU_AG_TAG_BY_STATUS[row.status]}`}>
              {EDU_APPOINTMENT_STATUS_LABELS[row.status]}
            </span>
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Estudiante</span>
          <span className="edu-kv__v">
            {row.studentMatricula} · {row.studentName}
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Especialidad</span>
          <span className="edu-kv__v">{row.studentProgramName}</span>
        </div>
        <div>
          <span className="edu-kv__k">Docente</span>
          <span className="edu-kv__v">{row.supervisorName ?? "Sin docente asignado"}</span>
        </div>
        <div>
          <span className="edu-kv__k">Tipo</span>
          <span className="edu-kv__v">{EDU_APPOINTMENT_TYPE_LABELS[row.type]}</span>
        </div>
        <div>
          <span className="edu-kv__k">Caso</span>
          <span className="edu-kv__v">
            {row.caseId
              ? `${row.caseProgramName ?? "Caso"}${row.caseStatus ? ` · ${EDU_CASE_STATUS_LABELS[row.caseStatus]}` : ""}`
              : row.type === "TAMIZAJE"
                ? "El tamizaje abre el caso"
                : "Sin caso"}
          </span>
        </div>
        {row.notes && (
          <div>
            <span className="edu-kv__k">Notas</span>
            <span className="edu-kv__v">{row.notes}</span>
          </div>
        )}
      </div>

      {cerrada ? (
        <p className="edu-note">
          Esta cita ya se cerró. No se mueve ni se reagenda: lo que ocurrió, ocurrió. Si el
          paciente vuelve, se agenda otra.
        </p>
      ) : (
        <div className="edu-section">
          <div className="edu-section__head">
            <h3 className="edu-section__title">Qué está pasando</h3>
          </div>
          <div className="edu-actions">
            {clinicos.map((s) => (
              <button
                key={s}
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => mover(s)}
                disabled={busy}
              >
                {EDU_APPOINTMENT_STATUS_LABELS[s]}
              </button>
            ))}
            {administrativos.map((s) => (
              <button
                key={s}
                type="button"
                className="edu-btn edu-btn--danger edu-btn--sm"
                onClick={() => mover(s)}
                disabled={busy || !canManage}
                title={canManage ? undefined : "Necesita el permiso agenda.manage"}
              >
                {EDU_APPOINTMENT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <p className="edu-note">
            Marcar que el paciente llegó o que ya está en el sillón lo puede hacer quien ve
            la cita. Cancelarla o darla por no presentada necesita <code>agenda.manage</code>.
          </p>
        </div>
      )}

      {canManage && !cerrada && (
        <div className="edu-section">
          <div className="edu-section__head">
            <h3 className="edu-section__title">Reagendar</h3>
            {!reagendando && (
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => setReagendando(true)}
              >
                Mover esta cita
              </button>
            )}
          </div>

          {!reagendando && (
            <p className="edu-note">
              En la rejilla también se arrastra: toma la tarjeta y suéltala en otra hora o en
              otro sillón. Es esta misma pantalla, con el ratón.
            </p>
          )}

          {reagendando && (
            <div className="edu-formgrid edu-formgrid--2">
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-rg-dia">
                  Día
                </label>
                <input
                  id="edu-rg-dia"
                  className="edu-input"
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-rg-hora">
                  Hora
                </label>
                <input
                  id="edu-rg-hora"
                  className="edu-input"
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                />
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-rg-min">
                  Duración (minutos)
                </label>
                <input
                  id="edu-rg-min"
                  className="edu-input"
                  type="number"
                  min={10}
                  max={480}
                  step={5}
                  value={minutos}
                  onChange={(e) => setMinutos(e.target.value)}
                />
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-rg-sillon">
                  Sillón
                </label>
                <select
                  id="edu-rg-sillon"
                  className="edu-input"
                  value={chairId}
                  onChange={(e) => setChairId(e.target.value)}
                >
                  {chairs.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.isActive && c.id !== row.chairId}>
                      {c.name}
                      {variasSedes ? ` · ${c.campusName}` : ""}
                      {c.isActive ? "" : " (baja)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-rg-alumno">
                  Estudiante
                </label>
                <select
                  id="edu-rg-alumno"
                  className="edu-input"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.matricula} · {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="edu-field">
                <label className="edu-field__label" htmlFor="edu-rg-sup">
                  Docente
                </label>
                <select
                  id="edu-rg-sup"
                  className="edu-input"
                  value={supervisorUserId}
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
              </div>
            </div>
          )}
        </div>
      )}

    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Confirmar un arrastre
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 ARRASTRAR NO GUARDA SOLO. Una cita movida por accidente con el codo es
 * un paciente al que le llega la hora equivocada, y deshacer no existe. Así
 * que el arrastre PROPONE y esta ventana confirma — enseñando de dónde a
 * dónde, con las dos horas escritas.
 *
 * Si el servidor dice que no (el sillón está cerrado a esa hora, choca con
 * otra cita, la sede no es la suya), el error se lee AQUÍ y la tarjeta se
 * queda donde estaba: no se toca la pantalla hasta que el servidor
 * confirma.
 */
export function EduAgendaConfirmarArrastre({
  row,
  drop,
  destino,
  advertencia,
  onCancel,
  onDone,
}: {
  row: EduAppointmentRow;
  drop: EduAgendaDrop;
  /** Cómo se llama la columna de destino ("Sillón 3", "mié 2 sep"). */
  destino: string;
  /** Lo que el navegador ya sospecha (choque) — el servidor manda. */
  advertencia: string | null;
  onCancel: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      // El MISMO endpoint que el formulario de reagendar. Y a propósito NO
      // se manda `studentId`: arrastrar mueve una hora, no cambia de
      // estudiante, y mandarlo obligaría al servidor a volver a derivar el
      // caso en cada movimiento.
      await eduRequest(`/api/instituto/agenda/${row.id}`, {
        method: "PATCH",
        body: {
          day: drop.dayISO,
          startMinute: drop.startMinute,
          minutes: drop.minutes,
          chairId: drop.chairId,
        },
      });
      onDone(`${row.patientName}: ${drop.startLabel}–${drop.endLabel} · ${destino}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reagendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="¿Mover esta cita?"
      subtitle={row.patientName}
      onClose={busy ? () => undefined : onCancel}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onCancel} disabled={busy}>
            Dejarla donde estaba
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Moviendo…" : "Sí, moverla"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {advertencia && !error && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">Ahí ya hay algo</p>
            <p className="edu-banner__detail">{advertencia}</p>
          </div>
        </div>
      )}

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Estaba</span>
          <span className="edu-kv__v">
            {eduFormatDayShort(row.dayISO)} · {row.startLabel}–{row.endLabel} · {row.chairName}
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Queda</span>
          <span className="edu-kv__v">
            {eduFormatDayShort(drop.dayISO)} · {drop.startLabel}–{drop.endLabel} · {destino}
          </span>
        </div>
      </div>

      <p className="edu-note">
        Al moverla se cancela el recordatorio de WhatsApp que ya estaba en cola: llevaba la
        hora vieja escrita dentro. Si hace falta avisar otra vez, se manda desde la ficha del
        paciente.
      </p>
    </EduModal>
  );
}
