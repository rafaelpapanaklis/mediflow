export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import {
  EDU_CLINICAL_NONE_DETAIL,
  EDU_RECORD_MAX_ROWS,
  eduClinicalScope,
} from "@/lib/edu/expediente-core";
import {
  getEduClinicalPatient,
  listEduPatientCaseOptions,
  listEduPatientRecords,
  listEduPatientRecordsRetiradas,
  registrarEduLecturaExpediente,
} from "@/lib/edu/expediente";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { eduIaEstadoActual } from "@/lib/edu/ia-cupo";
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
export default async function PacienteExpedientePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
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

  // H-20 · EL FILTRO POR CASO QUE EL BANNER PROMETÍA.
  //
  // El aviso de "se muestran las 200 más recientes" decía —y sigue
  // diciendo— "filtra por caso para ver las notas viejas". La API leía
  // `?caso=` desde el primer día; esta página no le pasaba `searchParams`,
  // así que era una instrucción imposible de seguir puesta delante de un
  // dato clínico que falta. El id se valida contra los casos que le tocan a
  // quien mira: uno inventado no recorta nada raro, simplemente no está.
  const casoParam = typeof searchParams?.caso === "string" ? searchParams.caso : "";

  const canWrite = hasEduPermission(permUser, "expediente.write");

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 NOM-024 §6.3.5 · SE REGISTRA QUE ALGUIEN **ABRIÓ** EL EXPEDIENTE.
  //
  // Es la mitad que siempre falta y la que la norma pide con nombre
  // propio: una bitácora que solo apunta escrituras contesta «¿quién
  // cambió esto?» y no contesta «¿quién leyó el expediente de mi
  // paciente?», que es con la que llega una queja de privacidad. El dental
  // ya lo hace en el `page.tsx` de su ficha (fila 21 del informe).
  //
  // Va AQUÍ y no dentro de `listEduPatientRecords` a propósito: esa lista
  // la usan también el Resumen y la bandeja del docente, y registrar una
  // lectura por cada uso llenaría la bitácora de renglones que no son
  // «alguien abrió el expediente». Lo que la norma quiere registrar es el
  // ACCESO, y el acceso es esta pantalla.
  //
  // `eduAudit` NUNCA lanza: abrir un expediente no puede fallar porque no
  // se pudo escribir el renglón que dice que se abrió.
  // ═══════════════════════════════════════════════════════════════════
  const h = headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  await registrarEduLecturaExpediente(ctx, paciente.id, {
    ip: (fwd.split(",")[0]?.trim() || h.get("x-real-ip") || null)?.slice(0, 60) ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });

  const [page, cases, iaDictado, retiradas] = await Promise.all([
    listEduPatientRecords(ctx, paciente.id, ctx.institution.timezone, { caseId: casoParam }),
    listEduPatientCaseOptions(ctx, paciente.id),
    // 🔴 Se resuelve AQUÍ, en el servidor, y desde la Ola 8 mira además el
    // CUPO del instituto (una fila de EduAiQuota + la suma del mes). El
    // navegador no puede decidirlo: ni ve `process.env` ni tiene por qué
    // saber cuánto le queda de presupuesto a la escuela. Llega ya decidido
    // y con el motivo escrito para una persona.
    eduIaEstadoActual(ctx, "DICTADO", ctx.institution.timezone),
    // Solo para quien puede RETIRAR: quien no puede tampoco necesita el
    // registro de quién retiró qué. Es el mismo criterio que «Retirados»
    // en Estudios, y con el `if` delante la consulta ni se hace.
    canWrite
      ? listEduPatientRecordsRetiradas(ctx, paciente.id, ctx.institution.timezone)
      : Promise.resolve([]),
  ]);

  return (
    <EduExpedienteScreen
      patientId={paciente.id}
      patientName={eduPatientFullName(paciente)}
      rows={page.rows}
      truncated={page.truncated}
      maxRows={EDU_RECORD_MAX_ROWS}
      cases={cases}
      // Solo se le pasa si de verdad es uno de sus casos: así el
      // desplegable nunca queda marcando algo que la lista no filtró.
      casoFiltro={cases.some((c) => c.id === casoParam) ? casoParam : null}
      canWrite={canWrite}
      // P2-13: firmar es otra key. El alumno (write sin sign) entrega; la
      // nota la cierra su docente. El endpoint lo vuelve a exigir.
      canSign={hasEduPermission(permUser, "expediente.sign")}
      meUserId={ctx.eduUserId}
      iaDictado={iaDictado}
      retiradas={retiradas}
    />
  );
}
