export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient, listEduPatientCaseOptions } from "@/lib/edu/expediente";
import { listEduPatientPhotos } from "@/lib/edu/fotos";
import { EDU_PHOTO_MAX_ROWS } from "@/lib/edu/fotos-core";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { eduTodayISO } from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduFotosScreen } from "@/components/edu/fotos/fotos-screen";

/**
 * /instituto/pacientes/[id]/fotos — LAS FOTOS CLÍNICAS del paciente.
 *
 * 🔴 SEPARADA DE ESTUDIOS, que es exactamente lo que pidió Rafael:
 * «radiografía es radiografía y foto clínica es foto clínica». Son dos
 * tablas, dos tuberías de subida y dos formas de mirarse — una placa se
 * lee sola; una foto clínica solo significa algo al lado de otra.
 *
 * 🔴 DOBLE CANDADO, como las demás pestañas del expediente:
 *   1. PERMISO: `estudios.view` aquí, no solo en la pestaña. Esconder una
 *      pestaña no cierra ninguna puerta — basta con teclear la URL.
 *   2. ALCANCE: el clínico (recurso "cases"). CAJA no ve fotos ni con el
 *      permiso encendido a mano, y un paciente que a este rol no le toca
 *      da 404, igual que uno inventado.
 *
 * 🔴 force-dynamic no es una precaución genérica: las URLs de las fotos
 * son FIRMADAS y caducan. Una página cacheada serviría enlaces muertos, y
 * lo peor es que se verían como «se perdieron las fotos del paciente».
 */
export default async function PacienteFotosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "estudios.view")) {
    return (
      <EduDenied
        permission="estudios.view"
        what="Las fotos clínicas del paciente y el comparador de antes y después."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay fotos que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  const [page, cases] = await Promise.all([
    listEduPatientPhotos(ctx, paciente.id, ctx.institution.timezone),
    listEduPatientCaseOptions(ctx, paciente.id),
  ]);

  return (
    <EduFotosScreen
      patientId={paciente.id}
      rows={page.rows}
      truncated={page.truncated}
      maxRows={EDU_PHOTO_MAX_ROWS}
      cases={cases}
      // Cuándo se firmaron estas URLs. Se sella AQUÍ, en el servidor y
      // justo después de firmarlas, y no al montar el componente: entre
      // que el servidor firma y el navegador pinta puede haber un rato (una
      // pestaña restaurada, una conexión lenta), y ese rato se le comería
      // al aviso de caducidad. Es la misma lección que S-9 en Estudios.
      signedAt={new Date().toISOString()}
      canUpload={hasEduPermission(permUser, "estudios.upload")}
      // HOY en el calendario del INSTITUTO, no en el del navegador: el
      // reloj de un teléfono puede estar en otra zona y en otro día, y la
      // fecha de toma por defecto saldría corrida.
      todayISO={eduTodayISO(ctx.institution.timezone)}
    />
  );
}
