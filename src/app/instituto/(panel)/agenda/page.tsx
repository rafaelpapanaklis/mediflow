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

  // ── Ola 12 · LA PARRILLA ES DE QUIEN VE EL DÍA ENTERO ────────────────
  // A un ALUMNO esta pantalla le salía como columnas por sillón llenas de
  // "Sin citas" que no eran suyas — ruido, no una agenda. Y a un DOCENTE
  // tampoco le sirve: lo suyo es el día de sus alumnos. Quien llega con el
  // alcance recortado se va a SU pantalla (/mi-dia, "Mi agenda"), que
  // enseña lo mismo con la forma correcta. No es un castigo ni un permiso:
  // los DATOS que vería aquí son exactamente los que ve allá — el recorte
  // lo hace el mismo helper en las dos.
  if (scope.kind === "own" || scope.kind === "supervised") {
    redirect("/instituto/mi-dia");
  }

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
    // 🔴 P1-4 DE LA AUDITORÍA — LA LISTA DE ALUMNOS NO VIAJA AL NAVEGADOR
    // DE QUIEN NO LA USA. Solo se pinta bajo `canManage` (el alta y el
    // reagendar), así que lleva el mismo `canManage ? … : []` que sus dos
    // vecinas de abajo. De aquí salían, además, los ids que hacían trivial
    // el P0-1. Desde la ola de cierre `listEduStudentOptions` además se
    // recorta SOLA por el alcance de "patients" (agenda.ts) — este guard se
    // queda como lo que es: no consultar lo que la pantalla no va a pintar.
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
            {/* Ola 12: a esta pantalla solo llega quien ve el día ENTERO
                (alcance "all") — los alcances recortados se redirigieron a
                /mi-dia más arriba, así que aquí ya no hay copys por rol. */}
            Las citas de la clínica, por sillón.{" "}
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
