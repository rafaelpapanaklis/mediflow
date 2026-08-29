/**
 * DaleControl INSTITUCIONAL — QUIÉN VE QUÉ. Punto ÚNICO.
 *
 * Módulo PURO y client-safe (sin prisma en runtime, sin "server-only", sin
 * `new Date()` escondido: el `now` siempre se pasa). Devuelve objetos
 * `where` y no ejecuta nada, para poder comprobar en una prueba —sin base
 * de datos— que nadie ve lo que no le toca.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA REGLA, Y POR QUÉ VIVE EN UN SOLO ARCHIVO
 *
 * Parchear la visibilidad ruta por ruta es cómo se llega a que doce
 * endpoints la apliquen y el decimotercero no. Ese decimotercero funciona
 * perfectamente — para todo el mundo. Así que TODA lectura de pacientes,
 * citas y casos del vertical arma su `where` aquí:
 *
 *   ALUMNO    → solo sus casos, sus pacientes y sus citas.
 *   DOCENTE   → lo de los alumnos que supervisa CON ASIGNACIÓN VIGENTE
 *               (endsAt null o futuro). Nada de otros docentes.
 *   CAJA      → todos los pacientes y toda la agenda. NINGÚN caso: caja
 *               cobra y recibe, no abre expediente clínico.
 *   DIRECCION → todo.
 *
 * 🔴 UNA ASIGNACIÓN VENCIDA NO DA ACCESO. El docente ROTA a media
 * generación (por eso la Ola 1A guarda vigencia en vez de sobrescribir):
 * el día que entrega su grupo deja de ver a esos pacientes, y el que entra
 * empieza a verlos. El predicado de vigencia NO se reescribe aquí — se
 * reusa `eduCurrentAssignmentWhere` de padron-core.ts, que es donde vive.
 *
 * 🔴 EL PERMISO ABRE LA PANTALLA; EL ALCANCE DECIDE LAS FILAS. Son dos
 * cosas distintas y por eso están en dos archivos distintos:
 *   · agenda.view    → ¿puedo abrir /instituto/agenda?   (permissions.ts)
 *   · el alcance     → ¿qué citas salen ahí adentro?     (este archivo)
 * Darle agenda.view a un alumno NO le abre la agenda entera.
 *
 * 🔴 institutionId SIEMPRE de getEduContext(), JAMÁS del body o del query.
 * Las tres funciones de `where` LANZAN si les llega vacío: en Prisma un
 * `where: { institutionId: undefined }` no devuelve cero filas, BORRA el
 * filtro y devuelve las de TODOS los institutos.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import type { EduRole } from "@/lib/edu/types";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las tres cosas que esta ola pone en el piso clínico. Se pregunta por
 * RECURSO y no por rol suelto porque el mismo rol no ve lo mismo en los
 * tres: CAJA ve todos los pacientes y toda la agenda, y ni un caso.
 */
export type EduVisibilityResource = "patients" | "appointments" | "cases";

export type EduVisibilityScope =
  /** Sin recorte: todas las filas del instituto. */
  | { kind: "all" }
  /** Solo lo de los alumnos que este docente supervisa HOY. */
  | { kind: "supervised"; supervisorUserId: string }
  /**
   * Solo lo de ESTE alumno. Se guarda el id del EduUser (no el del
   * EduStudent) a propósito: es lo que trae la sesión, y filtrar por la
   * relación (`student: { userId }`) evita una consulta previa que podría
   * fallar y dejar el `where` sin recorte.
   */
  | { kind: "own"; studentUserId: string }
  /** Ninguna fila. */
  | { kind: "none" };

/** Lo mínimo de la sesión que necesita decidir un alcance. */
export interface EduVisibilityActor {
  role: EduRole;
  eduUserId: string;
}

/**
 * Lo mínimo de la sesión que necesita la capa de datos del piso clínico:
 * el actor MÁS el tenant. Es un subconjunto de EduContext (src/lib/edu-auth.ts)
 * para poder llamar a estas funciones desde una prueba sin fabricar un
 * EduInstitution y un EduUser completos.
 *
 * 🔴 `institutionId` viene de getEduContext() y de ningún otro lado.
 */
