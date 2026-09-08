/**
 * DaleControl INSTITUCIONAL — EL CUESTIONARIO DE SALUD contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro (banderas de riesgo, merge aditivo,
 * parsers) vive en cuestionario-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *
 *   · PERMISO — `expediente.view` para leer, `expediente.write` para
 *     guardar. Ninguna key nueva: el cuestionario de salud ES la historia
 *     clínica, y quien puede escribir una nota puede capturarla. Es el
 *     mismo criterio con el que la Ola B resolvió las fotos («quien puede
 *     subir una radiografía puede subir una foto»).
 *   · ALCANCE — el CLÍNICO (`eduClinicalScope`, recurso "cases"), no el de
 *     "patients". Para CAJA, "patients" es `all` y "cases" es `none`: con
 *     el alcance equivocado, el mostrador leería los antecedentes médicos
 *     de toda la escuela.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 GUARDAR ES **INSERTAR**, NUNCA ACTUALIZAR. Y las dos escrituras —la
 * versión nueva y el merge a la ficha— van en la MISMA transacción: una
 * ficha con las alergias del cuestionario y sin el cuestionario que las
 * trajo es un expediente que no se puede auditar.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText } from "@/lib/edu/agenda-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import {
  EDU_CUESTIONARIO_HISTORIAL,
  EDU_RISK_FLAGS,
  EDU_CUESTIONARIO_NOTES_MAX,
  eduCuestionarioMergeData,
  eduCuestionarioParseAnswers,
  eduCuestionarioRiskFlags,
  type EduRiskFlag,
} from "@/lib/edu/cuestionario-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";
import type { EduPregnancy } from "@/lib/edu/types";

/**
 * La sesión que necesitan estas funciones: el tenant y el actor del piso
 * clínico (`EduClinicaContext`, que es lo que sabe leer el alcance) MÁS lo
 * que la bitácora necesita para congelar el nombre.
 */
export interface EduCuestionarioContext extends EduClinicaContext, EduAuditActor {}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

export interface EduCuestionarioRow {
  id: string;
  version: number;
  answers: unknown;
  riskFlags: string[];
  notes: string | null;
  recordedByName: string;
  recordedAt: string;
}

/**
 * EL HISTORIAL de un paciente, más reciente primero.
 *
 * 🔴 EL TOPE DE VEINTE ES DE LECTURA, NO DE BORRADO. Las versiones 21 y
 * siguientes siguen en la base y siguen siendo el expediente; lo que no
 * hacen es caber en la pestaña. Un tope que borra es una pérdida de datos
 * con nombre de paginación.
 *
 * 🔴 REGISTRA LA LECTURA en la bitácora (NOM-024 §6.3.5): abrir los
 * antecedentes médicos de alguien es un acceso al expediente.
 */
export async function listEduCuestionarios(
  ctx: EduCuestionarioContext,
  patientId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ rows: EduCuestionarioRow[]; truncated: boolean }> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  // Una de más para poder DECIR que se cortó, igual que el expediente.
  const filas = await prisma.eduHealthQuestionnaire.findMany({
    where: { institutionId, patientId: paciente.id },
    orderBy: { version: "desc" },
    take: EDU_CUESTIONARIO_HISTORIAL + 1,
    select: {
      id: true,
      version: true,
      answers: true,
      riskFlags: true,
      notes: true,
      recordedByName: true,
      recordedAt: true,
    },
  });

  const truncated = filas.length > EDU_CUESTIONARIO_HISTORIAL;
  const visibles = truncated ? filas.slice(0, EDU_CUESTIONARIO_HISTORIAL) : filas;

  await eduAudit(ctx, {
    action: "view",
    entity: "questionnaire",
    entityId: null,
    patientId: paciente.id,
    ...meta,
  });

  return {
    rows: visibles.map((f) => ({
      id: f.id,
      version: f.version,
      answers: f.answers,
      riskFlags: Array.isArray(f.riskFlags) ? (f.riskFlags as string[]) : [],
      notes: f.notes,
      recordedByName: f.recordedByName,
      recordedAt: f.recordedAt.toISOString(),
    })),
    truncated,
  };
}

