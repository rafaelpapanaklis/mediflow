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
 *
 * 🔴 Y DESDE LA OLA B, QUITAR TAMPOCO BORRA (H-17). Éste era el único
 * módulo del vertical que hacía `DELETE`: la goma del alumno de endodoncia
 * pasaba por encima de lo que marcó el de ortodoncia y no quedaba ni el
 * rastro de que existió. Ahora quitar es `deletedAt` + `deletedById`, las
 * lecturas del dibujo filtran `deletedAt IS NULL` y el historial enseña
 * las dos caras.
 *
 * ⛔ EL DETALLE QUE ROMPE ESTO SI SE OLVIDA: el índice único
 * `edu_odontogram_hallazgo_key` es de CINCO columnas y NO es parcial
 * (dejarlo parcial exigía un DROP INDEX, y aquí no se borra nada). Una
 * fila dada de baja SIGUE OCUPANDO su clave. Por eso remarcar un hallazgo
 * retirado tiene que REVIVIR esa misma fila —`deletedAt = NULL` y el
 * `recordedBy/At` de hoy— y no insertar una segunda, que chocaría contra
 * el índice. El upsert de las cinco columnas ya cae solo en esa rama; lo
 * único que hay que no hacer es tocar `firstRecordedAt` al revivir.
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
  eduOdontogramBajaData,
  eduOdontogramCreateData,
  eduOdontogramReviveData,
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
  deletedAt: true,
  deletedById: true,
  deletedBy: { select: { firstName: true, lastName: true, email: true } },
  firstRecordedAt: true,
  // `createdAt` no se pinta: es el respaldo de `firstRecordedAt` para las
  // filas que se crearon entre el SQL de la Ola B y esta casilla, cuando
  // el código todavía no sellaba la columna. Ver `desdeCuando`.
  createdAt: true,
} satisfies Prisma.EduOdontogramEntrySelect;

type EntryPayload = Prisma.EduOdontogramEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/**
 * DESDE CUÁNDO está marcado ese diente.
 *
 * `firstRecordedAt` es la respuesta y el backfill de la Ola B la llenó
 * para todo lo que existía. El `?? createdAt` cubre exactamente una
 * rendija: las filas que el código VIEJO creó después de aplicar el SQL y
 * antes de integrar esta casilla, que nacieron con la columna en NULL. En
 * esas, `createdAt` sigue siendo la fecha del primer marcaje —el upsert
 * viejo nunca lo tocaba—, así que la respuesta es correcta y no hace falta
 * ni una escritura más ni un segundo backfill.
 */
function desdeCuando(e: EntryPayload): Date {
  return e.firstRecordedAt ?? e.createdAt;
}

function toRow(e: EntryPayload, timeZone: string): EduOdontogramEntryRow {
  const primera = desdeCuando(e);
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

    deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
    deletedById: e.deletedById,
    // Un hallazgo dado de baja por alguien cuya cuenta se desactivó después
    // deja `deletedById` puesto y la relación en null (el FK es SetNull):
    // el rastro dice "se quitó el 3 de marzo" aunque ya no pueda decir
    // quién, que es mejor que no decir nada.
    deletedByName: e.deletedBy ? personName(e.deletedBy) : null,
    deletedLabel: e.deletedAt ? stampLabel(e.deletedAt, timeZone) : null,

    firstRecordedAt: primera.toISOString(),
    firstRecordedLabel: stampLabel(primera, timeZone),
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
    // 🔴 `deletedAt: null` EN EL `where`, no con un `.filter()` después.
    // Un recorte que vive fuera de la consulta es un recorte que el
    // siguiente `findMany` se olvida de copiar, y aquí olvidarlo significa
    // dibujar en la boca de alguien un hallazgo que se quitó.
    where: { institutionId, patientId: paciente.id, deletedAt: null },
    orderBy: [{ tooth: "asc" }, { surface: "asc" }, { condition: "asc" }],
    take: EDU_ODONTOGRAM_MAX_ROWS,
    select: ENTRY_SELECT,
  });
  return rows.map((e) => toRow(e, timeZone));
}

/**
 * Una página del odontograma: lo VIVO y lo RETIRADO, juntos.
 *
 * 🔴 POR QUÉ EN UNA SOLA CONSULTA Y NO EN DOS. El dibujo necesita las
 * vivas y el historial necesita las dos; pedirlas por separado serían dos
 * viajes al pooler para la misma tabla y, peor, dos fotos tomadas en
 * instantes distintos — un hallazgo que alguien quita entre una y otra
 * saldría dibujado y sin aparecer en el historial. Se traen juntas y las
 * vivas se derivan con `eduOdontogramLiveEntries`.
 */
