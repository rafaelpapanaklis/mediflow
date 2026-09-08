/**
 * DaleControl INSTITUCIONAL — las NOTAS CLÍNICAS contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". Lo
 * puro y compartible vive en expediente-core.ts; aquí solo hay consultas.
 *
 * 🔴 LAS TRES REGLAS DE ORO DE ESTE ARCHIVO
 *
 * 1. TODA función recibe el contexto de sesión y saca de ahí el
 *    institutionId. Ninguna lo acepta suelto, ninguna lo lee de un body.
 *
 * 2. NINGUNA lectura arma su propio recorte: el alcance sale de
 *    `eduClinicalScope` (expediente-core.ts), que es el del recurso
 *    "cases". Para CAJA eso es "none" y el `where` no devuelve una sola
 *    fila — ni con `expediente.view` encendido a mano.
 *
 * 3. NOM-004, y es la que gobierna todo lo demás:
 *      · el AUTOR de una nota es siempre identificable y sale de la SESIÓN;
 *      · el PACIENTE y el ALUMNO salen del CASO, nunca del body: si
 *        vinieran del cliente, se podría escribir una nota en el
 *        expediente de una persona atribuyéndosela a otra;
 *      · una nota FIRMADA no se edita. Se corrige con una nota NUEVA que
 *        la referencia.
 *
 * 4. OLA B · UN BORRADOR SE RETIRA, Y RETIRAR NO ES BORRAR (H-23). Una
 *    nota que se abrió en el paciente equivocado —o que quedó vacía de un
 *    doble clic— se puede sacar del expediente con `deletedAt` +
 *    `deletedById`. La fila se queda; lo que cambia es que TODAS las
 *    lecturas de aquí filtran `deletedAt: null`, así que deja de pintarse,
 *    deja de contar como nota en el Resumen y deja de poder mandarse a
 *    autorizar. Solo un BORRADOR: una ENVIADA se devuelve primero y una
 *    FIRMADA no se retira nunca.
 *
 * Las escrituras NO comprueban permisos: eso lo hace el endpoint con
 * assertEduPermission antes de llamar. Aquí se comprueba la PERTENENCIA,
 * que es lo que un permiso no puede saber.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduOptionalText,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import type { EduRetiradoRow } from "@/lib/edu/estudios-core";
import {
  EDU_RECORD_DIAGNOSIS_MAX,
  EDU_RECORD_MAX_ROWS,
  EDU_RECORD_TEXT_MAX,
  eduClinicalScope,
  eduRecordCanTransition,
  EDU_RECORD_CONTENT_FIELDS,
  EDU_RECORD_EMPTY_DENIED,
  EDU_RECORD_WITHDRAW_DENIED,
  EDU_RECORD_WITHDRAWN_APPROVAL_NOTE,
  eduRecordCanWithdraw,
  eduRecordHasContent,
  eduRecordIsEditable,
  eduRecordStamps,
  eduRecordText,
  parseEduRecordStatus,
  type EduCaseOption,
  type EduRecordPage,
  type EduRecordRow,
} from "@/lib/edu/expediente-core";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * OLA C·2 · LA SESIÓN QUE NECESITAN LAS ESCRITURAS Y LA LECTURA REGISTRADA.
 *
 * `EduClinicaContext` (tenant + alcance) MÁS lo que la BITÁCORA necesita
 * para congelar el nombre. Las lecturas que NO se registran siguen
 * pidiendo solo `EduClinicaContext`.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduExpedienteContext extends EduClinicaContext, EduAuditActor {}
import { EDU_CASE_CLOSED_STATUSES, EDU_ROLE_LABELS, type EduRecordStatus } from "@/lib/edu/types";

export { EduPadronError as EduExpedienteError };
export type { EduRecordRow, EduRecordPage, EduCaseOption } from "@/lib/edu/expediente-core";

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

/**
 * Sello de tiempo legible EN LA ZONA DEL INSTITUTO ("mar 1 sep 14:30").
 *
 * 🔴 `createdAt` es un INSTANTE, no una fecha de calendario, así que aquí
 * NO se usa `formatEduDate` (que formatea en UTC a propósito, para los
 * cumpleaños y los contratos). Pintar un instante en UTC en una escuela de
 * Tijuana pondría una nota de las 19:00 en el día siguiente.
 */
function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

const RECORD_SELECT = {
  id: true,
  status: true,
  subjetivo: true,
  objetivo: true,
  analisis: true,
  plan: true,
  diagnostico: true,
  submittedAt: true,
  signedAt: true,
  correctsId: true,
  createdAt: true,
  updatedAt: true,
  caseId: true,
  patientId: true,
  appointmentId: true,
  studentId: true,
  authorUserId: true,
  case: { select: { program: { select: { name: true } } } },
  student: { select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } } },
  author: { select: { firstName: true, lastName: true, email: true, role: true } },
  signedBy: { select: { firstName: true, lastName: true, email: true } },
  appointment: { select: { id: true, startsAt: true } },
  _count: { select: { correctedBy: true } },
} satisfies Prisma.EduRecordSelect;

