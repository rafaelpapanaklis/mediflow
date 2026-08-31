export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import { listEduPatientRecetas } from "@/lib/edu/recetas";
import { EDU_RECETA_NONE_DETAIL } from "@/lib/edu/recetas-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduRecetasScreen } from "@/components/edu/recetas/recetas-screen";

/**
 * Pestaña RECETAS: las recetas del paciente que le tocan a quien mira.
 *
 * 🔴 EL DISEÑO ENTERO EN UNA LÍNEA: un alumno de especialidad no tiene
 * cédula profesional, así que aquí PROPONE la receta y quien la EXPIDE
 * (desde su bandeja de autorizaciones, con su cédula) es el docente.
 * Una PENDIENTE o RECHAZADA no se imprime ni se entrega.
 *
 * DOS CERRADURAS, como en todo el vertical:
 *  1. el PERMISO "recetas.view" abre la pestaña;
 *  2. el ALCANCE (recurso "cases") decide las filas. Para CAJA no hay
 *     ninguna pase lo que pase — una receta es un documento clínico, no
 *     un cobro — y el alumno ve las de SUS casos.
 */
export default async function PacienteRecetasPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "recetas.view")) {
    return (
      <EduDenied
        permission="recetas.view"
        what="Las recetas del paciente: las que el alumno propone y las que el docente ya expidió con su cédula."
      />
    );
  }

  const p = await getEduPatient(ctx, params.id);
  if (!p) notFound();

  const scope = eduClinicalScope(ctx);
  if (scope.kind === "none") {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
        <p className="edu-empty__detail">{EDU_RECETA_NONE_DETAIL}</p>
      </div>
    );
  }

  const data = await listEduPatientRecetas(ctx, p.id, ctx.institution.timezone);

  return (
    <EduRecetasScreen
      patientId={p.id}
      rows={data.rows}
      cases={data.cases}
      canPropose={hasEduPermission(permUser, "recetas.propose")}
      canVoid={hasEduPermission(permUser, "recetas.void")}
    />
  );
}
