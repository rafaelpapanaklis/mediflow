export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduDocenteFicha, listEduDocenteCitas } from "@/lib/edu/docente";
import { EDU_ESTUDIANTE_MAX_FILAS } from "@/lib/edu/estudiante-core";
import { eduFormatDayShort } from "@/lib/edu/agenda-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { EDU_APPOINTMENT_STATUS_LABELS, EDU_APPOINTMENT_TYPE_LABELS } from "@/lib/edu/types";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * LA AGENDA QUE SUPERVISA.
 *
 * Historial, no calendario: el renglón no es un botón ni se arrastra, así que
 * los nombres se enlazan directo (a diferencia de /instituto/agenda).
 *
 * ⚠️ Son las citas donde ÉL figura como supervisor, no todas las de sus
 * alumnos: cubrir el turno de un compañero es un caso real, y las dos
 * preguntas tienen respuestas distintas.
 */
export default async function DocenteAgendaPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  // 🔴 DOS permisos, no uno. `docentes.view` es la puerta de la FICHA (quién
  // es esta persona) y el de abajo la de ESTA pestaña. Que el layout ya
  // exigiera el primero no basta: una página que se apoya en su layout para
  // cerrar la puerta es una página abierta el día que alguien la mueve de
  // sitio, y ALUMNO lleva casos.view y agenda.view por defecto.
  if (!hasEduPermission(permUser, "docentes.view")) notFound();
  if (!hasEduPermission(permUser, "agenda.view")) {
    return (
      <EduDenied
        permission="agenda.view"
        what="Las citas que supervisa este docente: cuándo, con qué estudiante y en qué acabaron."
      />
    );
  }

  const docente = await getEduDocenteFicha(ctx, params.id, ctx.institution.timezone);
  if (!docente) notFound();

  const { rows, truncated } = await listEduDocenteCitas(ctx, docente.id, ctx.institution.timezone);
  const scope = eduVisibility(ctx, "appointments");

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Citas que supervisa</h2>
          <span className="edu-count">{rows.length}</span>
        </div>

        {scope.kind !== "all" && rows.length > 0 && (
          <p className="edu-note">Ves las citas de este docente que además te tocan a ti.</p>
        )}

        {truncated && (
          <p className="edu-note">
            Son más de {EDU_ESTUDIANTE_MAX_FILAS}. Se muestran las {EDU_ESTUDIANTE_MAX_FILAS} más
            recientes.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin citas que mostrarte</p>
            <p className="edu-empty__detail">
              No figura como supervisor en ninguna cita que te toque.
            </p>
          </div>
        ) : (
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Hora</th>
                  <th>Paciente</th>
                  <th>Estudiante</th>
                  <th>Sillón</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    {/* El día viene YA calculado en la zona del instituto
                        (dayISO): formatear el instante aquí lo pintaría en la
                        del navegador. */}
                    <td>{eduFormatDayShort(a.dayISO)}</td>
                    <td>
                      {a.startLabel}–{a.endLabel}
                    </td>
                    <td>
                      <EduPersonaLink kind="paciente" id={a.patientId}>
                        {a.patientName}
                      </EduPersonaLink>
                    </td>
                    <td>
                      <EduPersonaLink kind="estudiante" id={a.studentId}>
                        {a.studentMatricula} · {a.studentName}
                      </EduPersonaLink>
                    </td>
                    <td>
                      {a.chairNumber} · {a.chairName}
                    </td>
                    <td>{EDU_APPOINTMENT_TYPE_LABELS[a.type]}</td>
                    <td>{EDU_APPOINTMENT_STATUS_LABELS[a.status]}</td>
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