type RecordPayload = Prisma.EduRecordGetPayload<{ select: typeof RECORD_SELECT }>;

function toRow(r: RecordPayload, timeZone: string): EduRecordRow {
  const tz = eduSafeTimeZone(timeZone);
  return {
    id: r.id,
    status: r.status,

    subjetivo: r.subjetivo,
    objetivo: r.objetivo,
    analisis: r.analisis,
    plan: r.plan,
    diagnostico: r.diagnostico,

    caseId: r.caseId,
    caseProgramName: r.case.program.name,
    patientId: r.patientId,

    studentId: r.studentId,
    studentName: personName(r.student.user),
    studentMatricula: r.student.matricula,

    authorUserId: r.authorUserId,
    authorName: personName(r.author),
    authorRoleLabel: EDU_ROLE_LABELS[r.author.role] ?? r.author.role,

    appointmentId: r.appointmentId,
    appointmentDayISO: r.appointment ? eduUtcToZoned(r.appointment.startsAt, tz).dayISO : null,
    appointmentLabel: r.appointment ? stampLabel(r.appointment.startsAt, tz) : null,

    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
    signedByName: r.signedBy ? personName(r.signedBy) : null,

    correctsId: r.correctsId,
    correctionsCount: r._count.correctedBy,

    createdAt: r.createdAt.toISOString(),
    createdLabel: stampLabel(r.createdAt, tz),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿Puede esta persona abrir el expediente de este paciente?
 *
 * Devuelve el paciente o null. El id de la URL NO basta: la fila se busca
 * con el `where` del alcance CLÍNICO, así que un paciente de otra escuela
 * —o de otro alumno, o cualquiera si quien pregunta es caja— se ve
 * exactamente igual que uno que no existe. Es lo que debe pasar: un 403
 * confirmaría que ese folio existe.
 *
 * Lo usan los TRES módulos de esta ola (notas, odontograma y estudios): es
 * la única puerta del expediente.
 */
export async function getEduClinicalPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<{
  id: string;
  folio: string;
  firstName: string;
  lastName: string;
  /**
   * Dentición TEMPORAL (Ola B). Lo captura la ficha del paciente; aquí solo
   * se LEE, y viaja en esta puerta —y no en una consulta aparte— porque
   * quien lo necesita es el odontograma, que ya pasa por aquí
   * obligatoriamente. Una segunda consulta para un booleano sería un viaje
   * más al pooler en la pantalla que más se abre desde un teléfono.
   */
  isChild: boolean;
} | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;

  return prisma.eduPatient.findFirst({
    // 🔴 `eduPatientScopeWhere` con el alcance de "cases", no con el de
    // "patients". Para caja, "patients" es `all` y "cases" es `none`: con
    // el alcance equivocado, caja abriría el expediente de toda la escuela.
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, folio: true, firstName: true, lastName: true, isChild: true },
  });
}

/**
 * Las notas de un paciente, más recientes primero.
 *
 * El recorte cuelga del CASO (`case: {…}`) y no del paciente: un alumno que
 * lleva la endodoncia de esta señora NO lee las notas de su ortodoncia, que
 * son de otro alumno y de otro docente. Que pueda abrir la ficha del
 * paciente no le da su expediente completo.
 *
 * 🔴 SE PIDE UNA DE MÁS (`MAX + 1`) PARA PODER DECIRLO. Con `take: MAX` a
 * secas, doscientas notas y doscientas cuarenta se ven exactamente igual
 * desde aquí: la consulta devuelve 200 en los dos casos y no hay forma de
 * saber cuál era. La fila sobrante no se pinta —se descarta al cortar— y
 * su único trabajo es encender `truncated`, que es lo que la pantalla
 * convierte en un aviso. En un expediente clínico callarlo es peor que
 * tardar: quien busca la nota de la primera sesión de un caso largo
 * concluye que no existe.
 */
