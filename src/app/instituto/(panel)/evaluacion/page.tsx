export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { parseEduStudentStatus } from "@/lib/edu/padron-core";
import { listEduCohorts, listEduPrograms } from "@/lib/edu/padron";
import { listEduEvaluacion } from "@/lib/edu/evaluacion";
import {
  EDU_EVALUACION_MAX_ROWS,
  parseEduSemaforo,
} from "@/lib/edu/evaluacion-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduEvaluacionScreen } from "@/components/edu/evaluacion/evaluacion-screen";

export const metadata: Metadata = {
  title: "Evaluación · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/evaluacion — QUIÉN VA ATRASADO, Y POR QUÉ.
 *
 * DOS CERRADURAS, como en todo el vertical:
 *  1. el PERMISO "evaluacion.view" abre la pantalla;
 *  2. el ALCANCE (visibility.ts, recurso "cases") decide las filas: la
 *     dirección ve a todos, el docente a los alumnos que supervisa HOY, y
 *     el ALUMNO se ve a sí mismo — una fila.
 *
 * 🔴 Que el alumno entre aquí es deliberado y es media ola. Si no pudiera,
 * "te faltan 3 de 8" no se lo diría nadie hasta el día que no se gradúa.
 * Lo que NO puede es calificar: eso es "evaluacion.grade", que no tiene.
 */
export default async function InstitutoEvaluacionPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "evaluacion.view")) {
    return (
      <EduDenied
        permission="evaluacion.view"
        what="El avance académico: qué requisitos lleva cada estudiante, cuántas horas clínicas y cómo va contra lo esperado."
      />
    );
  }

  const scope = eduVisibility(ctx, "cases");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Evaluación</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.cases}</p>
        </div>
      </div>
    );
  }

  const sp = searchParams ?? {};
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

  const filters = {
    programId: eduCleanId(first(sp.especialidad)),
    cohortId: eduCleanId(first(sp.generacion)),
    status: parseEduStudentStatus(first(sp.estado)),
    semaforo: parseEduSemaforo(first(sp.semaforo)),
  };

  const esAlumno = ctx.role === "ALUMNO";
  const canManagePlan = hasEduPermission(permUser, "requisitos.manage");

  // El alumno no ve filtros, así que tampoco se le cargan las listas: dos
  // consultas de menos en la pantalla que más se abre desde un teléfono.
  const [page, programs, cohorts] = await Promise.all([
    listEduEvaluacion(ctx, {
      programId: filters.programId,
      cohortId: filters.cohortId,
      status: filters.status,
      estado: filters.semaforo,
    }),
    esAlumno ? Promise.resolve([]) : listEduPrograms(ctx),
    esAlumno ? Promise.resolve([]) : listEduCohorts(ctx),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Evaluación</h1>
          <p className="edu-page__lead">
            {esAlumno
              ? "Lo que llevas y lo que te falta para cerrar, contra lo que se espera a esta altura del ciclo. Los números salen de tus casos: no los teclea nadie."
              : "Cada estudiante contra lo que se espera a esta altura del ciclo, y por qué. El avance se cuenta de sus casos —no hay ningún contador guardado que se pueda desincronizar."}
          </p>
        </div>
      </header>

      <EduEvaluacionScreen
        rows={page.rows}
        truncated={page.truncated}
        maxRows={EDU_EVALUACION_MAX_ROWS}
        filters={filters}
        programs={programs.map((p) => ({ id: p.id, name: p.name }))}
        cohorts={cohorts.map((c) => ({
          id: c.id,
          name: c.name,
          programId: c.programId,
          programName: c.programName,
        }))}
        esAlumno={esAlumno}
        canManagePlan={canManagePlan}
      />
    </div>
  );
}
