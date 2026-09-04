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

  const docente = await getEduDocenteFicha(ctx, params.id, ctx.institution.timezone);
  if (!docente) notFound();

  const vePadron = hasEduPermission(permUser, "padron.view");
  const estudiantes = vePadron ? await listEduDocenteEstudiantes(ctx, docente.id) : [];

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
            <p className="edu-kpi__label">Última entrada</p>
            <p className="edu-kpi__value edu-kpi__value--texto">
              {docente.lastLoginLabel ?? "Nunca"}
            </p>
            <p className="edu-kpi__note">
              {docente.isActive ? "Cuenta activa." : "Cuenta desactivada."}
            </p>
          </div>
        </div>
      </section>

      {vePadron && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Sus estudiantes</h2>
            <span className="edu-count">{estudiantes.length}</span>
          </div>
          {estudiantes.length === 0 ? (
            <p className="edu-note">No supervisa a nadie ahora mismo.</p>
          ) : (
            <ul className="edu-chiplist">
              {estudiantes.slice(0, 12).map((a) => (
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
