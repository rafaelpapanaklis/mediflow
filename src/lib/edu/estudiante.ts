/**
 * DaleControl INSTITUCIONAL — LA FICHA DE UN ESTUDIANTE, contra la base.
 *
 * Las formas y los `where` viven en estudiante-core.ts (puro, probable sin
 * base). Aquí solo se ejecutan. La razón de la partición es la de siempre en
 * este vertical: el `where` que decide quién ve qué tiene que poder
 * comprobarse en una prueba sin levantar Postgres.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ P2-6 DE LA AUDITORÍA — NO SE LEEN 17.000 FILAS PARA PINTAR 120.
 *
 * Todo lo que se cuenta se cuenta EN LA BASE (`groupBy`, `_count`,
 * `findFirst` con `orderBy`), nunca trayendo filas para contarlas en
 * memoria. Y ningún `findMany` sin `take`. Un alumno de último semestre con
 * cuatro años de citas es exactamente el caso donde "ya funciona en el
 * instituto de demo" deja de ser una respuesta.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { eduCurrentAssignmentWhere, eduPadronScope } from "@/lib/edu/padron-core";
import {
  EDU_APPOINTMENT_SELECT,
  eduAppointmentToRow,
} from "@/lib/edu/agenda";
import {
  eduCleanId,
  eduFormatDayShort,
  eduSafeTimeZone,
  eduUtcToZoned,
  type EduAppointmentRow,
} from "@/lib/edu/agenda-core";
import { eduAgeYears, eduPatientFullName } from "@/lib/edu/pacientes-core";
import { EDU_CASE_CLOSED_STATUSES, type EduStudentStatus } from "@/lib/edu/types";
import {
  EDU_ESTUDIANTE_MAX_FILAS,
  EDU_ESTUDIANTE_MAX_PACIENTES,
  eduEstudianteFichaWhere,
  eduEstudiantePacientesOrden,
  eduEstudiantePacientesWhere,
  type EduEstudianteFicha,
  type EduEstudianteKpis,
  type EduEstudiantePacienteRow,
  type EduEstudiantePacientesPage,
} from "@/lib/edu/estudiante-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    // No debería pasar nunca (el layout ya exigió sesión), pero un throw
    // aquí es infinitamente mejor que un where sin tenant.
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

/** Los tres estados que cierran un caso, como Set para no recorrer el array. */
const CERRADOS = new Set<string>(EDU_CASE_CLOSED_STATUSES);

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA CABECERA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El alumno y sus números, o `null`.
 *
 * 🔴 `null` SIGNIFICA 404, y significa las DOS cosas a la vez: "no existe" y
 * "no te toca". La página llama a `notFound()` con el mismo resultado en los
 * dos casos porque distinguirlos —un 403 para el segundo— confirmaría que
 * esa matrícula existe en esa escuela.
 *
 * Quién abre la ficha: `eduPadronScope`. DIRECCION todos, DOCENTE los suyos
 * (con asignación VIGENTE), ALUMNO ninguno, CAJA ninguno. Un alumno NO abre
 * ni la suya: su propio avance lo ve en su bitácora, que es otra pantalla
 * con otro alcance.
 *
 * Qué se ve DENTRO: `eduVisibility`, otra vez y por separado. Los KPIs
 * clínicos salen `null` —no 0— cuando ese alcance está vacío.
 */
