/**
 * DaleControl INSTITUCIONAL — LA CLÍNICA EN VIVO contra la base de datos.
 *
 * SERVIDOR: importa prisma. Todo lo que decide algo —cuándo un sillón está
 * ocupado, qué se calla— vive en clinica-viva-core.ts (puro) y en
 * visibility.ts (el punto único del alcance). Aquí solo hay consultas.
 *
 * 🔴 institutionId de la SESIÓN, siempre. Nunca del query ni del body.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA CONSULTA DE CITAS **NO** LLEVA `eduAppointmentScopeWhere`, Y NO ES
 * UN OLVIDO. Es la decisión que hay que entender antes de tocar este
 * archivo.
 *
 * En todas las pantallas anteriores del vertical, "quién ve qué" se resuelve
 * recortando FILAS: un docente pide citas y le llegan las de sus alumnos
 * vigentes. Aquí eso daría un tablero FALSO. Lo que esta pantalla cuenta no
 * es "mis citas": es cuántos SILLONES de la escuela están libres. Con el
 * recorte de filas, los sillones ocupados por alumnos de otro docente
 * saldrían pintados de verde, y la pregunta que el tablero existe para
 * contestar —"¿dónde siento a este paciente?"— tendría una respuesta
 * equivocada. Un tablero que miente sobre el piso es peor que no tenerlo.
 *
 * Así que el recorte cambia de sitio, no desaparece:
 *   · el SILLÓN es infraestructura de la escuela y no la fila de nadie, así
 *     que se lee con `eduChairScopeWhere` — que recorta por SEDE y por
 *     tenant, y por nadie más (misma regla que sillones.ts);
 *   · la CITA se lee de esos sillones, sin recorte por persona…
 *   · …y el DETALLE identificable de cada una —paciente, estudiante,
 *     especialidad— se decide fila por fila con `eduScopeCoversStudent`,
 *     que es el MISMO predicado de vigencia que usa el resto del vertical.
 *     Lo que no le toca a quien mira no sale de este archivo.
 *
 * Consecuencia buscada: DIRECCION ve el piso con nombre y apellido; un
 * DOCENTE ve el piso ENTERO con el detalle solo de sus estudiantes
 * vigentes; y un ALUMNO o CAJA no llegan hasta aquí — `eduLiveFloorVisibility`
 * devuelve "none" y esto lanza 403 antes de la primera consulta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { EDU_MAX_CHAIRS, eduSafeTimeZone } from "@/lib/edu/agenda-core";
import type { EduAppointmentStatus } from "@/lib/edu/types";
import { EDU_APPOINTMENT_TYPE_LABELS, EDU_CASE_STATUS_LABELS } from "@/lib/edu/types";
import type { EduAppointmentType, EduCaseStatus } from "@/lib/edu/types";
import {
  EDU_LIVE_FLOOR_NONE_DETAIL,
  eduChairScopeWhere,
  eduLiveFloorVisibility,
  eduScopeCoversStudent,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_VIVA_MAX_CITAS,
  EDU_VIVA_STATUS,
  EDU_VIVA_VENTANA_HORAS,
  buildEduVivaBoard,
  type EduVivaApptInput,
  type EduVivaBoard,
  type EduVivaChairInput,
} from "@/lib/edu/clinica-viva-core";

export type {
  EduVivaBoard,
  EduVivaCard,
  EduVivaCounts,
  EduVivaSlot,
} from "@/lib/edu/clinica-viva-core";

/**
 * Los estados que se traen de la base: los que el motor sabe pintar.
 *
 * Se DERIVA de EDU_VIVA_STATUS en vez de escribirse a mano — es la misma
 * lista, y dos copias es cómo una consulta acaba trayendo las canceladas y
 * la otra no. Si una ola futura agrega un estado al enum, el Record de
 * clinica-viva-core.ts obliga a decidir y esta consulta se entera sola.
 */
const EDU_VIVA_DB_STATUSES = Object.entries(EDU_VIVA_STATUS)
  .filter(([, v]) => v !== null)
  .map(([k]) => k as EduAppointmentStatus);

/**
 * Cuántas asignaciones de supervisión se leen por estudiante. Son pocas
 * (un titular y, como mucho, algún suplente), pero un `take` evita que una
 * fila con historial de tres años arrastre el tablero.
 */
const EDU_VIVA_MAX_SUPERVISORES = 20;

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function persona(u: { firstName: string; lastName: string } | null | undefined): string {
  if (!u) return "—";
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "—";
}

/**
 * EL CASO, en una línea.
 *
 * Un caso del vertical no tiene folio ni nombre propio: se identifica por
 * lo que se le está haciendo al paciente y en qué punto va. Así que la
 * línea es "procedimiento · estado" y, cuando la cita todavía no cuelga de
 * un caso —la de TAMIZAJE, que es anterior al caso—, el TIPO de la cita,
 * que es la respuesta correcta a "¿qué está pasando en ese sillón?".
 */
