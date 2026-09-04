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

  const estudiantes = await listEduDocenteEstudiantes(ctx, docente.id);

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Estudiantes vigentes</h2>
          <span className="edu-count">{estudiantes.length}</span>
        </div>

        {estudiantes.length === 0 ? (
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
