/**
 * DaleControl INSTITUCIONAL — LA FICHA DE UN DOCENTE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UN DOCENTE ES UN `EduUser`. NO HAY `EduTeacher`.
 *
 * Por eso el id de la URL es el de la CUENTA, y por eso todo lo suyo cuelga
 * de `supervisorUserId` (la asignación, el caso, la cita) y no de una tabla
 * propia. Es la otra mitad de la trampa de los dos ids: el estudiante se
 * abre con su `EduStudent` y el docente con su `EduUser`. Cruzarlos da un
 * 404 mudo — no hay error, simplemente no existe esa ficha.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * No hay `docente-core.ts` y es deliberado: esta ficha no tiene un `where`
 * propio que probar. El de los estudiantes lo pone `listEduCurrentAssignments`
 * (padron.ts), el de los casos `eduCaseScopeWhere` y el de las citas
 * `eduAppointmentScopeWhere` — los tres ya probados donde viven. Un
 * `docente-core.ts` con dos tipos dentro sería un archivo por simetría.
 */

import { prisma } from "@/lib/prisma";
import { EduPadronError, listEduCurrentAssignments } from "@/lib/edu/padron";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  eduCurrentAssignmentWhere,
  eduPadronScope,
  type EduAssignmentRow,
} from "@/lib/edu/padron-core";
// 🔴 LA BITÁCORA TIENE UN SOLO ESCRITOR y nunca lanza. Ver auditoria.ts.
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";
import { EDU_APPOINTMENT_SELECT, eduAppointmentToRow } from "@/lib/edu/agenda";
import { eduCleanId, eduSafeTimeZone, type EduAppointmentRow } from "@/lib/edu/agenda-core";
import { EDU_CASE_CLOSED_STATUSES } from "@/lib/edu/types";
import { EDU_ESTUDIANTE_MAX_FILAS } from "@/lib/edu/estudiante-core";

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

export interface EduDocenteFicha {
  /** El id de **EduUser**. Es el de la URL. */
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Cédula profesional. Es lo que firma una receta; se lee, no se navega. */
  cedulaProfesional: string | null;
  isActive: boolean;
  lastLogin: string | null;
  /**
   * La misma fecha, ya escrita en la hora del INSTITUTO.
   *
   * ⚠️ Se formatea en el servidor y no se recorta el ISO en la pantalla:
   * `lastLogin.slice(0, 10)` da el día en UTC, y una entrada de las 19:00 en
   * Tijuana quedaría fechada al día siguiente.
   *
   * 🔴 Y SOLO VIAJA PARA QUIEN YA LO VE EN OTRA PANTALLA. "Cuándo entró por
   * última vez mi colega" es un dato de administración de cuentas, no de
   * docencia: ya existe en la pantalla de Equipo (EduTeamRow.lastLogin), que
   * pide `equipo.manage`. Esta ficha la abre cualquiera con `docentes.view`
   * —todos los docentes entre sí—, así que sin este recorte la ola habría
   * repartido un dato nuevo sobre los compañeros sin que nadie lo pidiera.
   */
  lastLoginLabel: string | null;
  /**
   * 🔴 H-159 · ¿Quien mira PUEDE ver la última entrada? Es distinto de "no
   * hay ninguna", y hasta esta ola la ficha no los distinguía: `null`
   * significaba las dos cosas y el texto elegía siempre la de permisos —
   * «La última entrada solo la ve quien administra el equipo»—, que se lo
   * estaba leyendo justamente la persona que SÍ administra el equipo. Con
   * `lastLogin` sin escribir en todo el repo, ese caso era el único que
   * ocurría: la dirección concluía que le faltaba un permiso que ya tenía.
   */
  veUltimaEntrada: boolean;
  createdAt: string;

  /** Estudiantes con asignación VIGENTE ahora mismo. */
  estudiantesVigentes: number;
  /**
   * Casos abiertos que supervisa. `null` = a quien mira no le toca el
   * recurso "cases" (CAJA). null NO es cero: cero sería mentir sobre su
   * carga.
   */
  casosAbiertos: number | null;
  proximaCitaISO: string | null;
  proximaCitaLabel: string | null;
}

