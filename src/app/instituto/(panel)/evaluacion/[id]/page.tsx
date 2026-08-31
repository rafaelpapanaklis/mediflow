export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { listEduStudentOptions } from "@/lib/edu/agenda";
import { getEduBitacora } from "@/lib/edu/evaluacion";
import { listEduRubrics } from "@/lib/edu/rubricas";
import { listEduTransferableCases } from "@/lib/edu/traspasos";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduBitacoraScreen } from "@/components/edu/evaluacion/bitacora-screen";

export const metadata: Metadata = {
  title: "Bitácora académica · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/evaluacion/[id] — LA BITÁCORA ACADÉMICA DE UN ALUMNO.
 *
 * Es lo que la dirección enseña en una acreditación: casos, calificaciones,
 * horas clínicas, requisitos cumplidos y traspasos, con su exportación a
 * CSV.
 *
 * 🔴 El alumno se busca DENTRO del alcance (getEduBitacora). Un alumno que
 * teclee el id de un compañero recibe un 404 idéntico al de un alumno que
 * no existe — que es exactamente lo que tiene que verse desde fuera.
 */
export default async function InstitutoBitacoraPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "evaluacion.view")) {
    return (
      <EduDenied
        permission="evaluacion.view"
        what="La bitácora académica de un alumno: sus casos, sus calificaciones, sus horas y lo que le falta."
      />
    );
  }

  const scope = eduVisibility(ctx, "cases");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Bitácora académica</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.cases}</p>
        </div>
      </div>
    );
  }

  const zona = eduSafeTimeZone(ctx.institution.timezone);
  const page = await getEduBitacora(ctx, params.id, zona);
  if (!page) notFound();

  const canGrade = hasEduPermission(permUser, "evaluacion.grade");
  const canTransfer = hasEduPermission(permUser, "traspaso.manage");

  // Las rúbricas se cargan filtradas por la especialidad del alumno: una
  // rúbrica de Ortodoncia en el desplegable de un caso de Endodoncia es
  // una equivocación esperando a pasar. Las que no tienen especialidad
  // salen siempre (son las de la escuela chica que tiene una sola).
  const [rubrics, destinos, traspasables] = await Promise.all([
    canGrade
      ? listEduRubrics(ctx, { onlyActive: true, programId: page.programId })
      : Promise.resolve([]),
    canTransfer ? listEduStudentOptions(ctx) : Promise.resolve([]),
    canTransfer ? listEduTransferableCases(ctx, page.studentId) : Promise.resolve([]),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <Link href="/instituto/evaluacion" className="edu-btn edu-btn--quiet edu-btn--sm">
            <ChevronLeft size={15} />
            Evaluación
          </Link>
          <h1 className="edu-page__title">Bitácora académica</h1>
          <p className="edu-page__lead">
            Todo lo que este alumno ha hecho en la clínica de la escuela, en una pantalla y en un
            archivo. Generada el {page.generatedLabel}.
          </p>
        </div>
      </header>

      <EduBitacoraScreen
        page={page}
        rubrics={rubrics}
        canGrade={canGrade}
        canTransfer={canTransfer}
        // El propio alumno NUNCA es destino de sus casos: traspasárselos a
        // sí mismo cerraría el caso y abriría otro idéntico, que es la
        // definición de no hacer nada dejando rastro.
        destinos={destinos
          .filter((d) => d.id !== page.studentId)
          .map((d) => ({
            id: d.id,
            name: d.name,
            matricula: d.matricula,
            programId: d.programId,
          }))}
        traspasables={traspasables}
        esPropia={ctx.role === "ALUMNO"}
      />
    </div>
  );
}
