/**
 * DaleControl INSTITUCIONAL — EL TRASPASO DE CASO.
 *
 * SERVIDOR: importa prisma. El recorte de filas sale de visibility.ts y lo
 * puro (topes, textos) de evaluacion-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ PASA CUANDO UN ALUMNO ROTA O SE GRADÚA
 *
 * Sus casos abiertos NO se reasignan reescribiendo el `studentId`. Se
 * TRASPASAN, que es otra cosa:
 *
 *   1. el caso viejo se CIERRA como TRANSFERRED (con su `closedAt`);
 *   2. se ABRE uno nuevo con el alumno nuevo, conservando paciente,
 *      especialidad y procedimiento;
 *   3. el nuevo apunta al viejo (`transferredFromCaseId`), con el motivo y
 *      el nombre de quien lo hizo;
 *   4. las citas FUTURAS del caso viejo se mueven al alumno nuevo, para
 *      que el paciente no se quede a medias;
 *   5. el expediente, los estudios y las calificaciones del caso viejo NO
 *      se mueven ni se copian: quedan donde ocurrieron.
 *
 * 🔴 POR QUÉ NO SE REESCRIBE EL ALUMNO. Porque la pregunta que se hace
 * cuando algo sale mal en el sillón es "¿quién lo atendía en marzo?", y un
 * `studentId` reescrito la deja sin respuesta. Es la misma regla que la
 * supervisión de la Ola 1A —que se cierra en vez de editarse— y que la
 * nota firmada de la Ola 3 —que se corrige con otra nota—.
 *
 * 🔴 EL ACCESO CAMBIA DE MANOS EN EL MISMO ACTO, y eso NO se decide aquí:
 * lo decide src/lib/edu/visibility.ts, que descarta los casos TRANSFERRED
 * (y las citas que colgaban de ellos) al armar el `where` de pacientes. Si
 * se decidiera aquí, el segundo camino que traspase un caso —el de una ola
 * futura— nacería sin ese descarte y funcionaría perfectamente: el alumno
 * que se fue seguiría abriendo el expediente del paciente que entregó.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";
import { EDU_CASE_CLOSED_STATUSES } from "@/lib/edu/types";
import {
  eduCaseScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_TRANSFER_MAX_BATCH,
  EDU_TRANSFER_REASON_MAX,
  eduEvalOptionalText,
} from "@/lib/edu/evaluacion-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

export interface EduTransferResult {
  /** El caso NUEVO. */
  id: string;
  /** El que se cerró. */
  fromCaseId: string;
  patientName: string;
  toStudentName: string;
}

export interface EduTransferItem {
  caseId?: unknown;
  toStudentId?: unknown;
}

export interface EduTransferInput extends EduTransferItem {
  reason?: unknown;
}

/**
 * El titular VIGENTE del alumno que RECIBE. Se copia al caso nuevo por lo
 * mismo que en el tamizaje: si hubiera que elegirlo a mano en cada
 * traspaso, la mitad de los casos traspasados acabarían sin responsable —
 * y el responsable es justo lo que hay que poder contestar dentro de un
 * año.
 */
async function currentSupervisorOf(
  tx: Prisma.TransactionClient,
  institutionId: string,
  studentId: string,
  now: Date,
): Promise<string | null> {
  const a = await tx.eduSupervisorAssignment.findFirst({
    where: { institutionId, studentId, ...eduCurrentAssignmentWhere(now) },
    orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
    select: { supervisorUserId: true },
  });
  return a?.supervisorUserId ?? null;
}