export async function listEduPatientRecords(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  options: { caseId?: string | null } = {},
  now: Date = new Date(),
): Promise<EduRecordPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };
  const id = eduCleanId(patientId);
  if (!id) return { rows: [], truncated: false };

  const where: Prisma.EduRecordWhereInput = {
    institutionId,
    patientId: id,
    // 🔴 Ola B · las RETIRADAS no viajan, y el recorte va en el `where` y
    // no en un `.filter()` después: un recorte fuera de la consulta es un
    // recorte que el siguiente `findMany` se olvida de copiar. Además
    // arruinaría el `truncated` de abajo, que cuenta filas traídas.
    deletedAt: null,
    case: eduCaseScopeWhere({ institutionId, scope, now }),
  };
  const caseId = eduCleanId(options.caseId);
  if (caseId) where.caseId = caseId;

  const rows = await prisma.eduRecord.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: EDU_RECORD_MAX_ROWS + 1,
    select: RECORD_SELECT,
  });

  return {
    truncated: rows.length > EDU_RECORD_MAX_ROWS,
    rows: rows.slice(0, EDU_RECORD_MAX_ROWS).map((r) => toRow(r, timeZone)),
  };
}

/**
 * Los casos de ESTE paciente que le tocan a quien pregunta, en la forma
 * mínima del `<select>` de "¿a qué caso va esta nota?".
 *
 * Se reusa el mismo recorte de las notas para que no exista un caso que
 * aparece en el desplegable y luego el POST rechaza.
 */
