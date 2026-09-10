export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { eduScopeIsEmpty } from "@/lib/edu/visibility";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { listEduCuestionarios } from "@/lib/edu/cuestionario";
import {
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCuestionarioScreen } from "@/components/edu/expediente/cuestionario-screen";

/**
 * /instituto/pacientes/[id]/salud — EL CUESTIONARIO DE SALUD VERSIONADO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PESTAÑA PROPIA Y NO UNA SECCIÓN DE «DATOS», Y ES DELIBERADO.
 *
 * En Datos ya vive la tarjeta de ANTECEDENTES, que escribe sobre la propia
 * fila del paciente: el estado ACTUAL. Esto es otra cosa —el histórico de
 * qué se preguntó y qué se contestó CADA VEZ— y meter las dos en la misma
 * pestaña habría hecho que pareciera que una edita a la otra. No: la
 * tarjeta corrige el estado de hoy; aquí se contesta una versión nueva y
 * lo clínico se MEZCLA hacia la ficha. Dos gestos, dos sitios.
 *
 * 🔴 PERMISO `expediente.view` Y ALCANCE CLÍNICO ("cases"). CAJA no entra:
 * captura los antecedentes en Datos con `pacientes.manage`, pero los
 * antecedentes médicos versionados de toda la escuela no son del
 * mostrador. Con el alcance de "patients" —el que "parece" natural— caja
 * los leería enteros.
 *
 * 🔴 LA LECTURA QUEDA REGISTRADA (NOM-024 §6.3.5): `listEduCuestionarios`
 * llama a `eduAudit` con `action: "view"`. Abrir los antecedentes médicos
 * de alguien es un acceso al expediente, y la norma pide poder contestar
 * quién lo abrió.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function PacienteSaludPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "expediente.view")) {
    return (
      <EduDenied
        permission="expediente.view"
        what="El cuestionario de salud del paciente: qué contestó, cuándo, y qué banderas de riesgo encendió."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay cuestionario que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  // La IP y el navegador para el renglón de LECTURA. `headers()` y no un
  // `Request`: en un componente de servidor no hay petición que pasar, y
  // la constancia sin IP vale menos que la constancia con IP.
  const h = headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  const meta = {
    ip: (fwd.split(",")[0]?.trim() || h.get("x-real-ip") || null)?.slice(0, 60) ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };

  const { rows, truncated } = await listEduCuestionarios(ctx, paciente.id, meta);

  // 🔴 EL SELLO DE TIEMPO SE ESCRIBE EN EL SERVIDOR y en la zona del
  // INSTITUTO. En el navegador saldría en la zona de quien mira —dos
  // cadenas distintas para el mismo dato entre el render del servidor y el
  // del cliente, que es un aviso de hidratación— y en UTC un cuestionario
  // capturado a las 19:00 en Tijuana se fecharía al día siguiente.
  const tz = eduSafeTimeZone(ctx.institution.timezone);
  const sello = (iso: string) => {
    const d = new Date(iso);
    return `${eduFormatDayShort(eduUtcToZoned(d, tz).dayISO)} ${eduFormatTime(d, tz)}`;
  };

  const canEdit = hasEduPermission(permUser, "expediente.write");

  return (
    <EduCuestionarioScreen
      patientId={paciente.id}
      rows={rows.map((r) => ({
        id: r.id,
        version: r.version,
        answers: r.answers,
        riskFlags: r.riskFlags,
        notes: r.notes,
        recordedByName: r.recordedByName,
        recordedLabel: sello(r.recordedAt),
      }))}
      truncated={truncated}
      canEdit={canEdit}
      /* Deshabilitado CON MOTIVO, nunca un no-op: quien ve el botón gris
         tiene que saber por qué está gris y qué llave le falta. */
      motivoSinPermiso="Puedes leer el cuestionario, no contestarlo: hace falta el permiso expediente.write, el mismo que escribe una nota clínica."
    />
  );
}