export interface EduOdontogramPage {
  /** TODAS las filas, vivas y dadas de baja, la última acción primero. */
  rows: EduOdontogramEntryRow[];
  /** true = se topó con el techo y hay historia más vieja que no viajó. */
  truncated: boolean;
}

/**
 * El odontograma con su rastro.
 *
 * ── EL ORDEN: PRIMERO LAS VIVAS, Y ESO PROTEGE AL DIBUJO ───────────────
 * `deletedAt` ascendente con los NULL DELANTE pone todas las filas vivas
 * antes que cualquier retirada. No es estético: es lo que garantiza que,
 * si algún día se topara con el techo, lo que se pierda sea historia
 * vieja y NUNCA un hallazgo que hay que dibujar. Con un orden por fecha a
 * secas, un hallazgo marcado hace dos años y nunca tocado sería justo lo
 * primero en caerse, y el dibujo saldría incompleto sin que nadie lo vea.
 *
 * Dentro de cada grupo manda `updatedAt`, que con la baja lógica ES la
 * "última acción": Prisma lo reescribe en cada escritura, así que vale
 * `recordedAt` en una fila viva y `deletedAt` en una retirada. Postgres no
 * ordena por el mayor de dos columnas sin un índice funcional; esto sí, y
 * sin inventar nada.
 *
 * 🔴 SE PIDE UNA DE MÁS (`MAX + 1`) PARA PODER DECIRLO (S-12). El
 * historial se cortaba a 40 filas EN LA PANTALLA y sin una palabra que lo
 * dijera: un odontograma con 41 movimientos y uno con 400 se veían
 * idénticos. Mismo criterio que las notas del expediente.
 */
export async function listEduOdontogramHistory(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduOdontogramPage> {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduClinicalScope(ctx))) return { rows: [], truncated: false };

  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) return { rows: [], truncated: false };

  const rows = await prisma.eduOdontogramEntry.findMany({
    where: { institutionId, patientId: paciente.id },
    orderBy: [
      { deletedAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "desc" },
      { id: "desc" },
    ],
    take: EDU_ODONTOGRAM_MAX_ROWS + 1,
    select: ENTRY_SELECT,
  });

  return {
    truncated: rows.length > EDU_ODONTOGRAM_MAX_ROWS,
    rows: rows.slice(0, EDU_ODONTOGRAM_MAX_ROWS).map((e) => toRow(e, timeZone)),
  };
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
 *
 * 🔴 Y ES EL MISMO ÍNDICE EL QUE OBLIGA A REVIVIR (H-17). No es parcial
 * —no lleva `WHERE "deletedAt" IS NULL`, porque hacerlo parcial exigía un
 * DROP INDEX y aquí no se borra nada—, así que una fila dada de baja
 * SIGUE OCUPANDO su clave. Remarcar ese hallazgo cae por eso en la rama
 * `update` del upsert y lo que hace es revivir la fila: `deletedAt` a
 * NULL y el autor de hoy. Un `create` ahí chocaría contra el índice y la
 * escritura fallaría con P2002 delante de quien está marcando una boca.
 *
 * ⛔ `firstRecordedAt` NO va en el `update`. Es la única respuesta que
 * queda a "¿desde cuándo está marcado este diente?" —`recordedAt` se pisa
 * en cada remarcado, a propósito—, y escribirlo al revivir haría que
 * quitar y volver a marcar la borrara. Por eso el cuerpo del update es
 * `eduOdontogramReviveData`, que no la incluye.
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

  const llave = { institutionId, patientId: pid, tooth, surface, condition };
  const autor = { userId: ctx.eduUserId, at: now };

  if (present) {
    await prisma.eduOdontogramEntry.upsert({
      where: { institutionId_patientId_tooth_surface_condition: llave },
      // Marcar algo que ya estaba marcado REFRESCA quién y cuándo (si un
      // docente reconfirma un hallazgo del alumno, el expediente tiene que
      // decir que lo reconfirmó él) y, si estaba RETIRADO, lo revive.
      update: eduOdontogramReviveData(autor),
      create: { ...llave, ...eduOdontogramCreateData(autor) },
    });
  } else {
    // 🔴 BAJA LÓGICA, no DELETE (H-17). `updateMany` y no `update`: quitar
    // un hallazgo que ya no estaba no es un error que valga la pena
    // enseñarle a nadie (pasa con un doble clic) y `update` lanzaría
    // P2025. El `deletedAt: null` del `where` es lo que hace que volver a
    // quitar NO reescriba la firma de quien lo quitó de verdad.
    await prisma.eduOdontogramEntry.updateMany({
      where: { ...llave, deletedAt: null },
      data: eduOdontogramBajaData(autor),
    });
  }

  return { tooth, surface, condition, present };
}

