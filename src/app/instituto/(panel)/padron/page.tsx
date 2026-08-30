export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_PADRON_MAX_ROWS, parseEduPadronFilters } from "@/lib/edu/padron-core";
import {
  listEduCohorts,
  listEduEnrollableUsers,
  listEduPrograms,
  listEduStudents,
  listEduTeachers,
} from "@/lib/edu/padron";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPadronScreen } from "@/components/edu/padron/padron-screen";

export const metadata: Metadata = {
  title: "Padrón · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/padron — el padrón de alumnos.
 *
 * EXIGE "padron.view" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL.
 *
 * 🔴 EL RECORTE DEL DOCENTE SE HACE EN EL SERVIDOR. `listEduStudents`
 * resuelve el alcance por su cuenta (eduPadronScope) y el componente
 * cliente no tiene forma de pedir más filas: recibe las que le tocan y
 * punto. Si el recorte viviera en el navegador, sería una cortina, no un
 * muro.
 *
 * Los filtros viajan en la URL para que se puedan compartir y sobrevivan a
 * un refresh, y se aplican en la BASE: filtrar en memoria mentiría en
 * cuanto el padrón pase del techo de filas.
 */
export default async function InstitutoPadronPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "padron.view")) {
    return (
      <EduDenied
        permission="padron.view"
        what="El padrón lista a los alumnos del instituto con su generación, su semestre y el docente que los supervisa."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "padron.manage");
  const canAssign = hasEduPermission(permUser, "supervision.assign");
  // Para que el diálogo de inscripción sepa si puede mandar a /instituto/
  // equipo o solo explicar a quién pedírselo. La pantalla de equipo vuelve
  // a exigir el permiso: esto decide qué se PINTA, no qué se puede hacer.
  const canManageTeam = hasEduPermission(permUser, "equipo.manage");
  const canSeeTeachers = canAssign || hasEduPermission(permUser, "docentes.view");

  // Un solo `now` para TODAS las consultas de esta pantalla: si cada una
  // llamara a new Date(), dos consultas podrían discrepar sobre si una
  // asignación que acaba de cerrarse sigue vigente.
  const now = new Date();
  const filters = parseEduPadronFilters(searchParams);

  const [page, programas, generaciones, docentes, inscribibles] = await Promise.all([
    listEduStudents(ctx, filters, now),
    listEduPrograms(ctx),
    listEduCohorts(ctx),
    canSeeTeachers ? listEduTeachers(ctx, now) : Promise.resolve([]),
    canManage ? listEduEnrollableUsers(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Padrón</h1>
          <p className="edu-page__lead">
            {page.scope.kind === "supervised"
              ? "Los alumnos que supervisas hoy. Cuando la dirección te asigne o te quite alguno, esta lista lo refleja sola."
              : "Todos los alumnos del instituto, con su generación, su semestre y el docente que los supervisa."}
          </p>
        </div>
        {canManage && (
          <div className="edu-pagehead__actions">
            <Link href="/instituto/padron/estructura" className="edu-btn edu-btn--ghost edu-btn--sm">
              Especialidades y generaciones
            </Link>
          </div>
        )}
      </header>

      <EduPadronScreen
        rows={page.rows}
        truncated={page.truncated}
        scopeKind={page.scope.kind}
        filters={filters}
        maxRows={EDU_PADRON_MAX_ROWS}
        canManage={canManage}
        canAssign={canAssign}
        canManageTeam={canManageTeam}
        programs={programas.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          isActive: p.isActive,
        }))}
        cohorts={generaciones.map((c) => ({
          id: c.id,
          name: c.name,
          programId: c.programId,
          isActive: c.isActive,
        }))}
        teachers={docentes.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive }))}
        enrollables={inscribibles}
      />
    </div>
  );
}
