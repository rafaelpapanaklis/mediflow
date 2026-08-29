export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { listEduOdontogram } from "@/lib/edu/odontograma";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduOdontogramaScreen } from "@/components/edu/expediente/odontograma-screen";

/**
 * /instituto/pacientes/[id]/odontograma
 *
 * EXIGE "odontograma.view" AQUÍ, no solo en la pestaña.
 *
 * 🔴 Y EL ALCANCE, que es otra cosa: el odontograma cuelga del PACIENTE en
 * la base (la boca es una sola) pero se lee con el alcance del recurso
 * "cases". Para CAJA eso es "none". Si se leyera con el de "patients" —el
 * que "parece" natural porque es de donde cuelga— caja vería el
 * odontograma de la escuela entera con solo encenderse un permiso.
 */
export default async function PacienteOdontogramaPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "odontograma.view")) {
    return (
      <EduDenied
        permission="odontograma.view"
        what="El odontograma del paciente: qué tiene cada diente y quién lo marcó."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay odontograma que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  const entries = await listEduOdontogram(ctx, paciente.id, ctx.institution.timezone);

  return (
    <EduOdontogramaScreen
      patientId={paciente.id}
      entries={entries}
      canEdit={hasEduPermission(permUser, "odontograma.edit")}
    />
  );
}
