"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_STUDENT_STATUSES,
  EDU_STUDENT_STATUS_DESCRIPTIONS,
  EDU_STUDENT_STATUS_LABELS,
  type EduStudentStatus,
} from "@/lib/edu/types";
import { EDU_SCOPE_NONE_DETAIL } from "@/lib/edu/padron-core";
import type {
  EduCohortOption,
  EduEnrollableUser,
  EduPadronFilters,
  EduProgramOption,
  EduStudentRow,
  EduTeacherOption,
} from "@/lib/edu/padron-core";

/**
 * /instituto/padron — la lista de alumnos.
 *
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO:
 *  · NO decide qué filas se ven. Eso lo resolvió el servidor
 *    (eduPadronScope): un DOCENTE recibe solo a sus alumnos vigentes y aquí
 *    no hay forma de pedir más. Esconder filas en el cliente sería teatro.
 *  · NO decide quién puede editar. `canManage` y `canAssign` llegan ya
 *    resueltos y CADA endpoint los vuelve a exigir: si alguien fabrica el
 *    botón desde la consola, el servidor contesta 403.
 *
 * Los filtros viajan en la URL (?generacion=&programa=&estado=&q=) en vez de
 * vivir en un useState: así se pueden compartir, sobreviven a un refresh y
 * el filtrado ocurre en la BASE — filtrar en memoria mentiría en cuanto el
 * padrón pase del techo de filas.
 */
export interface EduPadronScreenProps {
  rows: EduStudentRow[];
  truncated: boolean;
  scopeKind: "all" | "supervised" | "none";
  filters: EduPadronFilters;
  programs: EduProgramOption[];
  cohorts: EduCohortOption[];
  teachers: EduTeacherOption[];
  enrollables: EduEnrollableUser[];
  canManage: boolean;
  canAssign: boolean;
  /** ¿Puede crear cuentas? Decide si el callejón sin salida de "no hay
   *  nadie por inscribir" lleva a /instituto/equipo o solo lo explica. */
  canManageTeam: boolean;
  maxRows: number;
}

const TAG_BY_STATUS: Record<EduStudentStatus, string> = {
  ACTIVE: "edu-tag--ok",
  ON_LEAVE: "edu-tag--warn",
  GRADUATED: "edu-tag--info",
  WITHDRAWN: "edu-tag--muted",
};

