export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduDocenteFicha } from "@/lib/edu/docente";
import { listEduCasosPanel } from "@/lib/edu/casos";
import { EDU_CASOS_PANEL_EMPTY_FILTERS } from "@/lib/edu/casos-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * LOS CASOS QUE SUPERVISA.
 *
 * 🔴 Es `listEduCasosPanel` —la MISMA de /instituto/casos— acotada por
 * `supervisorUserId`. No hay una segunda consulta de casos con sus propias
 * reglas de alcance: un segundo listado sería el sitio donde el recorte se
 * queda corto sin que nadie lo audite.
 *
 * ⚠️ `supervisorUserId` es la COLUMNA DEL CASO: quién respondía por él cuando
 * se abrió. No es lo mismo que "los casos de sus alumnos de hoy".
 *
 * 🔴 H-102 · Y ESO ES LO QUE ESTA PESTAÑA TODAVÍA NO CONTESTA DEL TODO. El
 * comentario de antes prometía que «un docente que rotó sigue figurando en
 * los casos que llevó, y ésa es justamente la pregunta que contesta esta
 * pestaña», y es falso para el propio docente: el `where` final es un AND
 * entre la columna del caso y el ALCANCE de quien mira, y el alcance de un
 * docente son los casos de sus alumnos VIGENTES. Los casos que llevó con
 * alumnos que ya no supervisa quedan fuera, así que su propia pestaña le
 * sale vacía y solo la dirección ve su historial.
 *
 * Lo que se arregla aquí es la MENTIRA: el vacío se explica por lo que de
 * verdad pasa, y el promedio del docente ya no lee "no llevó ninguno". Lo
 * que NO se hace es ensanchar `eduCaseScopeWhere` para que un docente vea
 * por esta puerta los casos que ya no supervisa: ese `where` lo comparten
 * Casos, Autorizaciones y Traspasos, donde "puedo verlo" es también "puedo
 * decidir sobre él". Cambiar el alcance clínico compartido para tapar un
 * dato no visible es un cambio que se acuerda, no que se cuela.
 */
export default async function DocenteCasosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  // 🔴 DOS permisos, no uno. `docentes.view` es la puerta de la FICHA (quién
  // es esta persona) y el de abajo la de ESTA pestaña. Que el layout ya
  // exigiera el primero no basta: una página que se apoya en su layout para
  // cerrar la puerta es una página abierta el día que alguien la mueve de
  // sitio, y ALUMNO lleva casos.view y agenda.view por defecto.
  if (!hasEduPermission(permUser, "docentes.view")) notFound();
  if (!hasEduPermission(permUser, "casos.view")) {
    return (
      <EduDenied
        permission="casos.view"
        what="Los casos que supervisa este docente: paciente, estudiante, especialidad y en qué van."
      />
    );
  }

  const docente = await getEduDocenteFicha(ctx, params.id, ctx.institution.timezone);
  if (!docente) notFound();

  const { rows, truncated } = await listEduCasosPanel(
    ctx,
    { ...EDU_CASOS_PANEL_EMPTY_FILTERS, supervisorUserId: docente.id, incluirCerrados: true },
    ctx.institution.timezone,
  );
  const scope = eduVisibility(ctx, "cases");

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Casos que supervisa</h2>
          <span className="edu-count">{rows.length}</span>
        </div>

        {scope.kind !== "all" && (
          <p className="edu-note">
            Ves los casos de este docente que <strong>además te tocan a ti</strong>: los de tus
            estudiantes con asignación vigente. Los que llevó con estudiantes que ya no supervisas
            no salen aquí aunque él figure como responsable — ese historial completo lo ve la
            dirección.
          </p>
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
              {scope.kind === "all"
                ? "No figura como responsable en ningún caso de este instituto."
                : // 🔴 H-102 · Vacío NO quiere decir "no llevó ninguno". Decirlo
                  // así hacía que un docente concluyera que su propio historial
                  // no existe, justo en la pestaña que existe para enseñárselo.
                  "No figura como responsable en ningún caso de los estudiantes que supervisas hoy. Puede haber llevado otros con estudiantes que ya no supervisas: ese historial lo ve la dirección."}
            </p>
          </div>
        ) : (
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Estudiante</th>
                  <th>Especialidad</th>
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
                    <td>
                      <EduPersonaLink kind="estudiante" id={c.studentId}>
                        {c.studentMatricula} · {c.studentName}
                      </EduPersonaLink>
                    </td>
                    <td>{c.programName}</td>
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
