export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduEstudianteFicha, listEduEstudianteCitas } from "@/lib/edu/estudiante";
import { EDU_ESTUDIANTE_MAX_FILAS } from "@/lib/edu/estudiante-core";
import { eduFormatDayShort } from "@/lib/edu/agenda-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { EDU_APPOINTMENT_STATUS_LABELS, EDU_APPOINTMENT_TYPE_LABELS } from "@/lib/edu/types";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * SU AGENDA: las citas de este alumno, la más reciente primero.
 *
 * Es un HISTORIAL, no el calendario: aquí no se arrastra ni se reagenda, así
 * que el renglón NO es un botón y los nombres pueden ser enlaces directos —
 * a diferencia de /instituto/agenda, donde el renglón entero abre la cita y
 * un ancla dentro sería HTML inválido.
 */
export default async function EstudianteAgendaPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "agenda.view")) {
    return (
      <EduDenied
        permission="agenda.view"
        what="Las citas de este estudiante: cuándo, con quién, en qué sillón y en qué acabaron."
      />
    );
  }

  const alumno = await getEduEstudianteFicha(ctx, params.id, ctx.institution.timezone);
  if (!alumno) notFound();

  const { rows, truncated } = await listEduEstudianteCitas(
    ctx,
    alumno.id,
    ctx.institution.timezone,
  );
  const scope = eduVisibility(ctx, "appointments");

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Sus citas</h2>
          <span className="edu-count">{rows.length}</span>
        </div>

        {scope.kind !== "all" && rows.length > 0 && (
          <p className="edu-note">
            Ves las citas de este estudiante que además te tocan a ti.
          </p>
        )}

        {truncated && (
          <p className="edu-note">
            Tiene más de {EDU_ESTUDIANTE_MAX_FILAS} citas. Se muestran las {EDU_ESTUDIANTE_MAX_FILAS}{" "}
            más recientes.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin citas que mostrarte</p>
            <p className="edu-empty__detail">
              Ni pasadas ni futuras. Si este estudiante tiene citas con otros docentes, no te tocan.
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
                  <th>Docente</th>
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
                      {a.supervisorName ? (
                        <EduPersonaLink kind="docente" id={a.supervisorUserId}>
                          {a.supervisorName}
                        </EduPersonaLink>
                      ) : (
                        "—"
                      )}
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