export interface EduClinicaContext extends EduVisibilityActor {
  institutionId: string;
}

/**
 * El alcance por ROL y RECURSO.
 *
 * ⚠️ Un rol desconocido (un `as any` que se coló, un rol nuevo que alguien
 * agregó al enum y olvidó aquí) cae en "none", no en "all". La opción
 * segura es la que no filtra datos.
 *
 * ⚠️ Un DOCENTE o un ALUMNO sin eduUserId caen en "none" por lo mismo: sin
 * id no hay a quién atribuirle nada, y "todos" sería la respuesta
 * equivocada.
 */
export function eduVisibility(
  actor: EduVisibilityActor,
  resource: EduVisibilityResource,
): EduVisibilityScope {
  if (typeof actor !== "object" || actor === null) return { kind: "none" };

  switch (actor.role) {
    case "DIRECCION":
      return { kind: "all" };

    case "CAJA":
      // Caja recibe al paciente, lo agenda y le cobra. El caso clínico —a
      // quién se le asignó, en qué va, qué decidió el docente— no es
      // asunto suyo, y esta línea es la que lo garantiza aunque alguien le
      // encienda "casos.view" por error desde los permisos.
      return resource === "cases" ? { kind: "none" } : { kind: "all" };

    case "DOCENTE":
      if (!actor.eduUserId) return { kind: "none" };
      return { kind: "supervised", supervisorUserId: actor.eduUserId };

    case "ALUMNO":
      if (!actor.eduUserId) return { kind: "none" };
      return { kind: "own", studentUserId: actor.eduUserId };

    default:
      return { kind: "none" };
  }
}

/** ¿Este alcance deja pasar alguna fila? (para no consultar de más). */
export function eduScopeIsEmpty(scope: EduVisibilityScope): boolean {
  return !scope || scope.kind === "none";
}

/** Texto que se le pinta a quien abrió una pantalla y no le toca nada. */
export const EDU_VISIBILITY_NONE_DETAIL: Record<EduVisibilityResource, string> = {
  patients:
    "Tu rol no lista pacientes. Los ven la dirección y caja (todos), los docentes (los de sus alumnos vigentes) y cada alumno (los suyos).",
  appointments:
    "Tu rol no lista citas. La agenda completa la ven la dirección y caja; un docente ve la de sus alumnos vigentes y un alumno la suya.",
  cases:
    "Tu rol no lista casos clínicos. Caja no los ve a propósito: recibe y cobra, no abre expediente. Si necesitas verlos, pídele a la dirección que revise tu rol.",
};

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL RECORTE, EN LA FORMA QUE ENTIENDE PRISMA
// ═══════════════════════════════════════════════════════════════════════

function requireInstitutionId(institutionId: string, fn: string): void {
  if (!institutionId || typeof institutionId !== "string") {
    throw new Error(
      `${fn} sin institutionId: un undefined BORRA el filtro de tenant y devuelve las filas de TODOS los institutos`,
    );
  }
}

/**
 * El filtro sobre el ALUMNO dueño de la fila. Devuelve `null` cuando el
 * alcance no recorta ("all"), para no meter un `student: {}` inútil.
 *
 * El institutionId se repite DENTRO de la relación a propósito: cierra el
 * tenant aunque un día alguien inserte una fila cruzada a mano.
 */
function eduStudentScopeFilter(
  scope: EduVisibilityScope,
  institutionId: string,
  now: Date,
): Prisma.EduStudentWhereInput | null {
  if (scope.kind === "own") {
    return { institutionId, userId: scope.studentUserId };
  }
  if (scope.kind === "supervised") {
    return {
      institutionId,
      supervisors: {
        some: {
          institutionId,
          supervisorUserId: scope.supervisorUserId,
          // 🔴 La vigencia NO se reescribe aquí. Si este archivo tuviera su
          // propia copia del predicado, tarde o temprano una de las dos
          // olvidaría el `startsAt` y un docente vería alumnos que
          // todavía no le tocan (o que ya entregó).
          ...eduCurrentAssignmentWhere(now),
        },
      },
    };
  }
  return null;
}