function eduVivaCaso(a: {
  type: EduAppointmentType;
  case: { status: EduCaseStatus; procedure: { name: string } | null } | null;
}): string {
  if (!a.case) return EDU_APPOINTMENT_TYPE_LABELS[a.type] ?? "Cita";
  const estado = EDU_CASE_STATUS_LABELS[a.case.status] ?? "";
  const proc = a.case.procedure?.name?.trim();
  if (proc && estado) return `${proc} · ${estado}`;
  return proc || estado || "Caso";
}

/**
 * El tablero del piso clínico, ahora mismo.
 *
 * 🔴 LANZA 403 cuando el alcance no le toca a quien pregunta, y lo hace
 * ANTES de la primera consulta. Es la segunda cerradura: la primera es el
 * permiso `clinica.view` en el endpoint y en la página. Un permiso
 * encendido por error no abre esto.
 */
export async function getEduClinicaViva(
  ctx: EduClinicaContext,
  now: Date = new Date(),
  opciones: {
    /**
     * true = devuelve TAMBIÉN el horario de hoy sillón por sillón.
     *
     * Va apagado por defecto porque lo pide UNA pantalla (el plano) y son
     * decenas de renglones más en un payload que se consulta cada veinte
     * segundos. La consulta a la base es la MISMA: el horario se arma con
     * las citas que ya se trajeron para decidir el color de cada sillón.
     */
    horario?: boolean;
  } = {},
): Promise<EduVivaBoard> {
  const institutionId = requireInstitution(ctx);

  // ── Cerradura 1 de este archivo: el ALCANCE ─────────────────────────
  const scope = eduLiveFloorVisibility(ctx);
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError(EDU_LIVE_FLOOR_NONE_DETAIL, 403);
  }

  // ── Los sillones ────────────────────────────────────────────────────
  // 🔴 `isActive: true`: un sillón dado de baja NO se pinta. Está fuera de
  // servicio y una tarjeta verde que dice "libre" sobre una unidad que
  // nadie puede usar es una invitación a sentar ahí a un paciente.
  //
  // El orden es el de la escuela: primero por SEDE (su orderIndex, luego su
  // nombre para que sea estable) y dentro de cada una por el orden que la
  // dirección le dio a sus unidades, con el número de la pared de desempate.
  const chairs = await prisma.eduChair.findMany({
    where: { ...eduChairScopeWhere({ institutionId, campusIds: ctx.campusIds }), isActive: true },
    orderBy: [
      { campus: { orderIndex: "asc" } },
      { campus: { name: "asc" } },
      { orderIndex: "asc" },
      { number: "asc" },
    ],
    take: EDU_MAX_CHAIRS,
    select: {
      id: true,
      name: true,
      number: true,
      campusId: true,
      campus: { select: { name: true, timezone: true } },
    },
  });

  const sillones: EduVivaChairInput[] = chairs.map((c) => ({
    id: c.id,
    name: c.name,
    number: c.number,
    campusId: c.campusId,
    campusName: c.campus.name,
    campusTimezone: eduSafeTimeZone(c.campus.timezone),
  }));

  // Sin sillones no hay tablero, y tampoco hay a qué colgarle una cita: se
  // devuelve vacío SIN pegarle a la tabla de citas.
  if (sillones.length === 0) {
    return buildEduVivaBoard({ chairs: [], appointments: [], now, horario: opciones.horario });
  }

  // ── Las citas ───────────────────────────────────────────────────────
  // La ventana es de ±12 h en INSTANTES, no un día de calendario, y es a
  // propósito: las sedes pueden estar en husos distintos y "hoy" no es el
  // mismo día en las dos. Lo que se pinta como "siguiente" sí se recorta al
  // día de calendario de SU sede, y eso lo hace el módulo puro.
  const ventanaMs = EDU_VIVA_VENTANA_HORAS * 60 * 60 * 1000;
  const supervisoresWhere: Prisma.EduSupervisorAssignmentWhereInput =
    scope.kind === "supervised"
      ? { institutionId, supervisorUserId: scope.supervisorUserId }
      : // Alcance "all" (dirección): `eduScopeCoversStudent` contesta true
        // sin mirar las asignaciones, así que no se traen. `id: { in: [] }`
        // y no un `where` ausente: ausente traería el historial entero de
        // cada estudiante para tirarlo.
        { id: { in: [] } };

  const citas = await prisma.eduAppointment.findMany({
    where: {
      institutionId,
      // 🔴 El recorte por SEDE viaja aquí, en los ids de los sillones que ya
      // se recortaron arriba: una cita de una sede a la que no entras cuelga
      // de un sillón que no está en esta lista. Es la misma regla de la Ola
      // 11 —la sede de una cita se DERIVA de su sillón— sin repetir el
      // `chair: { campusId }` en un segundo sitio.
      chairId: { in: sillones.map((c) => c.id) },
      startsAt: { gte: new Date(now.getTime() - ventanaMs), lt: new Date(now.getTime() + ventanaMs) },
      status: { in: EDU_VIVA_DB_STATUSES },
    },
    orderBy: [{ startsAt: "asc" }],
    take: EDU_VIVA_MAX_CITAS + 1,
    select: {
      id: true,
      chairId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      // `type` distingue una valoración de una sesión de trabajo: es lo
      // que se lee en el horario y lo que nombra el "caso" de una cita de
      // tamizaje, que por definición todavía no tiene caso.
      type: true,
      // El id del paciente lo pide el botón "Abrir ficha" del plano. NO
      // sale del proceso cuando el detalle está callado: lo corta
      // `eduVivaDetalle` en el módulo puro, en un solo sitio.
      patient: { select: { id: true, firstName: true, lastName: true, folio: true } },
      // El DOCENTE de la cita. Se cae al del caso cuando la cita no lo
      // lleva: son la misma persona en el caso normal, y la cita solo lo
      // guarda aparte cuando ese día supervisa otro.
      supervisor: { select: { id: true, firstName: true, lastName: true } },
      student: {
        select: {
          // `id` es el de EduStudent —el que abre su ficha— y `userId` el de
          // su cuenta. Los dos, porque `eduScopeCoversStudent` necesita el
          // segundo y la ficha el primero. Confundirlos manda a un 404.
          id: true,
          userId: true,
          matricula: true,
          user: { select: { firstName: true, lastName: true } },
          program: { select: { id: true, name: true } },
          supervisors: {
            where: supervisoresWhere,
            take: EDU_VIVA_MAX_SUPERVISORES,
            select: { supervisorUserId: true, startsAt: true, endsAt: true },
          },
        },
      },
      // La especialidad del CASO. Cuando la cita no trae caso —la de
      // tamizaje, que es anterior al caso— se cae a la especialidad del
      // estudiante, que es la suya y es la respuesta correcta a "¿de qué se
      // le está atendiendo?".
      case: {
        select: {
          status: true,
          program: { select: { id: true, name: true } },
          procedure: { select: { name: true } },
          supervisor: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  const truncated = citas.length > EDU_VIVA_MAX_CITAS;
  const usadas = truncated ? citas.slice(0, EDU_VIVA_MAX_CITAS) : citas;

  const appointments: EduVivaApptInput[] = usadas.map((a) => ({
    id: a.id,
    chairId: a.chairId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status as EduAppointmentStatus,
    patientName: persona(a.patient),
    patientFolio: a.patient?.folio ?? "",
    studentName: persona(a.student?.user),
    studentMatricula: a.student?.matricula ?? "",
    specialty: a.case?.program?.name ?? a.student?.program?.name ?? null,
    // Los cuatro de la TARJETA del plano. Van en claro hasta el módulo
    // puro, que es el único que decide qué se calla (misma regla que el
    // nombre del paciente, dos renglones más abajo).
    patientId: a.patient?.id ?? undefined,
    // El de EduStudent, no el de la cuenta: es lo que abre su ficha.
    studentId: a.student?.id ?? undefined,
    specialtyId: a.case?.program?.id ?? a.student?.program?.id ?? null,
    caseLabel: eduVivaCaso(a),
    supervisor:
      persona(a.supervisor ?? a.case?.supervisor ?? null) === "—"
        ? null
        : persona(a.supervisor ?? a.case?.supervisor ?? null),
    // 🔴 EL MISMO orden de preferencia que el NOMBRE de dos renglones
    // arriba (la cita primero, el caso después). Si el id saliera de una
    // fuente y el nombre de la otra, el enlace de "Dra. X" abriría la ficha
    // de otra persona el día que el docente de la cita no es el del caso.
    supervisorUserId: (a.supervisor ?? a.case?.supervisor ?? null)?.id ?? undefined,
    // 🔴 AQUÍ Y EN NINGÚN OTRO SITIO se decide si el nombre del paciente
    // sale de este proceso. Con el MISMO predicado de vigencia que el resto
    // del vertical: una asignación cerrada ayer ya no cuenta.
    detail: eduScopeCoversStudent(
      scope,
      {
        userId: a.student?.userId ?? "",
        supervisors: a.student?.supervisors ?? [],
      },
      now,
    ),
  }));

  return buildEduVivaBoard({
    chairs: sillones,
    appointments,
    now,
    truncated,
    horario: opciones.horario,
  });
}
