export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_TEAM_MAX_ROWS, parseEduTeamFilters } from "@/lib/edu/equipo-core";
import { listEduTeam } from "@/lib/edu/equipo";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduEquipoScreen } from "@/components/edu/equipo/equipo-screen";

export const metadata: Metadata = {
  title: "Equipo · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/equipo — las cuentas del instituto.
 *
 * Ésta es la pantalla que faltaba para que el producto se pudiera usar.
 * Hasta la Ola 1B no había forma de crear un alumno, un docente ni un
 * cajero desde el panel: la única vía era un INSERT a mano en Supabase, y
 * el padrón decía "las cuentas se dan de alta aparte" sin que existiera
 * ningún "aparte".
 *
 * EXIGE "equipo.manage" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL. Y lo vuelven
 * a exigir los dos endpoints, porque una página no protege a una API.
 *
 * Los filtros viajan en la URL (?rol=&estado=&q=) como en el padrón y en
 * pacientes: se comparten, sobreviven a un refresh, y el buscador filtra en
 * la BASE — en memoria mentiría en cuanto el equipo pase del techo de
 * filas.
 */
export default async function InstitutoEquipoPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "equipo.manage")) {
    return (
      <EduDenied
        permission="equipo.manage"
        what="Aquí se dan de alta las cuentas del instituto —dirección, docentes, estudiantes y caja— y se dan de baja las que ya no se usan."
      />
    );
  }

  const filters = parseEduTeamFilters(searchParams);
  const page = await listEduTeam(ctx, filters);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Equipo</h1>
          <p className="edu-page__lead">
            Todas las cuentas del instituto. Al dar de alta a alguien se le crea el acceso y se
            muestra su contraseña temporal <strong>una sola vez</strong>: cópiala antes de cerrar.
          </p>
        </div>
      </header>

      <EduEquipoScreen
        rows={page.rows}
        truncated={page.truncated}
        maxRows={EDU_TEAM_MAX_ROWS}
        filters={filters}
      />
    </div>
  );
}