export async function getEduEstudianteFicha(
  ctx: EduClinicaContext,
  studentId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduEstudianteFicha | null> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(studentId);
  if (!id) return null;

  const scope = eduPadronScope(ctx);
  // Sin alcance académico no se consulta nada: ALUMNO y CAJA se van con un
  // 404 sin tocar la base.
  if (scope.kind === "none") return null;

  const alumno = await prisma.eduStudent.findFirst({
    where: eduEstudianteFichaWhere({ institutionId, scope, studentId: id, now }),
    select: {
      id: true,
      matricula: true,
      semester: true,
      status: true,
      enrolledAt: true,
      graduatedAt: true,
      userId: true,
      programId: true,
      cohortId: true,
      user: {
        select: { firstName: true, lastName: true, email: true, phone: true, isActive: true },
      },
      program: { select: { name: true } },
      cohort: { select: { name: true } },
      supervisors: {
        where: { institutionId, ...eduCurrentAssignmentWhere(now) },
        // El TITULAR primero: es el que responde por él, y es el que la
        // cabecera enseña cuando no caben todos.
        orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
        take: 20,
        select: {
          id: true,
          supervisorUserId: true,
          isPrimary: true,
          startsAt: true,
          supervisor: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });
  if (!alumno) return null;

  const kpis = await kpisDelAlumno(ctx, institutionId, alumno.id, timeZone, now);

  return {
    id: alumno.id,
    userId: alumno.userId,
    matricula: alumno.matricula,
    name: personName(alumno.user),
    email: alumno.user.email,
    phone: alumno.user.phone,
    userIsActive: alumno.user.isActive,
    status: alumno.status as EduStudentStatus,
    semester: alumno.semester,
    programId: alumno.programId,
    programName: alumno.program.name,
    cohortId: alumno.cohortId,
    cohortName: alumno.cohort.name,
    enrolledAt: alumno.enrolledAt.toISOString(),
    graduatedAt: alumno.graduatedAt ? alumno.graduatedAt.toISOString() : null,
    supervisors: alumno.supervisors.map((a) => ({
      assignmentId: a.id,
      supervisorUserId: a.supervisorUserId,
      name: personName(a.supervisor),
      isPrimary: a.isPrimary,
      startsAt: a.startsAt.toISOString(),
    })),
    kpis,
  };
}

/**
 * Los números de la cabecera, TODOS contados en la base.
 *
 * Son seis lecturas y van en UN `Promise.all` — por debajo de las siete que
 * satura el pooler (regla de la casa). Ninguna trae filas para contarlas:
 * cuatro son `count`, dos son `findFirst` con `take` implícito de 1.
 *
 * 🔴 Cada una lleva SU alcance encima. `casos` y `citas` se recortan con el
 * clínico de quien mira, no con el académico que ya dejó abrir la ficha.
 */
async function kpisDelAlumno(
  ctx: EduClinicaContext,
  institutionId: string,
  studentId: string,
  timeZone: string,
  now: Date,
): Promise<EduEstudianteKpis> {
  const zona = eduSafeTimeZone(timeZone);
  const pacientes = eduVisibility(ctx, "patients");
  const casos = eduVisibility(ctx, "cases");
  const citas = eduVisibility(ctx, "appointments");

  const vacio: EduEstudianteKpis = {
    pacientes: null,
    casosAbiertos: null,
    casosCerrados: null,
    citasCompletadas: null,
    proximaCitaISO: null,
    proximaCitaLabel: null,
    ultimaAtencionISO: null,
    ultimaAtencionLabel: null,
  };

  const casoWhere = eduScopeIsEmpty(casos)
    ? null
    : { ...eduCaseScopeWhere({ institutionId, scope: casos, now }), studentId };
  const citaWhere = eduScopeIsEmpty(citas)
    ? null
    : { ...eduAppointmentScopeWhere({ institutionId, scope: citas, now }), studentId };
  const pacienteWhere = eduScopeIsEmpty(pacientes)
    ? null
    : eduEstudiantePacientesWhere({
        institutionId,
        clinico: eduPatientScopeWhere({ institutionId, scope: pacientes, now }),
        studentId,
      });

  const [nPacientes, nAbiertos, nCerrados, nCompletadas, proxima, ultima] = await Promise.all([
    pacienteWhere ? prisma.eduPatient.count({ where: pacienteWhere }) : Promise.resolve(null),
    casoWhere
      ? prisma.eduCase.count({
          where: { ...casoWhere, status: { notIn: EDU_CASE_CLOSED_STATUSES } },
        })
      : Promise.resolve(null),
    casoWhere
      ? prisma.eduCase.count({ where: { ...casoWhere, status: { in: EDU_CASE_CLOSED_STATUSES } } })
      : Promise.resolve(null),
    citaWhere
      ? prisma.eduAppointment.count({ where: { ...citaWhere, status: "COMPLETED" } })
      : Promise.resolve(null),
    // La próxima que tiene AGENDADA: viva y por delante de ahora.
    citaWhere
      ? prisma.eduAppointment.findFirst({
          where: {
            ...citaWhere,
            startsAt: { gt: now },
            status: { in: ["SCHEDULED", "CHECKED_IN"] },
          },
          orderBy: [{ startsAt: "asc" }],
          select: { startsAt: true },
        })
      : Promise.resolve(null),
    // La última vez que ATENDIÓ: la cita cumplida más reciente.
    citaWhere
      ? prisma.eduAppointment.findFirst({
          where: { ...citaWhere, status: "COMPLETED" },
          orderBy: [{ startsAt: "desc" }],
          select: { startsAt: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    ...vacio,
    pacientes: nPacientes,
    casosAbiertos: nAbiertos,
    casosCerrados: nCerrados,
    citasCompletadas: nCompletadas,
    proximaCitaISO: proxima ? proxima.startsAt.toISOString() : null,
    proximaCitaLabel: proxima ? eduFechaHora(proxima.startsAt, zona) : null,
    ultimaAtencionISO: ultima ? ultima.startsAt.toISOString() : null,
    ultimaAtencionLabel: ultima ? eduFechaHora(ultima.startsAt, zona) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS PACIENTES QUE HA ATENDIDO — el recorrido que pidió Rafael
// ═══════════════════════════════════════════════════════════════════════

/**
 * La tabla de "a quién ha atendido", con por qué entra cada uno.
 *
 * DOS lecturas en total, no una por fila:
 *   1. los pacientes (con el `where` de las tres vías + el alcance clínico),
 *      con `take: 301` para poder decir `truncated`;
 *   2. UN `groupBy` de citas y UN `groupBy` de casos, acotados a los
 *      pacientes que salieron. Contar caso por caso serían 600 viajes a la
 *      base para pintar 300 renglones.
 *
 * 🔴 Sin duplicados por construcción: la consulta devuelve PACIENTES, no
 * cruces. Un paciente que cumple las tres vías es UNA fila con las tres
 * banderas encendidas, no tres filas.
 */
export async function listEduEstudiantePacientes(
  ctx: EduClinicaContext,
  studentId: string,
  timeZone: string,
  opciones: { q?: string | null } = {},
  now: Date = new Date(),
): Promise<EduEstudiantePacientesPage> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(studentId);
  if (!id) return { rows: [], truncated: false };

  const zona = eduSafeTimeZone(timeZone);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const where = eduEstudiantePacientesWhere({
    institutionId,
    clinico: eduPatientScopeWhere({ institutionId, scope, now }),
    studentId: id,
    q: opciones.q ?? null,
  });

  const pacientes = await prisma.eduPatient.findMany({
    where,
    // El orden FINO es por última visita y se resuelve abajo, con el dato ya
    // en la mano; aquí basta con un orden estable para que el recorte de 300
    // sea el mismo entre dos cargas iguales.
    orderBy: [{ folio: "asc" }],
    take: EDU_ESTUDIANTE_MAX_PACIENTES + 1,
    select: {
      id: true,
      folio: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      referredByStudentId: true,
    },
  });

  const truncated = pacientes.length > EDU_ESTUDIANTE_MAX_PACIENTES;
  const usados = truncated ? pacientes.slice(0, EDU_ESTUDIANTE_MAX_PACIENTES) : pacientes;
  if (usados.length === 0) return { rows: [], truncated: false };

  const patientIds = usados.map((p) => p.id);

  const [citas, casos, ultimas] = await Promise.all([
    // Cuántas citas tiene con ESTE alumno cada paciente.
    prisma.eduAppointment.groupBy({
      by: ["patientId"],
      where: { institutionId, studentId: id, patientId: { in: patientIds } },
      _count: { _all: true },
    }),
    // Sus casos con ESTE alumno, por estado, para partirlos en abiertos y
    // cerrados sin traerse ni una fila de caso.
    prisma.eduCase.groupBy({
      by: ["patientId", "status"],
      where: { institutionId, studentId: id, patientId: { in: patientIds } },
      _count: { _all: true },
    }),
    // La última cita CUMPLIDA de cada pareja. `groupBy` con `_max` la saca
    // de una: un `findFirst` por paciente serían trescientas consultas.
    prisma.eduAppointment.groupBy({
      by: ["patientId"],
      where: {
        institutionId,
        studentId: id,
        patientId: { in: patientIds },
        status: "COMPLETED",
      },
      _max: { startsAt: true },
    }),
  ]);

  const nCitas = new Map<string, number>();
  for (const c of citas) nCitas.set(c.patientId, c._count._all);

  const abiertos = new Map<string, number>();
  const cerrados = new Map<string, number>();
  const conCaso = new Set<string>();
  for (const c of casos) {
    conCaso.add(c.patientId);
    const destino = CERRADOS.has(c.status) ? cerrados : abiertos;
    destino.set(c.patientId, (destino.get(c.patientId) ?? 0) + c._count._all);
  }

  const ultimaPorPaciente = new Map<string, Date>();
  for (const u of ultimas) {
    if (u._max.startsAt) ultimaPorPaciente.set(u.patientId, u._max.startsAt);
  }

  const rows: EduEstudiantePacienteRow[] = usados.map((p) => {
    const ultima = ultimaPorPaciente.get(p.id) ?? null;
    return {
      patientId: p.id,
      folio: p.folio,
      name: eduPatientFullName(p),
      ageYears: eduAgeYears(p.birthDate, now),
      porCaso: conCaso.has(p.id),
      porCita: (nCitas.get(p.id) ?? 0) > 0,
      porReferido: p.referredByStudentId === id,
      citas: nCitas.get(p.id) ?? 0,
      ultimaVisitaISO: ultima ? ultima.toISOString() : null,
      ultimaVisitaLabel: ultima ? eduFormatDayShort(eduUtcToZoned(ultima, zona).dayISO) : null,
      casosAbiertos: abiertos.get(p.id) ?? 0,
      casosCerrados: cerrados.get(p.id) ?? 0,
    };
  });

  rows.sort(eduEstudiantePacientesOrden);
  return { rows, truncated };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · SU AGENDA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las citas de este alumno, la más reciente primero.
 *
 * Reusa `EduAppointmentRow` y el `select` de la agenda (EDU_APPOINTMENT_SELECT)
 * para que la fila de la ficha y la del calendario no se desincronicen: son
 * la misma cita y la pantalla la lee igual.
 */
export async function listEduEstudianteCitas(
  ctx: EduClinicaContext,
  studentId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ rows: EduAppointmentRow[]; truncated: boolean }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(studentId);
  if (!id) return { rows: [], truncated: false };

  const scope = eduVisibility(ctx, "appointments");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const rows = await prisma.eduAppointment.findMany({
    where: { ...eduAppointmentScopeWhere({ institutionId, scope, now }), studentId: id },
    orderBy: [{ startsAt: "desc" }, { id: "desc" }],
    take: EDU_ESTUDIANTE_MAX_FILAS + 1,
    select: EDU_APPOINTMENT_SELECT,
  });

  const truncated = rows.length > EDU_ESTUDIANTE_MAX_FILAS;
  return {
    truncated,
    rows: rows
      .slice(0, EDU_ESTUDIANTE_MAX_FILAS)
      .map((a) => eduAppointmentToRow(a, eduSafeTimeZone(timeZone))),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · UTILIDADES
// ═══════════════════════════════════════════════════════════════════════

/**
 * "12 mar 2026, 09:30" en la hora del INSTITUTO.
 *
 * Se formatea en el SERVIDOR a propósito: si lo hiciera el navegador con su
 * propia zona, un docente conectado desde otro huso vería la cita a otra
 * hora y el primer render no coincidiría con el del servidor (error de
 * hidratación).
 */
function eduFechaHora(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
