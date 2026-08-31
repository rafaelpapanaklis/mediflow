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
 * Y desde la Ola 5, el DINERO (recurso "charges"), que se reparte al revés
 * que todo lo demás:
 *
 *   CAJA      → todos los cobros y todos los pagos.
 *   DIRECCION → todo.
 *   DOCENTE   → NADA.
 *   ALUMNO    → NADA. Ni el precio, ni el cobro, ni el saldo.
 *
 * 🔴 Ojo a la asimetría: para pacientes, citas y casos, un alumno ve LO
 * SUYO recortado. Para el dinero NO ve "lo suyo": no ve nada. Un residente
 * que puede consultar cuánto pagó su paciente sabe cuánto vale su propia
 * lista de espera, y ése es exactamente el incentivo que la escuela no
 * quiere crear. Por eso "charges" no cae en el `switch` de roles de abajo
 * sino que se resuelve ANTES: no hay forma de que un rol nuevo, un `as any`
 * o un permiso encendido por error acaben devolviendo "own" o "supervised"
 * sobre dinero.
 *
 * Y desde la Ola 6, EL TRASPASO DE CASO: cuando un alumno rota o se
 * gradúa, sus casos abiertos pasan a otro alumno, y el saliente PIERDE el
 * acceso al paciente en el mismo acto en que el entrante lo GANA. Eso se
 * decide en `eduPatientScopeWhere` (abajo) y en ningún otro sitio: la
 * función que traspasa no sabe nada de visibilidad.
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
import type { EduCaseStatus, EduRole } from "@/lib/edu/types";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";
import type { EduCampusAware } from "@/lib/edu/campus-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las tres cosas que esta ola pone en el piso clínico. Se pregunta por
 * RECURSO y no por rol suelto porque el mismo rol no ve lo mismo en los
 * tres: CAJA ve todos los pacientes y toda la agenda, y ni un caso.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 OLA 3 — EL EXPEDIENTE NO AGREGÓ UN CUARTO RECURSO, Y ESO ES LO
 * IMPORTANTE.
 *
 * Las notas clínicas, el odontograma y los estudios se leen con el recurso
 * "cases", no con "patients". La diferencia es LA línea del contrato:
 *
 *   · "patients"  → CAJA ve a TODOS (recibe, agenda y cobra).
 *   · "cases"     → CAJA ve NINGUNO. No abre expediente clínico.
 *
 * Dos de esas tres cosas cuelgan del PACIENTE en la base (la boca es una
 * sola, y una tomografía sirve para endodoncia y para ortodoncia) — pero
 * eso es dónde se GUARDAN, no quién las VE. Colgarlas de "patients" por
 * parecerse habría abierto a caja las notas, el odontograma y las
 * radiografías de toda la escuela, y el bug se habría visto exactamente
 * igual que "funciona".
 *
 * En la práctica: el expediente se lee con
 *   eduPatientScopeWhere({ ..., scope: eduVisibility(ctx, "cases") })
 * que para caja devuelve el `where` que no trae ni una fila. Un recurso
 * nuevo que dijera lo mismo solo habría dado un segundo sitio donde
 * equivocarse. El punto único lo aplica src/lib/edu/expediente-core.ts
 * (eduClinicalScope) y de ahí lo usan los tres módulos de servidor.
 * ═══════════════════════════════════════════════════════════════════════
 */
export type EduVisibilityResource = "patients" | "appointments" | "cases" | "charges";

/**
 * Los roles que pueden ver DINERO. Es una lista blanca y no una lista
 * negra a propósito: si mañana el schema gana un rol (COORDINADOR,
 * ADMINISTRATIVO, RECTOR), la respuesta por defecto tiene que ser "no ve
 * dinero" y no "se me olvidó agregarlo a los que no ven". Un olvido con
 * lista negra abre la caja; con lista blanca, la deja cerrada.
 */
const EDU_ROLES_CON_DINERO: EduRole[] = ["DIRECCION", "CAJA"];

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
export interface EduClinicaContext extends EduVisibilityActor, EduCampusAware {
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