/**
 * El docente, o `null` (⇒ 404).
 *
 * 🔴 `role: "DOCENTE"` va en el `where`, no se comprueba después. Sin esa
 * línea, /instituto/docentes/{id} con el id de un alumno —o el de la
 * dirección— abriría una "ficha de docente" de alguien que no lo es, con
 * cero estudiantes y cero casos, que es una pantalla que miente en vez de
 * un 404 honesto.
 *
 * `institutionId` va en el mismo `where` por lo de siempre: un `undefined`
 * ahí no filtra, Prisma descarta la clave y la ficha se abriría con el id de
 * un docente de otra escuela.
 *
 * ⚠️ Esta ficha NO tiene alcance propio de "quién la abre": la cierra el
 * permiso `docentes.view` en el layout, igual que la lista de docentes que
 * ya existía. Lo que sí se recorta es lo de DENTRO, con `eduVisibility`.
 */
export async function getEduDocenteFicha(
  ctx: EduClinicaContext,
  userId: string,
  timeZone: string,
  /**
   * `verCuenta` = quien mira tiene `equipo.manage`, el permiso que ya enseña
   * la última entrada en la pantalla de Equipo. Se recibe ya resuelto —el
   * permiso se comprueba en la página, que es quien tiene la sesión— y aquí
   * decide si el dato SALE del servidor, no si se pinta. Esconderlo en la
   * pantalla lo dejaría igual en el payload RSC.
   */
  opciones: { verCuenta?: boolean } = {},
  now: Date = new Date(),
): Promise<EduDocenteFicha | null> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(userId);
  if (!id) return null;

  const docente = await prisma.eduUser.findFirst({
    where: { institutionId, id, role: "DOCENTE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      cedulaProfesional: true,
      isActive: true,
      lastLogin: true,
      createdAt: true,
      _count: {
        select: { supervisees: { where: { institutionId, ...eduCurrentAssignmentWhere(now) } } },
      },
    },
  });
  if (!docente) return null;

  const casos = eduVisibility(ctx, "cases");
  const citas = eduVisibility(ctx, "appointments");

  // 🔴 La carga se cuenta por `supervisorUserId` (la columna del caso: quién
  // respondía por él) Y con el alcance de quien mira encima. Las dos cosas:
  // la columna dice de quién es la ficha, el alcance dice qué puede ver
  // quien la abrió.
  const casoWhere = eduScopeIsEmpty(casos)
    ? null
    : {
        ...eduCaseScopeWhere({ institutionId, scope: casos, now }),
        supervisorUserId: docente.id,
        status: { notIn: EDU_CASE_CLOSED_STATUSES },
      };
  const citaWhere = eduScopeIsEmpty(citas)
    ? null
    : {
        ...eduAppointmentScopeWhere({ institutionId, scope: citas, now }),
        supervisorUserId: docente.id,
      };

  const [casosAbiertos, proxima] = await Promise.all([
    casoWhere ? prisma.eduCase.count({ where: casoWhere }) : Promise.resolve(null),
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
  ]);

  const zona = eduSafeTimeZone(timeZone);
  return {
    id: docente.id,
    name: personName(docente),
    email: docente.email,
    phone: docente.phone,
    cedulaProfesional: docente.cedulaProfesional,
    isActive: docente.isActive,
    lastLogin: opciones.verCuenta && docente.lastLogin ? docente.lastLogin.toISOString() : null,
    lastLoginLabel:
      opciones.verCuenta && docente.lastLogin ? eduFechaHora(docente.lastLogin, zona) : null,
    veUltimaEntrada: Boolean(opciones.verCuenta),
    createdAt: docente.createdAt.toISOString(),
    estudiantesVigentes: docente._count.supervisees,
    casosAbiertos,
    proximaCitaISO: proxima ? proxima.startsAt.toISOString() : null,
    proximaCitaLabel: proxima ? eduFechaHora(proxima.startsAt, zona) : null,
  };
}

