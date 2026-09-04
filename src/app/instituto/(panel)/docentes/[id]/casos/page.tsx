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
 * se abrió. No es lo mismo que "los casos de sus alumnos de hoy" — un docente
 * que rotó sigue figurando en los casos que llevó, y ésa es justamente la
 * pregunta que contesta esta pestaña.
 */
export default async function DocenteCasosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
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

        {scope.kind !== "all" && rows.length > 0 && (
          <p className="edu-note">Ves los casos de este docente que además te tocan a ti.</p>
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
              No figura como responsable en ningún caso que te toque.
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