export interface EduOdontogramClearInput {
  tooth?: unknown;
}

/**
 * LIMPIAR UN DIENTE ENTERO — hallazgos, caras y nota — en UNA petición.
 *
 * 🔴 POR QUÉ EXISTE (H-22). Antes la pantalla mandaba UNA petición POR
 * HALLAZGO y le daba a todas el mismo "deshacer": restaurar el diente
 * entero. Un diente con cinco hallazgos mandaba cinco peticiones y, si
 * fallaba la tercera, se repintaban los cinco — incluidos los dos que las
 * peticiones 1 y 2 ya habían borrado en Postgres. La pantalla quedaba
 * enseñando hallazgos que ya no existían, que es justo lo contrario de lo
 * que promete el contenedor ("nunca se deja pintado algo que no se
 * guardó"). Con una sola escritura el resultado solo tiene dos formas: se
 * borró todo, o no se borró nada y se deshace entero con razón.
 *
 * UNA SOLA sentencia y no un `$transaction` con N escrituras: en Postgres
 * un UPDATE con `WHERE ... AND tooth = $n` es una sola sentencia y por
 * tanto ya es atómico. Una transacción alrededor no agregaría garantía
 * ninguna y sí un viaje más al pooler.
 *
 * La NOTA se va con el diente a propósito: vive en esta misma tabla con la
 * key reservada "__nota__", así que entra en el mismo `where`. Antes se
 * quedaba huérfana — "Limpiar diente" dejaba un diente sin un solo
 * hallazgo y con la nota de lo que ya no está.
 *
 * 🔴 OLA B · YA NO BORRA (H-17). Era la escritura más destructiva del
 * vertical: un clic y el diente entero desaparecía de la tabla, con lo que
 * hubiera marcado otra persona dentro. Ahora es una BAJA LÓGICA de todas
 * las filas vivas de ese diente, con la firma de quien la hizo, y el
 * historial sigue pudiendo contestar qué había ahí y quién lo quitó.
 *
 * `removed` cuenta lo que de verdad se dio de baja: el `deletedAt: null`
 * del `where` deja fuera lo que ya estaba retirado, así que limpiar dos
 * veces el mismo diente devuelve 0 la segunda y no reescribe la firma del
 * primero.
 */
export async function clearEduOdontogramTooth(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduOdontogramClearInput,
  now: Date = new Date(),
): Promise<{ tooth: number; removed: number }> {
  const institutionId = requireInstitution(ctx);
  const pid = await requireClinicalPatient(ctx, patientId, now);

  const tooth = parseEduFdi(input.tooth);
  if (tooth === null) {
    throw new EduPadronError("Ese número de diente no existe en la nomenclatura FDI.");
  }

  const { count } = await prisma.eduOdontogramEntry.updateMany({
    where: { institutionId, patientId: pid, tooth, deletedAt: null },
    data: eduOdontogramBajaData({ userId: ctx.eduUserId, at: now }),
  });

  return { tooth, removed: count };
}

/**
 * La NOTA de un diente.
 *
 * Se guarda en la misma tabla, con la key RESERVADA "__nota__" y la cara
 * vacía. El saneo del catálogo (parseEduCondition) RECHAZA cualquier id que
 * empiece con "__", así que esa fila no se puede crear ni borrar desde el
 * pincel: solo desde aquí.
 *
 * Vaciar el texto RETIRA la fila en vez de dejar una con "": una nota
 * vacía en la lista de hallazgos es ruido que nadie escribió.
 *
 * 🔴 OLA B · retirar es `deletedAt`, no `DELETE` (H-17), y volver a
 * escribir la nota REVIVE la misma fila por el mismo índice de cinco
 * columnas. Lo que se conserva es lo que a un expediente le importa: que
 * ahí hubo una nota, qué decía y quién la quitó.
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

  const autor = { userId: ctx.eduUserId, at: now };

  if (!texto) {
    // El `deletedAt: null` evita que vaciar dos veces reescriba la firma de
    // quien la quitó de verdad. El TEXTO no se borra: la nota retirada
    // queda legible en el historial, que es de lo que se trata.
    await prisma.eduOdontogramEntry.updateMany({
      where: { ...llave, deletedAt: null },
      data: eduOdontogramBajaData(autor),
    });
    return { tooth, notes: null };
  }

  await prisma.eduOdontogramEntry.upsert({
    where: { institutionId_patientId_tooth_surface_condition: llave },
    update: { notes: texto, ...eduOdontogramReviveData(autor) },
    create: { ...llave, notes: texto, ...eduOdontogramCreateData(autor) },
  });

  return { tooth, notes: texto };
}