/**
 * "12 mar 2026, 09:30" en la hora del INSTITUTO.
 *
 * En el SERVIDOR a propósito: si lo hiciera el navegador con su propia zona,
 * quien se conecta desde otro huso vería otra hora y el primer render no
 * coincidiría con el del servidor (error de hidratación).
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

/**
 * Sus estudiantes VIGENTES.
 *
 * ⛔ NO se escribe otra consulta de asignaciones vigentes.
 * `listEduCurrentAssignments` ya existe, ya lleva el predicado único de
 * vigencia (`eduCurrentAssignmentWhere`) y ya acota por docente con su
 * tercer parámetro. Un segundo listado aquí sería el sitio donde, dentro de
 * seis meses, se olvidaría el `startsAt` y aparecerían asignaciones que
 * todavía no empiezan.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 P1-4 DE LA AUDITORÍA — Y EL RECORTE VIVE AQUÍ, NO EN LAS PÁGINAS.
 *
 * `listEduCurrentAssignments` NO tiene alcance propio: devuelve el id, la
 * matrícula y el NOMBRE de cada alumno del docente que se le pida. El
 * alcance lo pone quien llama, y hasta ahora lo ponían a mano los dos
 * llamadores que había (/instituto/docentes y su API). Esta ficha era un
 * TERCER llamador, y sin esta función un DOCENTE abría la ficha de un
 * colega y leía el padrón nominal de sus alumnos — que es exactamente lo
 * que el P1-4 cerró.
 *
 * Va DENTRO de la función y no repetido en las dos páginas: un tercer sitio
 * que decide lo mismo es cómo se llega a que el cuarto se olvide.
 *
 * La regla, que es la de `eduPadronScope` y ninguna nueva:
 *   · DIRECCION           → los alumnos del docente que se está mirando;
 *   · DOCENTE, su PROPIA ficha → los suyos;
 *   · DOCENTE, la ficha de OTRO → ninguno. "Un DOCENTE ve SOLO sus alumnos".
 *   · ALUMNO y CAJA       → ninguno (no llegan: el layout ya cortó).
 *
 * ⚠️ El CONTEO agregado de la cabecera (`estudiantesVigentes`, que sale de
 * un `_count`) NO se recorta, igual que en /instituto/docentes: "cuántos
 * alumnos lleva cada quien hoy" es un número, no una identidad, y es para
 * lo que existe la pantalla de docentes.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `restringido: true` = hay alumnos pero no te toca verlos por nombre. La
 * pantalla lo dice en vez de fingir que el docente no supervisa a nadie.
 */
export async function listEduDocenteEstudiantes(
  ctx: EduClinicaContext,
  userId: string,
  now: Date = new Date(),
): Promise<{ rows: EduAssignmentRow[]; restringido: boolean }> {
  const id = eduCleanId(userId);
  if (!id) return { rows: [], restringido: false };

  const alcance = eduPadronScope(ctx);
  if (alcance.kind === "none") return { rows: [], restringido: true };
  if (alcance.kind === "supervised" && alcance.supervisorUserId !== id) {
    return { rows: [], restringido: true };
  }

  return { rows: await listEduCurrentAssignments(ctx, now, id), restringido: false };
}

/**
 * Las citas que SUPERVISA, la más reciente primero.
 *
 * ⚠️ `supervisorUserId` es la columna de la CITA: quién respondía por ella
 * ese día. No es lo mismo que "las citas de sus alumnos" —un docente puede
 * cubrir el turno de un compañero, y una cita de su alumno puede haberla
 * supervisado otro— y aquí la pregunta es la primera: qué supervisó ÉL.
 */
