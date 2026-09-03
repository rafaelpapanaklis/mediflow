export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  listEduApprovalHistory,
  listEduApprovalHistoryStudents,
} from "@/lib/edu/autorizaciones";
import {
  EDU_APPROVAL_MAX_ROWS,
  EDU_APPROVAL_NONE_DETAIL,
  parseEduApprovalHistoryFilters,
} from "@/lib/edu/autorizaciones-core";
import { listEduPrograms } from "@/lib/edu/padron";
import { listEduSupervisorOptions } from "@/lib/edu/agenda";
import { eduVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduHistorialScreen } from "@/components/edu/autorizaciones/historial-screen";

export const metadata: Metadata = {
  title: "Historial de autorizaciones · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/autorizaciones/historial — LO QUE YA SE DECIDIÓ.
 *
 * La bandeja se vacía: en cuanto el docente firma, la tarjeta desaparece.
 * Eso está bien para trabajar y es terrible para responder. Esta pantalla
 * es la otra mitad y no se vacía nunca — qué se firmó, qué se rechazó, qué
 * se devolvió con cambios, quién y a qué hora.
 *
 * LAS DOS CERRADURAS, como en todo el vertical:
 *  1. el PERMISO "autorizaciones.view" abre la pantalla (lo tienen
 *     DIRECCIÓN, DOCENTE y ALUMNO; CAJA no);
 *  2. el ALCANCE (visibility.ts, recurso "cases") decide las filas, y es el
 *     MISMO de la bandeja. Encender la key por override no amplía nada: el
 *     alcance no vive en la key.
 *
 * 🔴 LAS OPCIONES DE LOS FILTROS TAMBIÉN SE RECORTAN AQUÍ. Es el hallazgo
 * P1-4 de la auditoría: mandarle el padrón entero al navegador de quien no
 * ve ni una fila es la misma fuga que mandarle las filas. Al DOCENTE le
 * viajan SUS estudiantes vigentes; al ALUMNO, ninguna lista (ni de
 * estudiantes ni de docentes: solo ve lo suyo, y un desplegable con su
 * propio nombre sería ruido).
 *
 * ⚠️ Los filtros viven en la URL, no en un useState: "lo que rechacé de
 * endodoncia en marzo" se comparte pegando el enlace y sobrevive a un
 * refresh. Todo el filtrado ocurre EN LA BASE, dentro del recorte.
 */
export default async function InstitutoAutorizacionesHistorialPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "autorizaciones.view")) {
    return (
      <EduDenied
        permission="autorizaciones.view"
        what="El historial de autorizaciones: lo que se firmó, lo que se rechazó y lo que se devolvió con cambios."
      />
    );
  }

  const scope = eduVisibility(ctx, "cases");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Historial de autorizaciones</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_APPROVAL_NONE_DETAIL}</p>
        </div>
      </div>
    );
  }

  // Un solo `now` para TODAS las consultas: si cada una llamara a
  // new Date(), dos podrían discrepar sobre una asignación recién cerrada
  // y el desplegable enseñaría un alumno que la lista ya no devuelve.
  const now = new Date();
  const filters = parseEduApprovalHistoryFilters(searchParams);
  const canDecide = hasEduPermission(permUser, "autorizaciones.decide");

  const [page, alumnos, programas, docentes] = await Promise.all([
    listEduApprovalHistory(ctx, filters, ctx.institution.timezone, now),
    // Vacío para el ALUMNO por alcance, no por un `if` de la pantalla.
    listEduApprovalHistoryStudents(ctx, now),
    listEduPrograms(ctx),
    // El desplegable de DOCENTE solo tiene sentido con la clínica entera:
    // a un docente le daría la plantilla completa de la escuela (que no
    // necesita para nada: para lo suyo está «Las que decidí yo») y a un
    // alumno, una lista de nombres que no le toca recorrer.
    scope.kind === "all" ? listEduSupervisorOptions(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Historial de autorizaciones</h1>
          <p className="edu-page__lead">
            {scope.kind === "all"
              ? "Todo lo que se decidió en el instituto: firmado, rechazado o devuelto con cambios, con quién lo pidió, quién lo decidió y a qué hora."
              : scope.kind === "supervised"
                ? "Lo que se decidió sobre los casos de tus estudiantes vigentes. Cuando la dirección te asigne o te quite alguno, esta lista lo refleja sola."
                : "Lo que se decidió sobre tus casos: lo que te firmaron, lo que te devolvieron con cambios y lo que te rechazaron, con el motivo escrito."}
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link href="/instituto/autorizaciones" className="edu-btn edu-btn--ghost edu-btn--sm">
            <Inbox size={15} />
            Bandeja
          </Link>
        </div>
      </header>

      <EduHistorialScreen
        rows={page.rows}
        truncated={page.truncated}
        maxRows={EDU_APPROVAL_MAX_ROWS}
        filters={filters}
        alumnos={alumnos}
        docentes={docentes}
        programas={programas.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))}
        puedeFiltrarMias={canDecide}
        recortado={scope.kind !== "all"}
      />
    </div>
  );
}
