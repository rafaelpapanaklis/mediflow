/**
 * DaleControl INSTITUCIONAL — Ola 14 · RECETAS contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". Lo
 * puro (topes, validación, snapshot, formas de pantalla) vive en
 * recetas-core.ts.
 *
 * 🔴 LAS CUATRO REGLAS DE ORO DE ESTE ARCHIVO
 *
 * 1. TODA función recibe el contexto de sesión y saca de ahí el
 *    institutionId. Ninguna lo acepta suelto, ninguna lo lee de un body.
 *
 * 2. NINGUNA lectura arma su propio recorte: el alcance es el CLÍNICO
 *    (`eduClinicalScope` = recurso "cases"), el mismo del expediente.
 *    Para CAJA eso es "none" y no hay una sola fila — ni con
 *    "recetas.view" encendido a mano: una receta es un documento clínico,
 *    no un cobro. El alumno ve las de SUS casos; el docente, las de los
 *    alumnos que supervisa HOY.
 *
 * 3. LA RECETA NO SE EXPIDE AQUÍ. Mandarla a autorización crea una fila
 *    de EduCaseApproval (etapa PRESCRIPTION, Ola 4) y quien la expide es
 *    `decideEduApproval` (autorizaciones.ts), en la MISMA transacción que
 *    firma la autorización — con la cédula del docente congelada. Este
 *    archivo arma, edita, manda, anula y lee. No firma nada.
 *
 * 4. UNA EXPEDIDA NO SE TOCA. No se edita, no se borra: se ANULA con
 *    motivo (y la fila queda) o se hace otra. El PDF solo sale EXPEDIDA o
 *    ANULADA — una PENDIENTE o RECHAZADA no produce papel, y ése es el
 *    gate entero.
 *
 * Las escrituras NO comprueban permisos: eso lo hace el endpoint con
 * eduApiGuard antes de llamar. Aquí se comprueba la PERTENENCIA, que es
 * lo que un permiso no puede saber.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import { eduApprovalHash } from "@/lib/edu/autorizaciones-hash";
import {
  EDU_RECETA_DIAGNOSIS_MAX,
  EDU_RECETA_INDICATIONS_MAX,
  EDU_RECETA_MAX_ROWS,
  EDU_RECETA_VOID_REASON_MAX,
  EDU_RECETA_VOID_REASON_MIN,
  eduRecetaEditable,
  eduRecetaParseItems,
  eduRecetaPrintable,
  eduRecetaSendable,
  eduRecetaSnapshot,
  eduRecetaVoidable,
  type EduRecetaCaseOption,
  type EduRecetaItemDraft,
  type EduRecetaRow,
} from "@/lib/edu/recetas-core";
import {
  EDU_CASE_CLOSED_STATUSES,
  EDU_PRESCRIPTION_STATUS_LABELS,
  type EduPrescriptionStatus,
} from "@/lib/edu/types";

export { EduPadronError as EduRecetaError };
export type { EduRecetaCaseOption, EduRecetaRow } from "@/lib/edu/recetas-core";

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

/** Sello legible en la zona del instituto ("mar 1 sep 14:30"). */
function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

