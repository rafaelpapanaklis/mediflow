"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Search, X } from "lucide-react";
import {
  EDU_CASO_ESPERA_TAG,
  eduCasosPanelQuery,
  eduHasCasosPanelFilters,
  type EduCasosPanelFilters,
  type EduCasosPanelRow,
} from "@/lib/edu/casos-core";
import { EDU_CASE_STATUSES, EDU_CASE_STATUS_LABELS, type EduCaseStatus } from "@/lib/edu/types";

/**
 * /instituto/casos — TODOS los casos de la clínica, en una tabla.
 *
 * Los FILTROS viajan en la URL, no en un useState (el patrón de la agenda
 * y de la lista de pacientes): "los de endodoncia atorados en firma" se
 * comparte pegando el enlace, sobrevive a un refresh, y el filtrado ocurre
 * EN LA BASE. Este componente solo escribe la query string y pinta lo que
 * el server ya recortó — no decide ni una fila.
 *
 * ⚠️ Las OPCIONES de los filtros también vienen recortadas del server
 * (la lección del P1-4): un docente recibe solo SUS alumnos vigentes como
 * opciones; un alumno no recibe lista (sus casos ya son suyos) ni filtro
 * de docente. Que un select no aparezca no es un hueco: es el alcance.
 */
export interface EduCasosScreenProps {
  rows: EduCasosPanelRow[];
  truncated: boolean;
  maxRows: number;
  filters: EduCasosPanelFilters;
  /** true = quien mira NO ve la clínica entera (alumno/docente): la
   *  pantalla lo dice para que nadie lea 12 filas como el total. */
  recortado: boolean;
  programas: { id: string; name: string; isActive: boolean }[];
  alumnos: { id: string; matricula: string; name: string }[];
  docentes: { id: string; name: string; isActive: boolean }[];
}

const TAG_BY_CASE_STATUS: Record<EduCaseStatus, string> = {
  SCREENING: "edu-tag--info",
  ASSIGNED: "edu-tag--info",
  IN_TREATMENT: "edu-tag--ok",
  ON_HOLD: "edu-tag--warn",
  COMPLETED: "edu-tag--muted",
  TRANSFERRED: "edu-tag--muted",
  ABANDONED: "edu-tag--danger",
};