  // 🔴 EL DINERO SE DECIDE ANTES DEL SWITCH. Es todo o nada, y la lista de
  // quién lo ve es blanca: cualquier rol que no esté en ella —incluido uno
  // que no exista todavía— se queda fuera. Si esto viviera dentro del
  // switch, un `case` nuevo escrito sin pensar en la Ola 5 le abriría la
  // caja a alguien sin que nadie lo notara.
  if (resource === "charges") {
    return EDU_ROLES_CON_DINERO.includes(actor.role) ? { kind: "all" } : { kind: "none" };
  }

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
    "Tu rol no lista pacientes. Los ven la dirección y caja (todos), los docentes (los de sus estudiantes vigentes) y cada estudiante (los suyos).",
  appointments:
    "Tu rol no lista citas. La agenda completa la ven la dirección y caja; un docente ve la de sus estudiantes vigentes y un estudiante la suya.",
  cases:
    "Tu rol no lista casos clínicos. Caja no los ve a propósito: recibe y cobra, no abre expediente. Si necesitas verlos, pídele a la dirección que revise tu rol.",
  charges:
    "Tu rol no ve dinero: ni precios, ni cobros, ni saldos. Los ven la dirección y caja. Un docente y un estudiante no, y no es un permiso que se pueda encender: en el piso clínico se atiende, y en el mostrador se cobra.",
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

// ── Ola 6 · el traspaso de caso ─────────────────────────────────────────

/**
 * 🔴 UN CASO TRANSFERIDO YA NO ES DE QUIEN LO ENTREGÓ.
 *
 * Cuando un alumno rota o se gradúa, sus casos abiertos se TRASPASAN: el
 * viejo se cierra como TRANSFERRED y se abre uno nuevo con el alumno
 * nuevo, conservando paciente y especialidad (src/lib/edu/traspasos.ts).
 * A partir de ese momento el saliente PIERDE el acceso al paciente y el
 * entrante lo GANA, y eso se decide AQUÍ y en ningún otro sitio.
 *
 * Por qué hace falta escribirlo: sin esta condición, el caso viejo sigue
 * teniendo el `studentId` del saliente —y tiene que seguir teniéndolo, es
 * la respuesta a "¿quién lo atendía en marzo?"— así que el `where` de
 * pacientes lo seguiría encontrando y el traspaso no traspasaría nada. El
 * alumno que se fue seguiría abriendo la ficha, el expediente, el
 * odontograma y las radiografías de un paciente que ya no atiende.
 *
 * ⚠️ ABANDONED no entra aquí y no es un olvido: un caso abandonado no
 * cambió de manos, se acabó. El alumno que lo llevó sigue siendo el que
 * puede contestar por él.
 *
 * ⚠️ Lo que ESTO no toca: la AGENDA. Las citas pasadas del saliente siguen
 * siendo suyas —ocurrieron, y son su registro de asistencia—; lo que el
 * traspaso mueve son las citas FUTURAS, que cambian de alumno en la misma
 * transacción. Lo que se cierra aquí es el PACIENTE: su ficha y su
 * expediente.
 */
const EDU_CASE_TRANSFERRED: EduCaseStatus = "TRANSFERRED";

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
 *
 * 🔴 OLA 6 — Y UN PACIENTE TRASPASADO DEJA DE SER MÍO. Las dos ramas
 * descartan lo que quedó atrás en un traspaso: el caso TRANSFERRED y las
 * citas que colgaban de él. Es la mitad de la Ola 6 que no se ve —el
 * traspaso "funciona" perfectamente sin esto, solo que el alumno saliente
 * se queda con la llave— y por eso vive aquí, en el punto único, y no en
 * la función que traspasa.
 *
 * 🔴 P0-2 DE LA AUDITORÍA — Y LA RAMA DE LAS CITAS TENÍA UN AGUJERO DEL
 * TAMAÑO DE LA OLA 6. El `{ caseId: null }` de abajo existe para la cita
 * de TAMIZAJE (que es anterior al caso), pero en la práctica CASI NINGUNA
 * cita traía caso, así que esa opción no era la excepción: era la regla, y
 * el descarte del caso TRANSFERRED de al lado no se aplicaba a nada. El
 * alumno que entregaba un caso seguía abriendo la ficha, el expediente, el
 * odontograma y las radiografías de su ex paciente.
 *
 * Se cierra por los dos lados, porque uno solo no basta:
 *   · EL DATO — la cita queda enganchada a su caso cuando lo hay: al
 *     agendarla y al reagendarla (agenda.ts) y, para lo que ya existía,
 *     al traspasar (traspasos.ts engancha las citas sueltas del saliente
 *     con ese paciente al caso que entrega).
 *   · EL `where` — y aun así, una cita suelta NO abre la ficha de un
 *     paciente al que ya le entregué un caso. Es la línea `cases: { none:
 *     … TRANSFERRED }` de abajo, y es la que protege a las filas viejas,
 *     las de los traspasos que ocurrieron ANTES de este arreglo.
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
      // Un caso mío que NO entregué.
      { cases: { some: { institutionId, student, status: { not: EDU_CASE_TRANSFERRED } } } },
      // Una cita mía que no cuelga de un caso que entregué. El `caseId:
      // null` de la primera opción es la cita de TAMIZAJE anterior al
      // caso, que es la razón de que esta rama exista; se escribe como un
      // OR explícito y no con un `NOT` sobre la relación porque el `NOT`
      // de una relación uno-a-uno NULA es exactamente el sitio donde un
      // ORM decide por ti — y aquí decidir mal significa dejar la puerta
      // abierta.
      {
        appointments: {
          some: {
            institutionId,
            student,
            OR: [{ caseId: null }, { case: { status: { not: EDU_CASE_TRANSFERRED } } }],
          },
        },
        // 🔴 …Y QUE NO SEA UN PACIENTE QUE YA ENTREGUÉ. Sin esta línea, la
        // opción `{ caseId: null }` de arriba es una puerta abierta: basta
        // UNA cita suelta —y las de antes de este arreglo lo son casi
        // todas— para que el alumno saliente conserve la ficha completa.
        //
        // Aquí sí se usa la forma negativa, y no contradice el comentario
        // de arriba: `none` sobre una relación uno-a-MUCHOS es "ninguna
        // fila cumple" y no tiene ambigüedad. Lo que no se escribe con un
        // NOT es la relación uno-a-uno NULA (`case`), que es donde el ORM
        // decide por ti.
        //
        // ⚠️ Falso negativo conocido y aceptado: si a un alumno le vuelven
        // a agendar al paciente que entregó SIN abrirle un caso nuevo, no
        // verá su ficha hasta que se le abra. Falla del lado cerrado, se
        // arregla abriendo el caso (que es lo que hay que hacer de todos
        // modos) y es preferible a la alternativa — dejar la llave puesta.
        // Para un DOCENTE el descarte no distingue CUÁL de sus alumnos
        // entregó el caso: Prisma no correlaciona dos `some` hermanos.
        cases: { none: { institutionId, student, status: EDU_CASE_TRANSFERRED } },
      },
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
  /**
   * Ola 11 · LAS SEDES. `null` (o ausente) = sin recorte por sede.
   * Ver la sección 4 al final de este archivo.
   */
  campusIds?: string[] | null;
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
  campusIds,
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