/**
 * `where` que no devuelve NADA, con el tenant puesto igual.
 *
 * Cinturón: la capa de datos ni siquiera consulta cuando el alcance es
 * "none", pero si alguna vez lo hace, esto no devuelve una sola fila. Un
 * objeto vacío devolvería el instituto ENTERO, que es exactamente el error
 * que no puede pasar.
 */
function nada(institutionId: string): { institutionId: string; id: { in: string[] } } {
  return { institutionId, id: { in: [] } };
}

// ── Pacientes ───────────────────────────────────────────────────────────

export interface EduPatientScopeInput {
  institutionId: string;
  scope: EduVisibilityScope;
  now?: Date;
}

/**
 * Los pacientes que le tocan a quien pregunta.
 *
 * ¿Cuándo es "mío" un paciente si soy alumno? Cuando tengo un CASO suyo o
 * una CITA suya. Las dos, no una: la cita de tamizaje existe ANTES que el
 * caso (es la que lo abre), así que mirar solo los casos dejaría al alumno
 * que hace la valoración sin poder abrir la ficha del paciente que tiene
 * enfrente. Y al revés, un caso transferido puede quedarse sin citas
 * futuras y el alumno tiene que seguir viendo a quien atendió.
 *
 * Consecuencia buscada: un paciente que caja acaba de registrar, sin cita
 * y sin caso, NO lo ve ningún alumno ni ningún docente. Todavía no es de
 * nadie.
 */
export function eduPatientScopeWhere({
  institutionId,
  scope,
  now = new Date(),
}: EduPatientScopeInput): Prisma.EduPatientWhereInput {
  requireInstitutionId(institutionId, "eduPatientScopeWhere");
  if (eduScopeIsEmpty(scope)) return nada(institutionId);
  if (scope.kind === "all") return { institutionId };

  const student = eduStudentScopeFilter(scope, institutionId, now);
  if (!student) return nada(institutionId);

  return {
    institutionId,
    OR: [
      { cases: { some: { institutionId, student } } },
      { appointments: { some: { institutionId, student } } },
    ],
  };
}

// ── Citas ───────────────────────────────────────────────────────────────

export interface EduAppointmentScopeInput {
  institutionId: string;
  scope: EduVisibilityScope;
  now?: Date;
  /**
   * Restricciones extra SOBRE EL ALUMNO (hoy: la especialidad). Se fusionan
   * con el recorte en el MISMO objeto en vez de escribir dos veces la clave
   * `student`, que es como se pierde uno de los dos filtros en silencio.
   */
  studentExtra?: Prisma.EduStudentWhereInput;
}

/**
 * Las citas que le tocan a quien pregunta.
 *
 * La cita SIEMPRE tiene alumno (`studentId` no es opcional), así que el
 * recorte cuelga siempre de la misma relación y no hay caso "huérfano" que
 * atender.
 *
 * ⚠️ Un DOCENTE ve las citas de SUS alumnos, no las citas en las que
 * figura como supervisor de guardia. Es lo que pide el contrato de la ola
 * ("nada de otros docentes") y deja fuera un caso real: cubrir el turno de
 * un compañero. El producto lo evita por otro lado — la cita propone por
 * defecto al titular vigente del alumno.
 */
export function eduAppointmentScopeWhere({
  institutionId,
  scope,
  now = new Date(),
  studentExtra,
}: EduAppointmentScopeInput): Prisma.EduAppointmentWhereInput {
  requireInstitutionId(institutionId, "eduAppointmentScopeWhere");
  if (eduScopeIsEmpty(scope)) return nada(institutionId);

  const scopeFilter = scope.kind === "all" ? null : eduStudentScopeFilter(scope, institutionId, now);
  if (scope.kind !== "all" && !scopeFilter) {
    return nada(institutionId);
  }

  const student: Prisma.EduStudentWhereInput = { ...(scopeFilter ?? {}), ...(studentExtra ?? {}) };
  const where: Prisma.EduAppointmentWhereInput = { institutionId };
  if (Object.keys(student).length > 0) where.student = student;
  return where;
}

