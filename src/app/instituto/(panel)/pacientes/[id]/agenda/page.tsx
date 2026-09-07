export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { listEduPatientAppointments } from "@/lib/edu/agenda";
import { eduFormatDayShort, type EduAppointmentRow } from "@/lib/edu/agenda-core";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPE_LABELS,
  type EduAppointmentStatus,
} from "@/lib/edu/types";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCitaCancelar } from "@/components/edu/expediente/paciente-acciones";

/**
 * Pestaña AGENDA de la ficha (Ola 12): las citas de ESTE paciente, las que
 * vienen y las que ya pasaron, con alumno, sillón, sede y estado.
 *
 * 🔴 El recorte es el de SIEMPRE (eduAppointmentScopeWhere, vía
 * listEduPatientAppointments): un alumno ve SUS citas con este paciente
 * aunque el paciente tenga otras con otro alumno — y la pantalla lo dice,
 * para que nadie lea "2 citas" como el historial completo.
 *
 * Agendar NO vive aquí sino en la barra de acciones de la ficha (arriba,
 * en el layout): así el botón está en TODAS las pestañas y no solo en
 * ésta, que es lo que "agendar sin salir de la ficha" significa.
 *
 * 🔴 CANCELAR SÍ VIVE AQUÍ (Ola B), y es lo contrario por la misma razón:
 * se cancela UNA cita concreta, así que el botón tiene que estar pegado a
 * la cita y no en una barra que no sabe de cuál hablas. Hasta ahora esta
 * pestaña enseñaba las citas y no dejaba hacer nada con ellas: para
 * cancelar la del jueves había que salir a la agenda general, encontrar el
 * día y encontrar el hueco.
 *
 * ⚠️ La regla de estado NO se duplica: el botón pega a
 * `PATCH /api/instituto/pacientes/[id]/agenda/[citaId]`, que llama a
 * `setEduAppointmentStatus` — la misma función que usa la agenda general.
 *
 * ⚠️ La ficha NO se filtra por sede a propósito (decisión de la Ola 11):
 * la historia del paciente es UNA. La sede de cada cita se PINTA cuando
 * las filas cruzan más de una.
 */
const TAG_BY_STATUS: Record<EduAppointmentStatus, string> = {
  SCHEDULED: "edu-tag--info",
  CHECKED_IN: "edu-tag--info",
  IN_CHAIR: "edu-tag--warn",
  IN_PROGRESS: "edu-tag--warn",
  COMPLETED: "edu-tag--ok",
  CANCELLED: "edu-tag--muted",
  NO_SHOW: "edu-tag--danger",
};

/** Los estados desde los que todavía tiene sentido cancelar. Una cita ya
 *  cancelada, ya terminada o a la que el paciente no llegó no se cancela —
 *  y el servidor lo rebota igual con `eduAppointmentCanTransition`; esto
 *  solo evita pintar un botón que solo puede dar error. */
const CANCELABLES: EduAppointmentStatus[] = ["SCHEDULED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"];