/** El alumno que RECIBE, comprobado: de este instituto y ACTIVO. */
async function resolveDestino(
  institutionId: string,
  raw: unknown,
): Promise<{ id: string; programId: string; name: string }> {
  const id = eduCleanId(raw);
  const alumno = id
    ? await prisma.eduStudent.findFirst({
        where: { id, institutionId },
        select: {
          id: true,
          status: true,
          programId: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      })
    : null;
  if (!alumno) throw new EduPadronError("Elige un alumno de este instituto.", 404);
  if (alumno.status !== "ACTIVE") {
    throw new EduPadronError(
      "Ese alumno no está activo en el padrón: no se le pueden traspasar casos.",
    );
  }
  return {
    id: alumno.id,
    programId: alumno.programId,
    name:
      [alumno.user.firstName, alumno.user.lastName].filter(Boolean).join(" ").trim() ||
      alumno.user.email,
  };
}

/**
 * TRASPASA UN CASO. Todo dentro de UNA transacción: si el caso nuevo se
 * creara y el viejo no se cerrara, el paciente quedaría con dos casos
 * abiertos en la misma especialidad y las citas se repartirían entre los
 * dos — que es exactamente el estado que `createEduCase` rechaza.
 */
export async function transferEduCase(
  ctx: EduClinicaContext,
  input: EduTransferInput,
  now: Date = new Date(),
): Promise<EduTransferResult> {
  const institutionId = requireInstitution(ctx);
  const reason = eduEvalOptionalText(input.reason, EDU_TRANSFER_REASON_MAX) ?? null;
  const destino = await resolveDestino(institutionId, input.toStudentId);
  return traspasarUno(ctx, institutionId, input.caseId, destino, reason, now);
}

export interface EduBatchTransferResult {
  ok: EduTransferResult[];
  fallidos: { caseId: string; error: string }[];
}

/**
 * TRASPASO EN LOTE. Al cerrar una generación son decenas de casos.
 *
 * 🔴 Caso por caso y NO todo-o-nada, a propósito. Si el lote entero se
 * cayera porque un caso de los cuarenta ya estaba cerrado, quien cierra la
 * generación tendría que ir a buscar cuál y volver a empezar — y a la
 * tercera vez lo hace uno por uno. Lo que devuelve es la lista de los que
 * pasaron y la de los que no, CON EL MOTIVO de cada fallo.
 *
 * Cada traspaso es su propia transacción: un caso a medio traspasar sería
 * peor que un caso sin traspasar.
 */
export async function transferEduCasesBatch(
  ctx: EduClinicaContext,
  input: { items?: unknown; toStudentId?: unknown; reason?: unknown },
  now: Date = new Date(),
): Promise<EduBatchTransferResult> {
  const institutionId = requireInstitution(ctx);
  const reason = eduEvalOptionalText(input.reason, EDU_TRANSFER_REASON_MAX) ?? null;

  const crudos = Array.isArray(input.items) ? input.items : [];
  if (crudos.length === 0) throw new EduPadronError("No elegiste ningún caso que traspasar.");
  if (crudos.length > EDU_TRANSFER_MAX_BATCH) {
    throw new EduPadronError(
      `Son demasiados casos de una vez (${crudos.length}). El máximo es ${EDU_TRANSFER_MAX_BATCH}.`,
    );
  }

  // Un destino por defecto para todo el lote (lo normal al cerrar una
  // generación) y, si un renglón trae el suyo, ése manda.
  const porDefecto =
    input.toStudentId !== undefined && input.toStudentId !== null && input.toStudentId !== ""
      ? await resolveDestino(institutionId, input.toStudentId)
      : null;

  const cache = new Map<string, Awaited<ReturnType<typeof resolveDestino>>>();
  if (porDefecto) cache.set(porDefecto.id, porDefecto);

  const ok: EduTransferResult[] = [];
  const fallidos: { caseId: string; error: string }[] = [];

  for (const raw of crudos) {
    const item = (typeof raw === "object" && raw !== null ? raw : { caseId: raw }) as
      EduTransferItem;
    const caseId = eduCleanId(item.caseId) ?? "";
    try {
      let destino = porDefecto;
      if (item.toStudentId !== undefined && item.toStudentId !== null && item.toStudentId !== "") {
        const id = eduCleanId(item.toStudentId) ?? "";
        destino = cache.get(id) ?? (await resolveDestino(institutionId, item.toStudentId));
        cache.set(destino.id, destino);
      }
      if (!destino) throw new EduPadronError("Elige a quién se le traspasa este caso.");
      ok.push(await traspasarUno(ctx, institutionId, item.caseId, destino, reason, now));
    } catch (err) {
      fallidos.push({
        caseId,
        error:
          err instanceof EduPadronError
            ? err.message
            : "No se pudo traspasar. Intenta de nuevo.",
      });
      if (!(err instanceof EduPadronError)) {
        console.error("[instituto] traspaso en lote falló en un caso:", err);
      }
    }
  }

  return { ok, fallidos };
}

async function traspasarUno(
  ctx: EduClinicaContext,
  institutionId: string,
  rawCaseId: unknown,
  destino: { id: string; programId: string; name: string },
  reason: string | null,
  now: Date,
): Promise<EduTransferResult> {
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no ve casos clínicos, así que no puede traspasarlos.", 403);
  }

  const caseId = eduCleanId(rawCaseId);
  if (!caseId) throw new EduPadronError("Ese caso no es de este instituto.", 404);

  // 🔴 DENTRO DEL ALCANCE. Un docente solo traspasa los casos de los
  // alumnos que supervisa HOY; un caso que no le toca contesta 404, igual
  // que uno que no existe.
  const caso = await prisma.eduCase.findFirst({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id: caseId },
    select: {
      id: true,
      status: true,
      patientId: true,
      programId: true,
      procedureId: true,
      studentId: true,
      notes: true,
      screeningAppointmentId: true,
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!caso) throw new EduPadronError("Ese caso no es de este instituto.", 404);

  if ((EDU_CASE_CLOSED_STATUSES as string[]).includes(caso.status)) {
    throw new EduPadronError(
      "Ese caso ya está cerrado. Solo se traspasa un caso vivo: uno terminado ya no tiene nada que entregar.",
      409,
    );
  }
  if (caso.studentId === destino.id) {
    throw new EduPadronError("Ese caso ya es de ese alumno.", 409);
  }
  if (caso.programId !== destino.programId) {
    // Un caso de Endodoncia no se le pasa a un alumno de Ortodoncia: la
    // especialidad del caso es la del alumno que lo lleva, y cruzarlas
    // dejaría un requisito contando en el plan equivocado.
    throw new EduPadronError(
      "Ese alumno es de otra especialidad. Un caso se traspasa dentro de la misma especialidad.",
    );
  }

  const nombrePaciente =
    [caso.patient.firstName, caso.patient.lastName].filter(Boolean).join(" ").trim() ||
    "Sin nombre";

  const nuevo = await prisma.$transaction(async (tx) => {
    // 1 · El caso viejo se CIERRA como transferido. Se cierra con
    // `updateMany` y el status todavía abierto: si dos personas traspasan
    // el mismo caso a la vez, la segunda actualiza CERO filas y se rebota
    // en vez de abrir un segundo caso nuevo.
    const cerrado = await tx.eduCase.updateMany({
      where: {
        id: caso.id,
        institutionId,
        status: { notIn: EDU_CASE_CLOSED_STATUSES },
      },
      data: { status: "TRANSFERRED", closedAt: now },
    });
    if (cerrado.count === 0) {
      throw new EduPadronError(
        "Ese caso se cerró mientras traspasabas. Recarga la pantalla.",
        409,
      );
    }

    // 2 · El caso NUEVO, con el alumno nuevo y lo mismo del paciente.
    const supervisorUserId = await currentSupervisorOf(tx, institutionId, destino.id, now);
    const creado = await tx.eduCase.create({
      data: {
        institutionId,
        patientId: caso.patientId,
        studentId: destino.id,
        programId: caso.programId,
        procedureId: caso.procedureId,
        supervisorUserId,
        status: "ASSIGNED",
        openedAt: now,
        notes: caso.notes,
        transferredFromCaseId: caso.id,
        transferReason: reason,
        transferredByUserId: ctx.eduUserId,
      },
      select: { id: true },
    });

    // 3 · La cita de TAMIZAJE del caso viejo, si quedó suelta, se engancha
    // a él. Es lo que impide que el alumno saliente conserve el acceso al
    // paciente por una cita huérfana (ver el bloque largo de
    // visibility.ts). Los casos abiertos antes de la Ola 6 son justamente
    // los que pueden tenerla suelta.
    if (caso.screeningAppointmentId) {
      await tx.eduAppointment.updateMany({
        where: { id: caso.screeningAppointmentId, institutionId, caseId: null },
        data: { caseId: caso.id },
      });
    }

    // 4 · Las citas FUTURAS pasan al alumno nuevo, con su caso y su
    // supervisor. Es la mitad de "sin que el paciente quede a medias": si
    // no se movieran, el martes que viene el paciente llegaría a una cita
    // de alguien que ya no está en la escuela.
    //
    // Solo las AGENDADAS y que todavía no ocurren. Una cita pasada, una
    // cancelada o una en la que el paciente ya está sentado NO se tocan:
    // ocurrieron (o están ocurriendo) con el alumno que las tuvo, y
    // moverlas reescribiría la agenda de un día que ya pasó.
    await tx.eduAppointment.updateMany({
      where: {
        institutionId,
        caseId: caso.id,
        status: "SCHEDULED",
        startsAt: { gt: now },
      },
      data: {
        studentId: destino.id,
        caseId: creado.id,
        supervisorUserId,
      },
    });

    return creado;
  });

  return {
    id: nuevo.id,
    fromCaseId: caso.id,
    patientName: nombrePaciente,
    toStudentName: destino.name,
  };
}

/**
 * Los casos ABIERTOS de un alumno: lo que hay que repartir cuando rota o
 * se gradúa. Dentro del alcance, como todo.
 */
export async function listEduTransferableCases(
  ctx: EduClinicaContext,
  studentId: string,
  now: Date = new Date(),
): Promise<
  {
    id: string;
    patientName: string;
    patientFolio: string;
    programId: string;
    programName: string;
    procedureName: string | null;
    status: string;
    openedAt: string;
    upcomingAppointments: number;
  }[]
> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(studentId);
  if (!id) return [];

  const rows = await prisma.eduCase.findMany({
    where: {
      ...eduCaseScopeWhere({ institutionId, scope, now, studentExtra: { id } }),
      status: { notIn: EDU_CASE_CLOSED_STATUSES },
    },
    orderBy: [{ openedAt: "asc" }],
    select: {
      id: true,
      status: true,
      openedAt: true,
      programId: true,
      patient: { select: { firstName: true, lastName: true, folio: true } },
      program: { select: { name: true } },
      procedure: { select: { name: true } },
      _count: {
        select: {
          appointments: { where: { status: "SCHEDULED", startsAt: { gt: now } } },
        },
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    patientName:
      [c.patient.firstName, c.patient.lastName].filter(Boolean).join(" ").trim() || "Sin nombre",
    patientFolio: c.patient.folio,
    programId: c.programId,
    programName: c.program.name,
    procedureName: c.procedure?.name ?? null,
    status: c.status,
    openedAt: c.openedAt.toISOString(),
    upcomingAppointments: c._count.appointments,
  }));
}
