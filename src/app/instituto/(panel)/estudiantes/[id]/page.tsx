export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduEstudianteFicha } from "@/lib/edu/estudiante";
import { listEduCasosPanel } from "@/lib/edu/casos";
import { listEduEstudianteCitas } from "@/lib/edu/estudiante";
import { EDU_CASOS_PANEL_EMPTY_FILTERS } from "@/lib/edu/casos-core";
import { eduFormatDayShort } from "@/lib/edu/agenda-core";
import { EDU_APPOINTMENT_STATUS_LABELS } from "@/lib/edu/types";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * RESUMEN: los números del alumno, sus casos abiertos y lo que tiene por
 * delante.
 *
 * 🔴 Vuelve a pedir la ficha aunque el layout ya la pidió. Es una consulta
 * más y es a propósito: sin ella, esta página confiaría en que el layout ya
 * comprobó el alcance, y una página que se apoya en su layout para cerrar la
 * puerta es una página abierta el día que alguien la mueve de sitio.
 *
 * ⚠️ Los KPIs pueden venir en `null` y eso NO es cero: es "a ti no te toca
 * ese dato". Se pintan con una raya, no con un 0, porque un 0 mentiría sobre
 * el trabajo de una persona.
 */
export default async function EstudianteResumenPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "padron.view")) notFound();

  const alumno = await getEduEstudianteFicha(ctx, params.id, ctx.institution.timezone);
  if (!alumno) notFound();

  const veCasos = hasEduPermission(permUser, "casos.view");
  const veAgenda = hasEduPermission(permUser, "agenda.view");

  const [casos, citas] = await Promise.all([
    // El MISMO listado que la pantalla de casos, acotado a este alumno: no
    // hay una segunda consulta de casos con sus propias reglas de alcance.
    veCasos
      ? listEduCasosPanel(
          ctx,
          { ...EDU_CASOS_PANEL_EMPTY_FILTERS, studentId: alumno.id },
          ctx.institution.timezone,
        )
      : Promise.resolve({ rows: [], truncated: false }),
    veAgenda
      ? listEduEstudianteCitas(ctx, alumno.id, ctx.institution.timezone)
      : Promise.resolve({ rows: [], truncated: false }),
  ]);

  const ahora = Date.now();
  const proximas = citas.rows
    .filter((a) => new Date(a.startsAt).getTime() >= ahora)
    // `listEduEstudianteCitas` viene de la más reciente a la más vieja
    // (que es como se lee un historial); lo que viene POR DELANTE se lee al
    // revés: lo más cercano primero.
    .reverse()
    .slice(0, 8);

  const cifra = (v: number | null): string => (v === null ? "—" : String(v));

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Su trabajo clínico</h2>
        </div>

        <div className="edu-kpis">
          <div className="edu-kpi">
            <p className="edu-kpi__label">Pacientes atendidos</p>
            <p className="edu-kpi__value">{cifra(alumno.kpis.pacientes)}</p>
            <p className="edu-kpi__note">Distintos, por caso, cita o porque los trajo.</p>
          </div>
          <div className="edu-kpi">
            <p className="edu-kpi__label">Casos abiertos</p>
            <p className="edu-kpi__value">{cifra(alumno.kpis.casosAbiertos)}</p>
            <p className="edu-kpi__note">
              {alumno.kpis.casosCerrados === null
                ? "No te toca ver sus casos."
                : `${alumno.kpis.casosCerrados} cerrados.`}
            </p>
          </div>
          <div className="edu-kpi">
            <p className="edu-kpi__label">Citas cumplidas</p>
            <p className="edu-kpi__value">{cifra(alumno.kpis.citasCompletadas)}</p>
            <p className="edu-kpi__note">
              {alumno.kpis.ultimaAtencionLabel
                ? `Última: ${alumno.kpis.ultimaAtencionLabel}.`
                : "Todavía no atiende a nadie."}
            </p>
          </div>
          <div className="edu-kpi">
            <p className="edu-kpi__label">Próxima cita</p>
            <p className="edu-kpi__value edu-kpi__value--texto">
              {alumno.kpis.proximaCitaLabel ?? "—"}
            </p>
            <p className="edu-kpi__note">
              {alumno.kpis.proximaCitaLabel ? "En la hora del instituto." : "No tiene nada agendado."}
            </p>
          </div>
        </div>

        {alumno.kpis.pacientes === null && (
          <p className="edu-note">
            Los números clínicos no te tocan con tu rol. Lo académico —matrícula, generación,
            semestre y docente— sí lo estás viendo arriba.
          </p>
        )}
      </section>

      {veCasos && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Casos</h2>
            <span className="edu-count">{casos.rows.length}</span>
          </div>
          {casos.rows.length === 0 ? (
            <p className="edu-note">No tiene casos que te toquen.</p>
          ) : (
            <ul className="edu-chiplist">
              {casos.rows.slice(0, 10).map((c) => (
                <li key={c.id} className="edu-assign">
                  <span>
                    <EduPersonaLink kind="paciente" id={c.patientId}>
                      {c.patientFolio} · {c.patientName}
                    </EduPersonaLink>{" "}
                    · {c.programName} · {c.statusLabel}
                    {c.supervisorName ? (
                      <>
                        {" · supervisa "}
                        <EduPersonaLink kind="docente" id={c.supervisorUserId}>
                          {c.supervisorName}
                        </EduPersonaLink>
                      </>
                    ) : (
                      " · sin docente"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {veAgenda && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Lo que tiene por delante</h2>
            <span className="edu-count">{proximas.length}</span>
          </div>
          {proximas.length === 0 ? (
            <p className="edu-note">No tiene citas próximas que te toquen.</p>
          ) : (
            <ul className="edu-chiplist">
              {proximas.map((a) => (
                <li key={a.id} className="edu-assign">
                  <span>
                    {/* El día viene YA calculado en la zona del instituto
                        (dayISO): formatear el instante aquí lo pintaría en la
                        del navegador, y una cita de las 19:00 en Tijuana
                        saldría al día siguiente. */}
                    {eduFormatDayShort(a.dayISO)} {a.startLabel} ·{" "}
                    <EduPersonaLink kind="paciente" id={a.patientId}>
                      {a.patientName}
                    </EduPersonaLink>{" "}
                    · {a.chairName} · {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
