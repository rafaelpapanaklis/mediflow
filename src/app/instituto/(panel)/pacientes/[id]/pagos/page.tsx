export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { listEduPatientPlanes } from "@/lib/edu/pagos";
import { eduVisibility, EDU_VISIBILITY_NONE_DETAIL } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacientePagos } from "@/components/edu/dinero/planes-screen";

/**
 * /instituto/pacientes/[id]/pagos — los pagos a meses de ESTE paciente:
 * sus mensualidades, lo que debe y cuándo.
 *
 * EXIGE "caja.view" AQUÍ, no en una pestaña: es la vista de DINERO de la
 * ficha, y quien la usa es el mostrador (caja y dirección). El ALUMNO no
 * la ve por partida doble, y la segunda cerradura es la que manda: aunque
 * alguien le encienda "caja.view" a mano, el alcance de "charges" sigue
 * diciendo "ninguna fila" — un residente no sabe cuánto paga su paciente.
 *
 * ⚠️ Esta ruta vive DENTRO del layout de la ficha (hereda encabezado y
 * pestañas) pero NO está en la lista de pestañas del layout: esa lista la
 * está rehaciendo otra ola en paralelo y este encargo no toca la ficha.
 * Se llega desde Caja → Pagos a meses ("Ver al paciente") y por URL; el
 * enlace de pestaña es UNA línea al final de `definicion` cuando toque
 * integrar.
 */
export default async function PacientePagosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "caja.view")) {
    return (
      <EduDenied
        permission="caja.view"
        what="Los pagos a meses del paciente: sus mensualidades, lo que debe y cuándo."
      />
    );
  }

  if (eduVisibility(ctx, "charges").kind === "none") {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay nada que mostrarte</p>
        <p className="edu-empty__detail">{EDU_VISIBILITY_NONE_DETAIL.charges}</p>
      </div>
    );
  }

  // Se busca con el alcance de siempre: un paciente de otra escuela da
  // 404, igual que uno que no existe.
  const paciente = await getEduPatient(ctx, params.id);
  if (!paciente) notFound();

  const canCharge = hasEduPermission(permUser, "caja.charge");
  const canRefund = hasEduPermission(permUser, "caja.refund");
  const page = await listEduPatientPlanes(ctx, ctx.institution.timezone, paciente.id);

  return (
    <EduPacientePagos page={page} canCharge={canCharge} canRefund={canRefund} />
  );
}
