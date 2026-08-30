"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  EDU_ATRASO_DESCRIPTIONS,
  EDU_ATRASO_LABELS,
  eduScoreLabel,
  type EduAtrasoEstado,
  type EduEvaluacionRow,
} from "@/lib/edu/evaluacion-core";
import {
  EDU_STUDENT_STATUSES,
  EDU_STUDENT_STATUS_LABELS,
  type EduStudentStatus,
} from "@/lib/edu/types";

/**
 * /instituto/evaluacion — QUIÉN VA ATRASADO, Y POR QUÉ.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UN SEMÁFORO ROJO SIN EXPLICACIÓN NO SIRVE PARA HABLAR CON NADIE.
 *
 * Cada fila trae, además del color, la frase que lo justifica: cuánto del
 * ciclo ha transcurrido, cuántos requisitos se esperaban a esta altura,
 * cuántos lleva y cuáles son los que más le faltan. Es lo que la dirección
 * va a leer EN VOZ ALTA delante del alumno, así que se calcula en el
 * servidor y se pinta tal cual — la pantalla no inventa una segunda
 * versión del motivo.
 *
 * La lista se ordena de peor a mejor: existe para encontrar a quien hay
 * que llamar, no para leerla entera.
 *
 * ⚠️ El ALUMNO abre esta misma pantalla y ve UNA fila, la suya. No hay una
 * versión para él: lo recorta el alcance, igual que la bandeja de
 * autorizaciones. Lo único que cambia es el texto de arriba.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduEvaluacionScreenProps {
  rows: EduEvaluacionRow[];
  truncated: boolean;
  maxRows: number;
  filters: {
    programId: string | null;
    cohortId: string | null;
    status: EduStudentStatus | null;
    semaforo: string | null;
  };
  programs: { id: string; name: string }[];
  cohorts: { id: string; name: string; programId: string; programName: string }[];
  /** true = quien mira es un alumno viendo lo suyo. Cambia el copy. */
  esAlumno: boolean;
  canManagePlan: boolean;
}

const TAG_BY_ESTADO: Record<EduAtrasoEstado, string> = {
  AL_DIA: "edu-tag--ok",
  VIGILAR: "edu-tag--warn",
  ATRASADO: "edu-tag--danger",
};

