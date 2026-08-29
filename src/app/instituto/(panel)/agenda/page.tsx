export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  EDU_AGENDA_MAX_ROWS,
  eduTodayISO,
  parseEduAgendaQuery,
} from "@/lib/edu/agenda-core";
import {
  listEduAgenda,
  listEduStudentOptions,
  listEduSupervisorOptions,
} from "@/lib/edu/agenda";
import { listEduChairOptions } from "@/lib/edu/sillones";
import { listEduPatientOptions } from "@/lib/edu/pacientes";
import { listEduPrograms } from "@/lib/edu/padron";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduAgendaScreen } from "@/components/edu/clinica/agenda-screen";

export const metadata: Metadata = {
  title: "Agenda · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/agenda — el día y la semana, por sillón.
 *
 * EXIGE "agenda.view" AQUÍ, no solo en el menú.
 *
 * 🔴 EL RECORTE SE HACE EN EL SERVIDOR con el helper único
 * (src/lib/edu/visibility.ts): un ALUMNO recibe solo sus citas, un DOCENTE
 * las de sus alumnos con asignación VIGENTE, y caja y dirección la agenda
 * entera. El componente cliente no tiene forma de pedir más.
 *
 * 🔴 LA ZONA HORARIA sale de la sesión (institution.timezone) y el rango
 * del día se calcula con ella. Si se usara la del servidor (UTC en Vercel),
 * la agenda de una escuela en Tijuana empezaría a las cinco de la tarde del
 * día anterior.
 */
export default async function InstitutoAgendaPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "agenda.view")) {
    return (
      <EduDenied
        permission="agenda.view"
        what="La agenda de la clínica: qué paciente está citado, con qué alumno, en qué sillón y a qué hora."
      />
    );
  }

  const scope = eduVisibility(ctx, "appointments");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Agenda</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay citas que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.appointments}</p>
        </div>
      </div>
    );
  }

  const canManage = hasEduPermission(permUser, "agenda.manage");
  const canAssign = hasEduPermission(permUser, "casos.assign");

  // Un solo `now` y una sola zona para TODAS las consultas de la pantalla.
  const now = new Date();
  const tz = ctx.institution.timezone;
  const query = parseEduAgendaQuery(searchParams, tz, now);

  const [page, sillones, alumnos, docentes, programas, pacientes] = await Promise.all([
    listEduAgenda(ctx, query, tz, now),
    listEduChairOptions(ctx),
    listEduStudentOptions(ctx, now),
    canManage ? listEduSupervisorOptions(ctx) : Promise.resolve([]),
    listEduPrograms(ctx),
    canManage ? listEduPatientOptions(ctx, now) : Promise.resolve([]),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Agenda</h1>
          <p className="edu-page__lead">
            {scope.kind === "all"
              ? "Las citas de la clínica, por sillón. Las horas están en la hora del instituto."
              : scope.kind === "own"
                ? "Tus citas. Marca aquí cuando el paciente llegue y cuando lo sientes en el sillón."
                : "Las citas de los alumnos que supervisas hoy."}
          </p>
        </div>
        {canAssign && (
          <div className="edu-pagehead__actions">
            <Link href="/instituto/agenda/tamizaje" className="edu-btn edu-btn--ghost edu-btn--sm">
              Tamizaje
            </Link>
          </div>
        )}
      </header>

      <EduAgendaScreen
        rows={page.rows}
        days={page.days}
        truncated={page.truncated}
        maxRows={EDU_AGENDA_MAX_ROWS}
        query={query}
        chairs={sillones}
        students={alumnos}
        supervisors={docentes}
        programs={programas.map((p) => ({ id: p.id, name: p.name }))}
        patients={pacientes.map((p) => ({ id: p.id, folio: p.folio, name: p.name }))}
        canManage={canManage}
        todayISO={eduTodayISO(tz, now)}
      />
    </div>
  );
}
