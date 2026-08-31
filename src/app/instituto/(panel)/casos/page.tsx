export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICA_MAX_ROWS } from "@/lib/edu/agenda-core";
import { parseEduCasosPanelFilters } from "@/lib/edu/casos-core";
import { listEduCasosPanel } from "@/lib/edu/casos";
import { listEduPrograms, listEduCurrentAssignments } from "@/lib/edu/padron";
import { listEduStudentOptions, listEduSupervisorOptions } from "@/lib/edu/agenda";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCasosScreen } from "@/components/edu/casos/casos-screen";

export const metadata: Metadata = {
  title: "Casos · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/casos — TODOS los casos de la clínica (ola de Casos).
 *
 * Hasta esta ola un caso solo se veía entrando al paciente: la dirección
 * no podía contestar "¿cuántos casos de endodoncia están atorados en
 * firma?" sin abrir fichas una por una. Esta pantalla es esa respuesta:
 * paciente, alumno, docente, especialidad, generación, apertura, estado y
 * QUÉ ESTÁ ESPERANDO cada caso — con filtros, buscador y export.
 *
 * EXIGE "casos.view" AQUÍ, no solo en el menú: esconder el item no cierra
 * ninguna puerta, basta con teclear la URL.
 *
 * 🔴 EL RECORTE SE HACE EN EL SERVIDOR con el helper único de
 * visibility.ts (recurso "cases"): el ALUMNO ve los suyos —incluidos los
 * transferidos, que son su historia—, el DOCENTE los de sus alumnos
 * vigentes, DIRECCIÓN todos y CAJA ninguno. Para caja está cerrado DOS
 * veces: sin `casos.view` por default, y con alcance "none" aunque
 * alguien le encienda el permiso por error — el bloque de abajo se lo
 * dice con palabras en vez de enseñarle una tabla vacía que miente.
 *
 * 🔴 Las OPCIONES de los filtros también se recortan aquí (P1-4): a un
 * docente le viajan SUS alumnos vigentes, no el padrón; a un alumno no le
 * viaja ninguna lista.
 */
export default async function InstitutoCasosPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "casos.view")) {
    return (
      <EduDenied
        permission="casos.view"
        what="Los casos clínicos de la escuela: qué paciente, con qué alumno, en qué especialidad y qué está esperando cada uno."
      />
    );
  }

  const scope = eduVisibility(ctx, "cases");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Casos</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay casos que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.cases}</p>
        </div>
      </div>
    );
  }

  // Un solo `now` para TODAS las consultas: si cada una llamara a
  // new Date(), dos podrían discrepar sobre una asignación recién cerrada.
  const now = new Date();
  const filters = parseEduCasosPanelFilters(searchParams);

  const [page, programas, alumnos, docentes] = await Promise.all([
    listEduCasosPanel(ctx, filters, ctx.institution.timezone, now),
    listEduPrograms(ctx),
    // Alumnos para el filtro, por ALCANCE: dirección ve el padrón activo,
    // un docente SOLO sus vigentes, un alumno ninguno (sus casos ya son
    // suyos — un select con su propio nombre es ruido).
    scope.kind === "all"
      ? listEduStudentOptions(ctx, now).then((rows) =>
          rows.map((a) => ({ id: a.id, matricula: a.matricula, name: a.name })),
        )
      : scope.kind === "supervised"
        ? listEduCurrentAssignments(ctx, now, ctx.eduUserId).then((rows) =>
            rows.map((a) => ({ id: a.studentId, matricula: a.matricula, name: a.name })),
          )
        : Promise.resolve([]),
    // El filtro de docente solo tiene sentido con la clínica entera: un
    // docente ya está mirando lo suyo, y a un alumno le daría una lista de
    // nombres que no le toca recorrer.
    scope.kind === "all" ? listEduSupervisorOptions(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Casos</h1>
          <p className="edu-page__lead">
            {scope.kind === "all"
              ? "Todos los casos de la clínica, con qué está esperando cada uno: una firma, un alta, o nada. Es la vista de la clínica entera."
              : scope.kind === "own"
                ? "Tus casos, incluidos los que ya entregaste: son tu historia académica."
                : "Los casos de tus alumnos vigentes. Cuando la dirección te asigne o te quite alguno, esta lista lo refleja sola."}
          </p>
        </div>
      </header>

      <EduCasosScreen
        rows={page.rows}
        truncated={page.truncated}
        maxRows={EDU_CLINICA_MAX_ROWS}
        filters={filters}
        recortado={scope.kind !== "all"}
        programas={programas.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))}
        alumnos={alumnos}
        docentes={docentes}
      />
    </div>
  );
}
