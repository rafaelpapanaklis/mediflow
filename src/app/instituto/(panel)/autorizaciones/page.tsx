export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduApprovalInbox } from "@/lib/edu/autorizaciones";
import {
  EDU_APPROVAL_MAX_ROWS,
  EDU_APPROVAL_NONE_DETAIL,
  eduGroupApprovalsByStudent,
} from "@/lib/edu/autorizaciones-core";
import { eduVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduBandejaScreen } from "@/components/edu/autorizaciones/bandeja-screen";

export const metadata: Metadata = {
  title: "Autorizaciones · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/autorizaciones — LA BANDEJA DEL DOCENTE.
 *
 * Es la pantalla más importante de la Ola 4 y la que peor se diseña sola: se
 * usa DE PIE, CON GUANTES, EN UN TELÉFONO, con un paciente en el sillón
 * esperando. Todo lo que la aleja de eso —una tabla, un filtro, un modal de
 * confirmación— la convierte en algo que se consulta al final del día. Y una
 * autorización que se firma al final del día es un paciente que se fue sin
 * tratamiento.
 *
 * DOS CERRADURAS, como en todo el vertical:
 *  1. el PERMISO "autorizaciones.view" abre la pantalla;
 *  2. el ALCANCE (visibility.ts, recurso "cases") decide las filas. Para
 *     CAJA no hay ninguna pase lo que pase; un DOCENTE ve las de los alumnos
 *     que supervisa HOY y un ALUMNO las suyas.
 *
 * ⚠️ La misma pantalla sirve para el ALUMNO sin una regla nueva: ve lo que
 * mandó y sigue esperando, sin los botones de decidir (que exigen
 * "autorizaciones.decide", una key que un alumno no tiene). Esconder los
 * botones no cierra nada — lo que cierra es el guard del endpoint.
 */
export default async function InstitutoAutorizacionesPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "autorizaciones.view")) {
    return (
      <EduDenied
        permission="autorizaciones.view"
        what="La bandeja de autorizaciones: lo que los estudiantes mandaron a firmar y sigue esperando."
      />
    );
  }

  const scope = eduVisibility(ctx, "cases");
  if (scope.kind === "none") {
    return (
      <div className="edu-page">
        <header>
          <h1 className="edu-page__title">Autorizaciones</h1>
        </header>
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
          <p className="edu-empty__detail">{EDU_APPROVAL_NONE_DETAIL}</p>
        </div>
      </div>
    );
  }

  const canDecide = hasEduPermission(permUser, "autorizaciones.decide");
  // ── Ola 14 · recetas en la misma bandeja ─────────────────────────────
  // Decidir una RECETA exige además "recetas.issue" (expedirla pone la
  // cédula del firmante en el papel); la pantalla lo recibe para no pintar
  // botones que el endpoint va a rebotar. Y la cédula guardada viaja para
  // PREllenar el campo al expedir — el valor con el que se firma es el que
  // el docente ve y confirma en ese momento, nunca uno invisible.
  const canIssueRecetas = hasEduPermission(permUser, "recetas.issue");
  const issueCedula = ctx.user.cedulaProfesional ?? null;
  const page = await listEduApprovalInbox(ctx, ctx.institution.timezone);
  // El agrupado es PURO y corre en el servidor: la pantalla recibe los
  // grupos hechos y no tiene que decidir nada sobre el orden. Que las
  // urgencias van primero no puede depender de un `sort` del navegador.
  const groups = eduGroupApprovalsByStudent(page.rows);
  const urgencias = page.rows.filter((r) => r.isEmergency).length;

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Autorizaciones</h1>
          <p className="edu-page__lead">
            {canDecide
              ? "Lo que tus estudiantes mandaron a firmar, agrupado por estudiante y en orden de llegada. Las urgencias van primero: ésas ya ocurrieron y hay que leerlas."
              : "Lo que mandaste a autorización y sigue esperando la firma de tu docente."}
          </p>
        </div>
      </header>

      <EduBandejaScreen
        groups={groups}
        total={page.rows.length}
        emergencies={urgencias}
        truncated={page.truncated}
        maxRows={EDU_APPROVAL_MAX_ROWS}
        canDecide={canDecide}
        canIssueRecetas={canIssueRecetas}
        issueCedula={issueCedula}
        viewerRole={ctx.role}
      />
    </div>
  );
}
