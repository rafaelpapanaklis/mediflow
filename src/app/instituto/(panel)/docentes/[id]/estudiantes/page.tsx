export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduDocenteFicha, listEduDocenteEstudiantes } from "@/lib/edu/docente";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * SUS ESTUDIANTES VIGENTES.
 *
 * Vigente = el predicado único del vertical (`eduCurrentAssignmentWhere`):
 * `startsAt <= ahora && (endsAt == null || endsAt > ahora)`. Una asignación
 * cerrada ayer NO sale, y una que empieza mañana tampoco — que es lo que
 * distingue "a quién supervisa" de "a quién supervisó alguna vez".
 */
export default async function DocenteEstudiantesPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  // 🔴 DOS permisos, no uno. `docentes.view` es la puerta de la FICHA (quién
  // es esta persona) y el de abajo la de ESTA pestaña. Que el layout ya
  // exigiera el primero no basta: una página que se apoya en su layout para
  // cerrar la puerta es una página abierta el día que alguien la mueve de
  // sitio, y ALUMNO lleva casos.view y agenda.view por defecto.
  if (!hasEduPermission(permUser, "docentes.view")) notFound();
  if (!hasEduPermission(permUser, "padron.view")) {
    return (
      <EduDenied
        permission="padron.view"
        what="Los estudiantes que supervisa este docente ahora mismo, con su matrícula."
      />
    );
  }

  const docente = await getEduDocenteFicha(ctx, params.id, ctx.institution.timezone);
  if (!docente) notFound();

  // 🔴 El recorte del P1-4 vive DENTRO del loader: un DOCENTE que abre la
  // ficha de un colega recibe `restringido` y cero filas, no el padrón
  // nominal ajeno.
  const { rows: estudiantes, restringido } = await listEduDocenteEstudiantes(ctx, docente.id);

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Estudiantes vigentes</h2>
          <span className="edu-count">{estudiantes.length}</span>
        </div>

        {restringido ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sus estudiantes no te tocan</p>
            <p className="edu-empty__detail">
              Un docente ve por nombre solo a los suyos. El número de estudiantes vigentes que
              aparece en el Resumen sí es el real: cuántos lleva cada quien no es una identidad.
            </p>
          </div>
        ) : estudiantes.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">No supervisa a nadie ahora mismo</p>
            <p className="edu-empty__detail">
              Las asignaciones cerradas no cuentan aquí. Se asignan desde el padrón.
            </p>
          </div>
        ) : (
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>Matrícula</th>
                  <th>Estudiante</th>
                  <th>Papel</th>
                </tr>
              </thead>
              <tbody>
                {estudiantes.map((a) => (
                  <tr key={a.assignmentId}>
                    <td>{a.matricula}</td>
                    <td>
                      {/* kind="estudiante" quiere el id de EduStudent:
                          `studentId`, no `assignmentId` ni el de la cuenta. */}
                      <EduPersonaLink kind="estudiante" id={a.studentId}>
                        {a.name}
                      </EduPersonaLink>
                    </td>
                    <td>{a.isPrimary ? "Titular" : "Apoyo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
