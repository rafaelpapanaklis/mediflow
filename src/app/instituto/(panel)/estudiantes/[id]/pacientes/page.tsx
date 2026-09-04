export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduEstudianteFicha, listEduEstudiantePacientes } from "@/lib/edu/estudiante";
import { EDU_ESTUDIANTE_MAX_PACIENTES } from "@/lib/edu/estudiante-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * PACIENTES ATENDIDOS — el recorrido que pidió Rafael, y tiene que salir de
 * una: nombre del estudiante → esta tabla → clic en un paciente → su
 * expediente.
 *
 * La columna "Por qué" no es adorno. Un paciente entra aquí por tres vías
 * distintas y no significan lo mismo: tener un CASO suyo es llevarlo, tener
 * una CITA puede ser una sola valoración, y "lo trajo" es haberlo referido
 * sin haberlo tratado necesariamente. Fundirlas en "atendió a 34" contaría
 * como trabajo clínico gente a la que solo mandó a la clínica.
 *
 * 🔴 LO QUE SE VE AQUÍ NO ES "TODOS SUS PACIENTES": es el cruce de los suyos
 * con los que le tocan a QUIEN MIRA. Un docente que abre la ficha de un
 * alumno suyo no ve por ella pacientes que ese alumno atendió bajo otro
 * titular. Abrir la carpeta de alguien no es heredar su llavero — y la
 * pantalla lo dice en vez de fingir que ése es todo su historial.
 */
export default async function EstudiantePacientesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { q?: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  // 🔴 Cada página vuelve a exigir SU permiso. Que el layout haya dejado
  // pasar con padron.view no abre los pacientes.
  if (!hasEduPermission(permUser, "pacientes.view")) {
    return (
      <EduDenied
        permission="pacientes.view"
        what="Los pacientes que ha atendido este estudiante, con folio, edad y última visita."
      />
    );
  }

  const alumno = await getEduEstudianteFicha(ctx, params.id, ctx.institution.timezone);
  if (!alumno) notFound();

  const q = typeof searchParams?.q === "string" ? searchParams.q : null;
  const page = await listEduEstudiantePacientes(ctx, alumno.id, ctx.institution.timezone, { q });
  const scope = eduVisibility(ctx, "patients");

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Pacientes atendidos</h2>
          <span className="edu-count">{page.rows.length}</span>
        </div>

        {scope.kind !== "all" && page.rows.length > 0 && (
          <p className="edu-note">
            Ves los pacientes de este estudiante que además te tocan a ti. Si atendió a alguien
            bajo otro docente, no sale aquí.
          </p>
        )}

        {page.truncated && (
          <p className="edu-note">
            Son más de {EDU_ESTUDIANTE_MAX_PACIENTES}. Se muestran los {EDU_ESTUDIANTE_MAX_PACIENTES}{" "}
            de última visita más reciente; busca por nombre o folio para acotar.
          </p>
        )}

        {page.rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">
              {q ? "Nadie coincide con esa búsqueda" : "Todavía no ha atendido a nadie"}
            </p>
            <p className="edu-empty__detail">
              {q
                ? "Prueba con el folio o con parte del nombre."
                : "Un paciente aparece aquí en cuanto tiene un caso, una cita o el origen marcado con este estudiante."}
            </p>
          </div>
        ) : (
          <div className="edu-table">
            <table>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Paciente</th>
                  <th>Edad</th>
                  <th>Por qué</th>
                  <th>Citas</th>
                  <th>Casos</th>
                  <th>Última visita</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((p) => (
                  <tr key={p.patientId}>
                    <td>{p.folio}</td>
                    <td>
                      {/* 🔴 EL CLIC QUE PIDIÓ RAFAEL: de aquí al expediente. */}
                      <EduPersonaLink kind="paciente" id={p.patientId}>
                        {p.name}
                      </EduPersonaLink>
                    </td>
                    <td>{p.ageYears === null ? "—" : `${p.ageYears}`}</td>
                    <td>
                      {[
                        p.porCaso ? "Caso" : null,
                        p.porCita ? "Cita" : null,
                        p.porReferido ? "Lo trajo" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td>{p.citas}</td>
                    <td>
                      {p.casosAbiertos > 0 ? `${p.casosAbiertos} abierto` : "—"}
                      {p.casosCerrados > 0 ? ` · ${p.casosCerrados} cerrado` : ""}
                    </td>
                    <td>{p.ultimaVisitaLabel ?? "Sin visitas"}</td>
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
