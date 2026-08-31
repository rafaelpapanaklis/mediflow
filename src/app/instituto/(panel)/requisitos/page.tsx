export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduPrograms } from "@/lib/edu/padron";
import { listEduProcedures } from "@/lib/edu/tarifas";
import { listEduRequirements } from "@/lib/edu/evaluacion";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduRequisitosScreen } from "@/components/edu/evaluacion/requisitos-screen";

export const metadata: Metadata = {
  title: "Requisitos · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/requisitos — EL PLAN DE ESTUDIOS, EN NÚMEROS.
 *
 * Aquí se captura lo que un alumno tiene que cumplir para cerrar: cuántos
 * de qué, y para cuándo. Lo captura la DIRECCIÓN porque cada escuela tiene
 * su plan — el producto no trae uno de fábrica, y un catálogo de requisitos
 * "sugeridos" sería el plan de otra escuela con el nombre de ésta.
 *
 * 🔴 Y lo que NO se captura aquí: el avance. Ese se cuenta solo, de los
 * casos de cada alumno. Ver el porqué largo en src/lib/edu/evaluacion.ts.
 */
export default async function InstitutoRequisitosPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "requisitos.manage")) {
    return (
      <EduDenied
        permission="requisitos.manage"
        what="Los requisitos del plan de estudios: cuántos casos de cada cosa necesita un alumno para cerrar."
      />
    );
  }

  const [rows, programs, procedures] = await Promise.all([
    listEduRequirements(ctx),
    listEduPrograms(ctx),
    listEduProcedures(ctx, { soloActivos: true }),
  ]);

  // Las categorías salen del catálogo de procedimientos y no de una lista
  // aparte: si se capturaran a mano, un requisito de "Endodoncia" y unos
  // procedimientos de "endodoncia " (con espacio) contarían cero para
  // siempre sin que nadie supiera por qué.
  const categories = Array.from(
    new Set(
      procedures
        .map((p) => (p.category ?? "").trim())
        .filter((c) => c.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "es"));

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Requisitos</h1>
          <p className="edu-page__lead">
            Cuántos casos de cada cosa necesita un alumno para cerrar. Cuántos lleva NO se captura
            aquí ni en ningún lado: se cuenta de sus casos cada vez que alguien pregunta.
          </p>
        </div>
      </header>

      <EduRequisitosScreen
        rows={rows}
        programs={programs
          .filter((p) => p.isActive)
          .map((p) => ({
            id: p.id,
            name: p.name,
            durationSemesters: p.durationSemesters,
          }))}
        procedures={procedures.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
        }))}
        categories={categories}
      />
    </div>
  );
}
