/**
 * DaleControl INSTITUCIONAL — Ola 12 · EL RESUMEN DE LA FICHA contra la
 * base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro (qué bloque ve cada rol, qué es un
 * aviso) vive en resumen-core.ts; el recorte, en visibility.ts. Aquí solo
 * hay consultas — y NINGUNA arma su propio `where`: el de citas sale de
 * eduAppointmentScopeWhere, el de casos de eduCaseScopeWhere y el de
 * dinero de eduChargeScopeWhere. Un resumen que se saltara el punto único
 * le contaría a un alumno las visitas de otros alumnos, y el bug se vería
 * exactamente igual que "funciona".
 *
 * 🔴 EL DINERO NO SE CONSULTA cuando el alcance no es "all". No es un
 * `hidden` de pantalla: la consulta NO SE HACE, así el saldo de un
 * paciente jamás viaja en el payload RSC de un alumno (la lección del
 * P1-4: lo que llega al navegador ya se filtró en el servidor).
 *
 * 🔴 Promise.all CORTO a propósito (5 y 2, nunca cerca de 7): esta
 * pantalla cruza muchas tablas y es la primera de la ficha — una consulta
 * lenta aquí retrasa TODAS las visitas a la ficha.
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduChargeScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  eduResumenAvisos,
  eduResumenScopes,
  eduResumenVeClinico,
  eduResumenVeDinero,
  type EduPatientResumenData,
  type EduResumenCita,
} from "@/lib/edu/resumen-core";
import { EDU_CASE_CLOSED_STATUSES } from "@/lib/edu/types";

export type { EduPatientResumenData } from "@/lib/edu/resumen-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

/** "lun 31 ago 09:30" en la zona del instituto. */
function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

/** El `select` de las dos citas del resumen (última y próxima). */
const CITA_RESUMEN_SELECT = {
  startsAt: true,
  student: {
    select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } },
  },
  chair: { select: { name: true, campus: { select: { name: true } } } },
  supervisor: { select: { firstName: true, lastName: true, email: true } },
} as const;

type CitaResumenPayload = {
  startsAt: Date;
  student: {
    matricula: string;
    user: { firstName: string; lastName: string; email: string };
  };
  chair: { name: string; campus: { name: string } } | null;
  supervisor: { firstName: string; lastName: string; email: string } | null;
};

function toCita(
  c: CitaResumenPayload | null,
  timeZone: string,
  multiSede: boolean,
): EduResumenCita | null {
  if (!c) return null;
  return {
    label: stampLabel(c.startsAt, timeZone),
    studentName: personName(c.student.user),
    studentMatricula: c.student.matricula,
    chairName: c.chair?.name ?? null,
    // La sede solo se dice cuando hay MÁS de una: "Sillón 3 · Sede única"
    // es ruido en la escuela chica, que son casi todas (regla de la Ola 11).
    campusName: multiSede ? (c.chair?.campus.name ?? null) : null,
    supervisorName: c.supervisor ? personName(c.supervisor) : null,
  };
}

/**
 * El resumen de UN paciente, con cada bloque recortado (o directamente NO
 * consultado) según quien pregunta. El paciente en sí ya lo validó la
 * página con getEduPatient — aquí cada consulta vuelve a cerrar tenant y
 * alcance por su cuenta, así que un patientId ajeno solo produce ceros.
 *
 * ⚠️ La ficha NO se filtra por sede a propósito (decisión de la Ola 11):
 * el expediente y la historia de un paciente son UNO, se atienda donde se
 * atienda. Por eso aquí no viaja `campusIds`.
 */
