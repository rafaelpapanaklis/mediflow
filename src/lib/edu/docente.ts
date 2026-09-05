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