export function EduCasosScreen({
  rows,
  truncated,
  maxRows,
  filters,
  recortado,
  programas,
  alumnos,
  docentes,
}: EduCasosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  // Solo el BUSCADOR tiene estado local (se aplica con Enter o la lupa,
  // como en la lista de pacientes); los demás filtros escriben la URL al
  // cambiar.
  const [q, setQ] = useState(filters.q ?? "");

  const hayFiltros = eduHasCasosPanelFilters(filters);

  function irCon(next: EduCasosPanelFilters) {
    const qs = eduCasosPanelQuery(next);
    startNav(() => {
      router.replace(qs ? `/instituto/casos?${qs}` : "/instituto/casos", { scroll: false });
    });
  }

  const exportQs = eduCasosPanelQuery(filters);

  return (
    <>
      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          irCon({ ...filters, q: q.trim() || null });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-casos-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-casos-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Paciente, folio o matrícula"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-casos-estado">
            Estado
          </label>
          <select
            id="edu-casos-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? ""}
            onChange={(e) =>
              irCon({ ...filters, status: (e.target.value || null) as EduCaseStatus | null })
            }
          >
            <option value="">{filters.incluirCerrados ? "Todos" : "Todos los abiertos"}</option>
            {EDU_CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_CASE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-casos-esp">
            Especialidad
          </label>
          <select
            id="edu-casos-esp"
            className="edu-input edu-input--sm"
            value={filters.programId ?? ""}
            onChange={(e) => irCon({ ...filters, programId: e.target.value || null })}
          >
            <option value="">Todas</option>
            {programas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        </div>

        {alumnos.length > 0 && (
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-casos-alumno">
              Estudiante
            </label>
            <select
              id="edu-casos-alumno"
              className="edu-input edu-input--sm"
              value={filters.studentId ?? ""}
              onChange={(e) => irCon({ ...filters, studentId: e.target.value || null })}
            >
              <option value="">Todos</option>
              {alumnos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.matricula} · {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {docentes.length > 0 && (
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-casos-docente">
              Docente
            </label>
            <select
              id="edu-casos-docente"
              className="edu-input edu-input--sm"
              value={filters.supervisorUserId ?? ""}
              onChange={(e) => irCon({ ...filters, supervisorUserId: e.target.value || null })}
            >
              <option value="">Todos</option>
              {docentes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isActive ? "" : " (baja)"}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-casos-desde">
            Abiertos del
          </label>
          <input
            id="edu-casos-desde"
            className="edu-input edu-input--sm"
            type="date"
            value={filters.desdeISO ?? ""}
            onChange={(e) => irCon({ ...filters, desdeISO: e.target.value || null })}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-casos-hasta">
            al
          </label>
          <input
            id="edu-casos-hasta"
            className="edu-input edu-input--sm"
            type="date"
            value={filters.hastaISO ?? ""}
            onChange={(e) => irCon({ ...filters, hastaISO: e.target.value || null })}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-casos-cerrados">
            Mostrar
          </label>
          <select
            id="edu-casos-cerrados"
            className="edu-input edu-input--sm"
            value={filters.incluirCerrados ? "1" : ""}
            onChange={(e) => irCon({ ...filters, incluirCerrados: e.target.value === "1" })}
          >
            <option value="">Solo abiertos</option>
            <option value="1">También cerrados</option>
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/casos", { scroll: false }));
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
            : `${rows.length} ${rows.length === 1 ? "caso" : "casos"}${
                truncated ? ` (se muestran los primeros ${maxRows})` : ""
              }${recortado ? " · los que te tocan" : ""}`}
        </span>
        {rows.length > 0 && (
          // Exportar es LEER: mismo endpoint de guard + alcance, MISMOS
          // filtros (la query string es idéntica a la de la pantalla).
          //
          // El botón YA NO SE ESCONDE cuando la lista sale cortada. El
          // export tiene su propio techo, mucho más alto que el de la
          // pantalla (EDU_CASOS_EXPORT_MAX_ROWS), justamente porque
          // llevarse TODO es para lo que existe: quien marca "incluir
          // cerrados" está armando el reporte de una acreditación, no
          // leyendo la lista. Esconderlo dejaba a la escuela sin export en
          // cuanto pasaba de 300 casos.
          <a
            className="edu-btn edu-btn--ghost edu-btn--sm"
            href={`/api/instituto/casos/export${exportQs ? `?${exportQs}` : ""}`}
          >
            <Download size={15} />
            Exportar CSV
          </a>
        )}
      </div>

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Se muestran los primeros {maxRows}, no todos.</p>
            <p className="edu-banner__detail">
              Acota por especialidad, estado o fechas para ver el resto en pantalla.{" "}
              <strong>El CSV sí sale completo:</strong> el export tiene su propio techo, mucho más
              alto que el de esta lista, porque llevarse todo es justo para lo que existe. Solo se
              niega si ni siquiera ahí cabe — y entonces lo dice con el número.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ningún caso coincide" : "Todavía no hay casos"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros, o elige «También cerrados» si buscas uno terminado o transferido."
              : "Un caso se abre en el tamizaje: es lo que le pone estudiante y especialidad a un paciente. En cuanto exista uno que te toque, sale aquí."}
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--casos">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Paciente</span>
            <span>Estudiante</span>
            <span>Docente</span>
            <span>Especialidad</span>
            <span>Abierto</span>
            <span>Estado</span>
            <span>Esperando</span>
          </div>

          {rows.map((c) => {
            const cerrado = c.espera.kind === "cerrado";
            return (
              <div key={c.id} className={`edu-row ${cerrado ? "edu-row--off" : ""}`}>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Paciente</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    {/* A la pestaña Casos de su ficha: ahí están el detalle
                        del gate y las acciones. */}
                    <Link href={`/instituto/pacientes/${c.patientId}/casos`} className="edu-link">
                      {c.patientName}
                    </Link>
                  </span>
                  <span className="edu-cell__sub">Folio {c.patientFolio}</span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Estudiante</span>
                  <span className="edu-cell__value">{c.studentName}</span>
                  <span className="edu-cell__sub">{c.studentMatricula}</span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Docente</span>
                  <span className="edu-cell__value">
                    {c.supervisorName ?? "Sin responsable designado"}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Especialidad</span>
                  <span className="edu-cell__value">{c.programName}</span>
                  <span className="edu-cell__sub">
                    {[c.cohortName, `${c.semester}º sem.`].filter(Boolean).join(" · ")}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Abierto</span>
                  <span className="edu-cell__value">{c.openedLabel}</span>
                  {c.closedLabel && <span className="edu-cell__sub">cerró {c.closedLabel}</span>}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  <span className={`edu-tag ${TAG_BY_CASE_STATUS[c.status]}`}>
                    {c.statusLabel}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Esperando</span>
                  {cerrado ? (
                    <span className="edu-cell__value">—</span>
                  ) : (
                    <span className={`edu-tag ${EDU_CASO_ESPERA_TAG[c.espera.kind]}`}>
                      {c.espera.label}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
