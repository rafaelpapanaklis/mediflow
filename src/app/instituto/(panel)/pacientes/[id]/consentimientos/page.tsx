export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { getEduPatient } from "@/lib/edu/pacientes";
import { listEduPatientCaseOptions } from "@/lib/edu/expediente";
import {
  getEduCaseSupervisorNames,
  listEduPatientConsents,
} from "@/lib/edu/consentimientos";
import { eduScopeIsEmpty, eduVisibility } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduConsentimientosScreen } from "@/components/edu/expediente/consentimientos-screen";

/**
 * /instituto/pacientes/[id]/consentimientos — las cartas NOM-004.
 *
 * EXIGE "consentimientos.view" AQUÍ, no solo en la pestaña: esconder la
 * pestaña no cierra ninguna puerta, basta con teclear la URL.
 *
 * 🔴 EL ALCANCE DE ESTA PESTAÑA ES EL DEL PACIENTE, NO EL DEL EXPEDIENTE,
 * y es la única del expediente que lo hace. Es a propósito y hay que
 * saberlo antes de "arreglarlo": la carta se imprime, se entrega en el
 * mostrador y se recoge firmada, así que CAJA tiene que poder verla. Con
 * el alcance del expediente (recurso "cases") caja no vería ni una y no
 * podría hacer su trabajo. Sigue sin ver una sola nota clínica: eso son
 * las otras tres pestañas, que sí usan "cases". La razón larga está en la
 * cabecera de src/lib/edu/consentimientos.ts.
 *
 * ⚠️ Las opciones de CASO que se le pasan a la pantalla —para emitir una
 * carta— sí salen del alcance CLÍNICO. Caja no recibe ninguna, que es
 * coherente: no tiene `consentimientos.create` y no abre expediente.
 */
export default async function PacienteConsentimientosPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "consentimientos.view")) {
    return (
      <EduDenied
        permission="consentimientos.view"
        what="Las cartas de consentimiento informado del paciente: qué se le explicó, qué autorizó y quién responde."
      />
    );
  }

  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay consentimientos que mostrarte</p>
        <p className="edu-empty__detail">
          Tu rol no lista pacientes, así que tampoco sus cartas. Los ven la dirección y caja (todos),
          los docentes (los de sus alumnos vigentes) y cada alumno (los suyos).
        </p>
      </div>
    );
  }

  // Se busca con el mismo alcance con el que se leen las cartas: uno de
  // otra escuela —o de otro alumno— da 404, igual que uno que no existe.
  const paciente = await getEduPatient(ctx, params.id);
  if (!paciente) notFound();

  const [rows, cases, supervisorPorCaso] = await Promise.all([
    listEduPatientConsents(ctx, paciente.id, ctx.institution.timezone),
    listEduPatientCaseOptions(ctx, paciente.id),
    getEduCaseSupervisorNames(ctx, paciente.id),
  ]);

  return (
    <EduConsentimientosScreen
      patientId={paciente.id}
      patientName={eduPatientFullName(paciente)}
      patientAge={paciente.ageYears}
      patientFolio={paciente.folio}
      institutionName={ctx.institution.name}
      institutionCity={ctx.institution.city}
      timezone={ctx.institution.timezone}
      rows={rows}
      cases={cases}
      canCreate={hasEduPermission(permUser, "consentimientos.create")}
      canRevoke={hasEduPermission(permUser, "consentimientos.revoke")}
      supervisorPorCaso={supervisorPorCaso}
    />
  );
}