function texto(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** El nombre de quien está en la sesión, congelado en la fila. */
async function nombreDeSesion(ctx: EduClinicaContext): Promise<string> {
  const u = await prisma.eduUser.findFirst({
    where: { id: ctx.eduUserId, institutionId: ctx.institutionId },
    select: { firstName: true, lastName: true, email: true },
  });
  return u ? personName(u) : "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// EL SELECT Y LA FORMA DE PANTALLA
// ═══════════════════════════════════════════════════════════════════════

const RECETA_SELECT = {
  id: true,
  caseId: true,
  patientId: true,
  status: true,
  diagnosis: true,
  indications: true,
  proposedByUserId: true,
  proposedByName: true,
  proposedByMatricula: true,
  issuedByName: true,
  issuedByCedula: true,
  issuedAt: true,
  voidedByName: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  case: { select: { program: { select: { name: true } } } },
  items: {
    // El MISMO orden que loadTargets (autorizaciones.ts): el orden entra
    // al hash y dos lecturas distintas serían dos documentos distintos.
    orderBy: [{ orden: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      orden: true,
      drug: true,
      presentation: true,
      dose: true,
      route: true,
      frequency: true,
      duration: true,
      quantity: true,
      notes: true,
    },
  },
} satisfies Prisma.EduPrescriptionSelect;

type RecetaPayload = Prisma.EduPrescriptionGetPayload<{ select: typeof RECETA_SELECT }>;

function toRow(
  r: RecetaPayload,
  timeZone: string,
  viewerUserId: string,
  lastDecisionNote: string | null,
): EduRecetaRow {
  const status = r.status as EduPrescriptionStatus;
  return {
    id: r.id,
    caseId: r.caseId,
    programName: r.case.program.name,
    status,

    diagnosis: r.diagnosis,
    indications: r.indications,
    items: r.items.map((it) => ({
      id: it.id,
      orden: it.orden,
      drug: it.drug,
      presentation: it.presentation,
      dose: it.dose,
      route: it.route,
      frequency: it.frequency,
      duration: it.duration,
      quantity: it.quantity,
      notes: it.notes,
    })),

    proposedByName: r.proposedByName,
    proposedByMatricula: r.proposedByMatricula,
    createdAtLabel: stampLabel(r.createdAt, timeZone),

    issuedByName: r.issuedByName,
    issuedByCedula: r.issuedByCedula,
    issuedAtLabel: r.issuedAt ? stampLabel(r.issuedAt, timeZone) : null,

    voidedByName: r.voidedByName,
    voidedAtLabel: r.voidedAt ? stampLabel(r.voidedAt, timeZone) : null,
    voidReason: r.voidReason,

    lastDecisionNote,

    mine: r.proposedByUserId === viewerUserId,
    printable: eduRecetaPrintable(status),
    editable: eduRecetaEditable(status),
    sendable: eduRecetaSendable(status),
    voidable: eduRecetaVoidable(status),
  };
}

/**
 * La última palabra ESCRITA de un docente sobre cada receta (el motivo de
 * los cambios pedidos o del rechazo), leída de sus autorizaciones.
 *
 * Se filtra `decidedById != null` a propósito: el cierre automático por
 * reenvío ("Sustituida por un reenvío…") también es CHANGES_REQUESTED,
 * pero no lo decidió nadie y pintarlo como palabra del docente le
 * atribuiría una decisión que no tomó.
 */
async function lastDecisionNotes(
  institutionId: string,
  recetaIds: string[],
): Promise<Map<string, string>> {
  if (recetaIds.length === 0) return new Map();
  const filas = await prisma.eduCaseApproval.findMany({
    where: {
      institutionId,
      targetType: "EduPrescription",
      targetId: { in: recetaIds },
      status: { in: ["CHANGES_REQUESTED", "REJECTED"] },
      decidedById: { not: null },
      decisionNote: { not: null },
    },
    orderBy: [{ decidedAt: "desc" }],
    select: { targetId: true, decisionNote: true },
  });
  const out = new Map<string, string>();
  for (const f of filas) {
    if (!out.has(f.targetId) && f.decisionNote) out.set(f.targetId, f.decisionNote);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/** El paciente, buscado con el alcance CLÍNICO. null = no existe o no toca. */
async function getRecetaPatient(ctx: EduClinicaContext, patientId: string, now: Date) {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;

  return prisma.eduPatient.findFirst({
    // 🔴 `eduPatientScopeWhere` con el alcance de "cases", no con el de
    // "patients": para caja, "patients" es `all` y "cases" es `none`. Con
    // el alcance equivocado, caja leería las recetas de toda la escuela.
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, folio: true, firstName: true, lastName: true, birthDate: true },
  });
}

export interface EduRecetasDePaciente {
  rows: EduRecetaRow[];
  /** Los casos ABIERTOS del paciente que le tocan a quien mira: a uno de
   *  éstos se le cuelga una receta nueva. */
  cases: EduRecetaCaseOption[];
}

/**
 * La pestaña Recetas de la ficha: las recetas del paciente que le tocan a
 * quien pregunta, más recientes primero.
 *
 * El recorte cuelga del CASO (`case: {…}`), no del paciente: el alumno
 * que lleva la endodoncia de esta señora NO lee las recetas de su
 * ortodoncia, que son de otro alumno y de otro docente — igual que las
 * notas del expediente.
 */
export async function listEduPatientRecetas(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduRecetasDePaciente> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getRecetaPatient(ctx, patientId, now);
  if (!paciente) return { rows: [], cases: [] };

  const scope = eduClinicalScope(ctx);
  const caseScope = eduCaseScopeWhere({ institutionId, scope, now });

  const [recetas, casos] = await Promise.all([
    prisma.eduPrescription.findMany({
      where: { institutionId, patientId: paciente.id, case: caseScope },
      orderBy: [{ createdAt: "desc" }],
      take: EDU_RECETA_MAX_ROWS,
      select: RECETA_SELECT,
    }),
    prisma.eduCase.findMany({
      where: {
        ...caseScope,
        patientId: paciente.id,
        status: { notIn: EDU_CASE_CLOSED_STATUSES },
      },
      orderBy: [{ openedAt: "desc" }],
      select: {
        id: true,
        program: { select: { name: true } },
        student: {
          select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    }),
  ]);

  const notas = await lastDecisionNotes(
    institutionId,
    recetas.map((r) => r.id),
  );

  return {
    rows: recetas.map((r) => toRow(r, timeZone, ctx.eduUserId, notas.get(r.id) ?? null)),
    cases: casos.map((c) => ({
      id: c.id,
      label: `${c.program.name} · ${c.student.matricula} ${personName(c.student.user)}`,
    })),
  };
}

/**
 * Las recetas de UN caso, para su ficha (la lista del caso). Mismo
 * recorte, misma forma: la tarjeta del caso pinta lo mismo que la
 * pestaña, solo que acotado.
 */
export async function listEduCaseRecetas(
  ctx: EduClinicaContext,
  caseId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduRecetaRow[]> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(caseId);
  if (!id) return [];

  const recetas = await prisma.eduPrescription.findMany({
    where: {
      institutionId,
      caseId: id,
      case: eduCaseScopeWhere({ institutionId, scope, now }),
    },
    orderBy: [{ createdAt: "desc" }],
    take: EDU_RECETA_MAX_ROWS,
    select: RECETA_SELECT,
  });

  const notas = await lastDecisionNotes(
    institutionId,
    recetas.map((r) => r.id),
  );
  return recetas.map((r) => toRow(r, timeZone, ctx.eduUserId, notas.get(r.id) ?? null));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS DEL ALUMNO: armar, editar, mandar
// ═══════════════════════════════════════════════════════════════════════

export interface EduRecetaCreateInput {
  caseId?: unknown;
  diagnosis?: unknown;
  indications?: unknown;
  items?: unknown;
}

/**
 * PROPONER una receta (nace en BORRADOR).
 *
 * 🔴 El caso es OBLIGATORIO: la receta la firmará el docente que responde
 * por ese caso, y sin caso no hay a quién mandársela. Se busca DENTRO del
 * alcance — el de otra escuela o de otro alumno contesta 404, igual que
 * uno que no existe — y tiene que ser de ESTE paciente y estar abierto.
 *
 * La MATRÍCULA se congela solo si quien propone es EL ALUMNO del caso: si
 * propone el docente o la dirección (pueden: "recetas.propose" es suya
 * también), el documento no puede decir que lo propuso un alumno con una
 * matrícula que no es de quien lo escribió.
 */
export async function createEduReceta(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduRecetaCreateInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);

  const paciente = await getRecetaPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no te toca.", 404);

  const scope = eduClinicalScope(ctx);
  const caseId = eduCleanId(input.caseId);
  const caso = caseId
    ? await prisma.eduCase.findFirst({
        where: {
          ...eduCaseScopeWhere({ institutionId, scope, now }),
          id: caseId,
          patientId: paciente.id,
        },
        select: {
          id: true,
          status: true,
          student: { select: { userId: true, matricula: true } },
        },
      })
    : null;
  if (!caso) {
    throw new EduPadronError(
      "Falta el caso (o no te toca). La receta se cuelga del caso: es lo que dice qué docente responde por ella.",
      caseId ? 404 : 400,
    );
  }
  if ((EDU_CASE_CLOSED_STATUSES as string[]).includes(caso.status)) {
    throw new EduPadronError(
      "Ese caso ya está cerrado. Una receta nueva va en un caso vivo: si el paciente volvió, se le abre caso.",
      409,
    );
  }

  const parsed = eduRecetaParseItems(input.items);
  if (!parsed.ok) throw new EduPadronError(parsed.error);

  const created = await prisma.eduPrescription.create({
    data: {
      institutionId,
      caseId: caso.id,
      patientId: paciente.id,
      status: "BORRADOR",
      diagnosis: texto(input.diagnosis, EDU_RECETA_DIAGNOSIS_MAX),
      indications: texto(input.indications, EDU_RECETA_INDICATIONS_MAX),
      // 🔴 De la SESIÓN, jamás del body: quién propone es media receta.
      proposedByUserId: ctx.eduUserId,
      proposedByName: await nombreDeSesion(ctx),
      proposedByMatricula: caso.student.userId === ctx.eduUserId ? caso.student.matricula : null,
      items: {
        create: parsed.items.map((it, i) => ({ institutionId, orden: i, ...it })),
      },
    },
    select: { id: true },
  });

  return created;
}

/** La receta, buscada DENTRO del alcance. Una que no toca = una que no existe. */
async function resolveReceta(
  ctx: EduClinicaContext,
  institutionId: string,
  recetaId: string,
  now: Date,
) {
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Esa receta no existe o no te toca.", 404);
  }
  const id = eduCleanId(recetaId);
  const receta = id
    ? await prisma.eduPrescription.findFirst({
        where: {
          institutionId,
          id,
          case: eduCaseScopeWhere({ institutionId, scope, now }),
        },
        select: {
          id: true,
          caseId: true,
          status: true,
          proposedByUserId: true,
          proposedByName: true,
          diagnosis: true,
          indications: true,
          items: {
            orderBy: [{ orden: "asc" as const }, { id: "asc" as const }],
            select: {
              drug: true,
              presentation: true,
              dose: true,
              route: true,
              frequency: true,
              duration: true,
              quantity: true,
              notes: true,
            },
          },
        },
      })
    : null;
  if (!receta) throw new EduPadronError("Esa receta no existe o no te toca.", 404);
  return receta;
}

export interface EduRecetaUpdateInput {
  diagnosis?: unknown;
  indications?: unknown;
  items?: unknown;
}

/**
 * EDITAR el contenido. Solo BORRADOR y PENDIENTE (ver recetas-core), y
 * solo QUIEN LA PROPUSO: el nombre congelado en el papel es el suyo, y
 * dejar que otro escriba bajo ese nombre es atribuirle una propuesta que
 * no hizo. Quien necesite otra cosa, propone la suya.
 *
 * Editar una PENDIENTE no la esconde: la bandeja marca "la editó después
 * de mandarla" (el hash de la Ola 4 hace ese trabajo solo) y lo que el
 * docente firma es lo que LEE al firmar.
 */
export async function updateEduReceta(
  ctx: EduClinicaContext,
  recetaId: string,
  input: EduRecetaUpdateInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const receta = await resolveReceta(ctx, institutionId, recetaId, now);

  if (!eduRecetaEditable(receta.status as EduPrescriptionStatus)) {
    throw new EduPadronError(
      receta.status === "EXPEDIDA" || receta.status === "ANULADA"
        ? "Una receta expedida no se edita nunca: se anula con motivo y se hace otra."
        : "Una receta rechazada no se edita: se propone una nueva con lo que el docente pidió.",
      409,
    );
  }
  if (receta.proposedByUserId !== ctx.eduUserId) {
    throw new EduPadronError(
      `Esta receta la propuso ${receta.proposedByName} y solo quien la propuso la edita. Si necesitas otra cosa, propón tu propia receta.`,
      403,
    );
  }

  const data: Prisma.EduPrescriptionUncheckedUpdateInput = {};
  if ("diagnosis" in input) data.diagnosis = texto(input.diagnosis, EDU_RECETA_DIAGNOSIS_MAX);
  if ("indications" in input) {
    data.indications = texto(input.indications, EDU_RECETA_INDICATIONS_MAX);
  }

  let items: EduRecetaItemDraft[] | null = null;
  if ("items" in input) {
    const parsed = eduRecetaParseItems(input.items);
    if (!parsed.ok) throw new EduPadronError(parsed.error);
    items = parsed.items;
  }

  await prisma.$transaction(async (tx) => {
    await tx.eduPrescription.update({ where: { id: receta.id }, data });
    if (items) {
      // Se reemplazan completos: los renglones no tienen identidad
      // propia hacia fuera (no los referencia nadie) y un diff renglón a
      // renglón solo daría más sitios donde equivocar el `orden`.
      await tx.eduPrescriptionItem.deleteMany({
        where: { institutionId, prescriptionId: receta.id },
      });
      await tx.eduPrescriptionItem.createMany({
        data: items.map((it, i) => ({
          institutionId,
          prescriptionId: receta.id,
          orden: i,
          ...it,
        })),
      });
    }
  });

  return { id: receta.id };
}

/**
 * MANDARLA A AUTORIZACIÓN: BORRADOR → PENDIENTE + la fila del gate.
 *
 * 🔴 ES EL MECANISMO DE LA OLA 4, NO UNO NUEVO: se crea una
 * EduCaseApproval con la etapa PRESCRIPTION apuntando a esta receta, con
 * su contentHash — la bandeja, el "nadie firma su propia petición", el
 * hash que se recalcula al firmar y el vencimiento por edición vienen
 * gratis. Lo único que este camino agrega es mover la receta a PENDIENTE
 * en la MISMA transacción (por eso no pasa por requestEduApproval).
 *
 * Un reenvío cierra la petición anterior como CHANGES_REQUESTED sin
 * decisor —igual que la Ola 4— y crea una nueva: las filas son el
 * historial.
 */
export async function sendEduRecetaToApproval(
  ctx: EduClinicaContext,
  recetaId: string,
  now: Date = new Date(),
): Promise<{ id: string; approvalId: string }> {
  const institutionId = requireInstitution(ctx);
  const receta = await resolveReceta(ctx, institutionId, recetaId, now);

  if (!eduRecetaSendable(receta.status as EduPrescriptionStatus)) {
    throw new EduPadronError(
      receta.status === "EXPEDIDA"
        ? "Esa receta ya está expedida: no hay nada que mandar a firmar."
        : "Esa receta ya no se puede mandar: está " +
          EDU_PRESCRIPTION_STATUS_LABELS[receta.status as EduPrescriptionStatus].toLowerCase() +
          ".",
      409,
    );
  }
  if (receta.items.length === 0) {
    throw new EduPadronError("Agrega al menos un medicamento antes de mandarla a autorización.");
  }

  const contentHash = eduApprovalHash(eduRecetaSnapshot(receta));

  try {
    const created = await prisma.$transaction(async (tx) => {
      // El índice único PARCIAL de la Ola 4 (una PENDING por fila
      // apuntada) se satisface porque esto sale del índice ANTES del
      // insert — mismo baile que requestEduApproval.
      await tx.eduCaseApproval.updateMany({
        where: {
          institutionId,
          targetType: "EduPrescription",
          targetId: receta.id,
          status: "PENDING",
        },
        data: {
          status: "CHANGES_REQUESTED",
          decidedAt: now,
          decisionNote: "Sustituida por un reenvío. No la decidió nadie.",
        },
      });

      const approval = await tx.eduCaseApproval.create({
        data: {
          institutionId,
          caseId: receta.caseId,
          stage: "PRESCRIPTION",
          targetType: "EduPrescription",
          targetId: receta.id,
          contentHash,
          status: "PENDING",
          // 🔴 De la SESIÓN, jamás del body: quien manda no podrá firmar.
          requestedById: ctx.eduUserId,
          requestedAt: now,
        },
        select: { id: true },
      });

      await tx.eduPrescription.update({
        where: { id: receta.id },
        data: { status: "PENDIENTE" },
      });

      return approval;
    });
    return { id: receta.id, approvalId: created.id };
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new EduPadronError(
        "Esa receta ya está esperando firma. Refresca la pantalla: probablemente la mandaste dos veces.",
        409,
      );
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ANULAR (recetas.void)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ANULAR una EXPEDIDA. Deja constancia con motivo; NUNCA borra: el papel
 * salió de la escuela con una cédula encima, y la fila es la respuesta a
 * "¿qué decía y quién lo retiró?". El PDF de una anulada sigue saliendo,
 * marcado ANULADA con su motivo — esconderlo sería borrar historia.
 */
export async function voidEduReceta(
  ctx: EduClinicaContext,
  recetaId: string,
  input: { reason?: unknown },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const receta = await resolveReceta(ctx, institutionId, recetaId, now);

  if (!eduRecetaVoidable(receta.status as EduPrescriptionStatus)) {
    throw new EduPadronError(
      receta.status === "ANULADA"
        ? "Esa receta ya está anulada."
        : "Solo se anula lo expedido. Una receta sin expedir nunca fue documento: un borrador se corrige y una rechazada ya dice que no.",
      409,
    );
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < EDU_RECETA_VOID_REASON_MIN) {
    throw new EduPadronError(
      "Escribe por qué se anula. La receta ya salió con una cédula encima: el motivo es la mitad de la constancia.",
    );
  }

  const moved = await prisma.eduPrescription.updateMany({
    // Acotado a EXPEDIDA: dos anulaciones a la vez no se pisan el motivo.
    where: { institutionId, id: receta.id, status: "EXPEDIDA" },
    data: {
      status: "ANULADA",
      voidedAt: now,
      voidedByUserId: ctx.eduUserId,
      voidedByName: await nombreDeSesion(ctx),
      voidReason: reason.slice(0, EDU_RECETA_VOID_REASON_MAX),
    },
  });
  if (moved.count === 0) {
    throw new EduPadronError("Esa receta ya la anuló alguien. Refresca la pantalla.", 409);
  }

  return { id: receta.id };
}

// ═══════════════════════════════════════════════════════════════════════
// EL PDF (los datos; el render vive en receta-pdf.tsx)
// ═══════════════════════════════════════════════════════════════════════

export interface EduRecetaPdfData {
  institutionName: string;
  institutionCity: string | null;
  institutionPhone: string | null;
  institutionEmail: string | null;

  patientName: string;
  patientFolio: string;
  patientAgeYears: number | null;

  programName: string;
  diagnosis: string | null;
  indications: string | null;
  items: {
    drug: string;
    presentation: string | null;
    dose: string;
    route: string | null;
    frequency: string | null;
    duration: string | null;
    quantity: string | null;
    notes: string | null;
  }[];

  proposedByName: string;
  proposedByMatricula: string | null;

  issuedByName: string;
  issuedByCedula: string;
  issuedAtLabel: string;
  issuedHashShort: string | null;

  voided: boolean;
  voidReason: string | null;
  voidedAtLabel: string | null;
  voidedByName: string | null;

  recetaId: string;
  fileName: string;
}

function ageYears(birthDate: Date | null, now: Date): number | null {
  if (!birthDate) return null;
  const ms = now.getTime() - birthDate.getTime();
  if (ms <= 0) return null;
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000));
}

/**
 * 🔴 EL GATE, EN SU FORMA FINAL: los datos del PDF solo salen si la
 * receta está EXPEDIDA o ANULADA. Una PENDIENTE o RECHAZADA contesta 409
 * con el porqué — no hay ningún otro camino del producto que la
 * renderice, así que este `if` ES la regla "sin firma no hay papel".
 */
export async function getEduRecetaPdfData(
  ctx: EduClinicaContext,
  recetaId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduRecetaPdfData> {
  const institutionId = requireInstitution(ctx);
  const scope = eduClinicalScope(ctx);
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Esa receta no existe o no te toca.", 404);
  }
  const id = eduCleanId(recetaId);
  const receta = id
    ? await prisma.eduPrescription.findFirst({
        where: {
          institutionId,
          id,
          case: eduCaseScopeWhere({ institutionId, scope, now }),
        },
        select: {
          ...RECETA_SELECT,
          issuedHash: true,
          institution: { select: { name: true, city: true, phone: true, email: true } },
          patient: {
            select: { folio: true, firstName: true, lastName: true, birthDate: true },
          },
        },
      })
    : null;
  if (!receta) throw new EduPadronError("Esa receta no existe o no te toca.", 404);

  const status = receta.status as EduPrescriptionStatus;
  if (!eduRecetaPrintable(status)) {
    throw new EduPadronError(
      status === "PENDIENTE"
        ? "Esta receta todavía no está expedida: falta la firma del docente con cédula, y sin ella no hay papel que entregar."
        : status === "RECHAZADA"
          ? "Esta receta fue rechazada por el docente: no se expide y no se imprime."
          : "Esta receta es un borrador: se imprime cuando el docente la firme.",
      409,
    );
  }
  if (!receta.issuedByName || !receta.issuedByCedula || !receta.issuedAt) {
    // Cinturón: una EXPEDIDA sin firmante solo puede venir de un UPDATE a
    // mano. Antes que imprimir un papel sin responsable, se rebota.
    throw new EduPadronError(
      "Esta receta está marcada como expedida pero no tiene firmante. Repórtalo a la dirección: no se imprime sin cédula.",
      409,
    );
  }

  const issuedAtLabel = stampLabel(receta.issuedAt, timeZone);
  return {
    institutionName: receta.institution.name,
    institutionCity: receta.institution.city,
    institutionPhone: receta.institution.phone,
    institutionEmail: receta.institution.email,

    patientName:
      [receta.patient.firstName, receta.patient.lastName].filter(Boolean).join(" ").trim() ||
      "Sin nombre",
    patientFolio: receta.patient.folio,
    patientAgeYears: ageYears(receta.patient.birthDate, now),

    programName: receta.case.program.name,
    diagnosis: receta.diagnosis,
    indications: receta.indications,
    items: receta.items.map((it) => ({
      drug: it.drug,
      presentation: it.presentation,
      dose: it.dose,
      route: it.route,
      frequency: it.frequency,
      duration: it.duration,
      quantity: it.quantity,
      notes: it.notes,
    })),

    proposedByName: receta.proposedByName,
    proposedByMatricula: receta.proposedByMatricula,

    issuedByName: receta.issuedByName,
    issuedByCedula: receta.issuedByCedula,
    issuedAtLabel,
    issuedHashShort: receta.issuedHash ? receta.issuedHash.slice(0, 16) : null,

    voided: status === "ANULADA",
    voidReason: receta.voidReason,
    voidedAtLabel: receta.voidedAt ? stampLabel(receta.voidedAt, timeZone) : null,
    voidedByName: receta.voidedByName,

    recetaId: receta.id,
    fileName: `receta-${receta.patient.folio}-${receta.id.slice(0, 8)}.pdf`,
  };
}
