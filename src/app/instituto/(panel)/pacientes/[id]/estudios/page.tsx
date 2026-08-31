export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient, listEduPatientCaseOptions } from "@/lib/edu/expediente";
import { listEduPatientStudies } from "@/lib/edu/estudios";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { eduIaEstadoActual } from "@/lib/edu/ia-cupo";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduEstudiosScreen } from "@/components/edu/expediente/estudios-screen";

/**
 * /instituto/pacientes/[id]/estudios — radiografías, tomografías, fotos y
 * PDFs del paciente.
 *
 * EXIGE "estudios.view" AQUÍ, no solo en la pestaña.
 *
 * 🔴 force-dynamic no es una precaución genérica: las URLs de los archivos
 * son FIRMADAS y caducan. Una página cacheada serviría enlaces muertos, y
 * lo peor es que se verían como "el archivo se perdió".
 */
export default async function PacienteEstudiosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "estudios.view")) {
    return (
      <EduDenied
        permission="estudios.view"
        what="Los estudios del paciente: radiografías, tomografías, fotos intraorales y reportes."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay estudios que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  const [rows, cases, iaAnalisis] = await Promise.all([
    listEduPatientStudies(ctx, paciente.id, ctx.institution.timezone),
    listEduPatientCaseOptions(ctx, paciente.id),
    // El estado de la IA lo resuelve el SERVIDOR (Ola 3B), y desde la Ola 8
    // mira además el CUPO del instituto: cuánto se lleva del mes y si
    // queda. El navegador no tiene por qué saber el presupuesto de la
    // escuela — recibe el estado ya decidido, con el motivo escrito.
    eduIaEstadoActual(ctx, "ANALISIS", ctx.institution.timezone),
  ]);

  return (
    <EduEstudiosScreen
      patientId={paciente.id}
      rows={rows}
      cases={cases}
      canUpload={hasEduPermission(permUser, "estudios.upload")}
      iaAnalisis={iaAnalisis}
      canAnalyze={hasEduPermission(permUser, "estudios.analyze")}
    />
  );
}