  // 🔴 Ola 11 · LA SEDE DE UNA CITA SE DERIVA DE SU SILLÓN. No hay
  // `EduAppointment.campusId` y no es un olvido: una columna copiada se
  // desincroniza el día que un sillón cambia de edificio, y entonces la
  // agenda de la sede nueva no tendría las citas que ya estaban agendadas
  // en ese sillón. El sillón es el que sabe dónde está.
  const chair = eduCampusRelationFilter(institutionId, campusIds);
  if (chair) where.chair = chair;

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
 *
 * 🔴 OLA 6 — AQUÍ NO SE DESCARTA EL CASO TRANSFERIDO, y es deliberado.
 * `eduPatientScopeWhere` sí lo descarta (el saliente pierde al PACIENTE);
 * la LISTA DE CASOS del alumno lo conserva, porque es su historia
 * académica: la bitácora tiene que poder decir "llevó este caso de marzo a
 * julio y lo entregó". Lo que se cierra es la puerta al expediente vivo de
 * una persona que ya no atiende, no el registro de lo que hizo.
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

// ── Alumnos (Ola 6) ─────────────────────────────────────────────────────

export interface EduStudentScopeInput {
  institutionId: string;
  scope: EduVisibilityScope;
  now?: Date;
}

/**
 * Los ALUMNOS que le tocan a quien pregunta.
 *
 * Existe porque la Ola 6 lista una cosa que ninguna ola anterior listaba
 * con este alcance: alumnos. Y la diferencia con el padrón (padron-core.ts,
 * eduPadronScope) es exactamente UNA fila y es la que importa:
 *
 *   · el PADRÓN de un alumno son CERO filas — un residente no lista a su
 *     generación;
 *   · su EVALUACIÓN es UNA fila, la suya. Ver su propio avance es la mitad
 *     de para qué existe la ola: si no la viera, "te faltan 3 de 8" no se
 *     lo diría nadie hasta el día que no se gradúa.
 *
 * Por eso NO se reusa eduPadronScope aquí y sí se reusa el alcance de
 * "cases" —que es el que ya sabe decir "lo tuyo"—: el alumno se filtra por
 * su propio `userId` y el docente por sus asignaciones VIGENTES, con el
 * mismo predicado de vigencia que todo lo demás.
 *
 * ⚠️ CAJA cae en "none", como en el resto del expediente: cobrar no es
 * evaluar.
 */
export function eduStudentScopeWhere({
  institutionId,
  scope,
  now = new Date(),
}: EduStudentScopeInput): Prisma.EduStudentWhereInput {
  requireInstitutionId(institutionId, "eduStudentScopeWhere");
  if (eduScopeIsEmpty(scope)) return nada(institutionId);
  if (scope.kind === "all") return { institutionId };

  const student = eduStudentScopeFilter(scope, institutionId, now);
  if (!student) return nada(institutionId);
  return student;
}

// ── Dinero (Ola 5) ──────────────────────────────────────────────────────

export interface EduChargeScopeInput {
  institutionId: string;
  scope: EduVisibilityScope;
  /**
   * Ola 11 · LAS SEDES. `null` (o ausente) = sin recorte por sede.
   *
   * ⚠️ Aquí la sede NO se deriva de nada: `EduCharge.campusId` se SELLA al
   * emitir el cobro (dónde estaba el mostrador). Ver la sección 4.
   */
  campusIds?: string[] | null;
}

/**
 * Los cobros que le tocan a quien pregunta: todos, o ninguno.
 *
 * No hay recorte por alumno y no es un olvido — es la regla. Un cobro no
 * "pertenece" a un residente: pertenece a la caja de la escuela. Y como
 * `eduVisibility(actor, "charges")` solo devuelve "all" o "none", cualquier
 * otro alcance que llegue aquí (por un cast, por una llamada equivocada)
 * cierra la consulta en vez de abrirla.
 *
 * No lleva `now`: la vigencia de un docente no entra en esta cuenta,
 * porque un docente no ve dinero ni vigente ni vencido.
 */
export function eduChargeScopeWhere({
  institutionId,
  scope,
  campusIds,
}: EduChargeScopeInput): Prisma.EduChargeWhereInput {
  requireInstitutionId(institutionId, "eduChargeScopeWhere");
  if (!scope || scope.kind !== "all") return nada(institutionId);
  const where: Prisma.EduChargeWhereInput = { institutionId };
  if (Array.isArray(campusIds)) where.campusId = { in: campusIds };
  return where;
}

/**
 * Lo mismo para los pagos, que se consultan aparte en el corte de caja.
 *
 * Existe en vez de reusar el de cobros porque el `where` de Prisma es de
 * OTRO modelo y los tipos no son intercambiables; y escribir
 * `{ institutionId }` a mano en el corte es exactamente el atajo que deja
 * una consulta de dinero fuera del punto único.
 */
export function eduPaymentScopeWhere({
  institutionId,
  scope,
}: EduChargeScopeInput): Prisma.EduPaymentWhereInput {
  requireInstitutionId(institutionId, "eduPaymentScopeWhere");
  if (!scope || scope.kind !== "all") return nada(institutionId);
  return { institutionId };
}

// ── Pagos a meses ───────────────────────────────────────────────────────

/**
 * Los PLANES DE PAGO que le tocan a quien pregunta: todos, o ninguno.
 *
 * Un plan es DINERO —el calendario de lo que un paciente debe— así que se
 * lee con el mismo alcance de "charges" que el cobro del que cuelga: lista
 * blanca (DIRECCION y CAJA), todo o nada. Un ALUMNO no ve el plan de su
 * propio paciente por la misma razón por la que no ve su saldo.
 *
 * ⚠️ No se recorta por SEDE y no es un olvido: la sede vive SELLADA en el
 * COBRO (dónde estaba el mostrador al emitir); el plan es un acuerdo sobre
 * ese cobro y una mensualidad se puede pagar en cualquier mostrador — su
 * corte es el del turno que la cobró, como todo pago.
 */
export function eduPaymentPlanScopeWhere({
  institutionId,
  scope,
}: EduChargeScopeInput): Prisma.EduPaymentPlanWhereInput {
  requireInstitutionId(institutionId, "eduPaymentPlanScopeWhere");
  if (!scope || scope.kind !== "all") return nada(institutionId);
  return { institutionId };
}

/**
 * Lo mismo para las MENSUALIDADES, que se consultan sueltas en "qué vence
 * esta semana". Existe aparte por lo de siempre: el `where` de Prisma es de
 * OTRO modelo, y `{ institutionId }` a mano es el atajo que deja una
 * consulta de dinero fuera del punto único.
 */
export function eduInstallmentScopeWhere({
  institutionId,
  scope,
}: EduChargeScopeInput): Prisma.EduInstallmentWhereInput {
  requireInstitutionId(institutionId, "eduInstallmentScopeWhere");
  if (!scope || scope.kind !== "all") return nada(institutionId);
  return { institutionId };
}

// ── El gasto de IA (Ola 8) ──────────────────────────────────────────────

/**
 * El consumo de IA que le toca ver a quien pregunta: todo, o nada.
 *
 * 🔴 LA OLA 8 NO AGREGÓ UN QUINTO RECURSO, Y ESO ES LO IMPORTANTE. El
 * gasto de IA se lee con el recurso "charges" —el del DINERO— y no con uno
 * propio. La razón es la misma por la que la Ola 3 no inventó un recurso
 * para el expediente: un recurso nuevo que dijera lo mismo solo habría
 * dado un segundo sitio donde equivocarse.
 *
 * Y decir lo mismo es exactamente lo que hace falta aquí: "charges" es una
 * LISTA BLANCA (DIRECCION y CAJA; cualquier otro rol, incluido uno que no
 * exista todavía, cae en "none") y se resuelve ANTES del switch de roles.
 * Eso da el segundo candado del gasto de IA: si alguien le enciende
 * "ia.view" a un alumno desde la pantalla de permisos, el alcance sigue
 * devolviendo "none" y no ve un dólar. El permiso abre la pantalla; el
 * alcance decide las filas.
 *
 * ⚠️ CAJA cae en "all" por venir de "charges", y no pasa nada: caja no
 * lleva "ia.view" en su default, así que no abre la pantalla. Si un día
 * una escuela se lo enciende a propósito, lo que verá es el consumo de IA
 * del instituto — que es dinero, que es lo suyo. Lo que NO puede es
 * tocarlo: eso es "ia.manage", que es otra key.
 *
 * No lleva `now`: el gasto no caduca ni depende de la vigencia de nadie.
 */
export function eduAiUsageScopeWhere({
  institutionId,
  scope,
}: EduChargeScopeInput): Prisma.EduAiUsageWhereInput {
  requireInstitutionId(institutionId, "eduAiUsageScopeWhere");
  if (!scope || scope.kind !== "all") return nada(institutionId);
  return { institutionId };
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

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA SEDE (Ola 11) — OTRA DIMENSIÓN, NO OTRA REGLA
//
// Todo lo de arriba contesta "¿de quién es esta fila?". Esta sección
// contesta otra pregunta distinta: "¿en qué edificio pasó?". Se SUMAN, no
// se sustituyen — un alumno con acceso a las dos sedes sigue viendo solo
// sus casos, y un docente restringido al campus norte sigue viendo a sus
// alumnos vigentes, pero solo lo que ocurre en el norte.
//
// 🔴 LA SEDE NO ES EL TENANT. `institutionId` sigue estando en TODOS los
// `where` de este archivo y no se sustituye por `campusId` en ninguno.
// Filtrar por sede sin institución dejaría la puerta abierta entre
// escuelas — los ids son opacos y dos escuelas pueden tener las dos una
// sede "NORTE" — y el bug se vería exactamente igual que "funciona".
//
// 🔴 `null` NO ES `[]`, y es LA trampa de esta ola:
//   · `campusIds === null`  → sin recorte: todas las sedes del instituto.
//     Es lo que le toca a quien no tiene ninguna fila de acceso (que el
//     día que se aplica esta ola es TODO EL MUNDO — ver campus-core.ts).
//   · `campusIds === []`    → NINGUNA fila. Es lo que le toca a quien
//     tiene filas de acceso y todas apuntan a sedes que ya no existen.
// Confundirlas en el sentido equivocado (`[]` tratado como "sin filtro")
// le abre el instituto entero a alguien a quien se le restringió a una
// sede. Por eso se comprueba con `Array.isArray` y NUNCA con un `if
// (campusIds?.length)`, que trata el arreglo vacío como ausente.
//
// 🔴 QUÉ CUELGA DE LA SEDE Y CÓMO:
//   · SILLÓN  → columna propia (`EduChair.campusId`). Es dónde está.
//   · CITA    → SE DERIVA de su sillón, con un `chair: { campusId }`. Sin
//     columna copiada: una copia se desincroniza el día que un sillón
//     cambia de edificio.
//   · COBRO   → columna propia SELLADA al emitir (`EduCharge.campusId`).
//     No es una copia de nada: es dónde estaba el mostrador.
//   · PACIENTE, CASO, ALUMNO → NO cuelgan de ninguna sede. Un paciente se
//     atiende donde haga falta y un alumno ROTA entre sedes; su padrón y
//     su expediente son UNO solo. Recortarlos por sede partiría el
//     expediente de una persona en dos mitades que nadie vuelve a juntar.
// ═══════════════════════════════════════════════════════════════════════

/**
 * El filtro de sede que se cuelga de una RELACIÓN (hoy: el sillón de una
 * cita). Devuelve `null` cuando no hay recorte, para no meter un
 * `chair: {}` inútil en el `where`.
 *
 * El institutionId se repite DENTRO de la relación a propósito, igual que
 * en `eduStudentScopeFilter`: cierra el tenant aunque un día alguien
 * inserte una fila cruzada a mano.
 */
function eduCampusRelationFilter(
  institutionId: string,
  campusIds: string[] | null | undefined,
): Prisma.EduChairWhereInput | null {
  if (!Array.isArray(campusIds)) return null;
  return { institutionId, campusId: { in: campusIds } };
}

export interface EduChairScopeInput {
  institutionId: string;
  campusIds?: string[] | null;
}

/**
 * Las SEDES a las que entra quien pregunta.
 *
 * ⚠️ Ojo con la columna: aquí el filtro va sobre `id` y no sobre
 * `campusId`. Es el error de copiar-pegar que este helper existe para
 * evitar — un `campusId` sobre la tabla de sedes ni siquiera compila, pero
 * un `{ institutionId }` a secas compila perfectamente y le enseña a
 * alguien las sedes a las que no entra.
 */
export function eduCampusScopeWhere({
  institutionId,
  campusIds,
}: EduChairScopeInput): Prisma.EduCampusWhereInput {
  requireInstitutionId(institutionId, "eduCampusScopeWhere");
  const where: Prisma.EduCampusWhereInput = { institutionId };
  if (Array.isArray(campusIds)) where.id = { in: campusIds };
  return where;
}

/**
 * Los SILLONES que le tocan a quien pregunta.
 *
 * ⚠️ No lleva `scope` de rol y no es un olvido: un sillón es
 * INFRAESTRUCTURA de la escuela, no la fila de nadie. Quien puede verlos
 * (`sillones.view`) los ve todos — lo único que los recorta es la SEDE, que
 * es una pregunta sobre el edificio y no sobre las personas.
 *
 * Existe para que ninguna consulta de sillones vuelva a escribir
 * `{ institutionId, campusId: ... }` a mano: la agenda, la pantalla de
 * sillones y los desplegables de alta tienen que recortar igual, y tres
 * copias del mismo `where` son tres sitios donde discrepar.
 */
export function eduChairScopeWhere({
  institutionId,
  campusIds,
}: EduChairScopeInput): Prisma.EduChairWhereInput {
  requireInstitutionId(institutionId, "eduChairScopeWhere");
  const where: Prisma.EduChairWhereInput = { institutionId };
  if (Array.isArray(campusIds)) where.campusId = { in: campusIds };
  return where;
}

/**
 * ¿Este sillón cae dentro de las sedes que le tocan a quien pregunta?
 *
 * Se usa con el dato YA leído, para las comprobaciones en memoria de las
 * ESCRITURAS: agendar en un sillón de una sede a la que no entras no es un
 * problema de permiso —tienes `agenda.manage`— sino de alcance, y el
 * permiso no sabe de qué edificio es la fila.
 */
export function eduCampusCovers(
  campusIds: string[] | null | undefined,
  campusId: string | null | undefined,
): boolean {
  if (!Array.isArray(campusIds)) return true;
  if (!campusId) return false;
  return campusIds.includes(campusId);
}

// ── WhatsApp (Ola 9) ────────────────────────────────────────────────────

export interface EduWhatsappScopeInput {
  institutionId: string;
  /** El alcance de "patients": de quién puedo ver avisos. */
  patientScope: EduVisibilityScope;
  /** El alcance de "charges": si NO es "all", el dinero no se ve. */
  chargeScope: EduVisibilityScope;
  now?: Date;
}

/**
 * Los AVISOS de WhatsApp que le tocan a quien pregunta.
 *
 * 🔴 NO HAY UN QUINTO RECURSO EN `eduVisibility`, Y ESO ES LO IMPORTANTE.
 *
 * Un mensaje de WhatsApp no es una cosa nueva que ver: es la SOMBRA de la
 * cosa de la que habla. Así que se lee con el alcance de esa cosa, igual
 * que el expediente de la Ola 3 se lee con "cases" aunque cuelgue del
 * paciente:
 *
 *   · el recordatorio y el consentimiento → alcance de "patients" (el
 *     consentimiento ya se leía así desde la Ola 3B: la carta se imprime y
 *     se entrega en el mostrador, así que CAJA la ve);
 *   · el recibo                            → alcance de "charges", que es
 *     TODO o NADA y para DOCENTE y ALUMNO es NADA.
 *
 * 🔴 Y AQUÍ ESTÁ LA TRAMPA QUE ESTA FUNCIÓN EXISTE PARA CERRAR. El cuerpo
 * del aviso de un recibo dice el folio, el total y el saldo. Si la lista de
 * avisos de un paciente se recortara SOLO por "patients", un ALUMNO abriría
 * la ficha de su propio paciente y leería cuánto pagó — que es exactamente
 * lo que la Ola 5 cerró por partida doble y lo que la escuela no quiere que
 * sepa. Por eso el tipo RECIBO se descarta cuando el alcance de dinero no
 * es "all", y por eso esta decisión vive en el punto único y no en la
 * pantalla que lista.
 *
 * ⚠️ Los mensajes NO cuelgan de una relación con EduPatient en Prisma (ver
 * la nota del modelo): el recorte por paciente se aplica con la lista de
 * ids que el llamador ya resolvió con `eduPatientScopeWhere`. Por eso
 * `patientIds` es un parámetro y no un `where` anidado — y por eso
 * `allPatients` existe: sin él, "todos los pacientes" y "ningún paciente"
 * se escribirían igual (`{ patientId: { in: undefined } }` BORRA el filtro,
 * que es el error que no puede pasar).
 */
export function eduWhatsappScopeWhere(
  input: EduWhatsappScopeInput & {
    /** true = sin recorte por paciente (dirección y caja). */
    allPatients: boolean;
    /** Los pacientes visibles, cuando `allPatients` es false. */
    patientIds?: string[];
  },
): Prisma.EduWhatsappMessageWhereInput {
  requireInstitutionId(input.institutionId, "eduWhatsappScopeWhere");
  if (eduScopeIsEmpty(input.patientScope)) return nada(input.institutionId);

  const where: Prisma.EduWhatsappMessageWhereInput = { institutionId: input.institutionId };

  if (!input.allPatients) {
    // Lista VACÍA incluida a propósito: `in: []` no devuelve ninguna fila,
    // que es lo correcto para quien no tiene ni un paciente a la vista.
    where.patientId = { in: input.patientIds ?? [] };
  }

  // El dinero, otra vez, se decide fuera del recorte de pacientes.
  if (!input.chargeScope || input.chargeScope.kind !== "all") {
    where.kind = { not: "RECIBO" };
  }

  return where;
}

/**
 * ¿Puede esta persona MANDAR este tipo de aviso?
 *
 * El permiso abre la pantalla; esto decide el tipo. Se separa del permiso a
 * propósito, y con la misma asimetría de siempre: DOCENTE y ALUMNO comparten
 * "consentimientos.view" con CAJA y los tres pueden mandar la carta, pero el
 * RECIBO solo lo manda quien VE dinero. Es la segunda cerradura del mismo
 * candado que la Ola 5 puso en el permiso — un "caja.view" encendido por
 * error a un alumno sigue sin dejarle mandar un peso.
 *
 * El RECORDATORIO no está en esta lista porque no lo manda nadie: lo manda
 * el cron, que no tiene sesión.
 */
export function eduCanSendWhatsappKind(
  kind: "CONSENTIMIENTO" | "RECIBO",
  chargeScope: EduVisibilityScope,
): boolean {
  if (kind === "RECIBO") return !!chargeScope && chargeScope.kind === "all";
  return true;
}
