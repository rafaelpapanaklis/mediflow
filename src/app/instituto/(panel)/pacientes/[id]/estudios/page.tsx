export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient, listEduPatientCaseOptions } from "@/lib/edu/expediente";
import { listEduPatientStudies } from "@/lib/edu/estudios";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { eduIaEstadoActual } from "@/lib/edu/ia-cupo";
import { getDict } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/t";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduEstudiosScreen } from "@/components/edu/expediente/estudios-screen";

/**
 * Ola 12 — el TROZO de diccionario que necesita el visor de mallas 3D del
 * dental (Model3DViewer lee sus textos con useT). Se recorta AQUÍ, en el
 * servidor, para que al navegador viaje solo `patients.models3d` y no el
 * diccionario entero del panel dental. Siempre en español: el vertical no
 * está en i18n (feedback_i18n_solo_en_dashboard).
 */
function dictModelos3d(): Dictionary {
  const dict = getDict("es");
  const patients = dict.patients;
  const models3d =
    patients && typeof patients === "object" ? (patients as Dictionary).models3d : undefined;
  return { patients: { models3d: models3d && typeof models3d === "object" ? models3d : {} } };
}

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
export default async function PacienteEstudiosPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
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
      dict3d={dictModelos3d()}
      // El botón "Subir estudio" de la ficha llega con ?subir=1 y el modal
      // se abre solo. El permiso manda igual: sin estudios.upload se ignora.
      abrirSubida={searchParams?.subir === "1"}
    />
  );
}
