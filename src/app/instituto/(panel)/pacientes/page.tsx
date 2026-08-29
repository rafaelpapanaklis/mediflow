export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICA_MAX_ROWS } from "@/lib/edu/agenda-core";
import { parseEduPatientFilters } from "@/lib/edu/pacientes-core";
import { listEduPatients } from "@/lib/edu/pacientes";
import { listEduStudentOptions } from "@/lib/edu/agenda";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacientesScreen } from "@/components/edu/clinica/pacientes-screen";

export const metadata: Metadata = {
  title: "Pacientes · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/pacientes — los pacientes de la clínica de la escuela.
 *
 * EXIGE "pacientes.view" AQUÍ, no solo en el menú: esconder el item del
 * sidebar no cierra ninguna puerta, basta con teclear la URL.
 *
 * 🔴 EL RECORTE SE HACE EN EL SERVIDOR, con el helper único de
 * src/lib/edu/visibility.ts. `listEduPatients` resuelve el alcance por su
 * cuenta y el componente cliente no tiene forma de pedir más filas: recibe
 * las que le tocan y punto. Si el recorte viviera en el navegador, sería
 * una cortina, no un muro.
 */
export default async function InstitutoPacientesPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "pacientes.view")) {
    return (
      <EduDenied
        permission="pacientes.view"
        what="Los pacientes de la clínica: su folio, su contacto, en qué estado están y quién los trajo."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "pacientes.manage");
  const canOrigin = hasEduPermission(permUser, "pacientes.origen");
  const scope = eduVisibility(ctx, "patients");

  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Pacientes</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay pacientes que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.patients}</p>
        </div>
      </div>
    );
  }

  // Un solo `now` para TODAS las consultas de esta pantalla: si cada una
  // llamara a new Date(), dos podrían discrepar sobre si una asignación que
  // acaba de cerrarse sigue vigente.
  const now = new Date();
  const filters = parseEduPatientFilters(searchParams);

  const [page, alumnos] = await Promise.all([
    listEduPatients(ctx, filters, now),
    listEduStudentOptions(ctx, now),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Pacientes</h1>
          <p className="edu-page__lead">
            {scope.kind === "all"
              ? "Todos los pacientes de la clínica. Quién trajo a cada uno se marca aquí, y en la Ola 5 decidirá su tarifa."
              : scope.kind === "own"
                ? "Los pacientes que atiendes: los de tus casos y los de tus citas."
                : "Los pacientes de los alumnos que supervisas hoy. Cuando la dirección te asigne o te quite alguno, esta lista lo refleja sola."}
          </p>
        </div>
      </header>

      <EduPacientesScreen
        rows={page.rows}
        truncated={page.truncated}
        maxRows={EDU_CLINICA_MAX_ROWS}
        filters={filters}
        students={alumnos}
        canManage={canManage}
        canOrigin={canOrigin}
      />
    </div>
  );
}
