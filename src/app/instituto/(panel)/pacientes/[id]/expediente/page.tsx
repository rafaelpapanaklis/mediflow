export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import {
  EDU_CLINICAL_NONE_DETAIL,
  eduClinicalScope,
} from "@/lib/edu/expediente-core";
import {
  getEduClinicalPatient,
  listEduPatientCaseOptions,
  listEduPatientRecords,
} from "@/lib/edu/expediente";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduExpedienteScreen } from "@/components/edu/expediente/expediente-screen";

/**
 * /instituto/pacientes/[id]/expediente — las notas clínicas del paciente.
 *
 * EXIGE "expediente.view" AQUÍ, no solo en la pestaña: esconder la pestaña
 * no cierra ninguna puerta, basta con teclear la URL.
 *
 * 🔴 Y ADEMÁS EL ALCANCE, que es otra cosa. El permiso abre la pantalla; el
 * alcance decide las filas. Para CAJA el alcance del expediente (recurso
 * "cases") es "none": aunque la dirección le encendiera `expediente.view`
 * por error, aquí no vería ni el paciente. Son dos candados, y hacen falta
 * los dos — uno solo se abre por accidente.
 */
export default async function PacienteExpedientePage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "expediente.view")) {
    return (
      <EduDenied
        permission="expediente.view"
        what="El expediente clínico del paciente: las notas de cada sesión, con su autor y su firma."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay expediente que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  const [rows, cases] = await Promise.all([
    listEduPatientRecords(ctx, paciente.id, ctx.institution.timezone),
    listEduPatientCaseOptions(ctx, paciente.id),
  ]);

  return (
    <EduExpedienteScreen
      patientId={paciente.id}
      patientName={eduPatientFullName(paciente)}
      rows={rows}
      cases={cases}
      canWrite={hasEduPermission(permUser, "expediente.write")}
      meUserId={ctx.eduUserId}
    />
  );
}
