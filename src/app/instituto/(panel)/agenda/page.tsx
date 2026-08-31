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
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
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
 * 🔴 LA ZONA HORARIA sale de la sesión y el rango del día se calcula con
 * ella. Si se usara la del servidor (UTC en Vercel), la agenda de una
 * escuela en Tijuana empezaría a las cinco de la tarde del día anterior.
 *
 * ── Ola 11 · LA SEDE ────────────────────────────────────────────────────
 * 🔴 Y desde esta ola la zona es LA DE LA SEDE que se está viendo, no la
 * del instituto: una universidad puede tener un campus en Tijuana y otro en
 * Mérida. Con la vista consolidada puesta se cae a la del instituto y la
 * pantalla lo DICE — pintar dos husos en la misma rejilla es mentir.
 *
 * 🔴 El recorte por sede se aplica en el servidor, con el mismo helper
 * único: la cita se filtra POR SU SILLÓN (`chair: { campusId }`), no por una
 * columna copiada en la cita. Un sillón que se traslada de edificio se
 * lleva sus citas, que es lo que la escuela espera.
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
  const sede = await getEduCampusScope(ctx);
  const cctx = eduWithCampus(ctx, sede);
  const tz = sede.timezone;
  const query = parseEduAgendaQuery(searchParams, tz, now);

  const [page, sillones, alumnos, docentes, programas, pacientes] = await Promise.all([
    listEduAgenda(cctx, query, tz, now),
    listEduChairOptions(cctx),
    // 🔴 P1-4 DE LA AUDITORÍA — EL PADRÓN NO VIAJA AL NAVEGADOR DE QUIEN NO
    // LISTA ALUMNOS. `listEduStudentOptions` devuelve a TODOS los alumnos
    // activos del instituto con su id, su nombre y su matrícula; como es
    // prop de un componente cliente, iba entero en el payload RSC de
    // cualquiera con `agenda.view` — el ALUMNO incluido, que por alcance no
    // lista ni una fila de su generación (padron-core.ts, eduPadronScope).
    // Solo se pinta bajo `canManage` (el alta y el reagendar), así que
    // llevaba el mismo `canManage ? … : []` que sus dos vecinas de abajo
    // desde el primer día. De ahí salían, además, los ids que hacían
    // trivial el P0-1.
    canManage ? listEduStudentOptions(ctx, now) : Promise.resolve([]),
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
              ? "Las citas de la clínica, por sillón."
              : scope.kind === "own"
                ? "Tus citas. Marca aquí cuando el paciente llegue y cuando lo sientes en el sillón."
                : "Las citas de los alumnos que supervisas hoy."}{" "}
            {sede.active
              ? `Estás viendo ${sede.active.name}; las horas están en su hora local (${sede.timezone}).`
              : `Las horas están en la hora del instituto (${sede.timezone}).`}
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

      {/* 🔴 Dos husos en la MISMA rejilla no se pueden pintar sin mentir:
          las 9:00 de una sede y las 9:00 de la otra no son el mismo
          instante, y una columna que las ponga a la misma altura dice que
          sí. En vez de inventarse una conversión que nadie pidió, se avisa
          y se deja elegir sede arriba. */}
      {sede.mixedTimezones && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Estás viendo sedes en husos distintos</p>
            <p className="edu-banner__detail">
              Las horas de abajo están todas en {sede.timezone}, la del instituto — así que
              las de las sedes en otro huso NO son su hora local. Elige una sede arriba para
              ver su agenda con su hora.
            </p>
          </div>
        </div>
      )}

      {sede.locked && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Tu cuenta no tiene ninguna sede</p>
            <p className="edu-banner__detail">
              Alguien te dejó marcado en sedes que ya no existen, así que aquí no hay citas
              que mostrarte. Pídele a la dirección que te dé una sede en Sedes.
            </p>
          </div>
        </div>
      )}

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
