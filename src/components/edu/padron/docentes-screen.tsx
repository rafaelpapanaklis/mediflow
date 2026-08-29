"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import type { EduAssignmentRow, EduTeacherRow } from "@/lib/edu/padron-core";

/**
 * /instituto/docentes — quiénes son y cuánta carga llevan.
 *
 * El número que se pinta es "alumnos que supervisa HOY": solo asignaciones
 * VIGENTES. Sin ese filtro, un docente que entregó su generación hace dos
 * años seguiría apareciendo con doce alumnos y la dirección repartiría mal
 * la carga — que es justo lo que esta pantalla existe para evitar.
 *
 * Las asignaciones llegan TODAS de una consulta y se agrupan aquí; pedir
 * una consulta por docente serían veinte viajes a la base para pintar una
 * lista que cabe en una pantalla.
 */
export interface EduDocentesScreenProps {
  teachers: EduTeacherRow[];
  assignments: EduAssignmentRow[];
  canAssign: boolean;
}

export function EduDocentesScreen({ teachers, assignments, canAssign }: EduDocentesScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const porDocente = useMemo(() => {
    const map = new Map<string, EduAssignmentRow[]>();
    for (const a of assignments) {
      const lista = map.get(a.supervisorUserId);
      if (lista) lista.push(a);
      else map.set(a.supervisorUserId, [a]);
    }
    return map;
  }, [assignments]);

  async function cerrarAsignacion(assignmentId: string, alumno: string) {
    setError(null);
    setBusyId(assignmentId);
    try {
      await eduRequest(`/api/instituto/supervision/${assignmentId}`, { method: "PATCH" });
      setFlash(`Se cerró la supervisión de ${alumno}. La asignación queda en el historial.`);
      startNav(() => router.refresh());
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo cerrar la asignación.");
    } finally {
      setBusyId(null);
    }
  }

  if (teachers.length === 0) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Todavía no hay docentes</p>
        <p className="edu-empty__detail">
          Aquí aparece cada persona del instituto con rol <strong>Docente</strong>. Las cuentas se
          dan de alta aparte: esta ola administra el padrón, no los accesos.
        </p>
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
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-table edu-table--docentes">
        <div className="edu-rowhead" aria-hidden="true">
          <span>Docente</span>
          <span>Correo</span>
          <span>Alumnos hoy</span>
          <span>Estado</span>
          <span />
        </div>

        {teachers.map((t) => {
          const alumnos = porDocente.get(t.id) ?? [];
          const expandido = abierto === t.id;
          return (
            <div key={t.id} className={`edu-row ${t.isActive ? "" : "edu-row--off"}`}>
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Docente</span>
                <span className="edu-cell__value edu-cell__value--strong">{t.name}</span>
                {t.phone && <span className="edu-cell__sub">{t.phone}</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Correo</span>
                <span className="edu-cell__value">{t.email}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Alumnos hoy</span>
                <span className="edu-cell__value edu-cell__value--strong">{t.currentStudents}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Estado</span>
                <span className={`edu-tag ${t.isActive ? "edu-tag--ok" : "edu-tag--muted"}`}>
                  {t.isActive ? "Activo" : "Inactivo"}
                </span>
              </div>

              <div className="edu-cell__actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => setAbierto(expandido ? null : t.id)}
                  aria-expanded={expandido}
                  disabled={t.currentStudents === 0}
                >
                  {expandido ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  Alumnos
                </button>
              </div>

              {expandido && (
                <div className="edu-detail">
                  {alumnos.length === 0 ? (
                    <p className="edu-note">
                      Sin alumnos vigentes. (Si el número de arriba no dice cero, recarga la
                      pantalla: la lista se armó hace un momento.)
                    </p>
                  ) : (
                    <ul className="edu-chiplist">
                      {alumnos.map((a) => (
                        <li key={a.assignmentId} className="edu-assign">
                          <span>
                            {a.matricula} · {a.name}
                            {a.isPrimary ? " · titular" : ""}
                          </span>
                          {canAssign && (
                            <button
                              type="button"
                              className="edu-assign__x"
                              onClick={() => cerrarAsignacion(a.assignmentId, a.name)}
                              disabled={busyId === a.assignmentId}
                              aria-label={`Cerrar la supervisión de ${a.name}`}
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
                    <p className="edu-note">
                      Para asignarle un alumno nuevo, entra al padrón, abre la ficha del alumno y
                      elige al docente ahí: la asignación se hace desde el alumno, que es donde se
                      ve con quién más la comparte.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
