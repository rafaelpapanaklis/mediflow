"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_STATUSES,
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
  eduFormatDayLong,
  eduFormatDayShort,
  eduShiftDayISO,
  type EduAgendaQuery,
  type EduAppointmentRow,
  type EduChairOption,
  type EduStudentOption,
  type EduSupervisorOption,
} from "@/lib/edu/agenda-core";

/**
 * /instituto/agenda — el día y la semana, por sillón.
 *
 * MÓVIL PRIMERO: en el teléfono la agenda es una PILA de grupos (un grupo
 * por sillón en la vista de día, uno por día en la de semana) y cada cita
 * es una tarjeta con su hora escrita. A partir de 900 px los grupos se
 * acomodan en columnas — todo el cambio vive en edu-theme.css y aquí no hay
 * un solo `if` de tamaño.
 *
 * 🔴 LAS HORAS YA VIENEN FORMATEADAS del servidor, en la zona del
 * INSTITUTO. Este componente no llama a `toLocaleTimeString` ni una vez: si
 * lo hiciera, un alumno conectado desde otra zona vería su cita a otra hora
 * y el primer render no coincidiría con el del servidor.
 *
 * 🔴 QUÉ FILAS SE VEN lo decidió el servidor (visibility.ts). Aquí no hay
 * forma de pedir más.
 */