// ── Casos ───────────────────────────────────────────────────────────────

export interface EduCaseScopeInput {
  institutionId: string;
  scope: EduVisibilityScope;
  now?: Date;
  studentExtra?: Prisma.EduStudentWhereInput;
}

/**
 * Los casos que le tocan a quien pregunta.
 *
 * 🔴 El recorte del DOCENTE cuelga de la asignación VIGENTE alumno↔docente,
 * NO de `EduCase.supervisorUserId`. Esa columna guarda quién era el
 * responsable cuando el caso se abrió —para poder contestarlo dentro de un
 * año— y si la visibilidad se calculara con ella, un docente que ya rotó
 * seguiría leyendo el caso para siempre.
 */
export function eduCaseScopeWhere({
  institutionId,
  scope,
  now = new Date(),
  studentExtra,
}: EduCaseScopeInput): Prisma.EduCaseWhereInput {
  requireInstitutionId(institutionId, "eduCaseScopeWhere");
  if (eduScopeIsEmpty(scope)) return nada(institutionId);

  const scopeFilter = scope.kind === "all" ? null : eduStudentScopeFilter(scope, institutionId, now);
  if (scope.kind !== "all" && !scopeFilter) {
    return nada(institutionId);
  }

  const student: Prisma.EduStudentWhereInput = { ...(scopeFilter ?? {}), ...(studentExtra ?? {}) };
  const where: Prisma.EduCaseWhereInput = { institutionId };
  if (Object.keys(student).length > 0) where.student = student;
  return where;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · ESCRITURAS: ¿PUEDO TOCAR ESTA FILA?
//
// Leer y escribir no son la misma pregunta. Un ALUMNO puede LEER su cita y
// marcarla como "el paciente ya está en el sillón", pero no puede
// reagendarla ni asignarse un caso; eso lo decide el PERMISO
// (agenda.manage, casos.assign) en el endpoint. Lo que decide esta sección
// es lo otro: que la fila que se va a tocar sea de las que esa persona
// puede ver. Un permiso no sabe de quién es la fila.
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿El alumno dueño de una fila cae dentro del alcance? Se usa con los datos
 * YA leídos (el `userId` del alumno y sus asignaciones vigentes), para
 * poder decidirlo sin una segunda consulta.
 *
 * Sirve para las comprobaciones en memoria y para las pruebas; la
 * comprobación que de verdad cierra la puerta es el `where` de arriba, que
 * hace que una fila fuera de alcance ni siquiera se encuentre (404, igual
 * que una que no existe — que es exactamente lo que debe verse desde
 * fuera).
 */
export function eduScopeCoversStudent(
  scope: EduVisibilityScope,
  student: {
    userId: string;
    supervisors: { supervisorUserId: string; startsAt: Date | string; endsAt: Date | string | null }[];
  },
  now: Date = new Date(),
): boolean {
  if (!scope || scope.kind === "none") return false;
  if (scope.kind === "all") return true;
  if (typeof student !== "object" || student === null) return false;

  if (scope.kind === "own") return student.userId === scope.studentUserId;

  const supervisorUserId = scope.supervisorUserId;
  const t = now.getTime();
  return (student.supervisors ?? []).some((a) => {
    if (a.supervisorUserId !== supervisorUserId) return false;
    const starts = new Date(a.startsAt).getTime();
    if (Number.isNaN(starts) || starts > t) return false;
    if (a.endsAt === null || a.endsAt === undefined) return true;
    const ends = new Date(a.endsAt).getTime();
    // Cerrada hace un segundo YA no cuenta: cerrar es escribir endsAt =
    // ahora, y con `>=` el docente saliente y el entrante serían los dos
    // "vigentes" durante el mismo instante.
    return !Number.isNaN(ends) && ends > t;
  });
}
