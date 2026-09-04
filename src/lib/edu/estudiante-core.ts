/**
 * DaleControl INSTITUCIONAL — LA CUENTA DE UN ESTUDIANTE.
 *
 * Módulo PURO y client-safe (sin prisma en runtime, sin "server-only", sin
 * `new Date()` escondido: el `now` siempre se pasa). Aquí viven las formas
 * que viajan a la pantalla y los `where` que las traen; quien los EJECUTA
 * es src/lib/edu/estudiante.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA FICHA PASA POR DOS ALCANCES DISTINTOS Y NO INTERCAMBIABLES
 *
 * Una ficha que mezcla lo académico con lo clínico tiene que preguntar dos
 * veces, porque las dos preguntas tienen respuestas distintas:
 *
 *   · ¿PUEDO ABRIR la ficha de este alumno?  → eduPadronScope
 *       DIRECCION todos · DOCENTE los suyos · ALUMNO ninguno · CAJA ninguno
 *     Es la misma puerta que la lista del padrón: la ficha es el padrón
 *     abierto por una fila, y quien no lista alumnos tampoco abre uno.
 *
 *   · ¿QUÉ VEO DENTRO?                        → eduVisibility(ctx, recurso)
 *     Los pacientes, las citas y los casos se recortan otra vez con el
 *     alcance CLÍNICO. Un docente que abre la ficha de SU alumno no ve por
 *     ella pacientes que no le tocan: el alumno puede haber atendido a
 *     alguien bajo otro titular, y esa puerta no la abre esta pantalla.
 *
 * Confundirlos es la fuga clásica: "ya comprobé que puede abrir la ficha,
 * así que le enseño todo lo de dentro". No. La primera pregunta contesta
 * por la CARPETA; la segunda, por cada PAPEL que hay dentro.
 *
 * ⛔ Y NI UN DATO DE DINERO. `eduVisibility(ctx, "charges")` es `none` para
 * DOCENTE y para ALUMNO, y esta ficha la abren precisamente docentes. No
 * hay adeudos, no hay cobros, no hay saldo: si algún día hacen falta, se
 * piden con el recurso "charges" y se recortan como todo lo demás.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { Prisma } from "@prisma/client";
import type { EduStudentStatus } from "@/lib/edu/types";
import type { EduPadronScope, EduSupervisorRow } from "@/lib/edu/padron-core";
import { eduStudentWhere } from "@/lib/edu/padron-core";
import { eduPatientSearchAnd } from "@/lib/edu/pacientes-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · TOPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * El techo de la tabla de pacientes atendidos.
 *
 * Es el MISMO 300 del padrón y de la lista de casos, y con la misma
 * convención: se piden 301 filas, se devuelven 300 y `truncated` dice que
 * había más. Pedir exactamente 300 no permite distinguir "hay 300" de "hay
 * 300 y pico", que es justo lo que la pantalla necesita decir.
 */
export const EDU_ESTUDIANTE_MAX_PACIENTES = 300;

/** El techo de la agenda y de los casos de la ficha. */
export const EDU_ESTUDIANTE_MAX_FILAS = 300;

// ═══════════════════════════════════════════════════════════════════════
// 2 · LO QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los números de la cabecera.
 *
 * 🔴 `null` NO ES CERO, y la pantalla tiene que pintarlos distinto. Cero es
 * "este alumno no ha atendido a nadie"; null es "a ti no te toca saberlo".
 * Un null pintado como 0 le miente a quien mira sobre el trabajo de una
 * persona, que es peor que no enseñar el dato.
 */
export interface EduEstudianteKpis {
  pacientes: number | null;
  casosAbiertos: number | null;
  casosCerrados: number | null;
  citasCompletadas: number | null;
  /** La próxima cita que tiene agendada (ISO), o null. */
  proximaCitaISO: string | null;
  proximaCitaLabel: string | null;
  /** La última vez que atendió a alguien (cita COMPLETED más reciente). */
  ultimaAtencionISO: string | null;
  ultimaAtencionLabel: string | null;
}

