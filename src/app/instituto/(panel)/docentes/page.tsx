export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduCurrentAssignments, listEduTeachers } from "@/lib/edu/padron";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduDocentesScreen } from "@/components/edu/padron/docentes-screen";

export const metadata: Metadata = {
  title: "Docentes · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/docentes — la lista de docentes y su carga de hoy.
 *
 * EXIGE "docentes.view". Los docentes lo tienen por defecto: saber con
 * quién se comparte el piso clínico es parte del trabajo, no un privilegio
 * de la dirección.
 *
 * El número de alumnos es de HOY (asignaciones vigentes). Ese matiz es
 * TODO: un conteo sin vigencia suma las generaciones que ese docente
 * entregó hace años y la dirección reparte la carga con un dato falso.
 */
export default async function InstitutoDocentesPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "docentes.view")) {
    return (
      <EduDenied
        permission="docentes.view"
        what="Aquí se ve quién da clase en el instituto y cuántos alumnos supervisa cada quien."
      />
    );
  }

  const canAssign = hasEduPermission(permUser, "supervision.assign");

  // Un solo `now` para las dos consultas: si cada una llamara a new Date(),
  // el conteo y la lista podrían discrepar sobre una asignación cerrada
  // entre una y otra.
  const now = new Date();
  const [docentes, asignaciones] = await Promise.all([
    listEduTeachers(ctx, now),
    listEduCurrentAssignments(ctx, now),
  ]);

  const total = docentes.reduce((n, d) => n + d.currentStudents, 0);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Docentes</h1>
          <p className="edu-page__lead">
            {docentes.length} {docentes.length === 1 ? "docente" : "docentes"} y {total}{" "}
            {total === 1 ? "supervisión vigente" : "supervisiones vigentes"}. El conteo es de hoy:
            las asignaciones cerradas siguen en el historial, pero no suman aquí.
          </p>
        </div>
      </header>

      <EduDocentesScreen teachers={docentes} assignments={asignaciones} canAssign={canAssign} />
    </div>
  );
}
