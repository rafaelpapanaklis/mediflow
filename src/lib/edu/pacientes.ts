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
  eduPatientFieldGroupOf,
  eduPatientStatusConflict,
  eduPatientTutorConflict,
  eduPatientCursorDecode,
  eduPatientCursorEncode,
  eduCurpIsValid,
  normalizeEduCurp,
  normalizeEduPhone,
  parseEduContactPreference,
  parseEduHabitLevel,
  parseEduPregnancy,
  EDU_CURP_HELP,
  EDU_PATIENT_FORM_FIELDS,
  EDU_PATIENT_PAGE_SIZE,
  EDU_PHONE_HELP,
  type EduPatientFieldGroup,
  type EduPatientFormField,
  type EduAntecedentesInput,
  type EduPatientFilters,
  type EduPatientOption,
  type EduPatientOptionsPage,
  type EduPatientRow,
  type EduPatientsPage,
} from "@/lib/edu/pacientes-core";
import { eduRequiredText, eduSearchInput, parseEduCalendarDate } from "@/lib/edu/padron-core";
import {
  eduPatientScopeWhere,
  eduVisibility,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { EDU_CASE_CLOSED_STATUSES, type EduPatientStatus } from "@/lib/edu/types";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * OLA C·2 · LA SESIÓN QUE NECESITAN LAS ESCRITURAS DE LA FICHA.
 *
 * Es `EduClinicaContext` (el tenant y el alcance) MÁS lo que la BITÁCORA
 * necesita para congelar el nombre de quien escribió. Las LECTURAS siguen
 * pidiendo solo `EduClinicaContext`: una lista de pacientes no escribe
 * renglones y exigirle el actor completo obligaría a tocar diez llamadas
 * que no lo necesitan.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduPacienteEscrituraContext extends EduClinicaContext, EduAuditActor {}

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

  // ── OLA B · los 22 campos que la ficha ya captura (ws2-t3) ───────────
  //
  // Viajan en la fila COMPLETA y no en una consulta aparte de la pestaña
  // Datos, por lo mismo que los antecedentes: el modal de la lista y la
  // pestaña montan el MISMO formulario, y una fila que a veces trae el
  // tutor y a veces no es una fila que un día guarda un tutor vacío
  // encima del que había.
  curp: true,
  phone2: true,
  contactPreference: true,
  addressStreet: true,
  addressNeighborhood: true,
  addressCity: true,
  addressState: true,
  addressZip: true,
  guardianName: true,
  guardianRelation: true,
  guardianPhone: true,
  insuranceProvider: true,
  insurancePolicy: true,
  familyHistory: true,
  personalNonPathologicalHistory: true,
  habitsTobacco: true,
  habitsAlcohol: true,
  habitsBruxism: true,
  habitsNotes: true,
  pregnancy: true,
  isChild: true,
  privacyNoticeAcceptedAt: true,

  // ── OLA C·2 · ARCO y FUSIÓN ──────────────────────────────────────────
  // Viajan en la fila COMPLETA por la misma razón que los antecedentes:
  // la ficha del perdedor de una fusión tiene que poder redirigir al
  // ganador, y una fila que a veces trae el puntero y a veces no es una
  // que un día deja a alguien escribiendo en el expediente equivocado.
  deletedAt: true,
  deleteReason: true,
  anonymizedAt: true,
  mergedIntoId: true,
  mergedAt: true,
  mergedInto: { select: { folio: true } },
  // H-12b · quién tocó la ficha por última vez. `updatedAt` existía desde
  // el primer día y no se pintaba en ninguna pantalla.
  updatedAt: true,
  updatedBy: { select: { firstName: true, lastName: true, email: true } },
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

    // ── Ola B ──────────────────────────────────────────────────────────
    // Se copian TAL CUAL, sin "arreglar" un null a "" ni un enum a texto:
    // `null` es un dato (nadie preguntó) y la pantalla lo pinta como «sin
    // registrar». Convertirlo aquí perdería justo esa distinción.
    curp: p.curp,
    phone2: p.phone2,
    contactPreference: p.contactPreference,
    addressStreet: p.addressStreet,
    addressNeighborhood: p.addressNeighborhood,
    addressCity: p.addressCity,
    addressState: p.addressState,
    addressZip: p.addressZip,
    guardianName: p.guardianName,
    guardianRelation: p.guardianRelation,
    guardianPhone: p.guardianPhone,
    insuranceProvider: p.insuranceProvider,
    insurancePolicy: p.insurancePolicy,
    familyHistory: p.familyHistory,
    personalNonPathologicalHistory: p.personalNonPathologicalHistory,
    habitsTobacco: p.habitsTobacco,
    habitsAlcohol: p.habitsAlcohol,
    habitsBruxism: p.habitsBruxism,
    habitsNotes: p.habitsNotes,
    pregnancy: p.pregnancy,
    isChild: p.isChild,
    privacyNoticeAcceptedAt: iso(p.privacyNoticeAcceptedAt),
    updatedAt: p.updatedAt.toISOString(),
    updatedByName: p.updatedBy ? personName(p.updatedBy) : null,

    deletedAt: iso(p.deletedAt),
    deleteReason: p.deleteReason,
    anonymizedAt: iso(p.anonymizedAt),
    mergedIntoId: p.mergedIntoId,
    mergedIntoFolio: p.mergedInto?.folio ?? null,
    mergedAt: iso(p.mergedAt),
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

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 OLA C·2 · LAS FICHAS DADAS DE BAJA NO SALEN. NI EN LA LISTA, NI EN
  // EL BUSCADOR, NI EN EL CSV.
  //
  // Es la mitad visible del derecho ARCO: `bajaEduPatient` y
  // `anonymizeEduPatient` ponen `deletedAt`, y sin este renglón la ficha
  // seguiría saliendo al teclear el apellido de alguien que pidió
  // justamente que dejara de salir. La fusión también lo pone en el
  // perdedor, así que el duplicado desaparece de la lista con el mismo
  // filtro.
  //
  // ⚠️ VA AQUÍ Y NO EN `eduPatientScopeWhere`: ese helper lo comparten
  // agenda, expediente, caja y odontograma, y el expediente de una ficha
  // dada de baja SIGUE existiendo — la NOM-004 obliga a conservarlo cinco
  // años. Lo que sale de las listas es la FICHA, no su historia.
  //
  // ⚠️ Y `getEduPatient` NO lo lleva, a propósito: dirección tiene que
  // poder abrir una ficha dada de baja para reactivarla, y el perdedor de
  // una fusión tiene que poder abrirse para redirigir al ganador. Un
  // 404 ahí dejaría la baja sin marcha atrás.
  // ═══════════════════════════════════════════════════════════════════
  where.deletedAt = null;

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

/**
 * ═══════════════════════════════════════════════════════════════════════
 * H-06 · LA LISTA, PAGINADA POR CURSOR.
 *
 * 🔴 QUÉ ARREGLA. Una escuela con 2 000 pacientes veía los 300 más
 * recientes y leía «se muestran los primeros 300». No había siguiente, ni
 * cursor, ni orden por columna: los otros 1 700 solo existían si sabías su
 * nombre o su folio. Y los filtros no ayudaban — filtrar por «Dado de alta»
 * seguía devolviendo, como mucho, 300 de los más recientes.
 *
 * 🔴 POR CURSOR Y NO POR `skip`/`OFFSET`, y no es preferencia. La lista se
 * ordena por `createdAt desc` y a la clínica le dan de alta pacientes
 * MIENTRAS recepción la recorre: con `skip: 50`, un alta entre la página 1
 * y la 2 empuja una fila hacia abajo y esa fila sale DOS veces (o, al
 * revés, una se salta y nadie se entera). El cursor apunta a una fila
 * concreta, así que lo que ya pasó no vuelve.
 *
 * 🔴 Y EL ORDEN LLEVA DESEMPATE POR `id`. `createdAt` no es único: dos
 * altas del mismo milisegundo —una importación, dos recepcionistas— se
 * ordenarían de forma arbitraria entre dos consultas y el cursor saltaría
 * una fila. El `orderBy` y la condición del cursor son la MISMA pareja
 * (createdAt, id), en el mismo orden: si se separaran, el paginador
 * volvería a saltarse filas exactamente en el caso que esto viene a cerrar.
 *
 * ⚠️ El cursor NO es una credencial y no abre nada: el `where` del alcance
 * se aplica igual, así que un cursor copiado de otra sesión sigue
 * devolviendo solo lo que le toca a quien pregunta.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function listEduPatients(
  ctx: EduClinicaContext,
  filters: EduPatientFilters,
  now: Date = new Date(),
  options: { cursor?: unknown; take?: number } = {},
): Promise<EduPatientsPage> {
  const scope = eduVisibility(ctx, "patients");
  // Sin alcance no se consulta nada. La pantalla explica por qué.
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false, nextCursor: null };

  // El tope de la petición se acota a los dos lados: nadie puede pedir la
  // tabla entera por la query string, y un `take` de 0 o negativo (o
  // basura) cae en el tamaño de página normal.
  const pedido = Number(options.take);
  const take = Number.isFinite(pedido) && pedido > 0
    ? Math.min(Math.floor(pedido), EDU_CLINICA_MAX_ROWS)
    : EDU_PATIENT_PAGE_SIZE;

  const where = patientsWhere(ctx, filters, now);
  const cursor = eduPatientCursorDecode(options.cursor);
  if (cursor) {
    // "Estrictamente después de esta fila", en el mismo orden del
    // `orderBy`. Se añade al AND que `patientsWhere` ya armó para no pisar
    // el OR con el que se expresa el alcance del alumno y del docente.
    const despues: Prisma.EduPatientWhereInput = {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
    where.AND = Array.isArray(where.AND)
      ? [...where.AND, despues]
      : where.AND
        ? [where.AND, despues]
        : [despues];
  }

  // Se pide UNA de más: es cómo se sabe que hay página siguiente sin
  // gastar un `count()` sobre una tabla que puede tener decenas de miles
  // de filas por instituto.
  const rows = await prisma.eduPatient.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: PATIENT_SELECT,
  });

  const hayMas = rows.length > take;
  const pagina = rows.slice(0, take).map((p) => toRow(p, now));
  return {
    truncated: hayMas,
    rows: pagina,
    nextCursor:
      hayMas && pagina.length > 0
        ? eduPatientCursorEncode(pagina[pagina.length - 1])
        : null,
  };
}

/**
 * TODAS las filas que cumplen los filtros, para EXPORTAR a CSV.
 *
 * 🔴 Existe aparte y con su propio techo, y no es duplicación: la lista
 * pagina de 50 en 50 porque una persona no lee más, y una exportación
 * tiene que traer lo que hay. El `where` es EXACTAMENTE el mismo —el mismo
 * alcance, los mismos filtros, el mismo buscador—, así que el CSV no puede
 * enseñar una fila que la lista esconde.
 *
 * 🔴 EL TECHO SIGUE EXISTIENDO (5 000) y se dice cuándo muerde. Sin él,
 * una escuela con 40 000 pacientes tumbaría la función serverless
 * construyendo el archivo en memoria. `truncated` viaja para que el
 * endpoint pueda decirlo en la respuesta en vez de entregar un archivo
 * incompleto que parece completo.
 */
export const EDU_PATIENT_CSV_MAX_ROWS = 5000;

export async function listEduPatientsForCsv(
  ctx: EduClinicaContext,
  filters: EduPatientFilters,
  now: Date = new Date(),
): Promise<{ rows: EduPatientRow[]; truncated: boolean }> {
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const rows = await prisma.eduPatient.findMany({
    where: patientsWhere(ctx, filters, now),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EDU_PATIENT_CSV_MAX_ROWS + 1,
    select: PATIENT_SELECT,
  });
  return {
    truncated: rows.length > EDU_PATIENT_CSV_MAX_ROWS,
    rows: rows.slice(0, EDU_PATIENT_CSV_MAX_ROWS).map((p) => toRow(p, now)),
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

/**
 * Pacientes para un <select> (agendar una cita). Mismo recorte.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-06 · AHORA BUSCA POR TEXTO EN EL SERVIDOR.
 *
 * Este desplegable traía los 300 primeros por folio y el resto no existía:
 * en una escuela con 2 000 pacientes, agendarle una cita al que se llama
 * "Zúñiga" era imposible desde la agenda — su folio caía fuera del corte y
 * el `<select>` no tiene buscador. Y de paso viajaban 300 nombres de
 * pacientes al navegador de cualquiera que abriera la agenda.
 *
 * Con `q`, el filtro se aplica en Postgres contra `searchIndex` (la misma
 * columna, el mismo `where` y los mismos tokens que el buscador de la
 * lista, `eduPatientSearchAnd`), y baja lo que se pidió y nada más. Sin
 * `q` se comporta como siempre: es lo que hace que las dos pantallas que
 * hoy la llaman sigan funcionando sin tocarlas.
 *
 * ⚠️ ESTO ES LA MITAD DEL ARREGLO, Y HAY QUE SABERLO. Lo que existe hoy es
 * la CAPACIDAD: la función busca en el servidor y el endpoint la expone
 * (`GET /api/instituto/pacientes?opciones=1&q=`). Las dos pantallas que
 * montan el desplegable —`/instituto/agenda` y `/instituto/agenda/tamizaje`
 * con `agenda-modales.tsx`— siguen llamando sin `q` y siguen bajando los
 * 300 primeros por folio, porque esos archivos son de otra casilla de esta
 * misma ola y tocarlos desde aquí es cómo dos ramas se pisan. Hasta que
 * alguien monte el buscador ahí, a "Zúñiga" se le sigue sin poder agendar
 * desde la agenda (desde su FICHA sí, que es donde esta casilla sí llega).
 *
 * ⚠️ El tope sigue existiendo y `truncated` sigue viajando: un desplegable
 * que baja 2 000 opciones no es un desplegable. Lo que cambia es que ahora
 * hay una forma de llegar a las que no cupieron.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-05 (la mitad que faltaba) · EL DESPLEGABLE NO OFRECE INACTIVOS.
 *
 * Un paciente duplicado NO se borra (es NOM-004) y NO se fusiona: no existe
 * ninguna función de fusión en el vertical. Lo único que se puede hacer con
 * él es marcarlo INACTIVE — y hasta ahora eso no servía de nada aquí: el
 * duplicado seguía saliendo en el desplegable de agendar, así que la cita
 * se le volvía a poner al folio muerto y el expediente se partía en dos
 * otra vez, que es exactamente lo que H-05 vino a cerrar.
 *
 * 🔴 SOLO «INACTIVE», Y «DISCHARGED» NO. No es una omisión: el catálogo de
 * estados dice qué significa cada uno y no significan lo mismo.
 *   · INACTIVE = «Dejó de venir». Es el estado que recepción le pone al
 *     duplicado, y agendarle una cita a alguien que dejó de venir es justo
 *     lo que hay que parar.
 *   · DISCHARGED = «Terminó sus tratamientos. Su historia no se borra». Un
 *     alta clínica es el FINAL NORMAL de un caso, y ese paciente vuelve —a
 *     un control, a una revisión, a un tratamiento nuevo—: es el pan de
 *     cada día de una clínica de escuela. Sacarlo del desplegable no
 *     cerraría ningún duplicado y rompería el flujo más común de esta
 *     pantalla.
 *
 * ⚠️ Y NO ES UN CALLEJÓN SIN SALIDA. Al paciente que vuelve después de
 * haberse marcado inactivo se le pone el estado de vuelta desde su ficha
 * (pestaña Datos, campo Estado, `pacientes.manage`) y vuelve a salir aquí.
 * Ese camino nunca choca: `eduPatientStatusConflict` solo bloquea el
 * contrario —poner DISCHARGED o INACTIVE con casos abiertos—.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function listEduPatientOptions(
  ctx: EduClinicaContext,
  now: Date = new Date(),
  options: { q?: unknown; take?: number } = {},
): Promise<EduPatientOptionsPage> {
  const institutionId = requireInstitution(ctx);
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return { rows: [], truncated: false };

  const q = eduSearchInput(typeof options.q === "string" ? options.q : null);
  const where: Prisma.EduPatientWhereInput = eduPatientScopeWhere({ institutionId, scope, now });

  // 🔴 H-05 · sin INACTIVE. El porqué —y por qué DISCHARGED sí sale— está
  // entero en la cabecera de la función.
  where.status = { not: "INACTIVE" };

  // 🔴 OLA C·2 · y sin las dadas de BAJA ni las FUSIONADAS. Agendarle una
  // cita a una ficha anonimizada por solicitud ARCO —o al duplicado que
  // acaba de fusionarse— es exactamente lo que las dos operaciones
  // vinieron a cerrar. `mergedIntoId` va aparte de `deletedAt` porque el
  // perdedor de una fusión que YA estaba dado de baja antes seguiría
  // teniendo las dos, y con una sola de las dos condiciones bastaría —
  // pero una fusión futura que decidiera no dar de baja al perdedor se
  // colaría por aquí sin que nadie lo notara.
  where.deletedAt = null;
  where.mergedIntoId = null;

  const and = eduPatientSearchAnd(q);
  if (and.length > 0) where.AND = and;

  const pedido = Number(options.take);
  const take = Number.isFinite(pedido) && pedido > 0
    ? Math.min(Math.floor(pedido), EDU_CLINICA_MAX_ROWS)
    : EDU_CLINICA_MAX_ROWS;

  const rows = await prisma.eduPatient.findMany({
    where,
    orderBy: [{ folio: "asc" }],
    take: take + 1,
    select: { id: true, folio: true, firstName: true, lastName: true, status: true },
  });
  return eduPatientOptionsPageOf(
    rows.map((p) => ({
      id: p.id,
      folio: p.folio,
      name: eduPatientFullName(p),
      status: p.status,
    })),
    take,
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

  // ── Ola B · lo que la ficha completa captura (ws2-t3) ────────────────
  // TODAS opcionales: `undefined` = "no vino en el body y no se toca";
  // `null` = "vacíalo". Es la regla de H-10 (campo ausente no se escribe)
  // y aquí importa el doble, porque en estas columnas `null` SIGNIFICA
  // "nadie preguntó" y escribirlo por accidente borra un dato bueno.
  curp?: unknown;
  phone2?: unknown;
  contactPreference?: unknown;
  addressStreet?: unknown;
  addressNeighborhood?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressZip?: unknown;
  guardianName?: unknown;
  guardianRelation?: unknown;
  guardianPhone?: unknown;
  insuranceProvider?: unknown;
  insurancePolicy?: unknown;
  familyHistory?: unknown;
  personalNonPathologicalHistory?: unknown;
  habitsTobacco?: unknown;
  habitsAlcohol?: unknown;
  habitsBruxism?: unknown;
  habitsNotes?: unknown;
  pregnancy?: unknown;
  isChild?: unknown;
  privacyNoticeAcceptedAt?: unknown;
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

/**
 * ── LOS TRES AYUDANTES DE LA OLA B ─────────────────────────────────
 *
 * Vivían dentro de `updateEduPatient` y subieron a módulo cuando el ALTA
 * pasó a guardar los mismos 22 campos (N-16): las reglas se escriben una
 * vez, y quien las use es cosa suya.
 *
 * 🔴 `vacio` DISTINGUE "no vino" DE "vacíalo", y es la mitad de la
 * distinción NULL / DESCONOCIDO / NINGUNO. `undefined` = la clave no
 * estaba en el body → la columna no se toca. `null` o `""` = la persona
 * borró el campo → se escribe null, que en estas columnas significa
 * "nadie preguntó". Sin esta separación, cualquier PATCH que no
 * mencionara el embarazo lo borraría.
 *
 * ⚠️ Un texto de SOLO ESPACIOS también es vaciar. Sin el `trim` caía en
 * `eduOptionalText`, que devuelve null tras recortarlo, y el campo salía
 * rebotado con «no es un texto válido» — un error donde la persona solo
 * estaba borrando. No se alcanza desde la pantalla (el diff ya recorta),
 * sí desde la API.
 */
const vacio = (v: unknown) =>
  v === null || v === "" || (typeof v === "string" && v.trim() === "");

/** Un texto opcional con su tope, o null si se vació. */
function texto(campo: EduPatientFormField, raw: unknown, max: number): string | null {
  if (vacio(raw)) return null;
  const v = eduOptionalText(raw, max);
  if (v === undefined || v === null) {
    throw new EduPadronError(`El campo «${campo}» no es un texto válido.`);
  }
  return v;
}

/**
 * Un valor de enum, o null si se vació.
 *
 * 🔴 REBOTA lo que no reconoce en vez de guardarlo como null. Un parser
 * que convirtiera la basura en null estaría escribiendo "nadie preguntó"
 * encima de un dato bueno cada vez que llegara un valor mal escrito — y
 * en `pregnancy` eso es borrar en silencio la única columna que permite
 * alertar antes de una radiografía.
 */
function enumo<T>(raw: unknown, parse: (v: unknown) => T | null, que: string): T | null {
  if (vacio(raw)) return null;
  const v = parse(raw);
  if (v === null) throw new EduPadronError(`Ese valor de ${que} no existe.`);
  return v;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS 22 CAMPOS DE LA OLA B, SANEADOS UNA SOLA VEZ (N-8 · N-16).
 *
 * 🔴 POR QUÉ EXISTE ESTA FUNCIÓN. `EduPatientInput` declara los 23 campos
 * de la Ola B y el ALTA los TIRABA EN SILENCIO: `createEduPatient` los
 * aceptaba en la firma y no escribía ni uno. Era una trampa para el
 * siguiente que montara un alta completa, y sobre todo era lo que hacía
 * IMPOSIBLE cerrar N-8: si el alta no sabe guardar `guardianName`, exigir
 * tutor a un menor en el alta sería un callejón sin salida.
 *
 * Así que el alta los GUARDA, y los guarda con ESTE parser —el mismo que
 * usa la corrección—, no con una segunda copia de las reglas. Dos parsers
 * para las mismas 22 columnas es cómo uno de los dos acaba aceptando el
 * CURP que el otro rechaza.
 *
 * ⚠️ NO decide permisos. El recorte por grupos (`options.groups`) lo aplica
 * `updateEduPatient` ANTES de llamar aquí; el alta pide `pacientes.manage`,
 * que abre los tres grupos. Esta función solo sanea.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduPatientOlaBData {
  curp?: string | null;
  phone2?: string | null;
  contactPreference?: ReturnType<typeof parseEduContactPreference>;
  addressStreet?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  guardianName?: string | null;
  guardianRelation?: string | null;
  guardianPhone?: string | null;
  insuranceProvider?: string | null;
  insurancePolicy?: string | null;
  familyHistory?: string | null;
  personalNonPathologicalHistory?: string | null;
  habitsTobacco?: ReturnType<typeof parseEduHabitLevel>;
  habitsAlcohol?: ReturnType<typeof parseEduHabitLevel>;
  habitsBruxism?: ReturnType<typeof parseEduHabitLevel>;
  habitsNotes?: string | null;
  pregnancy?: ReturnType<typeof parseEduPregnancy>;
  isChild?: boolean;
  privacyNoticeAcceptedAt?: Date | null;
}

export function parseEduPatientOlaB(
  input: EduPatientInput,
  now: Date = new Date(),
): EduPatientOlaBData {
  const data: EduPatientOlaBData = {};

  // ── Identidad · CURP (NOM-024) ────────────────────────────────────
  //
  // 🔴 SE VALIDA EL FORMATO Y SE REBOTA, en vez de guardarlo como venga.
  // La columna no tiene CHECK a propósito (un CURP malo no puede impedir
  // registrar a alguien que está en el sillón), pero eso es una decisión
  // sobre el ALTA, no sobre la corrección: aquí hay una persona
  // capturándolo del acta y el dedazo se caza en el momento.
  if (input.curp !== undefined) {
    if (vacio(input.curp)) data.curp = null;
    else {
      const v = normalizeEduCurp(input.curp);
      if (!v || !eduCurpIsValid(v)) {
        throw new EduPadronError(`Ese CURP no tiene la forma oficial. ${EDU_CURP_HELP}`);
      }
      data.curp = v;
    }
  }

  // ── Contacto · el SEGUNDO teléfono ────────────────────────────────
  //
  // 🔴 CON LA REGLA ESTRECHA, la misma que `phone` (H-09): son diez
  // dígitos o nada. Es un teléfono DEL PACIENTE, y en cuanto exista un
  // recordatorio que lo use tiene que poder entregarse — aceptar aquí lo
  // que el envío rechaza es exactamente el agujero que H-09 cerró.
  if (input.phone2 !== undefined) {
    if (vacio(input.phone2)) data.phone2 = null;
    else {
      const v = normalizeEduWaPhone(input.phone2);
      if (!v) throw new EduPadronError(`Ese segundo teléfono no sirve. ${EDU_PHONE_HELP}`);
      data.phone2 = v;
    }
  }

  if (input.contactPreference !== undefined) {
    data.contactPreference = enumo(
      input.contactPreference,
      parseEduContactPreference,
      "preferencia de contacto",
    );
  }

  // ── Domicilio ──────────────────────────────────────────────────────
  if (input.addressStreet !== undefined) {
    data.addressStreet = texto("addressStreet", input.addressStreet, 200);
  }
  if (input.addressNeighborhood !== undefined) {
    data.addressNeighborhood = texto("addressNeighborhood", input.addressNeighborhood, 120);
  }
  if (input.addressCity !== undefined) {
    data.addressCity = texto("addressCity", input.addressCity, 120);
  }
  if (input.addressState !== undefined) {
    data.addressState = texto("addressState", input.addressState, 120);
  }
  if (input.addressZip !== undefined) {
    if (vacio(input.addressZip)) data.addressZip = null;
    else {
      // Cinco dígitos: el CP mexicano. Se aprieta porque es el único campo
      // del domicilio con el que una escuela agrupa ("¿de dónde vienen
      // nuestros pacientes?"), y una columna de agrupar con "col. centro"
      // dentro no agrupa nada.
      const v = String(input.addressZip).trim();
      if (!/^\d{5}$/.test(v)) {
        throw new EduPadronError("El código postal son cinco dígitos.");
      }
      data.addressZip = v;
    }
  }

  // ── Tutor / representante legal (H-08) ─────────────────────────────
  if (input.guardianName !== undefined) {
    data.guardianName = texto("guardianName", input.guardianName, 160);
  }
  if (input.guardianRelation !== undefined) {
    data.guardianRelation = texto("guardianRelation", input.guardianRelation, 60);
  }
  if (input.guardianPhone !== undefined) {
    if (vacio(input.guardianPhone)) data.guardianPhone = null;
    else {
      // 🔴 REGLA ANCHA, y es deliberado. Al tutor se le LLAMA: un número de
      // casa, uno con extensión o uno de otro país siguen sirviendo para
      // eso. Es la misma decisión —y la misma razón escrita— que ya tomó
      // este archivo con el contacto de emergencia de los antecedentes;
      // apretarlo a diez dígitos habría bloqueado guardar al tutor, que es
      // justo el dato sin el que un menor no puede firmar nada.
      const v = normalizeEduPhone(input.guardianPhone);
      if (!v) throw new EduPadronError("Ese teléfono del tutor no tiene números.");
      data.guardianPhone = v;
    }
  }

  // ── Seguro o convenio ──────────────────────────────────────────────
  if (input.insuranceProvider !== undefined) {
    data.insuranceProvider = texto("insuranceProvider", input.insuranceProvider, 120);
  }
  if (input.insurancePolicy !== undefined) {
    data.insurancePolicy = texto("insurancePolicy", input.insurancePolicy, 60);
  }

  // ── NOM-004 · los dos antecedentes que faltaban ────────────────────
  if (input.familyHistory !== undefined) {
    data.familyHistory = texto("familyHistory", input.familyHistory, 2000);
  }
  if (input.personalNonPathologicalHistory !== undefined) {
    data.personalNonPathologicalHistory = texto(
      "personalNonPathologicalHistory",
      input.personalNonPathologicalHistory,
      2000,
    );
  }

  // ── Hábitos ────────────────────────────────────────────────────────
  if (input.habitsTobacco !== undefined) {
    data.habitsTobacco = enumo(input.habitsTobacco, parseEduHabitLevel, "hábito de tabaco");
  }
  if (input.habitsAlcohol !== undefined) {
    data.habitsAlcohol = enumo(input.habitsAlcohol, parseEduHabitLevel, "hábito de alcohol");
  }
  if (input.habitsBruxism !== undefined) {
    data.habitsBruxism = enumo(input.habitsBruxism, parseEduHabitLevel, "bruxismo");
  }
  if (input.habitsNotes !== undefined) {
    data.habitsNotes = texto("habitsNotes", input.habitsNotes, 500);
  }

  // ── Embarazo / lactancia ───────────────────────────────────────────
  if (input.pregnancy !== undefined) {
    data.pregnancy = enumo(input.pregnancy, parseEduPregnancy, "embarazo o lactancia");
  }

  // ── Dentición temporal ─────────────────────────────────────────────
  //
  // Columna NOT NULL con default false: no tiene "sin registrar", tiene un
  // false. Se acepta el booleano y la cadena, porque el formulario manda
  // "true"/"false" (todos sus valores son cadenas) y un cliente que use la
  // API manda un booleano de verdad.
  if (input.isChild !== undefined) {
    const v = input.isChild;
    if (v === true || v === "true") data.isChild = true;
    else if (v === false || v === "false") data.isChild = false;
    else throw new EduPadronError("La dentición temporal se marca o se desmarca, nada más.");
  }

  // ── Aviso de privacidad (LFPDPPP) ──────────────────────────────────
  //
  // Fecha y no booleano porque lo que hay que poder contestar es
  // "¿cuándo?", y un `true` sin fecha no es constancia de nada.
  if (input.privacyNoticeAcceptedAt !== undefined) {
    if (vacio(input.privacyNoticeAcceptedAt)) data.privacyNoticeAcceptedAt = null;
    else {
      const v = parseEduCalendarDate(input.privacyNoticeAcceptedAt);
      if (!v) {
        throw new EduPadronError("La fecha del aviso de privacidad no es una fecha (AAAA-MM-DD).");
      }
      if (v.getTime() > now.getTime()) {
        throw new EduPadronError("El aviso de privacidad no se puede aceptar en el futuro.");
      }
      data.privacyNoticeAcceptedAt = v;
    }
  }

  return data;
}

export async function createEduPatient(
  ctx: EduPacienteEscrituraContext,
  input: EduPatientInput,
  options: { canSetOrigin: boolean; allowDuplicate?: boolean } = { canSetOrigin: false },
  now: Date = new Date(),
): Promise<{ id: string; folio: string; aviso: string | null }> {
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

  // 🔴 N-16 · LOS 22 CAMPOS DE LA OLA B SE GUARDAN, no se tiran. La firma
  // los declaraba y el alta no escribía ni uno: una trampa para el
  // siguiente que montara un alta completa. Con el MISMO parser que la
  // corrección (`parseEduPatientOlaB`), así que el CURP, el CP y los
  // teléfonos se validan igual desde los dos lados.
  //
  // ⚠️ Y esto es lo que hace posible N-8: sin poder guardar `guardianName`
  // en el alta, exigir tutor a un menor sería un callejón sin salida.
  const olaB = parseEduPatientOlaB(input, now);

  // 🔴 N-16 · `texto()` Y NO `eduOptionalText(...) ?? null`. Los otros
  // catorce textos de la ficha REBOTAN lo que no es texto; `notes` lo
  // convertía en null, así que un `{notes: 123}` BORRABA las notas de
  // recepción sin un solo error. Es la misma función y el mismo mensaje que
  // el resto, en el alta y en la corrección.
  const notes = texto("notes", input.notes, 1000);

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

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 N-8 · UN MENOR TAMBIÉN NACE CON TUTOR. La regla de H-08 vivía SOLO
  // en la corrección: el alta ponía la fecha de nacimiento por primera vez
  // —que es literalmente lo que la regla dice que hay que bloquear— y no
  // comprobaba nada. Recepción registraba a un niño de ocho años, salía un
  // 201 limpio, y la ficha se quedaba sin tutor para siempre: corregirle
  // después el teléfono ya no dispara la regla, por diseño. El 100 % de los
  // menores dados de alta nacían en el estado que H-08 vino a cerrar.
  //
  // 🔴 LA MISMA FUNCIÓN, el mismo 409 y el mismo mensaje que el update
  // (`eduPatientTutorConflict`, pacientes-core). No una segunda redacción.
  //
  // ⚠️ SIN FECHA DE NACIMIENTO NO SE BLOQUEA NADA, igual que en la
  // corrección y que en el servidor de los consentimientos: no se puede
  // afirmar que alguien sea menor, y trancar el alta de todo paciente sin
  // nacimiento —un dato que sigue siendo opcional— pararía la recepción. Lo
  // que sale entonces es el AVISO de abajo, que no impide registrar.
  // ═══════════════════════════════════════════════════════════════════
  const choqueTutor = eduPatientTutorConflict({
    ageYears: eduAgeYears(birthDate, now),
    guardianName: olaB.guardianName ?? null,
  });
  if (choqueTutor) throw new EduPadronError(choqueTutor, 409);

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
    // Los 22 de la Ola B, ya saneados. Van al final: un campo que no vino
    // en el body no está en el objeto, así que no pisa ningún default de
    // la tabla.
    ...olaB,
  };

  /** El índice sin acentos, con el folio que finalmente se le ponga. Se
   *  calcula aquí y no fuera porque el folio automático se resuelve más
   *  abajo (y puede cambiar entre reintentos). */
  const conIndice = (folio: string) => ({
    ...data,
    folio,
    // 🔴 EL CURP Y EL SEGUNDO TELÉFONO ENTRAN AL ÍNDICE DESDE EL ALTA.
    // Antes se pasaban como `null` con la nota de que el alta no los
    // capturaba; desde N-16 sí los guarda, y un paciente registrado con
    // CURP tiene que poder encontrarse por él sin esperar a que alguien le
    // corrija la ficha.
    searchIndex: eduPatientSearchIndex({
      folio,
      curp: olaB.curp ?? null,
      firstName,
      lastName,
      phone,
      phone2: olaB.phone2 ?? null,
      email,
    }),
  });

  /**
   * EL AVISO QUE VIAJA CON EL 201 (N-8, la mitad que no bloquea).
   *
   * Sin fecha de nacimiento no se puede afirmar que sea menor, así que no
   * se bloquea — pero tampoco se calla: quien registra tiene que saber que
   * la ficha se quedó sin la única pareja de datos con la que un
   * consentimiento se puede firmar. Es el mismo patrón —cuerpo con campo,
   * no error— que el aviso de duplicado.
   */
  const aviso =
    birthDate === null && !(olaB.guardianName ?? null)
      ? "Se registró sin fecha de nacimiento. Si es menor de edad, su ficha tiene que decir quién es su tutor antes de poder emitirle una carta de consentimiento."
      : null;

  // 🔴 EL RENGLÓN DE LA BITÁCORA NO GUARDA LA FICHA ENTERA. Solo folio,
  // nombre y estado: `edu_audit_logs` se lee desde una pantalla de
  // dirección, y copiar ahí el teléfono, el correo, el CURP y el domicilio
  // sería mover el PII a una tabla de la que la anonimización ARCO no lo
  // puede sacar. Es la misma regla que ya aplica `anonymizeEduPatient`.
  const alta = (created: { id: string; folio: string }) =>
    eduAudit(ctx, {
      action: "create",
      entity: "patient",
      entityId: created.id,
      patientId: created.id,
      after: { folio: created.folio, nombre: `${firstName} ${lastName}`.trim() },
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
    await alta(created);
    return { ...created, aviso };
  }

  // Folio automático. Tres intentos: si dos recepcionistas dan de alta en
  // el mismo segundo, el índice único rebota a la segunda y se recalcula.
  // Sin el reintento, el alta fallaría con un error que no explica nada.
  for (let intento = 0; intento < 3; intento++) {
    const folio = await nextEduFolio(institutionId);
    try {
      const created = await prisma.eduPatient.create({
        data: conIndice(folio),
        select: { id: true, folio: true },
      });
      await alta(created);
      return { ...created, aviso };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002" || intento === 2) throw err;
    }
  }
  throw new EduPadronError("No se pudo asignar un folio. Captúralo a mano y vuelve a intentar.", 409);
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ PARTE DE LA FICHA PUEDE TOCAR QUIEN MANDA EL PATCH (H-02, Ola B).
 *
 * Ya no son dos estados ("all" / "contacto") sino los GRUPOS que quien
 * manda tiene abiertos, y el cambio es lo que hace posible la ficha de 31
 * campos: con dos estados, "todo lo que no es contacto" era una sola cosa
 * y no había forma de decir que un alumno escribe el embarazo pero no el
 * domicilio.
 *
 *   · "identidad" → `pacientes.manage` (caja, dirección): quién es el
 *     paciente y su papeleo — folio, nombre, apellidos, sexo, nacimiento,
 *     CURP, domicilio, TUTOR, seguro, estado, notas y aviso de privacidad.
 *   · "contacto"  → `pacientes.manage` o `expediente.write`: los dos
 *     teléfonos, el correo y la preferencia de contacto.
 *   · "clinico"   → `pacientes.manage` o `expediente.write`, igual que los
 *     ANTECEDENTES: NOM-004, hábitos, embarazo/lactancia y dentición.
 *
 * El reparto vive en UN sitio (`EDU_PATIENT_FIELD_GROUP`, pacientes-core) y
 * lo resuelven las abilities (`eduPatientEditGroups`, permissions.ts).
 *
 * 🔴 El recorte se aplica AQUÍ y no solo en el endpoint. Que el body traiga
 * `folio` no basta para que se escriba: un campo que quien manda no puede
 * tocar es un ERROR con su motivo, no un campo que se ignora en silencio —
 * ignorarlo dejaría a un alumno creyendo que corrigió el apellido.
 * ═══════════════════════════════════════════════════════════════════════
 */
export type EduPatientEditFields = EduPatientFieldGroup;

/** El motivo escrito de un campo que no le toca a quien manda. Lo arma el
 *  servidor porque es él quien sabe cuál llegó de más. */
function motivoGrupoCerrado(grupo: EduPatientFieldGroup): string {
  if (grupo === "identidad") {
    return "Con tu permiso solo puedes corregir el contacto y los antecedentes clínicos del paciente. La identidad (folio, nombre, apellidos, sexo, nacimiento, CURP), el domicilio, el tutor, el seguro, el estado, las notas de recepción y el aviso de privacidad los captura recepción.";
  }
  if (grupo === "contacto") {
    return "Con tu permiso no puedes corregir el contacto del paciente (teléfonos, correo y preferencia). Lo hace recepción, o quien tenga al paciente en el sillón.";
  }
  return "Con tu permiso no puedes escribir los antecedentes clínicos del paciente (NOM-004, hábitos, embarazo y dentición). Eso lo captura quien hace la historia clínica.";
}

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
  ctx: EduPacienteEscrituraContext,
  patientId: string,
  input: EduPatientInput,
  // 🔴 `options` es OBLIGATORIO y `groups` dentro de él también. Con un
  // default esta firma fallaría ABIERTO: un llamador que pasara el `now` en
  // la posición vieja —era el cuarto parámetro hasta la ola de la edición—
  // caería en `options`, `groups` saldría undefined y el alumno editaría
  // los 31 campos. Que el compilador lo exija es lo que hace que ese error
  // no se pueda escribir.
  options: { groups: readonly EduPatientEditFields[] },
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
  //
  // Se miran los 31 campos de la ficha y no `Object.keys(input)`: lo que
  // esta función no lee ya se ignoraba en silencio para todo el mundo antes
  // de la Ola B (`referredByStudentId`, por ejemplo, que tiene su propio
  // endpoint), y rechazarlo dejaría el formulario roto el día que alguien
  // añada una clave suelta al body. Lo que se cierra es la escalada, que
  // solo puede venir por estos 31.
  //
  // ⚠️ `options.groups` es OBLIGATORIO y sin default, por lo mismo que lo
  // era `fields`: con un default esta firma fallaría ABIERTO — un llamador
  // que olvidara pasarlo abriría los 31 campos a cualquiera. Que el
  // compilador lo exija es lo que hace que ese error no se pueda escribir.
  const grupos = options.groups;
  const prohibido = EDU_PATIENT_FORM_FIELDS.filter((k) => input[k] !== undefined)
    .map((k) => eduPatientFieldGroupOf(k))
    .filter((g): g is EduPatientFieldGroup => g !== null && !grupos.includes(g))[0];
  if (prohibido) throw new EduPadronError(motivoGrupoCerrado(prohibido), 403);

  // Se traen las SIETE columnas que alimentan el índice de búsqueda, no
  // solo el id: al editar solo el apellido hay que reescribir el índice
  // ENTERO, y para eso hacen falta las otras seis tal como están hoy. Y los
  // casos, para poder revalidar el estado (H-28) sin una segunda vuelta a
  // la base; y el nacimiento y el tutor, para la regla del menor (H-08).
  const current = await prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: {
      id: true,
      folio: true,
      curp: true,
      firstName: true,
      lastName: true,
      phone: true,
      phone2: true,
      email: true,
      birthDate: true,
      guardianName: true,
      // Ola C·2 · el ESTADO se lee para el renglón de la bitácora. Sin él,
      // guardar la ficha con el mismo estado que ya tenía escribiría un
      // diff «— → ACTIVE» que no cambió nada, y una bitácora llena de
      // renglones que mienten deja de leerse.
      status: true,
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
    updatedById?: string | null;

    // ── Ola B ──────────────────────────────────────────────────────────
    curp?: string | null;
    phone2?: string | null;
    contactPreference?: ReturnType<typeof parseEduContactPreference>;
    addressStreet?: string | null;
    addressNeighborhood?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    addressZip?: string | null;
    guardianName?: string | null;
    guardianRelation?: string | null;
    guardianPhone?: string | null;
    insuranceProvider?: string | null;
    insurancePolicy?: string | null;
    familyHistory?: string | null;
    personalNonPathologicalHistory?: string | null;
    habitsTobacco?: ReturnType<typeof parseEduHabitLevel>;
    habitsAlcohol?: ReturnType<typeof parseEduHabitLevel>;
    habitsBruxism?: ReturnType<typeof parseEduHabitLevel>;
    habitsNotes?: string | null;
    pregnancy?: ReturnType<typeof parseEduPregnancy>;
    isChild?: boolean;
    privacyNoticeAcceptedAt?: Date | null;
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
    // 🔴 N-16 · `texto()` como los otros catorce. `eduOptionalText(...) ?? null`
    // convertía en null lo que no era texto, así que un `PATCH {notes: 123}`
    // BORRABA las notas de recepción y contestaba 200.
    data.notes = texto("notes", input.notes, 1000);
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

  // ═══════════════════════════════════════════════════════════════════
  // OLA B · LOS 22 CAMPOS DE LA FICHA COMPLETA
  //
  // Se sanean con `parseEduPatientOlaB`, LA MISMA función que usa el alta
  // (N-16): dos copias de estas reglas es cómo una de las dos acaba
  // aceptando el CURP que la otra rechaza.
  // ═══════════════════════════════════════════════════════════════════
  Object.assign(data, parseEduPatientOlaB(input, now));

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 H-08 · UN MENOR TIENE QUE TENER TUTOR — comprobado al GUARDAR.
  //
  // Se comprueba con la fecha y el tutor RESULTANTES (los del body si
  // vienen, los de la fila si no): poner un nacimiento de 2015 sobre una
  // ficha que figuraba adulta tiene que rebotar en ese mismo acto, no en
  // el siguiente.
  //
  // 🔴 Y SOLO CUANDO EL GUARDADO TOCA EL ASUNTO. En la base hay menores
  // registrados antes de que existiera la columna del tutor; si esto
  // bloqueara CUALQUIER guardado de un menor sin tutor, recepción no
  // podría corregirle un dedazo en el apellido —ni el alumno el teléfono—
  // hasta rellenar un dato que a lo mejor no tiene delante. Es la misma
  // regla, y por la misma razón, que la del estado contra los casos
  // (H-28): no se atrapa a nadie detrás de un dato que no está tocando.
  //
  // ⚠️ Sin fecha de nacimiento NO se bloquea nada: no se puede afirmar que
  // alguien sea menor. La pantalla lo advierte, igual que hace el servidor
  // de los consentimientos.
  // ═══════════════════════════════════════════════════════════════════
  const tocaNacimiento = data.birthDate !== undefined;
  const borraTutor = data.guardianName !== undefined && !data.guardianName;
  if (tocaNacimiento || borraTutor) {
    const nacimiento = tocaNacimiento ? data.birthDate : current.birthDate;
    const tutor = data.guardianName !== undefined ? data.guardianName : current.guardianName;
    const choque = eduPatientTutorConflict({
      ageYears: eduAgeYears(nacimiento ?? null, now),
      guardianName: tutor ?? null,
    });
    if (choque) throw new EduPadronError(choque, 409);
  }

  // 🔴 update con `data` vacío no falla: escribe nada y devuelve "ok". El
  // endpoint parecería funcionar y no cambiaría absolutamente nada, que es
  // la clase de bug que se busca durante una tarde entera.
  if (Object.keys(data).length === 0) throw new EduPadronError("No mandaste ningún cambio.");

  // 🔴 El índice se REESCRIBE cuando cambia cualquiera de las SIETE
  // columnas que lo alimentan —desde la Ola B, el CURP y el segundo
  // teléfono también—, y con los valores nuevos MEZCLADOS sobre los
  // actuales. Si se reconstruyera solo con `data`, corregir el apellido
  // borraría del índice el folio y el teléfono, y el paciente dejaría de
  // encontrarse por ellos. Va DESPUÉS del check de "data vacío" para que un
  // PATCH sin cambios siga siendo un error y no una escritura fantasma.
  //
  // ⚠️ SIN BACKFILL, y es deliberado (el encargo prohíbe SQL nuevo): un
  // paciente viejo empieza a encontrarse por su CURP y su segundo teléfono
  // la primera vez que alguien guarda su ficha — que es exactamente cuando
  // esos dos datos se capturan, porque hasta esta ola no había dónde
  // escribirlos.
  const tocaIndice = ["folio", "curp", "firstName", "lastName", "phone", "phone2", "email"].some(
    (k) => k in data,
  );
  if (tocaIndice) {
    data.searchIndex = eduPatientSearchIndex({
      folio: data.folio ?? current.folio,
      curp: data.curp !== undefined ? data.curp : current.curp,
      firstName: data.firstName ?? current.firstName,
      lastName: data.lastName ?? current.lastName,
      phone: data.phone !== undefined ? data.phone : current.phone,
      phone2: data.phone2 !== undefined ? data.phone2 : current.phone2,
      email: data.email !== undefined ? data.email : current.email,
    });
  }

  // 🔴 H-12b · QUIÉN CORRIGIÓ LA FICHA. `updatedAt` existía desde el primer
  // día (lo escribe Prisma con @updatedAt) y no se pintaba en ninguna
  // pantalla; y sin el nombre al lado tampoco servía de mucho. Se estampa
  // en la MISMA escritura, siempre, y no como un campo que el cliente
  // pueda mandar: un rastro de auditoría que el navegador puede elegir no
  // es un rastro.
  //
  // ⚠️ Se escribe también en `updateEduPatientAntecedentes` y en
  // `setEduPatientOrigin`, que son las otras dos escrituras de esta fila.
  // Si solo estuviera aquí, un guardado de antecedentes movería `updatedAt`
  // y dejaría `updatedById` apuntando al de la corrección anterior — y la
  // ficha diría "lo corrigió Fulano" con la fecha de lo que hizo Mengana.
  data.updatedById = ctx.eduUserId ?? null;

  await prisma.eduPatient.update({ where: { id: current.id }, data });

  // ── LA BITÁCORA (NOM-024) ────────────────────────────────────────────
  // 🔴 EL DIFF SE ARMA CON LO QUE DE VERDAD CAMBIÓ, y `eduAuditDiff` (en
  // auditoria-core) descarta los campos que llegaron iguales y no escribe
  // renglón si no cambió ninguno: un guardado que no cambió nada es un
  // botón que alguien pulsó dos veces.
  //
  // 🔴 Y NO ENTRA EL PII COMPLETO. Se comparan solo los siete campos que
  // el índice de búsqueda ya toca más el estado — no el domicilio, ni el
  // tutor, ni las notas. Copiar la ficha entera a cada renglón haría de la
  // bitácora un sitio del que la anonimización ARCO no puede sacar el dato
  // personal, y la haría ilegible de paso. `searchIndex` está en la lista
  // de campos ignorados del core, así que ni aparece.
  const mirados = ["folio", "firstName", "lastName", "phone", "email", "status", "curp"] as const;
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const k of mirados) {
    if (!(k in data)) continue;
    antes[k] = (current as Record<string, unknown>)[k] ?? null;
    despues[k] = (data as Record<string, unknown>)[k] ?? null;
  }
  // Los campos que sí cambiaron pero no se detallan: se cuentan, para que
  // el renglón no mienta diciendo que no pasó nada.
  const otros = Object.keys(data).filter(
    (k) => !(mirados as readonly string[]).includes(k) && k !== "searchIndex" && k !== "updatedById",
  );
  if (otros.length > 0) {
    antes.otrosCampos = "—";
    despues.otrosCampos = otros.join(", ").slice(0, 300);
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "patient",
    entityId: current.id,
    patientId: current.id,
    before: antes,
    after: despues,
  });

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
  ctx: EduPacienteEscrituraContext,
  patientId: string,
  input: { referredByStudentId?: unknown },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  // 🔴 N-10 · EL PACIENTE SE BUSCA DENTRO DEL ALCANCE, como sus dos
  // hermanas (`updateEduPatient` y `updateEduPatientAntecedentes`). Era la
  // única escritura de esta fila que se quedaba en `{ id, institutionId }`
  // a secas — el hueco que H-11 cerró en la de al lado y que aquí siguió
  // abierto (viene de `main`, no lo abrió la Ola B).
  //
  // Hoy no hay fuga: `pacientes.origen` solo lo llevan CAJA y DIRECCIÓN, y
  // su alcance es completo. El día que una escuela le encienda esa key a un
  // docente por `permissionsOverride` —que es editable— podría atribuirle a
  // su alumno un paciente que ni siquiera puede ver, y en la Ola 5 ese dato
  // decide la tarifa. Un candado que solo aguanta mientras nadie toque el
  // catálogo de permisos no es un candado.
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Ese paciente no es de este instituto.", 404);
  }
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const current = await prisma.eduPatient.findFirst({
    where: { ...eduPatientScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, referredByStudentId: true },
  });
  if (!current) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const studentId = await resolveOriginStudent(institutionId, input.referredByStudentId);
  if (studentId === current.referredByStudentId) {
    throw new EduPadronError("El origen ya era ése. No hay nada que cambiar.");
  }

  await prisma.eduPatient.update({
    where: { id: current.id },
    data: {
      referredByStudentId: studentId,
      // Quién y cuándo se escriben JUNTOS, siempre. Al borrar el origen se
      // borran los tres: guardar "lo quitó fulano" sin origen sería un dato
      // sin dueño.
      originSetById: studentId ? ctx.eduUserId : null,
      originSetAt: studentId ? now : null,
      // H-12b · esto TAMBIÉN es tocar la ficha. `updatedAt` se mueve solo
      // (Prisma, @updatedAt); sin esta línea quedaría con el nombre de
      // quien la corrigió la vez anterior, que es peor que no tener nombre.
      updatedById: ctx.eduUserId ?? null,
    },
  });

  // El ORIGEN decide la TARIFA del paciente, así que su cambio es de los
  // que hay que poder contestar dentro de un año. La fila ya guarda quién
  // y cuándo; el renglón de bitácora guarda además de QUÉ a QUÉ.
  await eduAudit(ctx, {
    action: "update",
    entity: "patient",
    entityId: current.id,
    patientId: current.id,
    before: { referredByStudentId: current.referredByStudentId },
    after: { referredByStudentId: studentId },
  });

  return { id: current.id };
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
  ctx: EduPacienteEscrituraContext,
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
      // H-12b · lo mismo que arriba: `updatedAt` se mueve con esta
      // escritura, así que el "quién" tiene que moverse con ella.
      updatedById: ctx.eduUserId ?? null,
    },
  });

  // 🔴 EL RENGLÓN DICE QUE SE REVISARON, NO QUÉ DECÍAN. Las alergias, los
  // padecimientos y la medicación de una persona son dato de salud: en la
  // bitácora —que abre dirección entera y de la que la anonimización ARCO
  // no puede sacar nada— se guarda el HECHO de la revisión y cuántos
  // campos trae, no su contenido. Quien necesite el contenido abre el
  // expediente, que es donde vive y donde la lectura también queda
  // registrada.
  await eduAudit(ctx, {
    action: "update",
    entity: "patient",
    entityId: current.id,
    patientId: current.id,
    before: { antecedentesRevisadosAt: "—" },
    after: { antecedentesRevisadosAt: now },
  });

  return { id: current.id };
}