export async function listEduDocenteCitas(
  ctx: EduClinicaContext,
  userId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ rows: EduAppointmentRow[]; truncated: boolean }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(userId);
  if (!id) return { rows: [], truncated: false };

  const scope = eduVisibility(ctx, "appointments");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const rows = await prisma.eduAppointment.findMany({
    where: {
      ...eduAppointmentScopeWhere({ institutionId, scope, now }),
      supervisorUserId: id,
    },
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
// OLA C·2 · LA ROTACIÓN DOCENTE PROGRAMADA
//
// «El docente que rota deja su nombre pegado en las citas futuras y no hay
// lote.» La mitad de eso —cambiar de titular— ya existía, pero SIEMPRE con
// efecto inmediato: `assignEduSupervisor` escribe `startsAt: now` a pelo.
// En una escuela real la rotación se decide en junta y arranca el lunes
// siguiente, y hacerla el lunes a mano es como se llega a un alumno sin
// docente durante tres días.
//
// ═══════════════════════════════════════════════════════════════════════
// 🔴 CERO SQL, CERO COLUMNAS. La columna `startsAt` existe desde la Ola 1A
// y `eduCurrentAssignmentWhere` (padron-core.ts) YA filtra `startsAt <= now`
// en las tres lecturas del vertical. Lo único que faltaba era poder
// escribir una fecha futura, y que se pudiera VER lo programado antes de
// que llegue: una asignación que existe y no se puede ver es peor que no
// tenerla.
//
// 🔴 Y NO VIVE EN padron.ts. `assignEduSupervisor` y
// `endEduSupervisorAssignment` son de otra casilla de esta ola; estas tres
// funciones no tocan ni una línea suya y comparten con ellas el mismo
// predicado de vigencia, que sigue viviendo en padron-core.ts.
// ═══════════════════════════════════════════════════════════════════════

/** Una rotación que TODAVÍA no arrancó. */
export interface EduRotacionProgramada {
  id: string;
  studentId: string;
  studentName: string;
  matricula: string;
  programName: string;
  supervisorUserId: string;
  supervisorName: string;
  isPrimary: boolean;
  /** ISO. Siempre en el futuro mientras esté en esta lista. */
  startsAt: string;
  /** Quién la lleva HOY, para poder leer el cambio de un vistazo. */
  titularActual: string | null;
}

/**
 * LO PROGRAMADO: las asignaciones cuya vigencia todavía no empezó.
 *
 * 🔴 SE RECORTA CON EL MISMO ALCANCE DEL PADRÓN. Un DOCENTE ve lo de SUS
 * alumnos vigentes y no el reparto entero de la escuela: de esta lista
 * salen la matrícula y el nombre de cada alumno, que es exactamente lo que
 * `eduPadronScope` existe para no repartir.
 */
export async function listEduRotacionesProgramadas(
  ctx: EduClinicaContext,
  now: Date = new Date(),
): Promise<EduRotacionProgramada[]> {
  const institutionId = requireInstitution(ctx);
  const alcance = eduPadronScope(ctx);
  if (alcance.kind === "none") return [];

  const filas = await prisma.eduSupervisorAssignment.findMany({
    where: {
      institutionId,
      // Lo PROGRAMADO es, exactamente, lo que el predicado de vigencia
      // descarta por la izquierda: `startsAt > now`. Escrito así —y no como
      // una columna "programada"— no hay dos verdades que mantener.
      startsAt: { gt: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      ...(alcance.kind === "supervised"
        ? {
            student: {
              supervisors: {
                some: {
                  supervisorUserId: alcance.supervisorUserId,
                  ...eduCurrentAssignmentWhere(now),
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ startsAt: "asc" }],
    take: EDU_ESTUDIANTE_MAX_FILAS,
    select: {
      id: true,
      studentId: true,
      supervisorUserId: true,
      isPrimary: true,
      startsAt: true,
      supervisor: { select: { firstName: true, lastName: true, email: true } },
      student: {
        select: {
          matricula: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          program: { select: { name: true } },
          // El titular de HOY, para que la fila diga «de X a Y» y no solo
          // «Y desde el lunes». Se pide con el mismo predicado de vigencia.
          supervisors: {
            where: { isPrimary: true, ...eduCurrentAssignmentWhere(now) },
            take: 1,
            select: { supervisor: { select: { firstName: true, lastName: true, email: true } } },
          },
        },
      },
    },
  });

  return filas.map((a) => ({
    id: a.id,
    studentId: a.studentId,
    studentName: personName(a.student.user),
    matricula: a.student.matricula,
    programName: a.student.program.name,
    supervisorUserId: a.supervisorUserId,
    supervisorName: personName(a.supervisor),
    isPrimary: a.isPrimary,
    startsAt: a.startsAt.toISOString(),
    titularActual: a.student.supervisors[0]
      ? personName(a.student.supervisors[0].supervisor)
      : null,
  }));
}

/**
 * PROGRAMA una rotación para una fecha futura.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE **NO** HACE, Y ES LA DECISIÓN IMPORTANTE: no cierra al titular
 * de hoy.
 *
 * `assignEduSupervisor` (padron.ts) sí lo cierra, y ahí es correcto: pone
 * la asignación en vigor AHORA, así que el saliente tiene que salir ahora.
 * Aquí el relevo es el lunes que viene: cerrar hoy al titular dejaría al
 * alumno TRES DÍAS SIN DOCENTE —sin supervisión clínica y sin nadie que le
 * firme una autorización— y eso no es lo que pidió quien programó la
 * rotación.
 *
 * El titular saliente se cierra el día que el relevo entra, y eso lo hace
 * la propia asignación nueva: el `isPrimary` del entrante convive con el
 * del saliente hasta esa fecha, y desde ella los dos están vigentes. Es la
 * consecuencia que hay que decir en voz alta y no esconder — ver el punto
 * 6 del reporte y `endsAt`, que sigue siendo la forma de cerrar al
 * saliente cuando la dirección lo decida.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function programarEduRotacion(
  ctx: EduClinicaContext & EduAuditActor,
  input: { studentId?: unknown; supervisorUserId?: unknown; isPrimary?: unknown; startsAt?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; startsAt: string }> {
  const institutionId = requireInstitution(ctx);

  const studentId = eduCleanId(input?.studentId);
  const supervisorUserId = eduCleanId(input?.supervisorUserId);
  if (!studentId) throw new EduPadronError("Elige el estudiante que rota.", 400);
  if (!supervisorUserId) throw new EduPadronError("Elige el docente que lo va a llevar.", 400);

  const startsAt = new Date(String(input?.startsAt ?? ""));
  if (Number.isNaN(startsAt.getTime())) {
    throw new EduPadronError("La fecha de arranque no se entiende.", 400);
  }
  if (startsAt.getTime() <= now.getTime()) {
    // Una rotación "programada" para ayer no es una rotación programada: es
    // una asignación normal, y ésa se hace desde el botón de siempre. Con un
    // camino que aceptara las dos, el titular saliente se quedaría abierto
    // sin que nadie lo hubiera decidido (ver el bloque de arriba).
    throw new EduPadronError(
      "Una rotación programada arranca en el FUTURO. Para que entre ya, asígnalo con el botón normal: ése sí cierra al titular anterior en el mismo acto.",
      400,
    );
  }
  if (startsAt.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000) {
    throw new EduPadronError(
      "Esa fecha está a más de un año. Revisa el año que escribiste.",
      400,
    );
  }

  const [student, supervisor] = await Promise.all([
    prisma.eduStudent.findFirst({
      where: { id: studentId, institutionId },
      select: { id: true, status: true, matricula: true },
    }),
    prisma.eduUser.findFirst({
      where: { id: supervisorUserId, institutionId },
      select: { id: true, role: true, isActive: true, firstName: true, lastName: true },
    }),
  ]);

  if (!student) throw new EduPadronError("Ese estudiante no es de este instituto.", 404);
  if (student.status !== "ACTIVE") {
    throw new EduPadronError(
      "Ese estudiante ya no está activo en el padrón: no se le puede programar un docente.",
    );
  }
  if (!supervisor) throw new EduPadronError("Ese docente no es de este instituto.", 404);
  if (supervisor.role !== "DOCENTE") {
    throw new EduPadronError("Solo se puede asignar como supervisor a alguien con rol Docente.");
  }
  if (!supervisor.isActive) {
    throw new EduPadronError("Ese docente está dado de baja. Reactívalo antes de programarle alumnos.");
  }
  // 🔴 H-16 · NADIE SE PROGRAMA A SÍ MISMO, igual que en la asignación
  // inmediata. Con `supervision.assign` prestado, un docente se daría
  // acceso al expediente de cualquier alumno — solo que con fecha.
  if (supervisor.id === ctx.eduUserId) {
    throw new EduPadronError(
      "No puedes programarte estudiantes a ti mismo. Las asignaciones las hace la dirección.",
      403,
    );
  }

  const isPrimary = input?.isPrimary === undefined ? true : input.isPrimary !== false;

  // Ya programada la misma pareja para el mismo día: se rebota en vez de
  // dejar dos filas idénticas que nadie sabrá cuál cerrar.
  const repetida = await prisma.eduSupervisorAssignment.findFirst({
    where: {
      institutionId,
      studentId: student.id,
      supervisorUserId: supervisor.id,
      startsAt: { gt: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (repetida) {
    throw new EduPadronError("Ese docente ya está programado para este estudiante.", 409);
  }

  const creada = await prisma.eduSupervisorAssignment.create({
    data: {
      institutionId,
      studentId: student.id,
      supervisorUserId: supervisor.id,
      isPrimary,
      startsAt,
    },
    select: { id: true, startsAt: true },
  });

  await eduAudit(ctx, {
    action: "create",
    entity: "student",
    entityId: student.id,
    after: {
      rotacionProgramada: `${supervisor.firstName} ${supervisor.lastName}`.trim(),
      matricula: student.matricula,
      startsAt: creada.startsAt,
      isPrimary,
    },
    ...meta,
  });

  return { id: creada.id, startsAt: creada.startsAt.toISOString() };
}

/**
 * CANCELA una rotación que todavía no arrancó.
 *
 * 🔴 NO BORRA LA FILA, y no es simetría por simetría: dentro de un año hay
 * que poder contestar «esto se programó y se dio marcha atrás», que no es
 * lo mismo que «nunca se programó». Se escribe `endsAt = startsAt`, con lo
 * que la asignación NUNCA llega a estar vigente —el predicado de vigencia
 * pide `startsAt <= now` Y `endsAt > now`, y con los dos iguales no hay
 * ningún instante que cumpla las dos— y la fila se queda con sus fechas.
 *
 * 🔴 Y SOLO LO QUE NO HA ARRANCADO. Una asignación que ya está en vigor se
 * cierra con el botón de siempre (`endsAt = ahora`, PATCH
 * /api/instituto/supervision/[id]): eso sí es un hecho del pasado y borrar
 * su vigencia reescribiría quién supervisaba cuando ocurrió algo.
 */
export async function cancelarEduRotacionProgramada(
  ctx: EduClinicaContext & EduAuditActor,
  assignmentId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(assignmentId);
  if (!id) throw new EduPadronError("Falta la rotación.", 400);

  const actual = await prisma.eduSupervisorAssignment.findFirst({
    where: { id, institutionId },
    select: { id: true, startsAt: true, endsAt: true, studentId: true, supervisorUserId: true },
  });
  if (!actual) throw new EduPadronError("Esa rotación no es de este instituto.", 404);
  if (actual.startsAt.getTime() <= now.getTime()) {
    throw new EduPadronError(
      "Esa asignación ya está en vigor: no se cancela, se cierra. Ciérrala desde la ficha del estudiante y quedará con su fecha de fin.",
      409,
    );
  }

  // El `where` lleva el `endsAt` leído: si otra persona la canceló entre la
  // lectura y ahora, esto contesta 409 en vez de pisarla. Patrón de la casa.
  const res = await prisma.eduSupervisorAssignment.updateMany({
    where: { id: actual.id, institutionId, endsAt: actual.endsAt },
    data: { endsAt: actual.startsAt },
  });
  if (res.count === 0) {
    throw new EduPadronError("Esa rotación ya estaba cancelada. Actualiza la pantalla.", 409);
  }

  await eduAudit(ctx, {
    action: "delete",
    entity: "student",
    entityId: actual.studentId,
    before: { rotacionProgramadaDesde: actual.startsAt, endsAt: actual.endsAt },
    after: { rotacionProgramadaDesde: actual.startsAt, endsAt: actual.startsAt, cancelada: true },
    ...meta,
  });

  return { id: actual.id };
}