export interface EduEstudianteFicha {
  /** El id de **EduStudent**. Es el de la URL. */
  id: string;
  /** El de su cuenta. NO es el de la URL: ver la trampa de los dos ids. */
  userId: string;
  matricula: string;
  name: string;
  email: string;
  phone: string | null;
  /** La CUENTA está activa (distinto del estado académico de abajo). */
  userIsActive: boolean;

  status: EduStudentStatus;
  semester: number;
  programId: string;
  programName: string;
  cohortId: string;
  cohortName: string;
  enrolledAt: string;
  graduatedAt: string | null;

  /**
   * Sus docentes VIGENTES, el titular primero. Vigente = el predicado único
   * del vertical (eduAssignmentIsCurrent): una asignación cerrada ayer no
   * sale, y una que empieza mañana tampoco.
   */
  supervisors: EduSupervisorRow[];

  kpis: EduEstudianteKpis;
}

/**
 * POR QUÉ ESTE PACIENTE ES "SUYO".
 *
 * Las tres vías son las mismas que decide `eduPatientScopeWhere` para un
 * alumno, más la de "lo trajo". Viajan por separado —y no fundidas en un
 * booleano— porque la pregunta que se hace quien mira la ficha es
 * exactamente ésa: ¿lo atendió, o solo lo refirió?
 */
export interface EduEstudiantePacienteRow {
  patientId: string;
  folio: string;
  name: string;
  ageYears: number | null;
  /** Tiene un caso de este alumno. */
  porCaso: boolean;
  /** Tiene una cita de este alumno. */
  porCita: boolean;
  /** `EduPatient.referredByStudentId` apunta a este alumno ("lo trajo"). */
  porReferido: boolean;
  /** Citas de ESTE alumno con ESTE paciente (todas, no solo las cumplidas). */
  citas: number;
  /** La última cita CUMPLIDA de los dos. null = todavía ninguna. */
  ultimaVisitaISO: string | null;
  /**
   * La misma fecha, ya escrita en el día de calendario del INSTITUTO.
   *
   * ⚠️ Viaja formateada desde el servidor y no se recorta el ISO en la
   * pantalla: `ultimaVisitaISO.slice(0, 10)` da el día en UTC, y una cita de
   * las 19:00 en Tijuana saldría fechada al día siguiente.
   */
  ultimaVisitaLabel: string | null;
  casosAbiertos: number;
  casosCerrados: number;
}

