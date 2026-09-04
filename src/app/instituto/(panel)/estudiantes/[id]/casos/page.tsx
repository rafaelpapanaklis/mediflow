export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduEstudianteFicha } from "@/lib/edu/estudiante";
import { listEduCasosPanel } from "@/lib/edu/casos";
import { EDU_CASOS_PANEL_EMPTY_FILTERS } from "@/lib/edu/casos-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * SUS CASOS.
 *
 * 🔴 NO hay una consulta nueva de casos: es `listEduCasosPanel` —la MISMA de
 * /instituto/casos— acotada por `studentId`. Escribir aquí un segundo listado
 * sería un segundo sitio donde el alcance puede discrepar, y el que se audita
 * siempre es el otro.
 *
 * `incluirCerrados: true` porque esta pantalla es la HISTORIA de un alumno,
 * no su lista de trabajo del día: un caso terminado o entregado es
 * exactamente lo que hay que poder enseñar en una acreditación.
 *
 * CAJA no llega: `casos.view` no lo tiene, y el recurso "cases" le devuelve
 * "none" aunque alguien le encienda el interruptor por error.
 */
export default async function EstudianteCasosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "casos.view")) {
    return (
      <EduDenied
        permission="casos.view"
        what="Los casos clínicos de este estudiante: paciente, especialidad, docente responsable y en qué van."
      />
    );
  }

  const alumno = await getEduEstudianteFicha(ctx, params.id, ctx.institution.timezone);
  if (!alumno) notFound();

  const { rows, truncated } = await listEduCasosPanel(
    ctx,
    { ...EDU_CASOS_PANEL_EMPTY_FILTERS, studentId: alumno.id, incluirCerrados: true },
    ctx.institution.timezone,
  );
  const scope = eduVisibility(ctx, "cases");

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Sus casos</h2>
          <span className="edu-count">{rows.length}</span>
        </div>

        {scope.kind !== "all" && rows.length > 0 && (
          <p className="edu-note">Ves los casos de este estudiante que además te tocan a ti.</p>
        )}

        {truncated && (
          <p className="edu-note">
            Son más de los que caben en la pantalla. Se muestran los más recientes; el listado
            completo está en Casos, con sus filtros.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin casos que mostrarte</p>
            <p className="edu-empty__detail">
              Un caso se abre en la valoración: es lo que le pone paciente y especialidad a un
              estudiante.
            </p>
          </div>
        ) : (
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Especialidad</th>
                  <th>Docente</th>
                  <th>Estado</th>
                  <th>Abierto</th>
                  <th>Cerrado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <EduPersonaLink kind="paciente" id={c.patientId}>
                        {c.patientFolio} · {c.patientName}
                      </EduPersonaLink>
                    </td>
                    <td>{c.programName}</td>
                    <td>
                      {c.supervisorName ? (
                        <EduPersonaLink kind="docente" id={c.supervisorUserId}>
                          {c.supervisorName}
                        </EduPersonaLink>
                      ) : (
                        "Sin docente"
                      )}
                    </td>
                    <td>{c.statusLabel}</td>
                    <td>{c.openedLabel}</td>
                    <td>{c.closedLabel ?? "—"}</td>
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
