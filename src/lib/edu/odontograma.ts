/**
 * DaleControl INSTITUCIONAL — el ODONTOGRAMA contra la base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro (qué diente, qué cara, qué hallazgo)
 * vive en odontograma-core.ts; aquí solo hay consultas.
 *
 * 🔴 EL ALCANCE ES EL DEL EXPEDIENTE, no el de pacientes. El odontograma
 * cuelga del PACIENTE en la base —la boca es una sola— pero se LEE con el
 * alcance de "cases" (eduClinicalScope). Si se leyera con el de
 * "patients", caja vería el odontograma de la escuela entera: para caja,
 * "patients" es `all` y "cases" es `none`.
 *
 * 🔴 UN HALLAZGO SIN AUTOR NO SIRVE PARA NADA. Cada fila guarda quién lo
 * marcó (`recordedById`, de la SESIÓN) y cuándo. Es parte del expediente:
 * "el 16 tiene una corona" sin firma no contesta ninguna pregunta.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import {
  EDU_ODONTOGRAM_NOTE_KEY,
  EDU_TOOTH_WHOLE,
  parseEduFdi,
  parseEduOdontogramTarget,
  type EduOdontogramEntryRow,
} from "@/lib/edu/odontograma-core";
import { eduScopeIsEmpty, type EduClinicaContext } from "@/lib/edu/visibility";

export { EduPadronError as EduOdontogramaError };
export type { EduOdontogramEntryRow } from "@/lib/edu/odontograma-core";

/** Techo de filas. 52 dientes × unos cuantos hallazgos cada uno; el tope
 *  está para que una consulta rota no se traiga la tabla entera. */
export const EDU_ODONTOGRAM_MAX_ROWS = 1000;

/** Tope de la nota por diente. Empata con el `@db.VarChar(1000)`. */
export const EDU_ODONTOGRAM_NOTE_MAX = 1000;

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

function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