export interface EduEstudiantePacientesPage {
  rows: EduEstudiantePacienteRow[];
  truncated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS `where`
// ═══════════════════════════════════════════════════════════════════════

export interface EduEstudianteFichaWhereInput {
  institutionId: string;
  scope: EduPadronScope;
  studentId: string;
  now?: Date;
}

/**
 * EL ALUMNO, DENTRO DEL ALCANCE ACADÉMICO.
 *
 * 🔴 El id de la URL NO basta y por eso no se consulta por `id` a secas: se
 * pide `eduStudentWhere` (el mismo del padrón, con su recorte por docente
 * vigente) Y ADEMÁS el id. Uno de otra escuela —o de un alumno que no
 * supervisas— no devuelve fila, igual que uno que no existe.
 *
 * 🔴 LOS DOS CASOS TIENEN QUE DAR EL MISMO 404. Un 403 para "existe pero no
 * te toca" confirmaría que esa matrícula existe en esa escuela, que es
 * justo lo que se está tapando.
 *
 * `eduStudentWhere` LANZA sin institutionId (un `undefined` ahí no filtra:
 * Prisma descarta la clave y devuelve el padrón de todos los institutos),
 * así que esta función hereda ese cinturón sin repetirlo.
 */
export function eduEstudianteFichaWhere({
  institutionId,
  scope,
  studentId,
  now = new Date(),
}: EduEstudianteFichaWhereInput): Prisma.EduStudentWhereInput {
  return { ...eduStudentWhere({ institutionId, scope, now }), id: studentId };
}

export interface EduEstudiantePacientesWhereInput {
  institutionId: string;
  /** El alcance CLÍNICO de "patients" (no el del padrón). */
  clinico: Prisma.EduPatientWhereInput;
  studentId: string;
  /** Búsqueda por nombre o folio, ya normalizada. */
  q?: string | null;
}

/**
 * LOS PACIENTES QUE ESTE ALUMNO HA ATENDIDO — y el recorte de quien mira,
 * ENCIMA.
 *
 * Tres vías, cualquiera vale (`OR`):
 *   (a) un CASO suyo;
 *   (b) una CITA suya — existe antes que el caso (la de tamizaje es la que
 *       lo abre), así que sin ella el alumno que hace la valoración no
 *       aparecería atendiendo a quien tiene enfrente;
 *   (c) `referredByStudentId` — "lo trajo". No lo atendió necesariamente,
 *       y por eso la fila lo dice en una columna aparte en vez de fundirlo
 *       con las otras dos.
 *
 * 🔴 Y ENCIMA, EL ALCANCE DE QUIEN MIRA. El `AND` con `clinico` no es
 * decorativo: un DOCENTE que abre la ficha de un alumno suyo NO ve por ella
 * los pacientes que ese alumno atendió bajo otro titular. Abrir la carpeta
 * de alguien no es heredar su llavero.
 *
 * ⚠️ El `institutionId` va explícito aquí ADEMÁS de venir dentro de
 * `clinico`. Es redundante a propósito: si algún día alguien llama a esta
 * función con un `clinico` armado a mano y sin tenant, el filtro sigue
 * puesto. Un `undefined` en esa clave no filtra — Prisma la descarta y
 * devuelve las filas de todas las escuelas.
 */
export function eduEstudiantePacientesWhere({
  institutionId,
  clinico,
  studentId,
  q,
}: EduEstudiantePacientesWhereInput): Prisma.EduPatientWhereInput {
  if (!institutionId || typeof institutionId !== "string") {
    throw new Error(
      "eduEstudiantePacientesWhere sin institutionId: un undefined BORRA el filtro de tenant y devuelve los pacientes de TODOS los institutos",
    );
  }
  if (!studentId || typeof studentId !== "string") {
    throw new Error(
      "eduEstudiantePacientesWhere sin studentId: sin él las tres vías dejan pasar a TODOS los pacientes del alcance",
    );
  }

  const where: Prisma.EduPatientWhereInput = {
    institutionId,
    AND: [
      clinico,
      {
        OR: [
          { cases: { some: { institutionId, studentId } } },
          { appointments: { some: { institutionId, studentId } } },
          { referredByStudentId: studentId },
        ],
      },
    ],
  };

  // 🔴 EL BUSCADOR ES EL DE LA LISTA DE PACIENTES, no uno nuevo. `contains`
  // compara el texto tal cual y `folio`/`firstName` llevan acentos: por ahí
  // es por donde "Rodriguez" no encontraba a "Rodríguez". `eduPatientSearchAnd`
  // ya mira solo la columna normalizada y ya sabe reducir un teléfono a
  // dígitos. Escribir aquí un segundo normalizador es cómo se acaba con dos
  // buscadores que no encuentran lo mismo.
  for (const clausula of eduPatientSearchAnd(q)) {
    (where.AND as Prisma.EduPatientWhereInput[]).push(clausula);
  }

  return where;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL ORDEN Y EL RECORTE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Por ÚLTIMA VISITA, lo más reciente arriba; quien todavía no tiene ninguna
 * va al final.
 *
 * ⚠️ El desempate por folio no es cosmética: sin un orden total, dos
 * pacientes con la misma última visita pueden salir barajados distinto en
 * dos cargas de la misma pantalla, y la lista parece moverse sola.
 *
 * ⚠️ Y `null` al FINAL a mano. En Postgres un `ORDER BY … DESC` pone los
 * NULL PRIMERO, que aquí sería encabezar la lista de "a quién ha atendido"
 * con los que todavía no ha atendido.
 */
export function eduEstudiantePacientesOrden(
  a: EduEstudiantePacienteRow,
  b: EduEstudiantePacienteRow,
): number {
  const av = a.ultimaVisitaISO;
  const bv = b.ultimaVisitaISO;
  if (av && bv && av !== bv) return av < bv ? 1 : -1;
  if (av && !bv) return -1;
  if (!av && bv) return 1;
  return a.folio.localeCompare(b.folio);
}