export async function listEduPatientCaseOptions(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<EduCaseOption[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(patientId);
  if (!id) return [];

  const rows = await prisma.eduCase.findMany({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), patientId: id },
    orderBy: [{ openedAt: "desc" }],
    take: 50,
    select: {
      id: true,
      status: true,
      program: { select: { name: true } },
      student: {
        select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    programName: c.program.name,
    studentName: personName(c.student.user),
    studentMatricula: c.student.matricula,
    isOpen: !(EDU_CASE_CLOSED_STATUSES as string[]).includes(c.status),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * El caso al que va la nota, comprobado DENTRO del alcance.
 *
 * Devuelve además su paciente y su alumno, que es de donde salen esas dos
 * columnas de la nota: si vinieran del body, se podría escribir una nota
 * en el expediente de una persona y atribuírsela a otra.
 */
async function resolveCase(
  institutionId: string,
  ctx: EduClinicaContext,
  rawCaseId: unknown,
  now: Date,
): Promise<{ id: string; patientId: string; studentId: string; status: string }> {
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no abre expedientes clínicos.", 403);
  }
  const caseId = eduCleanId(rawCaseId);
  const caso = caseId
    ? await prisma.eduCase.findFirst({
        where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id: caseId },
        select: { id: true, patientId: true, studentId: true, status: true },
      })
    : null;
  if (!caso) throw new EduPadronError("Ese caso no existe o no te toca.", 404);
  return caso;
}

export interface EduRecordInput {
  caseId?: unknown;
  appointmentId?: unknown;
  subjetivo?: unknown;
  objetivo?: unknown;
  analisis?: unknown;
  plan?: unknown;
  diagnostico?: unknown;
  /** La nota FIRMADA a la que ésta corrige. */
  correctsId?: unknown;
}

/**
 * Escribe una nota nueva. Nace SIEMPRE en BORRADOR.
 *
 * No se crea directamente firmada aunque quien escriba tenga todos los
 * permisos: firmar es un acto aparte, con su propia petición y su propio
 * sello de tiempo. Crear-y-firmar en un solo POST haría que un doble clic
 * dejara dos notas firmadas idénticas en un expediente que ya no se puede
 * editar.
 */
export async function createEduRecord(
  ctx: EduExpedienteContext,
  patientId: string,
  input: EduRecordInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const caso = await resolveCase(institutionId, ctx, input.caseId, now);

  // 🔴 El caso tiene que ser DE ESTE paciente, el de la URL.
  //
  // Sin esta línea, un POST a /pacientes/A/expediente con el `caseId` de un
  // caso de B —uno que quien escribe SÍ puede ver, así que el alcance no
  // dice nada— escribiría la nota en el expediente de B. No es una fuga de
  // datos: es peor, es una nota clínica en la persona equivocada. Y como
  // paciente y alumno se derivan del caso, la fila quedaría internamente
  // coherente y nadie la encontraría nunca.
  const esperado = eduCleanId(patientId);
  if (!esperado || caso.patientId !== esperado) {
    throw new EduPadronError("Ese caso no es de este paciente.", 404);
  }

  // La cita, si la nota documenta una sesión concreta. Tiene que ser del
  // MISMO paciente: una nota colgada de la cita de otra persona rompe la
  // línea de tiempo del expediente de los dos.
  let appointmentId: string | null = null;
  if (input.appointmentId !== undefined && input.appointmentId !== null && input.appointmentId !== "") {
    const id = eduCleanId(input.appointmentId);
    const cita = id
      ? await prisma.eduAppointment.findFirst({
          where: { id, institutionId, patientId: caso.patientId },
          select: { id: true },
        })
      : null;
    if (!cita) throw new EduPadronError("Esa cita no es de este paciente.", 404);
    appointmentId = cita.id;
  }

  // La nota a la que corrige. Solo se corrige lo FIRMADO: una nota en
  // borrador o entregada se arregla editándola, y encadenar correcciones a
  // borradores llenaría el expediente de versiones de algo que nunca se
  // cerró.
  let correctsId: string | null = null;
  if (input.correctsId !== undefined && input.correctsId !== null && input.correctsId !== "") {
    const id = eduCleanId(input.correctsId);
    const previa = id
      ? await prisma.eduRecord.findFirst({
          // Una nota retirada no se corrige: no está en el expediente.
          where: { id, institutionId, caseId: caso.id, deletedAt: null },
          select: { id: true, status: true },
        })
      : null;
    if (!previa) throw new EduPadronError("Esa nota no es de este caso.", 404);
    if (previa.status !== "FIRMADA") {
      throw new EduPadronError(
        "Solo se corrige una nota FIRMADA. Ésa todavía se puede editar directamente.",
      );
    }
    correctsId = previa.id;
  }

  // ══════════════════════════════════════════════════════════════════
  // 🔴 H-23 · UNA NOTA NACE CON ALGO ESCRITO. LO EXIGE EL SERVIDOR.
  //
  // El botón de la pantalla ya lo pedía (`!tieneAlgo(draft)` apaga
  // "Guardar" en expediente-screen.tsx), pero eso es una cortesía de la
  // pantalla y no una regla del expediente: un POST a mano, un doble clic
  // que manda el formulario vacío o el siguiente cliente que se escriba
  // creaban una nota sin una sola palabra, que después hay que RETIRAR
  // —con su fila de baja y su firma— para sacarla de en medio.
  //
  // Se comprueba sobre el texto YA SANEADO (`eduRecordText` recorta y
  // devuelve undefined si solo había espacios), que es lo que se va a
  // guardar, y no sobre el body crudo.
  // ══════════════════════════════════════════════════════════════════
  const contenido = {
    subjetivo: eduRecordText(input.subjetivo, EDU_RECORD_TEXT_MAX) ?? null,
    objetivo: eduRecordText(input.objetivo, EDU_RECORD_TEXT_MAX) ?? null,
    analisis: eduRecordText(input.analisis, EDU_RECORD_TEXT_MAX) ?? null,
    plan: eduRecordText(input.plan, EDU_RECORD_TEXT_MAX) ?? null,
    diagnostico: eduRecordText(input.diagnostico, EDU_RECORD_DIAGNOSIS_MAX) ?? null,
  };
  if (!eduRecordHasContent(contenido)) {
    throw new EduPadronError(EDU_RECORD_EMPTY_DENIED);
  }

  const created = await prisma.eduRecord.create({
    data: {
      institutionId,
      caseId: caso.id,
      // 🔴 Del CASO, no del body.
      patientId: caso.patientId,
      studentId: caso.studentId,
      // 🔴 De la SESIÓN, no del body. NOM-004: el autor siempre
      // identificable, y siempre el de verdad.
      authorUserId: ctx.eduUserId,
      appointmentId,
      correctsId,
      status: "BORRADOR",
      ...contenido,
    },
    select: { id: true },
  });

  // 🔴 LA BITÁCORA NO GUARDA EL TEXTO DE LA NOTA. Una SOAP es dato de
  // salud y `edu_audit_logs` se abre desde dirección entera: se registra
  // QUE se escribió una nota, en qué caso y de qué paciente. El contenido
  // vive en el expediente, que es donde la lectura también queda escrita.
  await eduAudit(ctx, {
    action: "create",
    entity: "record",
    entityId: created.id,
    patientId: caso.patientId,
    after: { caseId: caso.id, status: "BORRADOR" },
  });

  return created;
}

/**
 * Edita el contenido de una nota y/o la mueve de estado.
 *
 * 🔴 LA REGLA DE LA NOM-004 SE APLICA AQUÍ Y NO EN EL ENDPOINT: una nota
 * FIRMADA rebota TODO —texto, diagnóstico, cita y estado— aunque quien lo
 * intente sea la dirección del instituto. No es un permiso que falte: es
 * que un expediente que se puede reescribir deja de ser un registro de lo
 * que pasó.
 *
 * 🔴 CIERRE (P2-13) · FIRMAR EXIGE "expediente.sign", Y SE COMPRUEBA AQUÍ.
 * `canSign` llega resuelto del endpoint (como `canManage` en la agenda),
 * pero la puerta vive en ESTA función y no en el route: todo camino que
 * mueva una nota pasa por aquí, y el segundo endpoint que lo haga —el de
 * una ola futura— nacería sin la puerta y firmaría perfectamente. Para
 * todo el mundo. El alumno (write, sin sign) escribe, ENTREGA y devuelve;
 * la FIRMADA la pone quien responde. Quien tiene sign puede firmar una
 * nota propia: la separación es por responsabilidad, no por autoría.
 *
 * El caso y el paciente de la nota NO se cambian nunca. Una nota escrita en
 * el caso equivocado se anula con una corrección, igual que en papel.
 */
export async function updateEduRecord(
  ctx: EduExpedienteContext,
  recordId: string,
  input: EduRecordInput & { status?: unknown },
  options: { canSign: boolean },
  now: Date = new Date(),
): Promise<{ id: string; status: EduRecordStatus }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  const id = eduCleanId(recordId);
  if (!id) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  // Se busca DENTRO del alcance: una nota que no le toca a quien pregunta
  // se ve igual que una que no existe.
  const actual = await prisma.eduRecord.findFirst({
    where: {
      institutionId,
      id,
      // Una nota RETIRADA no se edita ni se mueve de estado: para el
      // expediente ya no está, y contestar 404 es lo mismo que contesta
      // una que no le toca a quien pregunta.
      deletedAt: null,
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    select: {
      id: true,
      status: true,
      caseId: true,
      patientId: true,
      submittedAt: true,
      subjetivo: true,
      objetivo: true,
      analisis: true,
      plan: true,
      diagnostico: true,
    },
  });
  if (!actual) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  if (!eduRecordIsEditable(actual.status)) {
    throw new EduPadronError(
      "Esa nota está FIRMADA y no se modifica. Si hay algo que corregir, escribe una nota nueva que la corrija: así queda el registro de las dos.",
      409,
    );
  }

  const data: Prisma.EduRecordUpdateInput = {};

  if (input.subjetivo !== undefined) {
    data.subjetivo = eduRecordText(input.subjetivo, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.objetivo !== undefined) {
    data.objetivo = eduRecordText(input.objetivo, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.analisis !== undefined) {
    data.analisis = eduRecordText(input.analisis, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.plan !== undefined) {
    data.plan = eduRecordText(input.plan, EDU_RECORD_TEXT_MAX) ?? null;
  }
  if (input.diagnostico !== undefined) {
    data.diagnostico = eduRecordText(input.diagnostico, EDU_RECORD_DIAGNOSIS_MAX) ?? null;
  }

  if (input.appointmentId !== undefined) {
    if (input.appointmentId === null || input.appointmentId === "") {
      data.appointment = { disconnect: true };
    } else {
      const apptId = eduCleanId(input.appointmentId);
      const cita = apptId
        ? await prisma.eduAppointment.findFirst({
            where: { id: apptId, institutionId, patientId: actual.patientId },
            select: { id: true },
          })
        : null;
      if (!cita) throw new EduPadronError("Esa cita no es de este paciente.", 404);
      data.appointment = { connect: { id: cita.id } };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 🔴 S-3 · REESCRIBIR UNA NOTA ENTREGADA REFRESCA LA ENTREGA.
  //
  // Una nota ENVIADA sigue siendo editable, y eso es deliberado: es el
  // mismo criterio que la receta PENDIENTE —quien ve el dedazo lo corrige
  // sin tener que pedir que se lo devuelvan—. Lo que NO era deliberado es
  // que `submittedAt` se quedara con la hora de la PRIMERA entrega: el
  // docente leía "entregada a las 9:10", firmaba, y lo que firmaba era un
  // texto de las 11:40 que nunca vio marcado como nuevo.
  //
  // La receta tiene un hash que vence la firma cuando la editan después de
  // mandarla (Ola 4). El expediente NO tiene esa maquinaria y no se le
  // inventa una aquí: se hace lo mínimo que vuelve honesta la fila, que es
  // que "entregada" diga cuándo se entregó ESTO. La bandeja del docente
  // reordena sola y una nota tocada vuelve a subir.
  //
  // Solo cuenta un cambio REAL del contenido: guardar sin tocar nada —o
  // firmar en el mismo PATCH, que ya trae su propio sello— no reabre nada.
  // ══════════════════════════════════════════════════════════════════
  const cambioElTexto = EDU_RECORD_CONTENT_FIELDS.some(
    (f) => data[f] !== undefined && (data[f] as string | null) !== actual[f],
  );
  if (actual.status === "ENVIADA" && cambioElTexto && input.status === undefined) {
    data.submittedAt = now;
  }

  let siguiente: EduRecordStatus = actual.status;
  if (input.status !== undefined) {
    const st = parseEduRecordStatus(input.status);
    if (!st) throw new EduPadronError("Ese estado de nota no existe.");
    if (st !== actual.status) {
      if (!eduRecordCanTransition(actual.status, st)) {
        throw new EduPadronError(
          `Una nota ${actual.status.toLowerCase()} no puede pasar a ${st.toLowerCase()}.`,
          409,
        );
      }

      // 🔴 P2-13 · FIRMAR ES DE QUIEN RESPONDE. Sin esto, "ENVIADA" era
      // decorativo: el alumno escribía, se firmaba y cerraba sin que su
      // docente viera la nota nunca.
      if (st === "FIRMADA" && !options.canSign) {
        throw new EduPadronError(
          "Firmar una nota necesita el permiso expediente.sign. Entrégala (ENVIADA) y la firma tu docente.",
          403,
        );
      }

      const sellos = eduRecordStamps(st, now, ctx.eduUserId, { submittedAt: actual.submittedAt });
      data.status = st;
      data.submittedAt = sellos.submittedAt;
      data.signedAt = sellos.signedAt;
      // `signedBy` se conecta o se desconecta; nunca se escribe el id a
      // pelo, que en Prisma es un campo de relación y no compila.
      data.signedBy = sellos.signedByUserId
        ? { connect: { id: sellos.signedByUserId } }
        : { disconnect: true };
      siguiente = st;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 🔴 H-23 · LA NOTA VACÍA SE COMPRUEBA SIEMPRE, NO SOLO AL CAMBIAR DE ESTADO.
  //
  // Este chequeo vivía DENTRO del `if (input.status !== undefined)`, así
  // que un PATCH que solo mandaba texto —el "Guardar" del modal de
  // edición— podía dejar en blanco los cinco campos de una nota ENVIADA y
  // el servidor lo aceptaba: el docente abría la bandeja y encontraba una
  // página en blanco esperando su firma, con la hora de entrega intacta.
  //
  // Ahora se juzga por el ESTADO EN EL QUE VA A QUEDAR (`siguiente`) y con
  // lo que va a quedar guardado (lo de la base MÁS lo que llega en este
  // mismo PATCH): escribir y firmar en una sola petición sigue pasando, y
  // vaciar una ENVIADA sin tocar su estado ya no.
  //
  // Un BORRADOR SÍ se puede quedar vacío, y es deliberado: es un papel a
  // medio escribir, y para el que nunca debió existir está "Retirar"
  // (H-23), que deja su fila con quién y cuándo.
  // ══════════════════════════════════════════════════════════════════
  if (siguiente !== "BORRADOR") {
    const final = {
      subjetivo: (data.subjetivo as string | null | undefined) ?? actual.subjetivo,
      objetivo: (data.objetivo as string | null | undefined) ?? actual.objetivo,
      analisis: (data.analisis as string | null | undefined) ?? actual.analisis,
      plan: (data.plan as string | null | undefined) ?? actual.plan,
      diagnostico: (data.diagnostico as string | null | undefined) ?? actual.diagnostico,
    };
    if (!eduRecordHasContent(final)) {
      throw new EduPadronError(EDU_RECORD_EMPTY_DENIED);
    }
  }

  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  await prisma.eduRecord.update({ where: { id: actual.id }, data });

  // 🔴 FIRMAR ES `sign`, NO `update`. Son dos actos distintos y la
  // pregunta de una auditoría es distinta ("¿quién firmó esta nota?" no es
  // "¿quién la editó?"). El catálogo de acciones tiene las dos, así que no
  // hay que elegir.
  //
  // Los CAMPOS que cambiaron se cuentan, no se copian: ver el renglón de
  // `createEduRecord`.
  const tocados = Object.keys(data).filter((k) => k !== "signedAt" && k !== "signedById");
  await eduAudit(ctx, {
    action: siguiente === "FIRMADA" && actual.status !== "FIRMADA" ? "sign" : "update",
    entity: "record",
    entityId: actual.id,
    patientId: actual.patientId,
    before: { status: actual.status },
    after: { status: siguiente, campos: tocados.join(", ").slice(0, 300) || "—" },
  });

  return { id: actual.id, status: siguiente };
}

/**
 * RETIRAR UN BORRADOR — baja lógica, con autor (H-23, Ola B).
 *
 * 🔴 QUÉ PROBLEMA RESUELVE, PORQUE NO ES "UN BOTÓN DE BORRAR". Una nota se
 * podía abrir en el paciente equivocado, o quedar completamente vacía de un
 * doble clic, y ya no había forma de sacarla: el expediente se quedaba con
 * ella para siempre, contándose como nota en el Resumen y ofreciéndose en
 * el desplegable de "¿qué mando a autorizar?". La única salida era pedirle
 * a alguien que la editara para que dijera "esto no va".
 *
 * 🔴 Y QUÉ **NO** RESUELVE, que es la mitad importante:
 *   · SOLO un BORRADOR (`eduRecordCanWithdraw`). Una ENVIADA está en la
 *     bandeja de un docente que puede haberla leído: se devuelve primero.
 *     Una FIRMADA no se retira NUNCA — es la NOM-004, y se corrige con una
 *     nota nueva que la referencia.
 *   · la fila NO se borra. `deletedAt` + `deletedById` dejan quién la
 *     retiró y cuándo. Un expediente del que se puede hacer desaparecer una
 *     página deja de ser el registro de lo que pasó.
 *
 * 🔴 OLA C·2 · EL MOTIVO, Y POR QUÉ ES **OPCIONAL**.
 *
 * La Ola B lo dejó fuera con este argumento, y era bueno: «retirar un
 * borrador vacío no es un acto clínico que haya que justificar por escrito,
 * y un campo de motivo obligatorio en el sitio equivocado solo produce
 * "asdf"». Lo que faltaba era la COLUMNA — y ya está
 * (`edu_records.deleteReason`, Ola C·base). Así que ahora se PIDE y no se
 * EXIGE: quien retira la nota que abrió en el paciente equivocado escribe
 * por qué en dos palabras, y quien retira un borrador vacío le da a
 * "Retirar" y sale. Es la misma decisión que el motivo de archivar una
 * receta rechazada, y por la misma razón.
 *
 * 🔴 Y AHORA SE PUEDEN LEER (`listEduPatientRecordsRetiradas`). Un motivo
 * obligatorio que ninguna pantalla enseña es peor que ninguno: fue el
 * hallazgo N-16 en los estudios y las fotos, y no se repite aquí.
 *
 * `updateMany` con `deletedAt: null` en el `where` y no `update`: retirar
 * dos veces (un doble clic, una pestaña vieja) no reescribe la firma de
 * quien la retiró de verdad, ni lanza P2025 en la cara de nadie.
 */
export const EDU_RECORD_DELETE_REASON_MAX = 500;

export async function withdrawEduRecord(
  ctx: EduExpedienteContext,
  recordId: string,
  body: { reason?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  const id = eduCleanId(recordId);
  if (!id) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  // Se busca DENTRO del alcance, igual que en updateEduRecord: una nota que
  // no le toca a quien pregunta se ve exactamente igual que una que no
  // existe. Y una ya retirada también da 404, que es lo que es.
  const actual = await prisma.eduRecord.findFirst({
    where: {
      institutionId,
      id,
      deletedAt: null,
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    select: { id: true, status: true, patientId: true },
  });
  if (!actual) throw new EduPadronError("Esa nota no existe o no te toca.", 404);

  if (!eduRecordCanWithdraw(actual.status)) {
    throw new EduPadronError(EDU_RECORD_WITHDRAW_DENIED, 409);
  }

  const reason = eduOptionalText(body?.reason, EDU_RECORD_DELETE_REASON_MAX) ?? null;

  // ══════════════════════════════════════════════════════════════════
  // 🔴 N-1 · RETIRAR LA NOTA CIERRA SUS PETICIONES DE AUTORIZACIÓN.
  //
  // Un BORRADOR se puede mandar a autorizar, y retirarlo después dejaba la
  // petición PENDING viva: la bandeja la pintaba con el resumen de una nota
  // que ninguna lectura del expediente devuelve ya, el docente la firmaba
  // con su cédula, y la puerta del caso avanzaba de etapa sobre una página
  // que no está en el expediente. El modal de la pantalla promete justo lo
  // contrario ("deja de poder mandarse a autorizar").
  //
  // Se cierran como CHANGES_REQUESTED, con `decidedAt` y SIN `decidedById`:
  // es EXACTAMENTE el patrón que ya usa el reenvío en
  // `requestEduApproval` (autorizaciones.ts), y por la misma razón — nadie
  // la decidió, la cerró un hecho. No se usa EXPIRED, que en este vertical
  // significa "se firmó y luego el contenido cambió" y haría que las
  // pantallas dijeran que hubo una firma que nunca existió
  // (autorizaciones-core.ts:752-754). Y no se BORRA ninguna fila: las
  // filas son el historial de qué se pidió y cuándo.
  //
  // Las dos escrituras van en UNA transacción: una nota retirada con su
  // petición todavía esperando firma es el agujero entero, y un corte de
  // red entre dos escrituras sueltas lo reabre.
  //
  // El `deletedAt: null` de `loadTargets` (autorizaciones.ts) es la otra
  // mitad, y hace falta igual: cubre las peticiones de notas retiradas
  // ANTES de este arreglo, que ya están en la base.
  // ══════════════════════════════════════════════════════════════════
  await prisma.$transaction(async (tx) => {
    await tx.eduRecord.updateMany({
      where: { id: actual.id, institutionId, deletedAt: null },
      data: { deletedAt: now, deletedById: ctx.eduUserId, deleteReason: reason },
    });

    await tx.eduCaseApproval.updateMany({
      where: {
        institutionId,
        targetType: "EduRecord",
        targetId: actual.id,
        status: "PENDING",
      },
      data: {
        status: "CHANGES_REQUESTED",
        decidedAt: now,
        decisionNote: EDU_RECORD_WITHDRAWN_APPROVAL_NOTE,
      },
    });
  });

  await eduAudit(ctx, {
    action: "delete",
    entity: "record",
    entityId: actual.id,
    patientId: actual.patientId,
    before: { status: actual.status, deletedAt: null },
    after: { deletedAt: now, deleteReason: reason ?? "—" },
  });

  return { id: actual.id };
}

/**
 * LAS NOTAS RETIRADAS de un paciente, con su motivo (N-16 aplicado al
 * expediente).
 *
 * 🔴 EXISTE PORQUE UN MOTIVO QUE NADIE LEE NO ES UNA CONSTANCIA. Es
 * exactamente el hallazgo que la Ola C cerró en estudios y fotos: se pedía
 * el motivo, se guardaba en `deleteReason`, y la única forma de leerlo era
 * abrir Postgres. Aquí se pinta en la sección plegada «Retiradas», con la
 * MISMA forma (`EduRetiradoRow`) que las otras dos.
 *
 * 🔴 EL MISMO RECORTE QUE LAS VIVAS: cuelga del CASO, no del paciente. Un
 * alumno que lleva la endodoncia no lee las notas retiradas de la
 * ortodoncia, igual que no lee las vivas.
 */
export const EDU_RECORD_RETIRADAS_MAX_ROWS = 60;

export async function listEduPatientRecordsRetiradas(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduRetiradoRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(patientId);
  if (!id) return [];

  const rows = await prisma.eduRecord.findMany({
    where: {
      institutionId,
      patientId: id,
      deletedAt: { not: null },
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    orderBy: [{ deletedAt: "desc" }],
    take: EDU_RECORD_RETIRADAS_MAX_ROWS,
    select: {
      id: true,
      createdAt: true,
      deletedAt: true,
      deleteReason: true,
      case: { select: { program: { select: { name: true } } } },
      deletedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const tz = eduSafeTimeZone(timeZone);
  return rows.map((r) => ({
    id: r.id,
    // El QUÉ de una nota retirada no puede ser su texto —es dato clínico y
    // esta sección la ve todo el que ve el expediente— así que se rotula
    // con lo que la identifica sin contarla: de qué caso era y de cuándo.
    que: `Nota del ${eduFormatDayShort(eduUtcToZoned(r.createdAt, tz).dayISO)} · ${
      r.case?.program?.name ?? "sin caso"
    }`,
    quien: r.deletedBy
      ? [r.deletedBy.firstName, r.deletedBy.lastName].filter(Boolean).join(" ").trim() ||
        r.deletedBy.email ||
        ""
      : "",
    cuando: r.deletedAt
      ? `${eduFormatDayShort(eduUtcToZoned(r.deletedAt, tz).dayISO)} ${eduFormatTime(r.deletedAt, tz)}`
      : "",
    porQue: r.deleteReason ?? "",
  }));
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * REGISTRA QUE ALGUIEN **ABRIÓ** EL EXPEDIENTE (NOM-024 §6.3.5).
 *
 * 🔴 ESTA ES LA MITAD QUE SIEMPRE FALTA. Una bitácora que solo apunta
 * escrituras contesta «¿quién cambió esto?» y no contesta «¿QUIÉN LEYÓ EL
 * EXPEDIENTE DE MI PACIENTE?», que es la pregunta con la que llega una
 * queja de privacidad. El dental ya lo hace en el `page.tsx` de su ficha
 * (fila 21 del informe); esto es lo mismo para el instituto.
 *
 * 🔴 SE LLAMA DESDE EL `page.tsx` DE LA PESTAÑA, no desde `listEduPatientRecords`.
 * La lista se usa también desde sitios que NO son «abrir el expediente»
 * (el resumen de la ficha, la bandeja del docente), y registrar una
 * lectura por cada uno llenaría la bitácora de renglones que no
 * corresponden a que nadie abriera nada. Lo que la norma pide es el
 * ACCESO, y el acceso es la pantalla.
 *
 * 🔴 NUNCA LANZA (es `eduAudit` por dentro): abrir un expediente no puede
 * fallar porque no se pudo escribir el renglón que dice que se abrió.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function registrarEduLecturaExpediente(
  ctx: EduExpedienteContext,
  patientId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const id = eduCleanId(patientId);
  if (!id) return;
  await eduAudit(ctx, {
    action: "view",
    entity: "record",
    entityId: null,
    patientId: id,
    ...meta,
  });
}