function Cita({
  a,
  conSede,
  patientId,
  canManage,
}: {
  a: EduAppointmentRow;
  conSede: boolean;
  patientId: string;
  /** `agenda.manage`: cancelar libera el hueco y toca el cobro. */
  canManage: boolean;
}) {
  return (
    <article className="edu-nota">
      <div className="edu-nota__head">
        <div>
          <span className="edu-nota__when">
            {eduFormatDayShort(a.dayISO)} · {a.startLabel}–{a.endLabel}
          </span>
          <span className="edu-nota__who">
            <EduPersonaLink kind="estudiante" id={a.studentId}>
              {a.studentMatricula} · {a.studentName}
            </EduPersonaLink>
            {a.supervisorName ? (
              <>
                {" · supervisa "}
                <EduPersonaLink kind="docente" id={a.supervisorUserId}>
                  {a.supervisorName}
                </EduPersonaLink>
              </>
            ) : (
              ""
            )}
          </span>
        </div>
        <span className={`edu-tag ${TAG_BY_STATUS[a.status]}`}>
          {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
        </span>
      </div>
      <p className="edu-estudio__meta">
        {EDU_APPOINTMENT_TYPE_LABELS[a.type]} · {a.chairName}
        {conSede ? ` · ${a.chairCampusName}` : ""}
        {a.caseProgramName ? ` · caso de ${a.caseProgramName}` : ""}
        {a.notes ? ` · ${a.notes}` : ""}
      </p>
      {CANCELABLES.includes(a.status) && (
        <div className="edu-actions">
          <EduCitaCancelar
            patientId={patientId}
            appointmentId={a.id}
            cuando={`${eduFormatDayShort(a.dayISO)} · ${a.startLabel}–${a.endLabel} · ${a.chairName}`}
            canManage={canManage}
          />
        </div>
      )}
    </article>
  );
}

export default async function PacienteAgendaPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "agenda.view")) {
    return (
      <EduDenied
        permission="agenda.view"
        what="Las citas de este paciente: cuándo viene, con qué estudiante y en qué sillón."
      />
    );
  }

  const p = await getEduPatient(ctx, params.id);
  if (!p) notFound();

  const scope = eduVisibility(ctx, "appointments");
  if (scope.kind === "none") {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay citas que mostrarte</p>
        <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.appointments}</p>
      </div>
    );
  }

  // 🔴 `agenda.manage` y no `agenda.view`: registrar lo que pasa en el
  // sillón (llegó, se sentó, terminó) lo hace cualquiera con agenda.view —
  // es lo que hace que /mi-dia funcione para un alumno—, pero CANCELAR es
  // una decisión administrativa: libera el hueco y, desde la Ola 5, toca el
  // cobro. Es la misma línea que traza el servidor con `eduStatusNeedsManage`.
  const canCancelar = hasEduPermission(permUser, "agenda.manage");

  const now = new Date();
  const citas = await listEduPatientAppointments(ctx, p.id, ctx.institution.timezone, now);

  // Vienen ordenadas DESC (la más reciente primero). Las futuras se
  // reordenan ASC — la próxima arriba es lo que uno espera de "qué sigue".
  const futuras = citas
    .filter((a) => new Date(a.startsAt).getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pasadas = citas.filter((a) => new Date(a.startsAt).getTime() < now.getTime());
  const conSede = new Set(citas.map((a) => a.chairCampusName)).size > 1;

  return (
    <div className="edu-stack">
      {scope.kind !== "all" && citas.length > 0 && (
        <p className="edu-note">
          Ves las citas que te tocan. Si este paciente tiene otras con otro estudiante, no salen
          aquí.
        </p>
      )}

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Próximas</h2>
          <span className="edu-count">{futuras.length}</span>
        </div>
        {futuras.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">No tiene próxima cita</p>
            <p className="edu-empty__detail">
              Nadie lo tiene agendado. Se agenda con el botón «Agendar cita» de arriba — sin
              salir de la ficha.
            </p>
          </div>
        ) : (
          <div className="edu-stack edu-stack--tight">
            {futuras.map((a) => (
              <Cita
                key={a.id}
                a={a}
                conSede={conSede}
                patientId={p.id}
                canManage={canCancelar}
              />
            ))}
          </div>
        )}
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Pasadas</h2>
          <span className="edu-count">{pasadas.length}</span>
        </div>
        {pasadas.length === 0 ? (
          <p className="edu-note">Todavía no tiene citas pasadas que te toquen.</p>
        ) : (
          <div className="edu-stack edu-stack--tight">
            {pasadas.map((a) => (
              <Cita
                key={a.id}
                a={a}
                conSede={conSede}
                patientId={p.id}
                canManage={canCancelar}
              />
            ))}
          </div>
        )}
      </section>

      {citas.length >= 50 && (
        <p className="edu-note">
          Se muestran las últimas 50 citas. Las más viejas existen — esta lista no las carga.
        </p>
      )}
    </div>
  );
}