export function EduEvaluacionScreen({
  rows,
  truncated,
  maxRows,
  filters,
  programs,
  cohorts,
  esAlumno,
  canManagePlan,
}: EduEvaluacionScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();

  const hayFiltros = Boolean(
    filters.programId || filters.cohortId || filters.status || filters.semaforo,
  );

  function aplicar(next: Partial<Record<"especialidad" | "generacion" | "estado" | "semaforo", string>>) {
    const actual: Record<string, string> = {};
    if (filters.programId) actual.especialidad = filters.programId;
    if (filters.cohortId) actual.generacion = filters.cohortId;
    if (filters.status) actual.estado = filters.status;
    if (filters.semaforo) actual.semaforo = filters.semaforo;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actual, ...next })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startNav(() => {
      router.replace(qs ? `/instituto/evaluacion?${qs}` : "/instituto/evaluacion", {
        scroll: false,
      });
    });
  }

  const generacionesVisibles = filters.programId
    ? cohorts.filter((c) => c.programId === filters.programId)
    : cohorts;

  const cuenta = {
    atrasados: rows.filter((r) => r.estado === "ATRASADO").length,
    vigilar: rows.filter((r) => r.estado === "VIGILAR").length,
    alDia: rows.filter((r) => r.estado === "AL_DIA").length,
    sinCalcular: rows.filter((r) => r.estado === null).length,
  };

  if (rows.length === 0 && !hayFiltros) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">
          {esAlumno ? "Todavía no hay nada que medirte" : "Todavía no hay alumnos que medir"}
        </p>
        <p className="edu-empty__detail">
          {esAlumno
            ? "Cuando la dirección capture los requisitos de tu especialidad, aquí verás cuántos llevas y cuántos te faltan."
            : canManagePlan
              ? "Da de alta alumnos en el Padrón y captura los requisitos de cada especialidad en Requisitos. El avance se cuenta solo: no hay nada que teclear."
              : "Todavía no tienes alumnos asignados. Cuando la dirección te asigne un grupo, aparecerá aquí."}
        </p>
      </div>
    );
  }

  return (
    <>
      {!esAlumno && rows.length > 0 && (
        <div className="edu-kpis">
          <div className="edu-kpi">
            <span className="edu-kpi__label">Atrasados</span>
            <span className="edu-kpi__value">{cuenta.atrasados}</span>
            <span className="edu-kpi__note">Van muy por debajo de lo esperado.</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Vigilar</span>
            <span className="edu-kpi__value">{cuenta.vigilar}</span>
            <span className="edu-kpi__note">Alcanzan si no se descuidan.</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Al día</span>
            <span className="edu-kpi__value">{cuenta.alDia}</span>
          </div>
          {cuenta.sinCalcular > 0 && (
            <div className="edu-kpi">
              <span className="edu-kpi__label">Sin calcular</span>
              <span className="edu-kpi__value">{cuenta.sinCalcular}</span>
              <span className="edu-kpi__note">
                A su generación le faltan fechas. Captúralas en Especialidades y generaciones.
              </span>
            </div>
          )}
        </div>
      )}

      {!esAlumno && (
        <form className="edu-toolbar" onSubmit={(e) => e.preventDefault()}>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ev-esp">
              Especialidad
            </label>
            <select
              id="edu-ev-esp"
              className="edu-input edu-input--sm"
              value={filters.programId ?? ""}
              onChange={(e) => aplicar({ especialidad: e.target.value, generacion: "" })}
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
            <label className="edu-field__label" htmlFor="edu-ev-gen">
              Generación
            </label>
            <select
              id="edu-ev-gen"
              className="edu-input edu-input--sm"
              value={filters.cohortId ?? ""}
              onChange={(e) => aplicar({ generacion: e.target.value })}
            >
              <option value="">Todas</option>
              {generacionesVisibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.programName}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ev-sem">
              Cómo va
            </label>
            <select
              id="edu-ev-sem"
              className="edu-input edu-input--sm"
              value={filters.semaforo ?? ""}
              onChange={(e) => aplicar({ semaforo: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="ATRASADO">Atrasado</option>
              <option value="VIGILAR">Vigilar</option>
              <option value="AL_DIA">Al día</option>
              <option value="SIN_CALCULAR">Sin calcular</option>
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ev-est">
              Estado del alumno
            </label>
            <select
              id="edu-ev-est"
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
              onClick={() =>
                startNav(() => router.replace("/instituto/evaluacion", { scroll: false }))
              }
            >
              <X size={15} />
              Limpiar
            </button>
          )}
        </form>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Calculando…"
            : `${rows.length} ${rows.length === 1 ? "alumno" : "alumnos"}${
                truncated ? ` (se muestran los primeros ${maxRows})` : ""
              }`}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Ningún alumno coincide</p>
          <p className="edu-empty__detail">Prueba con menos filtros.</p>
        </div>
      ) : (
        <div className="edu-table edu-table--evaluacion">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Alumno</span>
            <span>Especialidad</span>
            <span>Cómo va</span>
            <span>Avance</span>
            <span>Horas</span>
            <span>Promedio</span>
            <span />
          </div>

          {rows.map((r) => (
            <div key={r.studentId} className="edu-row">
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Alumno</span>
                <span className="edu-cell__value edu-cell__value--strong">{r.studentName}</span>
                <span className="edu-cell__sub">
                  {r.matricula} · {r.semester}º semestre ·{" "}
                  {EDU_STUDENT_STATUS_LABELS[r.status as EduStudentStatus] ?? r.status}
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Especialidad</span>
                <span className="edu-cell__value">{r.programName}</span>
                <span className="edu-cell__sub">{r.cohortName}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Cómo va</span>
                {r.estado ? (
                  <span
                    className={`edu-tag ${TAG_BY_ESTADO[r.estado]}`}
                    title={EDU_ATRASO_DESCRIPTIONS[r.estado]}
                  >
                    {EDU_ATRASO_LABELS[r.estado]}
                  </span>
                ) : (
                  <span className="edu-tag edu-tag--muted">Sin calcular</span>
                )}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Avance</span>
                <span className="edu-cell__value">
                  {r.hechos} de {r.totales}
                </span>
                {r.fraccion !== null && (
                  <span className="edu-cell__sub">
                    se esperan {eduScoreLabel(Math.round(r.esperados * 100))} · {Math.round(r.fraccion * 100)} % del ciclo
                  </span>
                )}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Horas clínicas</span>
                <span className="edu-cell__value">{r.hoursLabel}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Promedio</span>
                <span className="edu-cell__value">
                  {r.averageLabel ? `${r.averageLabel} / ${r.averageScaleMax}` : "—"}
                </span>
                <span className="edu-cell__sub">
                  {r.gradesCount === 0
                    ? "sin calificaciones"
                    : `${r.gradesCount} ${r.gradesCount === 1 ? "caso calificado" : "casos calificados"}`}
                </span>
              </div>

              {/* 🔴 EL PORQUÉ, en la misma tarjeta y siempre visible. Un
                  tooltip o un "ver detalle" lo dejaría sin leer justo
                  cuando hace falta: al hablar con el alumno. */}
              <div className="edu-cell edu-cell--wide">
                <p className="edu-motivo">{r.motivo}</p>
              </div>

              <div className="edu-cell__actions">
                <Link
                  href={`/instituto/evaluacion/${r.studentId}`}
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                >
                  Ver bitácora
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
