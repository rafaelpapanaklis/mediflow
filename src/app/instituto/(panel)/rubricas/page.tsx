export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduPrograms } from "@/lib/edu/padron";
import { listEduProcedures } from "@/lib/edu/tarifas";
import { listEduRubrics } from "@/lib/edu/rubricas";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduRubricasScreen } from "@/components/edu/evaluacion/rubricas-screen";

export const metadata: Metadata = {
  title: "Rúbricas · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/rubricas — CON QUÉ SE CALIFICA.
 *
 * UNA cerradura y no dos, a diferencia del resto del vertical: una rúbrica
 * no es de nadie —es el criterio COMPARTIDO de la escuela— así que no hay
 * filas que recortar. Lo que sí está recortado es lo que se CALIFICA con
 * ella, que son casos, y ésos pasan por el alcance de siempre.
 *
 * 🔴 "rubricas.manage" es de DIRECCIÓN y no del docente. Si cada docente
 * pudiera editar la rúbrica con la que se le mide a su alumno, la rúbrica
 * dejaría de ser un criterio compartido y pasaría a ser la opinión de
 * quien califica ese día.
 */
export default async function InstitutoRubricasPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "rubricas.manage")) {
    return (
      <EduDenied
        permission="rubricas.manage"
        what="Las rúbricas de evaluación: los criterios con los que se califica un caso y cuánto pesa cada uno."
      />
    );
  }

  const [rows, programs, procedures] = await Promise.all([
    listEduRubrics(ctx),
    listEduPrograms(ctx),
    listEduProcedures(ctx, { soloActivos: true }),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Rúbricas</h1>
          <p className="edu-page__lead">
            Lo que se mira al calificar un caso y cuánto pesa cada cosa. Los pesos suman 100 y la
            escala la decides tú: 1 a 10, 0 a 100, o la que use tu escuela.
          </p>
        </div>
      </header>

      <EduRubricasScreen
        rows={rows}
        programs={programs
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.name }))}
        procedures={procedures.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
        }))}
      />
    </div>
  );
}
