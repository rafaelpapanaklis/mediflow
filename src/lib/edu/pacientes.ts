/**
 * DaleControl INSTITUCIONAL — los PACIENTES contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client" (se
 * arrastraría el runtime de Prisma al navegador). Lo puro y compartible
 * vive en pacientes-core.ts; aquí solo hay consultas.
 *
 * 🔴 REGLA DE ORO DE ESTE ARCHIVO (la misma de la Ola 1A): TODA función
 * recibe el contexto de sesión y saca de ahí el institutionId. Ninguna lo
 * acepta como parámetro suelto, ninguna lo lee de un body. Si algún día ves
 * un `institutionId` en la firma de una función nueva de aquí, es un bug de
 * tenant esperando a que lo llamen con el id equivocado.
 *
 * 🔴 Y LA REGLA NUEVA DE ESTA OLA: ninguna lectura arma su propio recorte.
 * El `where` sale de src/lib/edu/visibility.ts, que es donde vive la
 * respuesta a "quién ve qué". Un endpoint que se lo salte devolvería los
 * pacientes de toda la escuela a un alumno, y el bug se vería exactamente
 * igual que "funciona".
 *
 * Las escrituras NO comprueban permisos: eso lo hace el endpoint con
 * assertEduPermission antes de llamar. Aquí se comprueba la PERTENENCIA
 * (que el paciente y el alumno sean de ESTE instituto y estén dentro del
 * alcance de quien pregunta), que es lo que un permiso no puede saber.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  EDU_CLINICA_MAX_ROWS,
  eduCleanId,
  eduOptionalText,
} from "@/lib/edu/agenda-core";
// Ola 1B: el índice sin acentos vive en su propio módulo puro. Se importa
// de ahí y no de pacientes-core para que quede claro de dónde sale: es el
// MISMO constructor que usa el .sql del backfill.
import { eduNormalizeSearch, eduPatientSearchIndex } from "@/lib/edu/search";
// El teléfono se compara con la MISMA función con la que se guarda y con la
// que se manda: reconocer un "+52 55…" viejo y un "5544332211" nuevo como
// el mismo número es la mitad del aviso de duplicado.
import { eduWaPhone } from "@/lib/edu/whatsapp-core";
import {
  eduAgeYears,
  eduPatientFullName,
  eduPatientSearchAnd,
  normalizeEduEmail,
  normalizeEduFolio,
  normalizeEduWaPhone,
  parseEduAntecedentes,
  parseEduPatientStatus,
  parseEduSex,
  eduPatientOptionsPageOf,
  eduPatientFieldIsContact,
  eduPatientStatusConflict,
  EDU_PATIENT_FORM_FIELDS,
  EDU_PHONE_HELP,
  type EduAntecedentesInput,
  type EduPatientFilters,
  type EduPatientOption,
  type EduPatientOptionsPage,
  type EduPatientRow,
  type EduPatientsPage,
} from "@/lib/edu/pacientes-core";
import { eduRequiredText, parseEduCalendarDate } from "@/lib/edu/padron-core";
import {
  eduPatientScopeWhere,
  eduVisibility,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { EDU_CASE_CLOSED_STATUSES, type EduPatientStatus } from "@/lib/edu/types";

/**
 * El error con status HTTP del vertical. Es el MISMO de la Ola 1A y no uno
 * nuevo: `eduApiError` (src/lib/edu/api-guard.ts) lo mapea tal cual, así
 * que un error propio de esta ola saldría como 500 genérico y el mensaje
 * escrito para una persona no llegaría a la pantalla.
 */
export { EduPadronError as EduClinicaError };

/** Las formas que viajan a la pantalla se DEFINEN en el módulo puro. */
export type {
  EduPatientRow,
  EduPatientsPage,
  EduPatientOption,
  EduPatientOptionsPage,
  EduPatientOrigin,
} from "@/lib/edu/pacientes-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

/** El `select` de una fila completa de paciente. Vive en una constante para
 *  que la lista y la ficha no se desincronicen: una columna nueva se agrega
 *  UNA vez. */
