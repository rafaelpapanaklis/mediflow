/**
 * DaleControl INSTITUCIONAL — el cerebro del PADRÓN, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa o se toma en UN solo lugar visible).
 * Aquí viven las tres decisiones que, si se escriben dos veces, terminan
 * discrepando:
 *
 *   1. QUÉ FILAS puede ver quien está mirando  → eduPadronScope
 *   2. QUÉ ASIGNACIÓN está VIGENTE hoy         → eduAssignmentIsCurrent /
 *                                                eduCurrentAssignmentWhere
 *   3. CÓMO se arma el `where` del padrón      → eduStudentWhere
 *
 * Se probó todo esto sin tocar Postgres (src/lib/edu/__tests__/edu-padron.test.ts):
 * son funciones que reciben datos y devuelven datos.
 *
 * 🔴 institutionId: eduStudentWhere LANZA si le llega vacío. No es
 * paranoia — en Prisma un `where: { institutionId: undefined }` no devuelve
 * cero filas: BORRA el filtro y devuelve las de TODOS los institutos. Un
 * throw ruidoso es infinitamente mejor que una escuela leyendo el padrón de
 * otra en silencio.
 */
import type { Prisma } from "@prisma/client";
import type { EduRole, EduStudentStatus } from "@/lib/edu/types";
import { EDU_STUDENT_STATUSES } from "@/lib/edu/types";
import { eduNormalizeSearch } from "@/lib/edu/search";

/**
 * El buscador SIN ACENTOS del vertical (Ola 1B) vive en
 * src/lib/edu/search.ts —módulo puro, lo usan también las pantallas— y se
 * REEXPORTA desde aquí porque éste es el archivo que ya importaba medio
 * vertical. Dos normalizadores de búsqueda es como se acaba con uno que
 * quita la diéresis y otro que no.
 */
export {
  eduIndexMatches,
  eduNormalizeSearch,
  eduPatientSearchIndex,
  eduStudentSearchIndex,
  eduUserSearchIndex,
} from "@/lib/edu/search";

/**
 * La fecha de calendario se pinta en UTC. El formateador ya existe desde la
 * Ola 0 y se REUSA en vez de escribir otro: dos formateadores de fecha en
 * el mismo vertical es como se acaba pintando "30 de diciembre" en una
 * pantalla y "31 de diciembre" en la de al lado.
 */
export { formatEduContractDate as formatEduDate } from "@/lib/edu/contract";

/** Techo de filas por consulta. El padrón de una escuela son decenas, no
 *  miles; el tope está para que una consulta rota no se traiga la tabla. */
export const EDU_PADRON_MAX_ROWS = 300;

// ═══════════════════════════════════════════════════════════════════════
// 1 · ALCANCE — quién ve qué
// ═══════════════════════════════════════════════════════════════════════

/**
 * El permiso abre la PANTALLA; el alcance decide las FILAS. Son dos cosas
 * distintas y por eso están en dos archivos distintos:
 *
 *   · padron.view  → ¿puedo abrir /instituto/padron?      (permissions.ts)
 *   · scope        → ¿qué alumnos salen ahí adentro?      (este archivo)
 *
 * Un DOCENTE con padron.view abre la pantalla y ve SOLO a sus alumnos
 * asignados y VIGENTES. Quitarle el permiso lo deja fuera; dárselo NO le
 * abre el padrón entero.
 */
export type EduPadronScope =
  | { kind: "all" }
  | { kind: "supervised"; supervisorUserId: string }
  | { kind: "none" };

/**
 * Alcance por ROL, no por permiso.
 *
 *   DIRECCION → todos.
 *   DOCENTE   → solo los alumnos que supervisa HOY.
 *   ALUMNO    → ninguno. Un residente no lista a su generación.
 *   CAJA      → ninguno. Cobra, no inscribe.
 *
 * ⚠️ Un rol desconocido (un `as any` que se coló, un rol nuevo que alguien
 * agregó al enum y olvidó aquí) cae en "none", no en "all". La opción
 * segura es la que no filtra datos.
 *
 * ⚠️ Consecuencia conocida y aceptada: un DOCENTE al que la dirección le
 * dé "padron.manage" por override podrá dar de alta a un alumno que
 * después NO verá en su lista, porque no es su supervisor. Es lo que pide
 * el contrato de esta ola ("un DOCENTE ve SOLO sus alumnos"); si algún día
 * molesta, se resuelve dándole el rol DIRECCION, no ensanchando esto.
 */
export function eduPadronScope(ctx: { role: EduRole; eduUserId: string }): EduPadronScope {
  if (typeof ctx !== "object" || ctx === null) return { kind: "none" };
  if (ctx.role === "DIRECCION") return { kind: "all" };
  if (ctx.role === "DOCENTE") {
    // Sin id no hay a quién atribuirle alumnos: mejor cero filas que todas.
    if (!ctx.eduUserId) return { kind: "none" };
    return { kind: "supervised", supervisorUserId: ctx.eduUserId };
  }
  return { kind: "none" };
}