const ENTRY_SELECT = {
  id: true,
  tooth: true,
  surface: true,
  condition: true,
  notes: true,
  recordedById: true,
  recordedAt: true,
  recordedBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduOdontogramEntrySelect;

type EntryPayload = Prisma.EduOdontogramEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

function toRow(e: EntryPayload, timeZone: string): EduOdontogramEntryRow {
  return {
    id: e.id,
    tooth: e.tooth,
    surface: e.surface,
    condition: e.condition,
    notes: e.notes,
    recordedById: e.recordedById,
    recordedByName: personName(e.recordedBy),
    recordedAt: e.recordedAt.toISOString(),
    recordedLabel: stampLabel(e.recordedAt, timeZone),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El odontograma completo de un paciente.
 *
 * La puerta es `getEduClinicalPatient`: si esa persona no puede abrir el
 * expediente de este paciente, aquí no se consulta ni una fila. Devolver
 * `[]` en vez de lanzar es a propósito — la pantalla ya decidió si pintar
 * "no te toca" o el dibujo vacío, y un throw aquí la dejaría en blanco.
 */
export async function listEduOdontogram(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduOdontogramEntryRow[]> {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return [];

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return [];

  const rows = await prisma.eduOdontogramEntry.findMany({
    where: { institutionId, patientId: paciente.id },
    orderBy: [{ tooth: "asc" }, { surface: "asc" }, { condition: "asc" }],
    take: EDU_ODONTOGRAM_MAX_ROWS,
    select: ENTRY_SELECT,
  });
  return rows.map((e) => toRow(e, timeZone));
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * La puerta de TODA escritura: el paciente tiene que estar dentro del
 * alcance clínico de quien escribe. Se comprueba SIEMPRE, aunque el
 * endpoint ya haya exigido `odontograma.edit`: un permiso no sabe de quién
 * es la boca.
 */
async function requireClinicalPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date,
): Promise<string> {
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no te toca.", 404);
  return paciente.id;
}

export interface EduOdontogramWriteInput {
  tooth?: unknown;
  surface?: unknown;
  condition?: unknown;
  /** true = marcar el hallazgo; false = quitarlo. */
  present?: unknown;
}

/**
 * Marca o quita UN hallazgo.
 *
 * Un solo endpoint para las dos cosas y no un PUT + un DELETE: el
 * odontograma se usa como un interruptor (clic pone, clic quita) y partirlo
 * en dos verbos obligaba a mandar los identificadores en el cuerpo de un
 * DELETE, que es de esas cosas que funcionan hasta que un proxy decide que
 * no.
 *
 * 🔴 El upsert se apoya en el índice único COMPLETO
 * (institutionId, patientId, tooth, surface, condition). Por eso `surface`
 * es NOT NULL con "" para el diente entero: Postgres considera distintos
 * dos NULL dentro de un índice único, así que con `surface` nullable el
 * mismo hallazgo entraría dos veces con un doble clic.
 */
export async function setEduOdontogramFinding(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduOdontogramWriteInput,
  now: Date = new Date(),
): Promise<{ tooth: number; surface: string; condition: string; present: boolean }> {
  const institutionId = requireInstitution(ctx);
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const parsed = parseEduOdontogramTarget(input);
  if (!parsed.ok) throw new EduPadronError(parsed.error);
  const { tooth, surface, condition } = parsed.value;

  // `present` ausente = marcar. Es lo que hace el pincel, que es el 95% de
  // los clics; obligar a mandarlo siempre solo produce peticiones que
  // fallan por un campo que la pantalla olvidó.
  const present = input.present === undefined ? true : input.present === true;

  if (present) {
    await prisma.eduOdontogramEntry.upsert({
      where: {
        institutionId_patientId_tooth_surface_condition: {
          institutionId,
          patientId: pid,
          tooth,
          surface,
          condition,
        },
      },
      // Marcar algo que ya estaba marcado REFRESCA quién y cuándo: si un
      // docente reconfirma un hallazgo del alumno, el expediente tiene que
      // decir que lo reconfirmó él.
      update: { recordedById: ctx.eduUserId, recordedAt: now },
      create: {
        institutionId,
        patientId: pid,
        tooth,
        surface,
        condition,
        recordedById: ctx.eduUserId,
        recordedAt: now,
      },
    });
  } else {
    // deleteMany y no delete: quitar un hallazgo que ya no estaba no es un
    // error que valga la pena enseñarle a nadie (pasa con un doble clic), y
    // `delete` lanzaría P2025.
    await prisma.eduOdontogramEntry.deleteMany({
      where: { institutionId, patientId: pid, tooth, surface, condition },
    });
  }

  return { tooth, surface, condition, present };
}

/**
 * La NOTA de un diente.
 *
 * Se guarda en la misma tabla, con la key RESERVADA "__nota__" y la cara
 * vacía. El saneo del catálogo (parseEduCondition) RECHAZA cualquier id que
 * empiece con "__", así que esa fila no se puede crear ni borrar desde el
 * pincel: solo desde aquí.
 *
 * Vaciar el texto BORRA la fila en vez de dejar una con "": una nota vacía
 * en la lista de hallazgos es ruido que nadie escribió.
 */
export async function setEduOdontogramNote(
  ctx: EduClinicaContext,
  patientId: string,
  input: { tooth?: unknown; notes?: unknown },
  now: Date = new Date(),
): Promise<{ tooth: number; notes: string | null }> {
  const institutionId = requireInstitution(ctx);
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const tooth = parseEduFdi(input.tooth);
  if (tooth === null) {
    throw new EduPadronError("Ese número de diente no existe en la nomenclatura FDI.");
  }

  const texto =
    typeof input.notes === "string" ? input.notes.trim().slice(0, EDU_ODONTOGRAM_NOTE_MAX) : "";

  const llave = {
    institutionId,
    patientId: pid,
    tooth,
    surface: EDU_TOOTH_WHOLE,
    condition: EDU_ODONTOGRAM_NOTE_KEY,
  };

  if (!texto) {
    await prisma.eduOdontogramEntry.deleteMany({ where: llave });
    return { tooth, notes: null };
  }

  await prisma.eduOdontogramEntry.upsert({
    where: { institutionId_patientId_tooth_surface_condition: llave },
    update: { notes: texto, recordedById: ctx.eduUserId, recordedAt: now },
    create: { ...llave, notes: texto, recordedById: ctx.eduUserId, recordedAt: now },
  });

  return { tooth, notes: texto };
}