export async function getEduPatientResumen(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduPatientResumenData | null> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(patientId);
  if (!id) return null;

  const scopes = eduResumenScopes(ctx);
  const veCitas = !eduScopeIsEmpty(scopes.citas);
  const veClinico = eduResumenVeClinico(scopes);
  const veDinero = eduResumenVeDinero(scopes);

  const citasWhere = eduAppointmentScopeWhere({ institutionId, scope: scopes.citas, now });
  const casosWhere = eduCaseScopeWhere({ institutionId, scope: scopes.clinico, now });

  // ¿El instituto reparte por sedes? Decide si la sede se PINTA. Es una
  // cuenta barata (count con take implícito) y va dentro del mismo batch.
  const [visitas, ultima, proxima, casos, dinero, sedes] = await Promise.all([
    veCitas
      ? prisma.eduAppointment.count({
          where: { ...citasWhere, patientId: id, status: "COMPLETED" },
        })
      : Promise.resolve(0),
    veCitas
      ? prisma.eduAppointment.findFirst({
          where: { ...citasWhere, patientId: id, status: "COMPLETED" },
          orderBy: [{ startsAt: "desc" }],
          select: CITA_RESUMEN_SELECT,
        })
      : Promise.resolve(null),
    veCitas
      ? prisma.eduAppointment.findFirst({
          where: {
            ...citasWhere,
            patientId: id,
            startsAt: { gt: now },
            // Las vivas: una cancelada o un "no llegó" no son la próxima
            // visita de nadie, y una COMPLETED futura no existe.
            status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] },
          },
          orderBy: [{ startsAt: "asc" }],
          select: CITA_RESUMEN_SELECT,
        })
      : Promise.resolve(null),
    veClinico
      ? prisma.eduCase.findMany({
          where: { ...casosWhere, patientId: id, status: { notIn: EDU_CASE_CLOSED_STATUSES } },
          orderBy: [{ openedAt: "desc" }],
          take: 20,
          select: {
            id: true,
            status: true,
            openedAt: true,
            supervisorUserId: true,
            program: { select: { name: true } },
            student: {
              select: {
                matricula: true,
                user: { select: { firstName: true, lastName: true, email: true } },
                // El titular VIGENTE del alumno: decide el aviso "sin
                // docente". Mismo predicado de vigencia de siempre — no se
                // reescribe aquí.
                supervisors: {
                  where: { institutionId, ...eduCurrentAssignmentWhere(now) },
                  take: 1,
                  select: { id: true },
                },
              },
            },
            supervisor: { select: { firstName: true, lastName: true, email: true } },
          },
        })
      : Promise.resolve([]),
    veDinero
      ? prisma.eduCharge.aggregate({
          where: { ...eduChargeScopeWhere({ institutionId, scope: scopes.dinero }), patientId: id },
          _sum: { paidCents: true, balanceCents: true },
          _count: true,
        })
      : Promise.resolve(null),
    prisma.eduCampus.count({ where: { institutionId } }).catch(() => 0),
  ]);

  // ── Los avisos: consentimientos y autorizaciones de ESOS casos ────────
  let avisos: EduPatientResumenData["avisos"] = [];
  if (veClinico && casos.length > 0) {
    const ids = casos.map((c) => c.id);
    const [consents, pendientes] = await Promise.all([
      prisma.eduConsent.findMany({
        where: { institutionId, caseId: { in: ids } },
        select: { caseId: true, signedAt: true, revokedAt: true },
      }),
      prisma.eduCaseApproval.findMany({
        where: { institutionId, caseId: { in: ids }, status: "PENDING" },
        select: { caseId: true },
      }),
    ]);
    const pendientesPorCaso: Record<string, number> = {};
    for (const p of pendientes) {
      pendientesPorCaso[p.caseId] = (pendientesPorCaso[p.caseId] ?? 0) + 1;
    }
    avisos = eduResumenAvisos(
      casos.map((c) => ({
        id: c.id,
        status: c.status,
        programName: c.program.name,
        supervisorUserId: c.supervisorUserId,
        tieneTitularVigente: c.student.supervisors.length > 0,
      })),
      consents,
      pendientesPorCaso,
    );
  }

  const multiSede = sedes > 1;
  const tz = eduSafeTimeZone(timeZone);

  return {
    visitas,
    recortado: scopes.citas.kind !== "all",
    ultimaVisita: toCita(ultima, tz, multiSede),
    proximaCita: toCita(proxima, tz, multiSede),
    casos: veClinico
      ? casos.map((c) => ({
          id: c.id,
          status: c.status,
          programName: c.program.name,
          studentName: personName(c.student.user),
          studentMatricula: c.student.matricula,
          supervisorName: c.supervisor ? personName(c.supervisor) : null,
          abiertoLabel: eduFormatDayShort(eduUtcToZoned(c.openedAt, tz).dayISO),
        }))
      : null,
    saldo: dinero
      ? {
          cobradoCents: dinero._sum.paidCents ?? 0,
          pendienteCents: dinero._sum.balanceCents ?? 0,
          cobros: dinero._count,
        }
      : null,
    avisos,
  };
}