export interface EduAgendaScreenProps {
  rows: EduAppointmentRow[];
  days: string[];
  truncated: boolean;
  maxRows: number;
  query: EduAgendaQuery;
  chairs: EduChairOption[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  programs: { id: string; name: string }[];
  patients: { id: string; folio: string; name: string }[];
  canManage: boolean;
  todayISO: string;
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

function slotClass(a: EduAppointmentRow): string {
  if (a.status === "CANCELLED" || a.status === "NO_SHOW") return "edu-slot edu-slot--off";
  if (a.status === "COMPLETED") return "edu-slot edu-slot--done";
  if (a.type === "TAMIZAJE") return "edu-slot edu-slot--tamizaje";
  if (a.type === "CONTROL") return "edu-slot edu-slot--control";
  return "edu-slot";
}

export function EduAgendaScreen({
  rows,
  days,
  truncated,
  maxRows,
  query,
  chairs,
  students,
  supervisors,
  programs,
  patients,
  canManage,
  todayISO,
}: EduAgendaScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [alta, setAlta] = useState(false);
  const [detalle, setDetalle] = useState<EduAppointmentRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const hayFiltros = Boolean(query.chairId || query.programId || query.studentId || query.type || query.status);

  function ir(next: Partial<Record<"vista" | "dia" | "sillon" | "programa" | "alumno" | "tipo" | "estado", string>>) {
    const actual: Record<string, string> = {
      vista: query.view,
      dia: query.dayISO,
    };
    if (query.chairId) actual.sillon = query.chairId;
    if (query.programId) actual.programa = query.programId;
    if (query.studentId) actual.alumno = query.studentId;
    if (query.type) actual.tipo = query.type;
    if (query.status) actual.estado = query.status;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actual, ...next })) {
      if (v) params.set(k, v);
    }
    startNav(() => router.replace(`/instituto/agenda?${params.toString()}`, { scroll: false }));
  }

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  /**
   * Los grupos que se pintan. En la vista de DÍA son los sillones — todos
   * los activos, aunque no tengan citas: un sillón vacío es información
   * (ahí cabe alguien). En la de SEMANA son los días.
   */
  /**
   * 🔴 Ola 11 · CON DOS SEDES HAY DOS "Sillón 1", uno en cada pared, y sin
   * el nombre de la sede la agenda consolidada tendría dos columnas
   * idénticas. Se decide contando las sedes que hay EN LA LISTA que mandó
   * el servidor: con una sola no se menciona ninguna, que es el caso de
   * casi todas las escuelas — nombrar algo que no tiene alternativa es
   * ruido.
   */
  const variasSedes = useMemo(
    () => new Set(chairs.map((c) => c.campusId)).size > 1,
    [chairs],
  );

  const grupos = useMemo(() => {
    if (query.view === "semana") {
      return days.map((d) => ({
        key: d,
        title: eduFormatDayShort(d),
        sub: d === todayISO ? "Hoy" : "",
        rows: rows.filter((r) => r.dayISO === d),
      }));
    }
    const visibles = chairs.filter((c) => c.isActive || rows.some((r) => r.chairId === c.id));
    const acotados = query.chairId ? visibles.filter((c) => c.id === query.chairId) : visibles;
    const grupos = acotados.map((c) => ({
      key: c.id,
      title: c.name,
      sub: [variasSedes ? c.campusName : "", c.isActive ? "" : "Dado de baja"]
        .filter(Boolean)
        .join(" · "),
      rows: rows.filter((r) => r.chairId === c.id),
    }));
    // Cinturón: una cita en un sillón que ya no está en la lista (se dio de
    // baja y se borró de los desplegables) no puede desaparecer de la
    // pantalla — si no, la escuela tendría un paciente citado que nadie ve.
    const sueltas = rows.filter((r) => !acotados.some((c) => c.id === r.chairId));
    if (sueltas.length > 0 && !query.chairId) {
      grupos.push({ key: "sueltas", title: "Otros sillones", sub: "", rows: sueltas });
    }
    return grupos;
  }, [query.view, query.chairId, days, rows, chairs, todayISO, variasSedes]);

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-daybar">
        <div className="edu-daybar__nav">
          <button
            type="button"
            className="edu-iconbtn"
            aria-label={query.view === "semana" ? "Semana anterior" : "Día anterior"}
            onClick={() => ir({ dia: eduShiftDayISO(query.dayISO, query.view === "semana" ? -7 : -1) })}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="edu-daybar__label">
            {query.view === "semana"
              ? `${eduFormatDayShort(days[0])} – ${eduFormatDayShort(days[days.length - 1])}`
              : eduFormatDayLong(query.dayISO)}
          </span>
          <button
            type="button"
            className="edu-iconbtn"
            aria-label={query.view === "semana" ? "Semana siguiente" : "Día siguiente"}
            onClick={() => ir({ dia: eduShiftDayISO(query.dayISO, query.view === "semana" ? 7 : 1) })}
          >
            <ChevronRight size={18} />
          </button>
          {query.dayISO !== todayISO && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => ir({ dia: todayISO })}
            >
              Hoy
            </button>
          )}
        </div>

        <div className="edu-seg" role="group" aria-label="Vista">
          <button
            type="button"
            className={`edu-seg__btn ${query.view === "dia" ? "edu-seg__btn--on" : ""}`}
            aria-pressed={query.view === "dia"}
            onClick={() => ir({ vista: "dia" })}
          >
            Día
          </button>
          <button
            type="button"
            className={`edu-seg__btn ${query.view === "semana" ? "edu-seg__btn--on" : ""}`}
            aria-pressed={query.view === "semana"}
            onClick={() => ir({ vista: "semana" })}
          >
            Semana
          </button>
        </div>
      </div>

      <div className="edu-toolbar">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ag-sillon">
            Sillón
          </label>
          <select
            id="edu-ag-sillon"
            className="edu-input edu-input--sm"
            value={query.chairId ?? ""}
            onChange={(e) => ir({ sillon: e.target.value })}
          >
            <option value="">Todos</option>
            {chairs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {variasSedes ? ` · ${c.campusName}` : ""}
                {c.isActive ? "" : " (baja)"}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ag-programa">
            Especialidad
          </label>
          <select
            id="edu-ag-programa"
            className="edu-input edu-input--sm"
            value={query.programId ?? ""}
            onChange={(e) => ir({ programa: e.target.value })}
          >
            <option value="">Todas</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ag-tipo">
            Tipo
          </label>
          <select
            id="edu-ag-tipo"
            className="edu-input edu-input--sm"
            value={query.type ?? ""}
            onChange={(e) => ir({ tipo: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EDU_APPOINTMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ag-estado">
            Estado
          </label>
          <select
            id="edu-ag-estado"
            className="edu-input edu-input--sm"
            value={query.status ?? ""}
            onChange={(e) => ir({ estado: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_APPOINTMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() =>
              ir({ sillon: "", programa: "", alumno: "", tipo: "", estado: "" })
            }
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </div>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Cargando…"
            : `${rows.length} ${rows.length === 1 ? "cita" : "citas"}${
                truncated ? ` (se muestran las primeras ${maxRows})` : ""
              }`}
        </span>
        {canManage && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAlta(true);
            }}
          >
            <CalendarPlus size={16} />
            Agendar cita
          </button>
        )}
      </div>

      {grupos.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay sillones</p>
          <p className="edu-empty__detail">
            La agenda se organiza por unidad dental. Da de alta los sillones que tenga la
            clínica en <strong>Sillones</strong> y aquí aparecerán sus columnas.
          </p>
        </div>
      ) : (
        <div className={`edu-agenda ${query.view === "dia" ? "edu-agenda--cols" : ""}`}>
          {grupos.map((g) => (
            <section key={g.key} className="edu-agenda__group">
              <header className="edu-agenda__head">
                <h2 className="edu-agenda__title">{g.title}</h2>
                <p className="edu-agenda__sub">
                  {g.sub ? `${g.sub} · ` : ""}
                  {g.rows.length} {g.rows.length === 1 ? "cita" : "citas"}
                </p>
              </header>

              {g.rows.length === 0 ? (
                <p className="edu-agenda__empty">Sin citas.</p>
              ) : (
                <div className="edu-agenda__body">
                  {g.rows.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={slotClass(a)}
                      onClick={() => {
                        setFlash(null);
                        setDetalle(a);
                      }}
                    >
                      <span className="edu-slot__time">
                        {a.startLabel}–{a.endLabel}
                        {query.view === "semana" ? ` · ${a.chairName}` : ""}
                      </span>
                      <span className="edu-slot__name">{a.patientName}</span>
                      <span className="edu-slot__meta">
                        {a.studentMatricula} · {a.studentProgramName}
                      </span>
                      <span className="edu-slot__tags">
                        <span className="edu-tag edu-tag--muted">
                          {EDU_APPOINTMENT_TYPE_LABELS[a.type]}
                        </span>
                        <span className={`edu-tag ${TAG_BY_STATUS[a.status]}`}>
                          {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {alta && (
        <AltaCita
          chairs={chairs}
          students={students}
          supervisors={supervisors}
          patients={patients}
          dayISO={query.dayISO}
          onClose={() => setAlta(false)}
          onDone={() => {
            setAlta(false);
            recargar("La cita quedó agendada.");
          }}
        />
      )}

      {detalle && (
        <DetalleCita
          row={detalle}
          chairs={chairs}
          students={students}
          supervisors={supervisors}
          canManage={canManage}
          onClose={() => setDetalle(null)}
          onDone={(mensaje) => {
            setDetalle(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Agendar
// ═══════════════════════════════════════════════════════════════════════

function AltaCita({
  chairs,
  students,
  supervisors,
  patients,
  dayISO,
  onClose,
  onDone,
}: {
  chairs: EduChairOption[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  patients: { id: string; folio: string; name: string }[];
  dayISO: string;
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
  const [chairId, setChairId] = useState(activos[0]?.id ?? "");
  const [supervisorUserId, setSupervisorUserId] = useState("");
  const [day, setDay] = useState(dayISO);
  const [hora, setHora] = useState("09:00");
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
function DetalleCita({
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
  // Con dos sedes hay dos "Sillón 1" y el desplegable diría dos veces lo
  // mismo; con una sola, mencionarla es ruido.
  const variasSedes = new Set(chairs.map((c) => c.campusId)).size > 1;
  const [studentId, setStudentId] = useState(row.studentId);
  const [supervisorUserId, setSupervisorUserId] = useState(row.supervisorUserId ?? "");

  const siguientes = EDU_APPOINTMENT_TRANSITIONS[row.status] ?? [];
  const clinicos = siguientes.filter((s) => s !== "CANCELLED" && s !== "NO_SHOW");
  const administrativos = siguientes.filter((s) => s === "CANCELLED" || s === "NO_SHOW");
  const cerrada = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(row.status);

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
            <span className={`edu-tag ${TAG_BY_STATUS[row.status]}`}>
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
