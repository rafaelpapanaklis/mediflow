export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduDocenteFicha, listEduDocenteEstudiantes } from "@/lib/edu/docente";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * RESUMEN del docente: su carga y sus estudiantes vigentes de un vistazo.
 *
 * ⚠️ `casosAbiertos` puede venir `null` y NO es cero: es "a ti no te toca ese
 * dato" (le pasa a CAJA). Se pinta con una raya, no con un 0 — un 0 mentiría
 * sobre la carga de una persona.
 */
export default async function DocenteResumenPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "docentes.view")) notFound();

  // `equipo.manage` es el permiso que YA enseña la última entrada en la
  // pantalla de Equipo. Sin él el dato ni sale del servidor.
  const docente = await getEduDocenteFicha(ctx, params.id, ctx.institution.timezone, {
    verCuenta: hasEduPermission(permUser, "equipo.manage"),
  });
  if (!docente) notFound();

  const vePadron = hasEduPermission(permUser, "padron.view");
  // 🔴 El recorte del P1-4 vive DENTRO de listEduDocenteEstudiantes: un
  // DOCENTE que abre la ficha de un colega recibe `restringido` y cero filas.
  const estudiantes = vePadron
    ? await listEduDocenteEstudiantes(ctx, docente.id)
    : { rows: [], restringido: true };

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Su carga</h2>
        </div>

        <div className="edu-kpis">
          <div className="edu-kpi">
            <p className="edu-kpi__label">Estudiantes vigentes</p>
            <p className="edu-kpi__value">{docente.estudiantesVigentes}</p>
            <p className="edu-kpi__note">Con asignación abierta ahora mismo.</p>
          </div>
          <div className="edu-kpi">
            <p className="edu-kpi__label">Casos abiertos</p>
            <p className="edu-kpi__value">
              {docente.casosAbiertos === null ? "—" : docente.casosAbiertos}
            </p>
            <p className="edu-kpi__note">
              {docente.casosAbiertos === null
                ? "No te toca ver casos."
                : "Donde figura como responsable."}
            </p>
          </div>
          <div className="edu-kpi">
            <p className="edu-kpi__label">Próxima cita que supervisa</p>
            <p className="edu-kpi__value edu-kpi__value--texto">
              {docente.proximaCitaLabel ?? "—"}
            </p>
            <p className="edu-kpi__note">
              {docente.proximaCitaLabel ? "En la hora del instituto." : "Nada agendado."}
            </p>
          </div>
          <div className="edu-kpi">
            <p className="edu-kpi__label">Estado de la cuenta</p>
            <p className="edu-kpi__value edu-kpi__value--texto">
              {docente.isActive ? "Activa" : "Desactivada"}
            </p>
            <p className="edu-kpi__note">
              {docente.lastLoginLabel
                ? `Última entrada: ${docente.lastLoginLabel}.`
                : "La última entrada solo la ve quien administra el equipo."}
            </p>
          </div>
        </div>
      </section>

      {vePadron && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Sus estudiantes</h2>
            <span className="edu-count">{estudiantes.rows.length}</span>
          </div>
          {estudiantes.restringido ? (
            <p className="edu-note">
              Sus estudiantes no te tocan: un docente ve por nombre solo a los suyos. El número de
              arriba sí es el real.
            </p>
          ) : estudiantes.rows.length === 0 ? (
            <p className="edu-note">No supervisa a nadie ahora mismo.</p>
          ) : (
            <ul className="edu-chiplist">
              {estudiantes.rows.slice(0, 12).map((a) => (
                <li key={a.assignmentId} className="edu-assign">
                  <span>
                    {/* kind="estudiante" quiere el id de EduStudent, y eso es
                        justo lo que trae `studentId` de EduAssignmentRow (el
                        de la asignación es `assignmentId`). */}
                    <EduPersonaLink kind="estudiante" id={a.studentId}>
                      {a.matricula} · {a.name}
                    </EduPersonaLink>
                    {a.isPrimary ? " · titular" : ""}
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