const PATIENT_SELECT = {
  id: true,
  folio: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  birthDate: true,
  sex: true,
  notes: true,
  status: true,
  createdAt: true,
  referredByStudentId: true,
  originSetAt: true,
  // Ola de Casos: los antecedentes médicos viajan SIEMPRE con la fila —
  // los chips de alerta se pintan en el encabezado de la ficha, y un
  // encabezado que a veces no los trae es un encabezado que un día calla
  // una alergia.
  bloodType: true,
  allergies: true,
  chronicConditions: true,
  currentMedications: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  historyRecordedAt: true,
  historyRecordedBy: { select: { firstName: true, lastName: true, email: true } },
  referredByStudent: {
    select: {
      id: true,
      matricula: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  originSetBy: { select: { firstName: true, lastName: true, email: true } },
  cases: { select: { status: true } },
} satisfies Prisma.EduPatientSelect;

type PatientPayload = Prisma.EduPatientGetPayload<{ select: typeof PATIENT_SELECT }>;

function toRow(p: PatientPayload, now: Date): EduPatientRow {
  const abiertos = p.cases.filter(
    (c) => !(EDU_CASE_CLOSED_STATUSES as string[]).includes(c.status),
  ).length;
  return {
    id: p.id,
    folio: p.folio,
    name: eduPatientFullName(p),
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone,
    email: p.email,
    birthDate: iso(p.birthDate),
    ageYears: eduAgeYears(p.birthDate, now),
    sex: p.sex,
    notes: p.notes,
    status: p.status,
    origin: {
      studentId: p.referredByStudentId,
      studentName: p.referredByStudent ? personName(p.referredByStudent.user) : null,
      studentMatricula: p.referredByStudent?.matricula ?? null,
      setByName: p.originSetBy ? personName(p.originSetBy) : null,
      setAt: iso(p.originSetAt),
    },
    antecedentes: {
      bloodType: p.bloodType,
      allergies: p.allergies,
      chronicConditions: p.chronicConditions,
      currentMedications: p.currentMedications,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
      emergencyContactRelation: p.emergencyContactRelation,
      recordedAt: iso(p.historyRecordedAt),
      recordedByName: p.historyRecordedBy ? personName(p.historyRecordedBy) : null,
    },
    openCases: abiertos,
    totalCases: p.cases.length,
    createdAt: p.createdAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Arma el `where` de la lista: alcance + filtros + buscador.
 *
 * El recorte va SIEMPRE primero y de `eduPatientScopeWhere`; los filtros se
 * suman en un `AND` para no pisar el `OR` con el que el alcance del alumno
 * y el del docente se expresan. Escribir `where.OR = …` aquí borraría el
 * recorte entero y nadie lo notaría hasta que un alumno viera la clínica
 * completa.
 */
function patientsWhere(
  ctx: EduClinicaContext,
  filters: EduPatientFilters,
  now: Date,
): Prisma.EduPatientWhereInput {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  const where = eduPatientScopeWhere({ institutionId, scope, now });

  const and: Prisma.EduPatientWhereInput[] = [];
  if (filters.status) and.push({ status: filters.status });
  if (filters.referredByStudentId) {
    and.push({ referredByStudentId: filters.referredByStudentId });
  }

  // 🔴 SE BUSCA EN `searchIndex` Y EN NADA MÁS (Ola 1B). Esa columna lleva
  // folio + nombre + apellido + dígitos del teléfono + correo, en
  // minúsculas y SIN ACENTOS, así que "Rodriguez" encuentra a "Rodríguez" y
  // "MARIA" encuentra a "María". Buscar contra `firstName` con
  // `mode: "insensitive"` —que es lo que había— arregla las mayúsculas y NO
  // los acentos: `contains` compara el texto tal cual.
  //
  // La construcción vive en el módulo PURO (pacientes-core) para que se
  // pueda probar sin base de datos: este archivo importa prisma y una
  // prueba no lo puede cargar.
  and.push(...eduPatientSearchAnd(filters.q));

  if (and.length > 0) where.AND = and;
  return where;
}

export async function listEduPatients(
  ctx: EduClinicaContext,
  filters: EduPatientFilters,
  now: Date = new Date(),
): Promise<EduPatientsPage> {
  const scope = eduVisibility(ctx, "patients");
  // Sin alcance no se consulta nada. La pantalla explica por qué.
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const rows = await prisma.eduPatient.findMany({
    where: patientsWhere(ctx, filters, now),
    orderBy: [{ createdAt: "desc" }],
    take: EDU_CLINICA_MAX_ROWS + 1,
    select: PATIENT_SELECT,
  });

  return {
    truncated: rows.length > EDU_CLINICA_MAX_ROWS,
    rows: rows.slice(0, EDU_CLINICA_MAX_ROWS).map((p) => toRow(p, now)),
  };
}

/**
 * Una ficha, SI le toca a quien pregunta.
 *
 * 🔴 El id de la URL no basta: la fila se busca con el `where` del alcance,
 * así que un paciente de otra escuela —o de otro alumno— se ve exactamente
 * igual que uno que no existe. Es lo que debe pasar: un 403 confirmaría que
 * ese folio existe.
 */
export async function getEduPatient(
  ctx: EduClinicaContext,
  patientId: string,
  now: Date = new Date(),
): Promise<EduPatientRow | null> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return null;
  const id = eduCleanId(patientId);
  if (!id) return null;

  const p = await prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: PATIENT_SELECT,
  });
  return p ? toRow(p, now) : null;
}

/** Pacientes para un <select> (agendar una cita). Mismo recorte. */
export async function listEduPatientOptions(
  ctx: EduClinicaContext,
  now: Date = new Date(),
): Promise<EduPatientOptionsPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const rows = await prisma.eduPatient.findMany({
    where: eduPatientScopeWhere({ institutionId, scope, now }),
    orderBy: [{ folio: "asc" }],
    take: EDU_CLINICA_MAX_ROWS + 1,
    select: { id: true, folio: true, firstName: true, lastName: true, status: true },
  });
  return eduPatientOptionsPageOf(
    rows.map((p) => ({
      id: p.id,
      folio: p.folio,
      name: eduPatientFullName(p),
      status: p.status,
    })),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ESCRITURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * El siguiente folio automático: P-0001, P-0002…
 *
 * Con CUATRO dígitos y ceros a la izquierda a propósito: el orden de
 * Postgres es alfabético y sin el relleno "P-9" saldría después de "P-10",
 * que es justo lo que rompería este cálculo.
 *
 * Una escuela que ya tiene su propia numeración teclea el folio y esto no
 * se usa. Si dos recepcionistas dan de alta a la vez, el índice único
 * (institutionId, folio) rebota a la segunda y `createEduPatient` reintenta.
 */
async function nextEduFolio(institutionId: string): Promise<string> {
  const last = await prisma.eduPatient.findFirst({
    where: { institutionId, folio: { startsWith: "P-" } },
    orderBy: { folio: "desc" },
    select: { folio: true },
  });
  const m = last?.folio.match(/^P-(\d{1,6})$/);
  const n = m ? Number(m[1]) + 1 : 1;
  return `P-${String(n).padStart(4, "0")}`;
}

export interface EduPatientInput {
  folio?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  email?: unknown;
  birthDate?: unknown;
  sex?: unknown;
  notes?: unknown;
  status?: unknown;
  referredByStudentId?: unknown;
}

/** Comprueba que el alumno del ORIGEN sea de este instituto. Devuelve el
 *  id o null si el origen se está borrando. */
async function resolveOriginStudent(
  institutionId: string,
  raw: unknown,
): Promise<string | null> {
  if (raw === null || raw === undefined || raw === "") return null;
  const id = eduCleanId(raw);
  if (!id) throw new EduPadronError("Ese estudiante no es válido.");
  const student = await prisma.eduStudent.findFirst({
    where: { id, institutionId },
    select: { id: true },
  });
  if (!student) throw new EduPadronError("Ese estudiante no es de este instituto.", 404);
  return student.id;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL AVISO DE DUPLICADO (H-05)
 *
 * 🔴 QUÉ ARREGLA. El alta solo comprobaba que el FOLIO no se repitiera.
 * Nada miraba el nombre ni el teléfono, así que dos recepcionistas —o la
 * misma dos días distintos— daban de alta a «María López, 5544332211» y
 * salían dos folios, dos expedientes, dos odontogramas y dos historiales de
 * la misma persona. Y a partir de ahí no hay vuelta: un paciente NO se
 * borra (es NOM-004, y está razonado en el endpoint) y NO se fusiona (no
 * existe ninguna función de fusión en el vertical).
 *
 * 🔴 AVISA, NO IMPIDE. Dos hermanos pueden llamarse igual y compartir el
 * teléfono de su madre; una escuela grande tiene homónimos. Así que esto
 * NO es un índice único: es un alto en el camino que dice a quién se
 * parece y deja seguir A PROPÓSITO, con `allowDuplicate`. Un bloqueo duro
 * dejaría a recepción sin poder registrar a un paciente real.
 *
 * 🔴 DÓNDE VIVE Y POR QUÉ. En el SERVIDOR, dentro del alta, y no como una
 * consulta que la pantalla hace antes de enviar: entre "consulto" y "creo"
 * caben los cinco segundos en los que la otra recepcionista lo registra.
 * Aquí la comprobación y la escritura van pegadas.
 *
 * ⚠️ Esto NO fusiona nada. Fusionar son ocho tablas y una decisión de
 * producto; es otra ola.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduPatientDuplicate {
  id: string;
  folio: string;
  name: string;
  phone: string | null;
  /** Por qué se parece: "telefono" o "nombre" (nombre + apellidos + nacimiento). */
  motivo: "telefono" | "nombre";
}

/**
 * Pacientes del instituto que se parecen al que se está registrando.
 *
 * Dos criterios, los dos exactos (nada de parecidos borrosos: un "Juan
 * Pérez" que avisa por cada "Juan Pérezz" se aprende a ignorar en dos días
 * y deja de servir):
 *   · MISMO TELÉFONO ya normalizado a diez dígitos, o
 *   · MISMO nombre + apellidos + fecha de nacimiento.
 *
 * El nombre se compara SIN acentos y en minúsculas, con el mismo índice que
 * usa el buscador (`searchIndex`), porque «María» y «Maria» son la misma
 * persona escrita por dos recepcionistas distintas.
 *
 * 🔴 Alcance: el INSTITUTO entero, no el de quien pregunta. Quien registra
 * es caja o dirección (`pacientes.manage`), cuyo alcance ya es completo, y
 * un aviso recortado sería justo el que no avisa del duplicado que importa.
 * El tenant, como siempre, sale de la sesión.
 */
async function buscarDuplicados(
  institutionId: string,
  datos: {
    phone: string | null;
    firstName: string;
    lastName: string;
    birthDate: Date | null;
  },
): Promise<EduPatientDuplicate[]> {
  const or: Prisma.EduPatientWhereInput[] = [];

  // 🔴 EL TELÉFONO SE BUSCA EN TODAS LAS FORMAS EN QUE PUDO GUARDARSE. Los
  // pacientes de hoy llevan los diez dígitos (`normalizeEduWaPhone`), pero
  // los de antes de esta ola se guardaron con la regla ancha y hay
  // "+525544332211" y "525544332211" en la base. Comparar solo contra los
  // diez dejaría el aviso ciego para justo los pacientes viejos, que son
  // los que más duplicados tienen. No hay backfill: se busca por las cuatro.
  if (datos.phone) {
    or.push({
      phone: { in: [datos.phone, `52${datos.phone}`, `+52${datos.phone}`, `+521${datos.phone}`] },
    });
  }

  if (datos.birthDate) {
    or.push({
      birthDate: datos.birthDate,
      // 🔴 Contra `searchIndex` y NO contra `lastName` con
      // `mode: "insensitive"`: eso arregla las mayúsculas y NO los acentos,
      // y el duplicado que importa es exactamente "Pérez" contra "Perez" —
      // la misma persona tecleada por dos recepcionistas. `searchIndex` es
      // la columna que ya está en minúsculas y sin acentos (Ola 1B), y es
      // la que usa el buscador de la lista por esta misma razón.
      searchIndex: { contains: eduNormalizeSearch(datos.lastName) },
    });
  }
  if (or.length === 0) return [];

  const filas = await prisma.eduPatient.findMany({
    where: { institutionId, OR: or },
    orderBy: [{ createdAt: "asc" }],
    // Un tope pequeño a propósito: el aviso enseña a quién se parece, no
    // hace un censo. Con más de cinco, lo que hace falta no es esta lista.
    take: 5,
    select: { id: true, folio: true, firstName: true, lastName: true, phone: true, birthDate: true },
  });

  const nombreBuscado = eduNormalizeSearch(`${datos.firstName} ${datos.lastName}`);
  const out: EduPatientDuplicate[] = [];
  for (const f of filas) {
    // El afinado del teléfono se hace con `eduWaPhone` en los dos lados: es
    // lo que hace que un "+52 55 4433 2211" guardado en 2025 y un
    // "5544332211" de hoy se reconozcan como el mismo número.
    const mismoTelefono =
      Boolean(datos.phone) && Boolean(f.phone) && eduWaPhone(f.phone) === datos.phone;
    const mismoNombre =
      Boolean(datos.birthDate) &&
      f.birthDate?.getTime() === datos.birthDate?.getTime() &&
      eduNormalizeSearch(`${f.firstName} ${f.lastName}`) === nombreBuscado;
    if (!mismoTelefono && !mismoNombre) continue;
    out.push({
      id: f.id,
      folio: f.folio,
      name: eduPatientFullName(f),
      phone: f.phone,
      motivo: mismoTelefono ? "telefono" : "nombre",
    });
  }
  return out;
}

/** El aviso, escrito para recepción. Lo arma el servidor y la pantalla lo
 *  pinta tal cual: el mensaje tiene que decir A QUIÉN se parece, con folio,
 *  o no sirve para decidir. */
export function eduDuplicateMessage(dups: EduPatientDuplicate[]): string {
  const quienes = dups
    .map((d) => `${d.folio} · ${d.name}${d.motivo === "telefono" ? " (mismo teléfono)" : ""}`)
    .join("; ");
  return dups.length === 1
    ? `Ya existe ${quienes}. ¿Es la misma persona? Si no lo es, vuelve a pulsar Registrar para darla de alta igual.`
    : `Ya existen ${dups.length} pacientes que se le parecen: ${quienes}. ¿Es alguno de ellos? Si no, vuelve a pulsar Registrar para darlo de alta igual.`;
}

/** El error del duplicado, con la lista pegada para que la pantalla pueda
 *  pintarla sin volver a preguntar. */
export class EduPatientDuplicateError extends EduPadronError {
  readonly duplicates: EduPatientDuplicate[];
  constructor(duplicates: EduPatientDuplicate[]) {
    super(eduDuplicateMessage(duplicates), 409);
    this.name = "EduPatientDuplicateError";
    this.duplicates = duplicates;
  }
}

export async function createEduPatient(
  ctx: EduClinicaContext,
  input: EduPatientInput,
  options: { canSetOrigin: boolean; allowDuplicate?: boolean } = { canSetOrigin: false },
  now: Date = new Date(),
): Promise<{ id: string; folio: string }> {
  const institutionId = requireInstitution(ctx);

  const firstName = eduRequiredText(input.firstName, 80);
  if (!firstName) throw new EduPadronError("El nombre del paciente es obligatorio (máximo 80 caracteres).");
  const lastName = eduRequiredText(input.lastName, 80);
  if (!lastName) throw new EduPadronError("El apellido del paciente es obligatorio (máximo 80 caracteres).");

  const phone = input.phone === undefined || input.phone === null || input.phone === "" ? null : normalizeEduWaPhone(input.phone);
  if (input.phone && !phone) throw new EduPadronError(`Ese teléfono no sirve. ${EDU_PHONE_HELP}`);

  const email = input.email === undefined || input.email === null || input.email === "" ? null : normalizeEduEmail(input.email);
  if (input.email && !email) throw new EduPadronError("Ese correo no parece un correo.");

  const birthDate =
    input.birthDate === undefined || input.birthDate === null || input.birthDate === ""
      ? null
      : parseEduCalendarDate(input.birthDate);
  if (input.birthDate && !birthDate) {
    throw new EduPadronError("La fecha de nacimiento no es una fecha válida (AAAA-MM-DD).");
  }
  if (birthDate && birthDate.getTime() > now.getTime()) {
    throw new EduPadronError("La fecha de nacimiento no puede estar en el futuro.");
  }

  const sex = input.sex === undefined || input.sex === null || input.sex === "" ? "UNSPECIFIED" : parseEduSex(input.sex);
  if (!sex) throw new EduPadronError("Ese valor de sexo no existe.");

  const notes = eduOptionalText(input.notes, 1000) ?? null;

  // 🔴 El ORIGEN solo lo escribe quien tiene "pacientes.origen". Que el
  // campo llegue en el body no basta: decide el precio en la Ola 5, así que
  // se ignora en silencio para quien no puede ponerlo — y quien puede queda
  // registrado (originSetById + originSetAt).
  const referredByStudentId = options.canSetOrigin
    ? await resolveOriginStudent(institutionId, input.referredByStudentId)
    : null;

  const folioTecleado = input.folio === undefined || input.folio === null || input.folio === "" ? null : normalizeEduFolio(input.folio);
  if (input.folio && !folioTecleado) {
    throw new EduPadronError("El folio es obligatorio si lo capturas (máximo 30 caracteres, sin espacios).");
  }

  // 🔴 EL AVISO DE DUPLICADO va DESPUÉS de sanear (para comparar teléfonos
  // ya normalizados y no "55 4433 2211" contra "5544332211") y ANTES de
  // escribir. Quien insiste manda `allowDuplicate` y se registra igual.
  if (!options.allowDuplicate) {
    const dups = await buscarDuplicados(institutionId, { phone, firstName, lastName, birthDate });
    if (dups.length > 0) throw new EduPatientDuplicateError(dups);
  }

  const data = {
    institutionId,
    firstName,
    lastName,
    phone,
    email,
    birthDate,
    sex,
    notes,
    referredByStudentId,
    originSetById: referredByStudentId ? ctx.eduUserId : null,
    originSetAt: referredByStudentId ? now : null,
  };

  /** El índice sin acentos, con el folio que finalmente se le ponga. Se
   *  calcula aquí y no fuera porque el folio automático se resuelve más
   *  abajo (y puede cambiar entre reintentos). */
  const conIndice = (folio: string) => ({
    ...data,
    folio,
    searchIndex: eduPatientSearchIndex({ folio, firstName, lastName, phone, email }),
  });

  if (folioTecleado) {
    const dup = await prisma.eduPatient.findFirst({
      where: { institutionId, folio: folioTecleado },
      select: { id: true },
    });
    if (dup) throw new EduPadronError(`El folio ${folioTecleado} ya está en uso.`, 409);
    const created = await prisma.eduPatient.create({
      data: conIndice(folioTecleado),
      select: { id: true, folio: true },
    });
    return created;
  }

  // Folio automático. Tres intentos: si dos recepcionistas dan de alta en
  // el mismo segundo, el índice único rebota a la segunda y se recalcula.
  // Sin el reintento, el alta fallaría con un error que no explica nada.
  for (let intento = 0; intento < 3; intento++) {
    const folio = await nextEduFolio(institutionId);
    try {
      return await prisma.eduPatient.create({
        data: conIndice(folio),
        select: { id: true, folio: true },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002" || intento === 2) throw err;
    }
  }
  throw new EduPadronError("No se pudo asignar un folio. Captúralo a mano y vuelve a intentar.", 409);
}

/**
 * Qué parte de la ficha puede tocar quien manda el PATCH (H-02).
 *
 *   · "all"      → los nueve campos. Es `pacientes.manage` (caja, dirección).
 *   · "contacto" → SOLO teléfono y correo. Es `expediente.write` sin
 *     `pacientes.manage`: el alumno y el docente que tienen al paciente en
 *     el sillón.
 *
 * 🔴 El recorte se aplica AQUÍ y no solo en el endpoint. Que el body traiga
 * `folio` no basta para que se escriba: un campo que quien manda no puede
 * tocar es un ERROR con su motivo, no un campo que se ignora en silencio —
 * ignorarlo dejaría a un alumno creyendo que corrigió el apellido.
 */
export type EduPatientEditFields = "all" | "contacto";

/**
 * Edita la ficha. El ORIGEN no se toca aquí: tiene su propia función y su
 * propio permiso, porque no es un dato más de la ficha sino el que decide
 * el precio.
 *
 * 🔴 H-11 · EL PACIENTE SE BUSCA DENTRO DEL ALCANCE, como TODAS las demás
 * escrituras del vertical (`updateEduPatientAntecedentes` ya lo hacía). Era
 * la única que se saltaba el punto único: hoy no explota porque el endpoint
 * exige `pacientes.manage` y solo lo llevan caja y dirección, cuyo alcance
 * es completo — pero el catálogo es editable por `permissionsOverride`, y
 * el día que una escuela le encendiera esa key a un coordinador, podría
 * editar por API la ficha de CUALQUIER paciente del instituto, incluidos
 * los que no puede ver. Y desde esta ola ya no es hipotético: el alumno y
 * el docente entran aquí de verdad, con alcance recortado.
 *
 * 🔴 H-28 · EL ESTADO SE REVALIDA CONTRA LOS CASOS al guardar. La pantalla
 * ya lo dice antes de pulsar, y aun así se comprueba aquí: entre que se
 * pintó y se pulsó, alguien pudo abrir un caso — y el endpoint no puede
 * confiar en que el body venga de esa pantalla.
 */
export async function updateEduPatient(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduPatientInput,
  // 🔴 `options` es OBLIGATORIO y `fields` dentro de él también. Con un
  // default ("all") esta firma fallaría ABIERTO: un llamador que pasara el
  // `now` en la posición vieja —era el cuarto parámetro hasta esta ola—
  // caería en `options`, `fields` saldría undefined y el alumno editaría los
  // nueve campos. Que el compilador lo exija es lo que hace que ese error no
  // se pueda escribir.
  options: { fields: EduPatientEditFields },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Ese paciente no es de este instituto.", 404);
  }
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  // 🔴 Los campos que quien manda NO puede tocar se rechazan ANTES de
  // consultar nada: un alumno que manda `folio` se entera de que no puede,
  // en vez de guardar a medias.
  const fields = options.fields;
  if (fields === "contacto") {
    // Se miran los NUEVE campos de la ficha y no `Object.keys(input)`: lo
    // que esta función no lee ya se ignoraba en silencio para todo el mundo
    // antes de esta ola (`referredByStudentId`, por ejemplo, que tiene su
    // propio endpoint), y rechazarlo solo para el alumno dejaría al
    // formulario roto el día que alguien añada una clave suelta al body. Lo
    // que se cierra es la escalada, que solo puede venir por estos nueve.
    const prohibidos = EDU_PATIENT_FORM_FIELDS.filter(
      (k) => input[k] !== undefined && !eduPatientFieldIsContact(k),
    );
    if (prohibidos.length > 0) {
      throw new EduPadronError(
        "Con tu permiso solo puedes corregir el teléfono y el correo del paciente. El resto de la ficha (folio, nombre, apellidos, sexo, nacimiento, estado y notas de recepción) lo captura recepción.",
        403,
      );
    }
  }

  // Se traen las cinco columnas que alimentan el índice de búsqueda, no
  // solo el id: al editar solo el apellido hay que reescribir el índice
  // ENTERO, y para eso hacen falta las otras cuatro tal como están hoy. Y
  // los casos, para poder revalidar el estado (H-28) sin una segunda vuelta
  // a la base.
  const current = await prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: {
      id: true,
      folio: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      cases: { select: { status: true } },
    },
  });
  if (!current) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const data: {
    folio?: string;
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    email?: string | null;
    birthDate?: Date | null;
    sex?: ReturnType<typeof parseEduSex>;
    notes?: string | null;
    status?: EduPatientStatus;
    searchIndex?: string;
  } = {};

  if (input.folio !== undefined) {
    const folio = normalizeEduFolio(input.folio);
    if (!folio) throw new EduPadronError("El folio es obligatorio (máximo 30 caracteres, sin espacios).");
    const dup = await prisma.eduPatient.findFirst({
      where: { institutionId, folio, NOT: { id } },
      select: { id: true },
    });
    if (dup) throw new EduPadronError(`El folio ${folio} ya está en uso.`, 409);
    data.folio = folio;
  }
  if (input.firstName !== undefined) {
    const v = eduRequiredText(input.firstName, 80);
    if (!v) throw new EduPadronError("El nombre del paciente es obligatorio (máximo 80 caracteres).");
    data.firstName = v;
  }
  if (input.lastName !== undefined) {
    const v = eduRequiredText(input.lastName, 80);
    if (!v) throw new EduPadronError("El apellido del paciente es obligatorio (máximo 80 caracteres).");
    data.lastName = v;
  }
  if (input.phone !== undefined) {
    if (input.phone === null || input.phone === "") data.phone = null;
    else {
      const v = normalizeEduWaPhone(input.phone);
      if (!v) throw new EduPadronError(`Ese teléfono no sirve. ${EDU_PHONE_HELP}`);
      data.phone = v;
    }
  }
  if (input.email !== undefined) {
    if (input.email === null || input.email === "") data.email = null;
    else {
      const v = normalizeEduEmail(input.email);
      if (!v) throw new EduPadronError("Ese correo no parece un correo.");
      data.email = v;
    }
  }
  if (input.birthDate !== undefined) {
    if (input.birthDate === null || input.birthDate === "") data.birthDate = null;
    else {
      const v = parseEduCalendarDate(input.birthDate);
      if (!v) throw new EduPadronError("La fecha de nacimiento no es una fecha válida (AAAA-MM-DD).");
      if (v.getTime() > now.getTime()) {
        throw new EduPadronError("La fecha de nacimiento no puede estar en el futuro.");
      }
      data.birthDate = v;
    }
  }
  if (input.sex !== undefined) {
    const v = parseEduSex(input.sex);
    if (!v) throw new EduPadronError("Ese valor de sexo no existe.");
    data.sex = v;
  }
  if (input.notes !== undefined) {
    data.notes = eduOptionalText(input.notes, 1000) ?? null;
  }
  if (input.status !== undefined) {
    const v = parseEduPatientStatus(input.status);
    if (!v) throw new EduPadronError("Ese estado de paciente no existe.");
    // 🔴 H-28 · un estado a mano no puede contradecir los casos. Se cuenta
    // con la MISMA regla que la lista (`EDU_CASE_CLOSED_STATUSES`) y se
    // rechaza con la MISMA frase que la pantalla ya enseñó, para que quien
    // llegue aquí no lea dos explicaciones distintas del mismo no.
    const abiertos = current.cases.filter(
      (c) => !(EDU_CASE_CLOSED_STATUSES as string[]).includes(c.status),
    ).length;
    const choque = eduPatientStatusConflict(v, abiertos);
    if (choque) throw new EduPadronError(choque, 409);
    data.status = v;
  }

  // 🔴 update con `data` vacío no falla: escribe nada y devuelve "ok". El
  // endpoint parecería funcionar y no cambiaría absolutamente nada, que es
  // la clase de bug que se busca durante una tarde entera.
  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  // 🔴 El índice se REESCRIBE cuando cambia cualquiera de las cinco
  // columnas que lo alimentan, y con los valores nuevos MEZCLADOS sobre los
  // actuales. Si se reconstruyera solo con `data`, corregir el apellido
  // borraría del índice el folio y el teléfono, y el paciente dejaría de
  // encontrarse por ellos. Va DESPUÉS del check de "data vacío" para que un
  // PATCH sin cambios siga siendo un error y no una escritura fantasma.
  const tocaIndice = ["folio", "firstName", "lastName", "phone", "email"].some(
    (k) => k in data,
  );
  if (tocaIndice) {
    data.searchIndex = eduPatientSearchIndex({
      folio: data.folio ?? current.folio,
      firstName: data.firstName ?? current.firstName,
      lastName: data.lastName ?? current.lastName,
      phone: data.phone !== undefined ? data.phone : current.phone,
      email: data.email !== undefined ? data.email : current.email,
    });
  }

  await prisma.eduPatient.update({ where: { id: current.id }, data });
  return { id: current.id };
}

/**
 * Marca (o borra) CUÁL alumno trajo al paciente.
 *
 * Función aparte y permiso aparte ("pacientes.origen") a propósito: en la
 * Ola 5 este dato decide el precio, así que se guarda además QUIÉN lo puso
 * y CUÁNDO. Si un día no cuadra una cuenta, hay que poder preguntarlo.
 */
export async function setEduPatientOrigin(
  ctx: EduClinicaContext,
  patientId: string,
  input: { referredByStudentId?: unknown },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const current = await prisma.eduPatient.findFirst({
    where: { id, institutionId },
    select: { id: true, referredByStudentId: true },
  });
  if (!current) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const studentId = await resolveOriginStudent(institutionId, input.referredByStudentId);
  if (studentId === current.referredByStudentId) {
    throw new EduPadronError("El origen ya era ése. No hay nada que cambiar.");
  }

  await prisma.eduPatient.update({
    where: { id },
    data: {
      referredByStudentId: studentId,
      // Quién y cuándo se escriben JUNTOS, siempre. Al borrar el origen se
      // borran los tres: guardar "lo quitó fulano" sin origen sería un dato
      // sin dueño.
      originSetById: studentId ? ctx.eduUserId : null,
      originSetAt: studentId ? now : null,
    },
  });
  return { id };
}

/**
 * Guarda los ANTECEDENTES MÉDICOS del paciente (ola de Casos).
 *
 * Función aparte de `updateEduPatient` a propósito, como el origen: los
 * escriben personas distintas por permisos distintos. La ficha general es
 * de `pacientes.manage` (caja y dirección); los antecedentes los captura
 * TAMBIÉN quien hace la historia clínica —el alumno con el paciente en el
 * sillón y su docente— con `expediente.write`. El endpoint decide con cuál
 * de las dos llaves entró; aquí solo se comprueba la PERTENENCIA.
 *
 * 🔴 El paciente se busca DENTRO DEL ALCANCE de "patients" (a diferencia
 * de `updateEduPatient`, cuyo endpoint solo lo tiene caja/dirección, con
 * alcance completo): un alumno solo puede capturar los antecedentes de SUS
 * pacientes, y el de otro alumno se ve igual que uno que no existe.
 *
 * 🔴 ES UN REEMPLAZO DEL BLOQUE COMPLETO, y `historyRecordedAt` +
 * `historyRecordedById` se estampan JUNTOS en la misma escritura: guardar
 * significa "revisé los antecedentes hoy". Por eso también un guardado con
 * todo vacío ES un dato — "se le preguntó y no refiere" — y no un no-op:
 * es exactamente el estado que separa a este vertical del chip verde
 * mentiroso del dental.
 *
 * ⚠️ No toca `searchIndex`: los antecedentes no se buscan por texto y el
 * índice solo se alimenta de folio/nombre/teléfono/correo (Ola 1B).
 */
export async function updateEduPatientAntecedentes(
  ctx: EduClinicaContext,
  patientId: string,
  input: EduAntecedentesInput,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Ese paciente no es de este instituto.", 404);
  }
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const current = await prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true },
  });
  if (!current) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const parsed = parseEduAntecedentes(input);
  if (!parsed.ok) throw new EduPadronError(parsed.error);

  await prisma.eduPatient.update({
    where: { id: current.id },
    data: {
      ...parsed.data,
      historyRecordedAt: now,
      historyRecordedById: ctx.eduUserId,
    },
  });
  return { id: current.id };
}