/** Texto que se le pinta a quien abrió la lista de alumnos y no le toca
 *  ninguna fila. */
export const EDU_SCOPE_NONE_DETAIL =
  "Tu rol no lista estudiantes. La lista la ven la dirección (todos) y los docentes (los suyos). Si necesitas verla, pídele a la dirección que revise tu rol.";

// ═══════════════════════════════════════════════════════════════════════
// 2 · VIGENCIA — el docente rota a media generación
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo de una asignación para saber si está vigente. */
export interface EduAssignmentPeriod {
  startsAt: Date | string;
  endsAt: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Vigente en el instante T ⇔ startsAt <= T && (endsAt == null || endsAt > T).
 *
 * Los dos extremos están elegidos, no heredados:
 *  · `startsAt <= T` — una asignación que empieza HOY cuenta hoy.
 *  · `endsAt > T`    — una que se cerró hace un segundo YA no cuenta. Cerrar
 *    es escribir endsAt = ahora, así que con `>=` el docente saliente
 *    seguiría contando durante el mismo instante en que entra el nuevo y
 *    los dos aparecerían como "vigente".
 *
 * Una fecha ilegible (un string basura que se coló) NO se da por vigente.
 */
export function eduAssignmentIsCurrent(
  assignment: EduAssignmentPeriod,
  now: Date = new Date(),
): boolean {
  if (typeof assignment !== "object" || assignment === null) return false;
  const starts = toDate(assignment.startsAt);
  if (!starts) return false;
  const t = now.getTime();
  if (starts.getTime() > t) return false;
  if (assignment.endsAt === null || assignment.endsAt === undefined) return true;
  const ends = toDate(assignment.endsAt);
  if (!ends) return false;
  return ends.getTime() > t;
}

/**
 * El MISMO predicado, en la forma que entiende Prisma. Lo usan el `include`
 * del padrón, el `_count` de docentes y el listado de supervisados: si cada
 * uno escribiera su propio filtro, tarde o temprano uno olvidaría el
 * `startsAt` y contaría asignaciones que todavía no empiezan.
 */
export function eduCurrentAssignmentWhere(now: Date = new Date()) {
  return {
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  } satisfies Prisma.EduSupervisorAssignmentWhereInput;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · FILTROS Y BUSCADOR
// ═══════════════════════════════════════════════════════════════════════

export interface EduPadronFilters {
  programId: string | null;
  cohortId: string | null;
  status: EduStudentStatus | null;
  q: string | null;
}

export const EDU_PADRON_EMPTY_FILTERS: EduPadronFilters = {
  programId: null,
  cohortId: null,
  status: null,
  q: null,
};

/** ¿Hay algún filtro puesto? (para pintar el botón de "limpiar"). */
export function eduHasFilters(f: EduPadronFilters): boolean {
  return Boolean(f.programId || f.cohortId || f.status || f.q);
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

/** Un id que viene de la URL: recortado y con techo, nunca confiado. */
function cleanId(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * Lee los filtros de la query string. Todo lo que no reconoce se descarta:
 * un `?estado=DROP TABLE` se convierte en "sin filtro de estado", no en un
 * error 500 ni en una consulta rara.
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión y de
 * ningún otro lado; si esta función lo aceptara, bastaría con teclear
 * `?institutionId=…` para leer el padrón de otra escuela.
 */
export function parseEduPadronFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduPadronFilters {
  const sp = searchParams ?? {};
  const status = firstParam(sp.estado);
  return {
    programId: cleanId(sp.programa),
    cohortId: cleanId(sp.generacion),
    status: parseEduStudentStatus(status),
    q: eduSearchInput(firstParam(sp.q)),
  };
}

/** El texto tal cual se le devuelve al cuadro de búsqueda (recortado). */
export function eduSearchInput(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().slice(0, 60);
  return v.length > 0 ? v : null;
}

/**
 * Palabras de búsqueda, saneadas para LIKE y NORMALIZADAS (minúsculas, sin
 * acentos).
 *
 * 🔴 Prisma NO escapa los comodines de `contains`: el texto se pega dentro
 * de un `LIKE '%…%'` tal cual, así que buscar "%" trae la tabla entera y un
 * término que termine en "\" hace que Postgres tire un error de patrón. Se
 * quitan `%`, `_` y `\` — ninguna matrícula ni nombre real los lleva.
 *
 * 🔴 Y SE QUITAN LOS ACENTOS, con el MISMO eduNormalizeSearch que escribe
 * la columna `searchIndex`. Ahí está toda la corrección de la Ola 1B: si
 * solo se normalizara un lado, buscar "Rodriguez" seguiría devolviendo cero
 * con "Rodríguez" en la ficha — que es exactamente lo que pasaba en
 * producción. Normalizados los dos lados, funciona en las dos direcciones y
 * de paso deja de hacer falta `mode: "insensitive"`.
 *
 * Se parte en palabras y se piden TODAS (AND): "juan pe" tiene que
 * encontrar a Juan Pérez. Máximo tres palabras: es un buscador, no un motor
 * de consultas.
 */
export function eduSearchTokens(raw: string | null | undefined): string[] {
  const clean = eduSearchInput(raw);
  if (!clean) return [];
  return eduNormalizeSearch(clean.replace(/[%_\\]/g, " "))
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 3);
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL `where` DEL PADRÓN — el punto donde se cierra el tenant
// ═══════════════════════════════════════════════════════════════════════

export interface EduStudentWhereInput {
  institutionId: string;
  scope: EduPadronScope;
  filters?: EduPadronFilters;
  now?: Date;
}

/**
 * Arma el `where` completo: tenant + alcance + filtros + buscador.
 *
 * Se devuelve un objeto y no se ejecuta nada, para poder comprobar en una
 * prueba —sin base de datos— que el institutionId SIEMPRE está y que el
 * docente nunca sale de sus alumnos vigentes.
 */
export function eduStudentWhere({
  institutionId,
  scope,
  filters = EDU_PADRON_EMPTY_FILTERS,
  now = new Date(),
}: EduStudentWhereInput): Prisma.EduStudentWhereInput {
  if (!institutionId || typeof institutionId !== "string") {
    throw new Error(
      "eduStudentWhere sin institutionId: un undefined BORRA el filtro de tenant y devuelve el padrón de TODOS los institutos",
    );
  }

  const where: Prisma.EduStudentWhereInput = { institutionId };

  if (scope?.kind === "none") {
    // Cinturón: la capa de datos ni siquiera consulta cuando el alcance es
    // "none", pero si alguna vez lo hace, esto no devuelve una sola fila.
    where.id = { in: [] };
    return where;
  }

  if (scope?.kind === "supervised") {
    where.supervisors = {
      some: {
        // El institutionId se repite dentro de la relación a propósito: la
        // asignación lleva el suyo y comprobarlo aquí cierra el tenant
        // aunque un día alguien inserte una fila cruzada a mano.
        institutionId,
        supervisorUserId: scope.supervisorUserId,
        ...eduCurrentAssignmentWhere(now),
      },
    };
  }

  if (filters.programId) where.programId = filters.programId;
  if (filters.cohortId) where.cohortId = filters.cohortId;
  if (filters.status) where.status = filters.status;

  // 🔴 EL BUSCADOR MIRA SOLO LAS COLUMNAS NORMALIZADAS. Nunca `matricula`
  // ni `firstName` directamente: son las que llevan el acento, y `contains`
  // compara el texto tal cual — por ahí es por donde "Rodriguez" no
  // encontraba a "Rodríguez". En `searchIndex` los dos lados están sin
  // acentos y en minúsculas, así que tampoco hace falta `mode:
  // "insensitive"`.
  //
  // Son DOS columnas y no una porque la matrícula es del ALUMNO y el nombre
  // es de la PERSONA: si el índice del alumno arrastrara el nombre de su
  // EduUser, renombrar a alguien dejaría la matrícula pegada a un nombre
  // viejo sin que nadie se enterara hasta que lo buscaran.
  const tokens = eduSearchTokens(filters.q);
  if (tokens.length > 0) {
    where.AND = tokens.map((token) => ({
      OR: [
        { searchIndex: { contains: token } },
        { user: { searchIndex: { contains: token } } },
      ],
    }));
  }

  return where;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · SANEO DE LO QUE SE ESCRIBE
//     Todo lo que entra por un endpoint pasa por aquí. Devuelven `null`
//     cuando el valor no sirve, y el endpoint contesta 400 — nunca guardan
//     un valor "arreglado" a la brava.
// ═══════════════════════════════════════════════════════════════════════

/** Semestres que admite el producto. Un tope alto pero finito: sin él, un
 *  `semester: 99999` se guarda y luego se pinta. */
export const EDU_MAX_SEMESTER = 20;

/** Duración máxima de un programa, en semestres. */
export const EDU_MAX_DURATION_SEMESTERS = 20;

/** Texto obligatorio: recorta espacios, colapsa los de en medio y exige
 *  que quede algo. Devuelve null si se pasa del largo de la columna. */
export function eduRequiredText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length === 0 || v.length > maxLength) return null;
  return v;
}

/**
 * Matrícula: en MAYÚSCULAS y sin espacios internos.
 *
 * Se normaliza porque el índice único es (institutionId, matricula) y
 * Postgres distingue mayúsculas: sin esto, "a-01" y "A-01" serían dos
 * alumnos distintos con la misma matrícula impresa en la credencial.
 */
export function normalizeEduMatricula(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (v.length === 0 || v.length > 30) return null;
  return v;
}

/** Clave del programa: MAYÚSCULAS, sin espacios, máx. 20 (la columna). */
export function normalizeEduProgramCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (v.length === 0 || v.length > 20) return null;
  return v;
}

/** Entero dentro de un rango; acepta el string que manda un <input>. */
export function eduParseInt(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

export function parseEduSemester(raw: unknown): number | null {
  return eduParseInt(raw, 1, EDU_MAX_SEMESTER);
}

export function parseEduDurationSemesters(raw: unknown): number | null {
  return eduParseInt(raw, 1, EDU_MAX_DURATION_SEMESTERS);
}

/** El estado, o null si no es uno de los cuatro. */
export function parseEduStudentStatus(raw: unknown): EduStudentStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_STUDENT_STATUSES as string[]).includes(raw) ? (raw as EduStudentStatus) : null;
}

/** Un booleano que viene de un JSON; `undefined` significa "no lo toques". */
export function parseEduBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * Fecha de CALENDARIO ("2026-08-31") → medianoche UTC.
 *
 * 🔴 `new Date("2026-08-31")` ya devuelve medianoche UTC, pero
 * `new Date(2026, 7, 31)` devuelve medianoche LOCAL, y esas siete horas de
 * diferencia son las que hacen que el 31 de agosto se pinte "30 de agosto"
 * en México. Aquí se construye explícitamente en UTC y se pinta en UTC
 * (formatEduDate), así que el día que se teclea es el día que se lee.
 */
export function parseEduCalendarDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rebota el 31 de febrero: el Date lo "arregla" solo y quedaría el 3 de
  // marzo guardado sin que nadie se entere.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** El valor que quiere un <input type="date">, leído en UTC. */
export function eduDateInputValue(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Viven AQUÍ, en el módulo puro, y no junto a las consultas, por una razón
// muy concreta: los componentes "use client" las necesitan y padron.ts
// importa prisma. Un `import type` se borra al compilar, sí — pero basta
// con que alguien quite el `type` de un import para arrastrar el runtime
// de Prisma al navegador. Si el tipo no vive ahí, no hay de dónde.
//
// Las fechas salen como string ISO: una Date cruzando el límite
// server→client es una fuente de sorpresas que no hace falta correr.
// ═══════════════════════════════════════════════════════════════════════

export interface EduSupervisorRow {
  assignmentId: string;
  supervisorUserId: string;
  name: string;
  isPrimary: boolean;
  startsAt: string;
}

export interface EduStudentRow {
  id: string;
  matricula: string;
  semester: number;
  status: EduStudentStatus;
  enrolledAt: string;
  graduatedAt: string | null;
  userId: string;
  name: string;
  email: string;
  userIsActive: boolean;
  programId: string;
  programName: string;
  programCode: string;
  cohortId: string;
  cohortName: string;
  /** Solo las VIGENTES, con el titular primero. */
  supervisors: EduSupervisorRow[];
}

export interface EduPadronPage {
  rows: EduStudentRow[];
  scope: EduPadronScope;
  /** true si se llegó al techo: la UI lo dice en vez de mentir con un total. */
  truncated: boolean;
}

export interface EduProgramRow {
  id: string;
  name: string;
  code: string;
  durationSemesters: number;
  isActive: boolean;
  cohorts: number;
  students: number;
}

export interface EduCohortRow {
  id: string;
  name: string;
  programId: string;
  programName: string;
  programCode: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  students: number;
}

export interface EduTeacherRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  /** Alumnos que supervisa HOY (asignaciones vigentes). */
  currentStudents: number;
}

export interface EduAssignmentRow {
  assignmentId: string;
  supervisorUserId: string;
  studentId: string;
  matricula: string;
  name: string;
  isPrimary: boolean;
}

/** Un EduUser con rol ALUMNO que todavía no tiene ficha académica. */
export interface EduEnrollableUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Lo MÍNIMO que necesita un <select> del navegador.
 *
 * No se le manda la fila completa: los conteos, los correos y las fechas
 * que la pantalla no pinta no tienen por qué viajar. En este repo ya se
 * pagó una vez el hábito de mandar la fila entera "por si acaso".
 */
export interface EduProgramOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export interface EduCohortOption {
  id: string;
  name: string;
  programId: string;
  isActive: boolean;
}

export interface EduTeacherOption {
  id: string;
  name: string;
  isActive: boolean;
}
