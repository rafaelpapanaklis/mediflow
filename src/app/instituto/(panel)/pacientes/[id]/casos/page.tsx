export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { listEduPatientCases } from "@/lib/edu/casos";
import { listEduPatientAppointments } from "@/lib/edu/agenda";
import { eduFormatDayShort } from "@/lib/edu/agenda-core";
import { eduVisibility } from "@/lib/edu/visibility";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_CASE_CLOSED_STATUSES,
  EDU_CASE_STATUS_LABELS,
} from "@/lib/edu/types";
import { EduDenied } from "@/components/edu/edu-denied";

/**
 * Pestaña CASOS: los casos del paciente y sus últimas citas.
 *
 * 🔴 CAJA NO LLEGA AQUÍ. No por la pestaña escondida (eso no cierra nada)
 * sino por el permiso `casos.view`, que caja no tiene, y por el ALCANCE:
 * `listEduPatientCases` usa el recurso "cases", que para caja es "none" y
 * devuelve la lista vacía aunque alguien le encienda el interruptor.
 *
 * ⚠️ Lo que se ve aquí NO es "todos los casos del paciente": es el recorte
 * de quien pregunta. La señora con endodoncia y ortodoncia tiene dos casos,
 * dos alumnos y dos docentes; el de endodoncia ve UNO. Que pueda abrir la
 * ficha del paciente no le da el expediente completo — y la pantalla lo
 * dice, en vez de fingir que ese es todo el historial.
 */
export default async function PacienteCasosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "casos.view")) {
    return (
      <EduDenied
        permission="casos.view"
        what="Los casos clínicos del paciente: qué especialidad, qué alumno y en qué van."
      />
    );
  }

  const p = await getEduPatient(ctx, params.id);
  if (!p) notFound();

  const scope = eduVisibility(ctx, "cases");
  const [casos, citas] = await Promise.all([
    listEduPatientCases(ctx, p.id),
    hasEduPermission(permUser, "agenda.view")
      ? listEduPatientAppointments(ctx, p.id, ctx.institution.timezone)
      : Promise.resolve([]),
  ]);

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Casos</h2>
          <span className="edu-count">{casos.length}</span>
        </div>

        {scope.kind !== "all" && casos.length > 0 && (
          <p className="edu-note">
            Ves los casos que te tocan. Si este paciente tiene otros con otra especialidad y otro
            alumno, no salen aquí.
          </p>
        )}

        {casos.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Sin casos que mostrarte</p>
            <p className="edu-empty__detail">
              Un caso se abre en el tamizaje: es lo que le pone alumno y especialidad al paciente. Si
              este paciente ya tiene casos con otros alumnos, no te tocan.
            </p>
          </div>
        ) : (
          <div className="edu-stack edu-stack--tight">
            {casos.map((c) => {
              const cerrado = (EDU_CASE_CLOSED_STATUSES as string[]).includes(c.status);
              return (
                <div key={c.id} className={`edu-nota ${cerrado ? "edu-nota--borrador" : ""}`}>
                  <div className="edu-nota__head">
                    <div>
                      <span className="edu-nota__when">{c.programName}</span>
                      <span className="edu-nota__who">
                        {c.studentMatricula} · {c.studentName}
                        {c.supervisorName ? ` · supervisa ${c.supervisorName}` : ""}
                      </span>
                    </div>
                    <span className={`edu-tag ${cerrado ? "edu-tag--muted" : "edu-tag--ok"}`}>
                      {EDU_CASE_STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <p className="edu-estudio__meta">
                    {c.appointments} {c.appointments === 1 ? "sesión" : "sesiones"}
                    {c.notes ? ` · ${c.notes}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Últimas citas</h2>
          <span className="edu-count">{citas.length}</span>
        </div>
        {citas.length === 0 ? (
          <p className="edu-note">Todavía no tiene citas que te toquen.</p>
        ) : (
          <ul className="edu-chiplist">
            {citas.slice(0, 12).map((a) => (
              <li key={a.id} className="edu-assign">
                <span>
                  {/* El día viene YA calculado en la zona del instituto
                      (dayISO). Formatear el instante aquí lo pintaría en la
                      zona del navegador, y una cita de las 19:00 en Tijuana
                      saldría al día siguiente. */}
                  {eduFormatDayShort(a.dayISO)} {a.startLabel} · {a.chairName} ·{" "}
                  {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
