export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { EDU_CLINICAL_NONE_DETAIL, eduClinicalScope } from "@/lib/edu/expediente-core";
import { eduScopeIsEmpty, eduVisibility } from "@/lib/edu/visibility";
import { getEduClinicalPatient, listEduPatientCaseOptions } from "@/lib/edu/expediente";
import { listEduPlanes } from "@/lib/edu/plan-tratamiento";
import { getEduTarifaDePaciente } from "@/lib/edu/tarifas";
import { listEduPatientAppointments } from "@/lib/edu/agenda";
import {
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPlanScreen } from "@/components/edu/expediente/plan-screen";

/**
 * /instituto/pacientes/[id]/plan — EL PLAN DE TRATAMIENTO (fila 25).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PERMISO `expediente.view` Y ALCANCE CLÍNICO. Caja no ve planes de
 * tratamiento: cobra, no planifica actos clínicos. Con el alcance de
 * "patients" —el que "parece" natural porque el plan cuelga del
 * paciente— caja leería los planes de toda la escuela.
 *
 * 🔴 EL TARIFARIO SOLO SE CONSULTA PARA QUIEN VE EL DINERO, y por eso hay
 * un `if` antes de la llamada y no un try/catch después:
 * `getEduTarifaDePaciente` LANZA 403 sin el alcance de "charges", y eso
 * tumbaría la pestaña entera de un docente. Es la misma lección del P1-4:
 * lo que no le toca a quien mira ni se consulta ni viaja en el payload.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function PacientePlanPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "expediente.view")) {
    return (
      <EduDenied
        permission="expediente.view"
        what="El plan de tratamiento del paciente: cuántas sesiones lleva, cuántas le faltan y en qué va."
      />
    );
  }

  if (eduScopeIsEmpty(eduClinicalScope(ctx))) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">Aquí no hay planes que mostrarte</p>
        <p className="edu-empty__detail">{EDU_CLINICAL_NONE_DETAIL}</p>
      </div>
    );
  }

  const paciente = await getEduClinicalPatient(ctx, params.id);
  if (!paciente) notFound();

  const tz = eduSafeTimeZone(ctx.institution.timezone);
  const sello = (iso: string) => {
    const d = new Date(iso);
    return `${eduFormatDayShort(eduUtcToZoned(d, tz).dayISO)} ${eduFormatTime(d, tz)}`;
  };
  const dia = (iso: string) => eduFormatDayShort(eduUtcToZoned(new Date(iso), tz).dayISO);

  const veDinero =
    hasEduPermission(permUser, "caja.view") && !eduScopeIsEmpty(eduVisibility(ctx, "charges"));
  const canPresupuestar =
    hasEduPermission(permUser, "caja.charge") && !eduScopeIsEmpty(eduVisibility(ctx, "charges"));

  // Menos de siete consultas por Promise.all (CLAUDE.md): son cuatro.
  const [planes, casos, citas, tarifa] = await Promise.all([
    listEduPlanes(ctx, paciente.id, ctx.institution.timezone),
    listEduPatientCaseOptions(ctx, paciente.id),
    hasEduPermission(permUser, "agenda.view")
      ? listEduPatientAppointments(ctx, paciente.id, ctx.institution.timezone)
      : Promise.resolve([]),
    veDinero ? getEduTarifaDePaciente(ctx, paciente.id) : Promise.resolve(null),
  ]);

  const etiquetaCaso = new Map(
    casos.map((c) => [c.id, `${c.programName} · ${c.studentMatricula} ${c.studentName}`]),
  );

  return (
    <EduPlanScreen
      patientId={paciente.id}
      rows={planes.map((p) => ({
        id: p.id,
        name: p.name,
        descripcion: p.descripcion,
        // 🔴 LAS PARTIDAS NO VIAJAN SIN `caja.view`. Llevan el precio
        // dentro, así que mandarlas y esconderlas en el JSX las dejaría en
        // el payload RSC de un alumno: el candado no puede ser el CSS.
        partidas: veDinero ? p.partidas : [],
        caseId: p.caseId,
        caseLabel: p.caseId ? (etiquetaCaso.get(p.caseId) ?? null) : null,
        status: p.status,
        totalCents: veDinero ? p.totalCents : 0,
        startsLabel: dia(p.startsAt),
        closedLabel: p.closedAt ? dia(p.closedAt) : null,
        nextExpectedLabel: p.nextExpectedAt ? dia(p.nextExpectedAt) : null,
        closeReason: p.closeReason,
        createdByName: p.createdByName,
        // 🔴 OLA C·fin 2 · lo calcula el servidor (el alumno del caso, o
        // quien lo armó si no hay caso) y viaja como booleano: la pantalla
        // solo necesita saber si ofrece el botón que cierra el plan.
        esMio: p.esMio,
        kpis: {
          hechas: p.kpis.hechas,
          total: p.kpis.total,
          avance: p.kpis.avance,
          siguienteNumero: p.kpis.siguienteNumero,
          atrasado: p.kpis.atrasado,
        },
        sesiones: p.sesiones.map((s) => ({
          id: s.id,
          sessionNumber: s.sessionNumber,
          notes: s.notes,
          completedAt: s.completedAt,
          completedLabel: s.completedAt ? sello(s.completedAt) : null,
          completedByName: s.completedByName,
          appointmentId: s.appointmentId,
          appointmentLabel: s.appointmentLabel,
        })),
      }))}
      casos={casos
        .filter((c) => c.isOpen)
        .map((c) => ({
          id: c.id,
          label: `${c.programName} · ${c.studentMatricula} ${c.studentName}`,
        }))}
      citas={citas.map((a) => ({
        id: a.id,
        label: `${eduFormatDayShort(a.dayISO)} ${a.startLabel} · ${a.chairName}`,
      }))}
      procedimientos={
        tarifa
          ? tarifa.prices.map((p) => ({ id: p.procedureId, name: p.name, priceCents: p.priceCents }))
          : []
      }
      canEdit={hasEduPermission(permUser, "expediente.write")}
      veDinero={veDinero}
      canPresupuestar={canPresupuestar}
      // Con el rol, la pantalla aplica la MISMA regla que el servidor
      // (`eduPlanPuedeCerrar`) para decidir qué botón de cierre pinta. El
      // 403 sigue estando; lo que se quita es el clic que siempre falla.
      role={ctx.role}
      motivoSinPermiso="Puedes leer los planes, no armarlos ni marcar sesiones: hace falta el permiso expediente.write, el mismo que escribe una nota clínica."
    />
  );
}