export function EduPadronScreen({
  rows,
  truncated,
  scopeKind,
  filters,
  programs,
  cohorts,
  teachers,
  enrollables,
  canManage,
  canAssign,
  canManageTeam,
  maxRows,
}: EduPadronScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const [abriendoAlta, setAbriendoAlta] = useState(false);
  const [ficha, setFicha] = useState<EduStudentRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const hayFiltros = Boolean(filters.programId || filters.cohortId || filters.status || filters.q);

  function aplicar(next: Partial<Record<"programa" | "generacion" | "estado" | "q", string>>) {
    const actual: Record<string, string> = {};
    if (filters.programId) actual.programa = filters.programId;
    if (filters.cohortId) actual.generacion = filters.cohortId;
    if (filters.status) actual.estado = filters.status;
    if (filters.q) actual.q = filters.q;

    const merged = { ...actual, ...next };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startNav(() => {
      router.replace(qs ? `/instituto/padron?${qs}` : "/instituto/padron", { scroll: false });
    });
  }

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  // Las generaciones del programa filtrado: ofrecer las 40 de la escuela
  // cuando ya se eligió "Endodoncia" es ruido.
  const generacionesVisibles = useMemo(() => {
    if (!filters.programId) return cohorts;
    return cohorts.filter((c) => c.programId === filters.programId);
  }, [cohorts, filters.programId]);

  if (scopeKind === "none") {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay estudiantes que mostrarte</p>
        <p className="edu-empty__detail">{EDU_SCOPE_NONE_DETAIL}</p>
      </div>
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

      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q: q.trim() });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre o matrícula"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-programa">
            Especialidad
          </label>
          <select
            id="edu-f-programa"
            className="edu-input edu-input--sm"
            value={filters.programId ?? ""}
            onChange={(e) => aplicar({ programa: e.target.value, generacion: "" })}
          >
            <option value="">Todos</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-generacion">
            Generación
          </label>
          <select
            id="edu-f-generacion"
            className="edu-input edu-input--sm"
            value={filters.cohortId ?? ""}
            onChange={(e) => aplicar({ generacion: e.target.value })}
          >
            <option value="">Todas</option>
            {generacionesVisibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isActive ? "" : " (cerrada)"}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-estado">
            Estado
          </label>
          <select
            id="edu-f-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? ""}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_STUDENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/padron", { scroll: false }));
            }}
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </form>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Buscando…"
            : `${rows.length} ${rows.length === 1 ? "estudiante" : "estudiantes"}${truncated ? ` (se muestran los primeros ${maxRows})` : ""}`}
          {scopeKind === "supervised" ? " que supervisas" : ""}
        </span>
        {canManage && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAbriendoAlta(true);
            }}
          >
            <UserPlus size={16} />
            Inscribir estudiante
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ningún estudiante coincide" : "Todavía no hay estudiantes inscritos"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros o revisa la matrícula que buscaste."
              : scopeKind === "supervised"
                ? "Aquí aparecerán los estudiantes que la dirección te asigne como supervisor."
                : "Primero crea una especialidad y una generación en Especialidades y generaciones, y después inscribe a cada estudiante."}
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--padron">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Matrícula</span>
            <span>Estudiante</span>
            <span>Especialidad · Generación</span>
            <span>Sem.</span>
            <span>Estado</span>
            <span>Docente vigente</span>
            <span />
          </div>

          {rows.map((r) => {
            const titular = r.supervisors.find((s) => s.isPrimary) ?? r.supervisors[0] ?? null;
            const extra = r.supervisors.length - (titular ? 1 : 0);
            return (
              <div key={r.id} className={`edu-row ${r.status === "ACTIVE" ? "" : "edu-row--off"}`}>
                <div className="edu-cell">
                  <span className="edu-cell__label">Matrícula</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.matricula}</span>
                </div>

                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Estudiante</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.name}</span>
                  <span className="edu-cell__sub">
                    {r.email}
                    {r.userIsActive ? "" : " · cuenta desactivada"}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Especialidad · Generación</span>
                  <span className="edu-cell__value">{r.programName}</span>
                  <span className="edu-cell__sub">{r.cohortName}</span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Semestre</span>
                  <span className="edu-cell__value">{r.semester}º</span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span className={`edu-tag ${TAG_BY_STATUS[r.status]}`}>
                    {EDU_STUDENT_STATUS_LABELS[r.status]}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Docente vigente</span>
                  {titular ? (
                    <>
                      <span className="edu-cell__value">{titular.name}</span>
                      {extra > 0 && <span className="edu-cell__sub">y {extra} más</span>}
                    </>
                  ) : (
                    <span className="edu-tag edu-tag--warn">Sin docente</span>
                  )}
                </div>

                <div className="edu-cell__actions">
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setFicha(r);
                    }}
                  >
                    {canManage || canAssign ? "Editar" : "Ver"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {abriendoAlta && (
        <AltaAlumno
          programs={programs}
          cohorts={cohorts}
          enrollables={enrollables}
          canManageTeam={canManageTeam}
          onClose={() => setAbriendoAlta(false)}
          onDone={(nombre) => {
            setAbriendoAlta(false);
            recargar(`${nombre} quedó inscrito como estudiante.`);
          }}
        />
      )}

      {ficha && (
        <FichaAlumno
          student={ficha}
          programs={programs}
          cohorts={cohorts}
          teachers={teachers}
          canManage={canManage}
          canAssign={canAssign}
          onClose={() => setFicha(null)}
          onDone={(mensaje) => {
            setFicha(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Alta: colgarle la ficha académica a alguien que YA tiene cuenta
// ═══════════════════════════════════════════════════════════════════════

function AltaAlumno({
  programs,
  cohorts,
  enrollables,
  canManageTeam,
  onClose,
  onDone,
}: {
  programs: EduProgramOption[];
  cohorts: EduCohortOption[];
  enrollables: EduEnrollableUser[];
  canManageTeam: boolean;
  onClose: () => void;
  onDone: (nombre: string) => void;
}) {
  const activos = programs.filter((p) => p.isActive);
  const [userId, setUserId] = useState("");
  const [programId, setProgramId] = useState(activos[0]?.id ?? "");
  const [cohortId, setCohortId] = useState("");
  const [matricula, setMatricula] = useState("");
  const [semester, setSemester] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generaciones = cohorts.filter((c) => c.programId === programId);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/padron", {
        method: "POST",
        body: { userId, programId, cohortId, matricula, semester },
      });
      onDone(enrollables.find((u) => u.id === userId)?.name ?? "El estudiante");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo inscribir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Inscribir estudiante"
      subtitle="Se le da ficha académica a una persona que ya tiene cuenta en el instituto."
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
            disabled={busy || !userId || !programId || !cohortId || !matricula.trim()}
          >
            {busy ? "Inscribiendo…" : "Inscribir"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {enrollables.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">No hay nadie por inscribir</p>
          <p className="edu-empty__detail">
            Aquí solo aparecen las personas con rol <strong>Estudiante</strong> que todavía no tienen
            ficha académica. Inscribir es el SEGUNDO paso: primero hay que crearle la cuenta.
          </p>
          {/* Sin esto el diálogo era un callejón sin salida: decía que
              faltaba crear la cuenta y no decía dónde. El enlace solo se
              pinta a quien puede hacerlo — a los demás, ofrecerles una
              puerta que les va a contestar 403 es peor que no ofrecerla. */}
          {canManageTeam ? (
            <p className="edu-empty__detail">
              <Link href="/instituto/equipo" className="edu-btn edu-btn--primary edu-btn--sm">
                Ir a Equipo y crear la cuenta
              </Link>
            </p>
          ) : (
            <p className="edu-empty__detail">
              Las cuentas se crean en <strong>Equipo</strong>, y eso lo hace la dirección. Pídeselo
              y vuelve aquí a inscribirlo.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-alta-persona">
              Persona
            </label>
            <select
              id="edu-alta-persona"
              className="edu-input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Elige a quién inscribir…</option>
              {enrollables.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-formgrid edu-formgrid--2">
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-alta-programa">
                Especialidad
              </label>
              <select
                id="edu-alta-programa"
                className="edu-input"
                value={programId}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  setCohortId("");
                }}
              >
                <option value="">Elige…</option>
                {activos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-alta-generacion">
                Generación
              </label>
              <select
                id="edu-alta-generacion"
                className="edu-input"
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
                disabled={!programId}
              >
                <option value="">{programId ? "Elige…" : "Elige antes la especialidad"}</option>
                {generaciones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? "" : " (cerrada)"}
                  </option>
                ))}
              </select>
              {programId && generaciones.length === 0 && (
                <span className="edu-field__hint">
                  Esa especialidad todavía no tiene generaciones. Créala en Especialidades y
                  generaciones.
                </span>
              )}
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-alta-matricula">
                Matrícula
              </label>
              <input
                id="edu-alta-matricula"
                className="edu-input"
                value={matricula}
                onChange={(e) => setMatricula(e.target.value)}
                placeholder="ENDO-2026-01"
                autoComplete="off"
              />
              <span className="edu-field__hint">
                Se guarda en mayúsculas y sin espacios. No se puede repetir en el instituto.
              </span>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-alta-semestre">
                Semestre
              </label>
              <input
                id="edu-alta-semestre"
                className="edu-input"
                type="number"
                min={1}
                max={20}
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
              />
            </div>
          </div>
        </>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ficha: datos académicos + supervisión
// ═══════════════════════════════════════════════════════════════════════

function FichaAlumno({
  student,
  programs,
  cohorts,
  teachers,
  canManage,
  canAssign,
  onClose,
  onDone,
}: {
  student: EduStudentRow;
  programs: EduProgramOption[];
  cohorts: EduCohortOption[];
  teachers: EduTeacherOption[];
  canManage: boolean;
  canAssign: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [matricula, setMatricula] = useState(student.matricula);
  const [semester, setSemester] = useState(String(student.semester));
  const [status, setStatus] = useState<EduStudentStatus>(student.status);
  const [programId, setProgramId] = useState(student.programId);
  const [cohortId, setCohortId] = useState(student.cohortId);
  const [nuevoDocente, setNuevoDocente] = useState("");
  const [titular, setTitular] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generaciones = cohorts.filter((c) => c.programId === programId);
  const docentesDisponibles = teachers.filter(
    (t) => t.isActive && !student.supervisors.some((s) => s.supervisorUserId === t.id),
  );

  async function guardarDatos() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/padron/${student.id}`, {
        method: "PATCH",
        body: { matricula, semester, status, programId, cohortId },
      });
      onDone(`Se actualizó la ficha de ${student.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function asignar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/supervision", {
        method: "POST",
        body: { studentId: student.id, supervisorUserId: nuevoDocente, isPrimary: titular },
      });
      onDone(`Listo: ${student.name} ya tiene docente asignado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo asignar.");
    } finally {
      setBusy(false);
    }
  }

  async function quitar(assignmentId: string) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/supervision/${assignmentId}`, { method: "PATCH" });
      onDone("Se cerró la supervisión. La asignación queda en el historial.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la asignación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={student.name}
      subtitle={`${student.matricula} · ${student.programName} · ${student.cohortName}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
          {canManage && (
            <button
              type="button"
              className="edu-btn edu-btn--primary"
              onClick={guardarDatos}
              disabled={busy || !matricula.trim() || !cohortId}
            >
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

      {canManage ? (
        <section className="edu-section">
          <h3 className="edu-section__title">Datos académicos</h3>
          <div className="edu-formgrid edu-formgrid--2">
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-ed-matricula">
                Matrícula
              </label>
              <input
                id="edu-ed-matricula"
                className="edu-input"
                value={matricula}
                onChange={(e) => setMatricula(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-ed-semestre">
                Semestre
              </label>
              <input
                id="edu-ed-semestre"
                className="edu-input"
                type="number"
                min={1}
                max={20}
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
              />
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-ed-programa">
                Especialidad
              </label>
              <select
                id="edu-ed-programa"
                className="edu-input"
                value={programId}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  setCohortId("");
                }}
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-ed-generacion">
                Generación
              </label>
              <select
                id="edu-ed-generacion"
                className="edu-input"
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
              >
                <option value="">Elige…</option>
                {generaciones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="edu-field" style={{ gridColumn: "1 / -1" }}>
              <label className="edu-field__label" htmlFor="edu-ed-estado">
                Estado
              </label>
              <select
                id="edu-ed-estado"
                className="edu-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as EduStudentStatus)}
              >
                {EDU_STUDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {EDU_STUDENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <span className="edu-field__hint">{EDU_STUDENT_STATUS_DESCRIPTIONS[status]}</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="edu-section">
          <h3 className="edu-section__title">Datos académicos</h3>
          <p className="edu-section__lead">
            {student.programName} · {student.cohortName} · {student.semester}º semestre ·{" "}
            {EDU_STUDENT_STATUS_LABELS[student.status]}
          </p>
          <p className="edu-note">Solo la dirección puede cambiar estos datos.</p>
        </section>
      )}

      <section className="edu-section">
        <h3 className="edu-section__title">Supervisión</h3>
        {student.supervisors.length === 0 ? (
          <p className="edu-section__lead">Nadie lo supervisa hoy.</p>
        ) : (
          <ul className="edu-chiplist">
            {student.supervisors.map((s) => (
              <li key={s.assignmentId} className="edu-assign">
                <span>
                  {s.name}
                  {s.isPrimary ? " · titular" : ""}
                </span>
                {canAssign && (
                  <button
                    type="button"
                    className="edu-assign__x"
                    onClick={() => quitar(s.assignmentId)}
                    disabled={busy}
                    aria-label={`Quitar a ${s.name}`}
                    title="Cerrar esta supervisión"
                  >
                    <X size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canAssign && (
          <>
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-ed-docente">
                Asignar docente
              </label>
              <select
                id="edu-ed-docente"
                className="edu-input"
                value={nuevoDocente}
                onChange={(e) => setNuevoDocente(e.target.value)}
              >
                <option value="">Elige un docente…</option>
                {docentesDisponibles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <label
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}
              htmlFor="edu-ed-titular"
            >
              <input
                id="edu-ed-titular"
                type="checkbox"
                checked={titular}
                onChange={(e) => setTitular(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              Es el docente titular
            </label>
            <p className="edu-note">
              Asignar un titular nuevo CIERRA al anterior con la fecha de hoy; su asignación no se
              borra, queda en el historial para poder saber quién supervisaba en cada fecha.
            </p>

            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={asignar}
              disabled={busy || !nuevoDocente}
            >
              {busy ? "Asignando…" : "Asignar"}
            </button>
          </>
        )}
      </section>
    </EduModal>
  );
}