/**
 * GUARDA UNA VERSIÓN NUEVA y mezcla lo clínico en la ficha.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL NÚMERO DE VERSIÓN SE CALCULA DENTRO DE LA TRANSACCIÓN Y EL ÍNDICE
 * ÚNICO (patientId, version) ES EL CANDADO DE VERDAD.
 *
 * Dos alumnos guardando el mismo cuestionario a la vez calcularían los dos
 * `MAX(version) + 1 = 3`, y sin el índice único quedarían DOS versiones 3
 * — dos respuestas a «¿qué decía la 3?». Con él, la segunda choca (P2002)
 * y se REINTENTA, que es el mismo patrón que el folio del cobro en caja.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function createEduCuestionario(
  ctx: EduCuestionarioContext,
  patientId: string,
  body: { answers?: unknown; notes?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; version: number; riskFlags: EduRiskFlag[] }> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const answers = eduCuestionarioParseAnswers(body?.answers);
  const notes = eduOptionalText(body?.notes, EDU_CUESTIONARIO_NOTES_MAX) ?? null;

  // La ficha, para el merge aditivo y para las dos columnas que alimentan
  // las banderas (menor de edad y embarazo ya conocido).
  const ficha = await prisma.eduPatient.findFirst({
    where: { id: paciente.id, institutionId },
    select: {
      allergies: true,
      chronicConditions: true,
      currentMedications: true,
      isChild: true,
      pregnancy: true,
    },
  });
  if (!ficha) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const riskFlags = eduCuestionarioRiskFlags(answers, {
    isChild: ficha.isChild,
    pregnancy: (ficha.pregnancy as EduPregnancy | null) ?? null,
  });
  const mergeData = eduCuestionarioMergeData(answers, ficha, ctx.eduUserId, now);
  const recordedByName =
    `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  // Tres intentos por la carrera de la versión. Ver el encabezado.
  for (let intento = 0; intento < 3; intento++) {
    const agg = await prisma.eduHealthQuestionnaire.aggregate({
      where: { institutionId, patientId: paciente.id },
      _max: { version: true },
    });
    const version = (agg._max.version ?? 0) + 1;

    try {
      const creado = await prisma.$transaction(async (tx) => {
        const fila = await tx.eduHealthQuestionnaire.create({
          data: {
            institutionId,
            patientId: paciente.id,
            version,
            answers: answers as Prisma.InputJsonValue,
            riskFlags: riskFlags as unknown as Prisma.InputJsonValue,
            notes,
            recordedById: ctx.eduUserId,
            recordedByName,
            recordedAt: now,
          },
          select: { id: true, version: true },
        });

        // 🔴 EL MERGE, ADITIVO Y EN LA MISMA TRANSACCIÓN. El where lleva
        // el institutionId además del id, como toda escritura del
        // vertical.
        await tx.eduPatient.updateMany({
          where: { id: paciente.id, institutionId },
          data: mergeData as Prisma.EduPatientUncheckedUpdateManyInput,
        });

        return fila;
      });

      await eduAudit(ctx, {
        action: "create",
        entity: "questionnaire",
        entityId: creado.id,
        patientId: paciente.id,
        after: { version: creado.version, riskFlags: riskFlags.join(", ") },
        ...meta,
      });

      return { id: creado.id, version: creado.version, riskFlags };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002" && intento < 2) continue;
      throw err;
    }
  }

  throw new EduPadronError(
    "No se pudo guardar el cuestionario: otra persona está capturando el mismo. Inténtalo otra vez.",
    409,
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LAS BANDERAS DE LA VERSIÓN VIGENTE, para los chips de la cabecera.
 *
 * 🔴 SOLO LAS BANDERAS, NO LAS RESPUESTAS. La cabecera de la ficha se
 * pinta en LAS CATORCE PESTAÑAS: traerse el `answers` completo en cada una
 * sería mover los antecedentes médicos de alguien al payload de la
 * pestaña de Pagos. Se leen dos columnas de UNA fila.
 *
 * 🔴 Y **NO** REGISTRA UNA LECTURA EN LA BITÁCORA, a diferencia de
 * `listEduCuestionarios`. La NOM-024 pide constancia de quién ABRIÓ el
 * expediente, y esto no es abrirlo: es el chip rojo que avisa de un
 * anticoagulante en la cabecera de cualquier pestaña. Registrarlo metería
 * un renglón por cada navegación —catorce por paciente y por rato— y
 * ahogaría los accesos de verdad, que son los que la norma quiere poder
 * leer. La lectura del expediente se registra donde se abre el expediente.
 *
 * ⚠️ Devuelve `[]` —y NO lanza— cuando el paciente no está en el alcance
 * de quien mira o cuando no hay ninguna versión: es una cabecera, y un
 * throw aquí dejaría la ficha entera en blanco por un chip.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function getEduRiskFlagsVigentes(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<{ flags: EduRiskFlag[]; version: number; recordedAt: string } | null> {
  const institutionId = ctx?.institutionId;
  if (!institutionId) return null;
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return null;

  const fila = await prisma.eduHealthQuestionnaire.findFirst({
    where: { institutionId, patientId: paciente.id },
    orderBy: { version: "desc" },
    select: { version: true, riskFlags: true, recordedAt: true },
  });
  if (!fila) return null;

  const crudas = Array.isArray(fila.riskFlags) ? (fila.riskFlags as unknown[]) : [];
  const flags = crudas.filter((f): f is EduRiskFlag =>
    typeof f === "string" && (EDU_RISK_FLAGS as readonly string[]).includes(f),
  );
  return { flags, version: fila.version, recordedAt: fila.recordedAt.toISOString() };
}
