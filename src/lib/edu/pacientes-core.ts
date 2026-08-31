/**
 * DaleControl INSTITUCIONAL — el cerebro de PACIENTES, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Lo que decide:
 * cómo se sanea lo que se captura en recepción, cómo se busca sin que el
 * buscador vuelque la tabla, y qué forma tiene la ficha que viaja a la
 * pantalla.
 *
 * 🔴 EL ORIGEN. `referredByStudentId` dice CUÁL alumno trajo al paciente, y
 * en la Ola 5 ese dato decide el precio. Por eso se guarda desde hoy
 * —reconstruirlo después, de memoria, no se puede— y por eso se guarda
 * también quién lo marcó y cuándo: es un dato con consecuencia económica.
 * Marcarlo exige el permiso `pacientes.origen`; a quien no lo tiene se le
 * PINTA, deshabilitado, en vez de escondérselo. Un alumno tiene derecho a
 * ver si su paciente cuenta como suyo.
 */
import type { Prisma } from "@prisma/client";
import type { EduPatientStatus, EduSex } from "@/lib/edu/types";
import { EDU_PATIENT_STATUSES, EDU_SEXES } from "@/lib/edu/types";
import { eduSearchInput, eduSearchTokens } from "@/lib/edu/padron-core";
import { eduNormalizeSearch } from "@/lib/edu/search";

/** El buscador y el saneo de texto se REUSAN del padrón en vez de
 *  escribirse otra vez: dos saneadores de búsqueda en el mismo vertical es
 *  como se acaba con uno que escapa los comodines de LIKE y otro que no. */
export { eduSearchInput, eduSearchTokens } from "@/lib/edu/padron-core";
export { formatEduContractDate as formatEduDate } from "@/lib/edu/contract";

// ═══════════════════════════════════════════════════════════════════════
// 1 · SANEO DE LA FICHA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Folio de la escuela: MAYÚSCULAS y sin espacios internos.
 *
 * Se normaliza porque el índice único es (institutionId, folio) y Postgres
 * distingue mayúsculas: sin esto, "p-01" y "P-01" serían dos pacientes con
 * el mismo folio impreso en el expediente de papel.
 */
export function normalizeEduFolio(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (v.length === 0 || v.length > 30) return null;
  return v;
}

/**
 * Teléfono: se guardan SOLO los dígitos (y un "+" inicial si venía).
 *
 * 🔴 Se normaliza al guardar porque si no, buscar "5544332211" no
 * encuentra al que se capturó como "55 4433 2211" — el `contains` de Prisma
 * compara el texto tal cual. Ese bug ya se pagó en el dental.
 */
export function normalizeEduPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const v = `${plus}${digits}`;
  return v.length > 30 ? null : v;
}

/** Correo, en minúsculas y con una forma mínimamente creíble. */
export function normalizeEduEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.length > 160) return null;
  // A propósito NO es la expresión "completa" del RFC: rechazar correos
  // válidos y raros en recepción es peor que aceptar uno con un dedazo.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function parseEduSex(raw: unknown): EduSex | null {
  if (typeof raw !== "string") return null;
  return (EDU_SEXES as string[]).includes(raw) ? (raw as EduSex) : null;
}

export function parseEduPatientStatus(raw: unknown): EduPatientStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_PATIENT_STATUSES as string[]).includes(raw) ? (raw as EduPatientStatus) : null;
}

/**
 * Edad en años cumplidos, a partir de una fecha de calendario guardada a
 * medianoche UTC. Se calcula en UTC de punta a punta.
 *
 * ⚠️ El off-by-one de la edad ya mordió una vez en este repo: comparar
 * `Date.now() - nacimiento` en milisegundos y dividir entre 365 días
 * equivoca el año en los bisiestos y el día del cumpleaños. Aquí se compara
 * año/mes/día, que es como cuenta la gente.
 */
export function eduAgeYears(
  birth: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!birth) return null;
  const d = birth instanceof Date ? birth : new Date(birth);
  if (Number.isNaN(d.getTime())) return null;

  let years = now.getUTCFullYear() - d.getUTCFullYear();
  const mes = now.getUTCMonth() - d.getUTCMonth();
  if (mes < 0 || (mes === 0 && now.getUTCDate() < d.getUTCDate())) years -= 1;
  if (years < 0 || years > 130) return null;
  return years;
}

/** Nombre completo, sin el espacio de más cuando falta el apellido. */
export function eduPatientFullName(p: { firstName: string; lastName: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · FILTROS DE LA LISTA
// ═══════════════════════════════════════════════════════════════════════

export interface EduPatientFilters {
  status: EduPatientStatus | null;
  /** Solo los que trajo ESE alumno. Es el filtro que la Ola 5 va a cobrar. */
  referredByStudentId: string | null;
  q: string | null;
}

export const EDU_PATIENT_EMPTY_FILTERS: EduPatientFilters = {
  status: null,
  referredByStudentId: null,
  q: null,
};

export function eduHasPatientFilters(f: EduPatientFilters): boolean {
  return Boolean(f.status || f.referredByStudentId || f.q);
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

function cleanId(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * Lee los filtros de la query string. Todo lo que no reconoce se descarta.
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión y de
 * ningún otro lado; si esta función lo aceptara, bastaría con teclear
 * `?institutionId=…` para leer los pacientes de otra escuela.
 */
export function parseEduPatientFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduPatientFilters {
  const sp = searchParams ?? {};
  return {
    status: parseEduPatientStatus(firstParam(sp.estado)),
    referredByStudentId: cleanId(sp.origen),
    q: eduSearchInput(firstParam(sp.q)),
  };
}

/**
 * Los términos con los que se busca un paciente, ya saneados para LIKE.
 *
 * Se busca por nombre, apellido, folio y teléfono. El teléfono va aparte
 * porque lo que la persona teclea ("55 4433") no es lo que está guardado
 * (solo dígitos): se le quitan los caracteres de adorno antes de comparar.
 */
export function eduPhoneSearchToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LAS FORMAS QUE VIAJAN A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

/** El origen del paciente, ya resuelto para pintarlo. */
export interface EduPatientOrigin {
  studentId: string | null;
  studentName: string | null;
  studentMatricula: string | null;
  setByName: string | null;
  setAt: string | null;
}

export interface EduPatientRow {
  id: string;
  folio: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  ageYears: number | null;
  sex: EduSex;
  notes: string | null;
  status: EduPatientStatus;
  origin: EduPatientOrigin;
  /** Ola de Casos: los antecedentes médicos, siempre presentes en la fila
   *  — la ficha los pinta como chips en TODAS las pestañas. */
  antecedentes: EduAntecedentes;
  /** Casos abiertos (no cerrados). Lo pinta la lista como "2 casos". */
  openCases: number;
  /** Total de casos, abiertos y cerrados. */
  totalCases: number;
  createdAt: string;
}

export interface EduPatientsPage {
  rows: EduPatientRow[];
  truncated: boolean;
}

/** Lo MÍNIMO para un <select> de pacientes (agendar una cita). */
export interface EduPatientOption {
  id: string;
  folio: string;
  name: string;
  status: EduPatientStatus;
}

/** El texto que se busca, sin comodines de LIKE. Se reexporta el del
 *  padrón para no tener dos. */
export function eduPatientSearchTokens(raw: string | null | undefined): string[] {
  return eduSearchTokens(raw);
}

/** El constructor del índice del paciente, reexportado desde el módulo puro
 *  del buscador para que quien ya importa de aquí no tenga que ir a otro
 *  archivo. */
export { eduPatientSearchIndex } from "@/lib/edu/search";

/**
 * Las cláusulas AND del buscador de pacientes.
 *
 * Vive AQUÍ, en el módulo puro, y no dentro de pacientes.ts, por una razón
 * concreta: pacientes.ts importa prisma y no se puede cargar en una prueba
 * sin base de datos. Este `where` es justo lo que se rompió en producción
 * —buscar "Rodriguez" no encontraba a "Rodríguez"— así que tiene que poder
 * probarse.
 *
 * 🔴 Solo mira `searchIndex`: es la columna con el texto ya en minúsculas y
 * sin acentos. Comparar contra `firstName` con `mode: "insensitive"` —que
 * es lo que había— arregla las mayúsculas y NO los acentos.
 */
export function eduPatientSearchAnd(
  q: string | null | undefined,
): Prisma.EduPatientWhereInput[] {
  const and: Prisma.EduPatientWhereInput[] = [];
  for (const token of eduSearchTokens(q)) {
    const or: Prisma.EduPatientWhereInput[] = [{ searchIndex: { contains: token } }];
    // El teléfono va en el índice SOLO con dígitos, así que un término con
    // adornos ("55-4433") se prueba también reducido a dígitos: quien
    // teclea el teléfono como se lo dictaron tiene que encontrar al que se
    // capturó como "5544332211".
    const digits = eduPhoneSearchToken(token);
    if (digits && digits !== token) or.push({ searchIndex: { contains: digits } });
    and.push({ OR: or });
  }
  return and;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · ANTECEDENTES MÉDICOS (ola de Casos) — ES SEGURIDAD, NO ESTÉTICA
//
// Un alumno a punto de infiltrar anestesia tiene que poder ver que el
// paciente es cardiópata SIN abrir nada: los chips de alerta se pintan en
// el ENCABEZADO de la ficha, arriba de todas las pestañas.
//
// 🔴 EL ESTADO ES TRI-ESTADO, y confundir dos de ellos es como se mata a
// alguien:
//   · SIN_REGISTRAR — nadie ha preguntado. `[]` es el default de la fila,
//     NO una respuesta. La ficha lo AVISA en ámbar.
//   · NO_REFIERE    — se le preguntó y no refiere nada. Chip verde.
//   · CON_DATOS     — hay alergias/padecimientos/medicamentos capturados.
// Lo que separa el primero de los otros dos es `historyRecordedAt`: null =
// nadie los capturó; con fecha = alguien los revisó (y quedó quién).
// ═══════════════════════════════════════════════════════════════════════

/** Los ocho grupos ABO/Rh. El servidor NO acepta texto libre aquí: un
 *  "0+" (cero) tecleado donde debía decir "O+" es exactamente la clase de
 *  dato que no puede vivir en un campo de seguridad. */
export const EDU_BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type EduBloodType = (typeof EDU_BLOOD_TYPES)[number];

/** Tope de renglones por lista y de largo por renglón. Una "lista" de 200
 *  alergias no es una historia clínica, es un pegado accidental. */
export const EDU_ANTECEDENTES_MAX_ITEMS = 30;
export const EDU_ANTECEDENTES_MAX_ITEM_LENGTH = 120;

export interface EduAntecedentes {
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  /** null = nadie los ha capturado (la ficha lo AVISA). */
  recordedAt: string | null;
  recordedByName: string | null;
}

export type EduAntecedentesEstado = "SIN_REGISTRAR" | "NO_REFIERE" | "CON_DATOS";

export function eduAntecedentesEstado(a: {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  recordedAt: string | Date | null;
}): EduAntecedentesEstado {
  const vacio =
    a.allergies.length === 0 &&
    a.chronicConditions.length === 0 &&
    a.currentMedications.length === 0;
  // 🔴 LOS DATOS MANDAN SOBRE LA FECHA. Una fila con alergias capturadas
  // pero sin fecha de revisión (un import a mano, una escritura vieja) es
  // CON_DATOS: pintarle "sin antecedentes registrados" ESCONDERÍA una
  // alergia que sí está en la base — el único error peor que confundir
  // los otros dos estados.
  if (!vacio) return "CON_DATOS";
  // Y con las tres listas vacías, la fecha es lo ÚNICO que separa "nadie
  // ha preguntado" (null) de "se le preguntó y no refiere" (con fecha):
  // en la base se ven idénticas.
  return a.recordedAt ? "NO_REFIERE" : "SIN_REGISTRAR";
}

export type EduAlertChipKind =
  | "sin-registrar"
  | "no-refiere"
  | "alergia"
  | "padecimiento"
  | "medicamento"
  | "sangre"
  | "mas";

export interface EduAlertChip {
  kind: EduAlertChipKind;
  /** El tono es el del sistema de tags del vertical (edu-tag--*). */
  tone: "danger" | "warn" | "info" | "ok" | "muted";
  text: string;
  /** Lo que no cupo en el chip "+N", para el title. */
  detail?: string;
}

/** Cuántos padecimientos/medicamentos se pintan antes del "+N". Las
 *  ALERGIAS no se recortan nunca: esconder la cuarta alergia detrás de un
 *  "+1" es esconder justo la que iba a importar. */
const CHIP_CAP = 3;

/**
 * Los chips del encabezado de la ficha, derivados de los antecedentes.
 *
 * Rojo = contraindica (alergias). Ámbar = a tener en cuenta
 * (padecimientos) y el aviso de "sin registrar". Info = medicamentos y
 * tipo de sangre. Verde = revisado y sin hallazgos.
 */
export function eduAntecedentesChips(a: EduAntecedentes): EduAlertChip[] {
  const estado = eduAntecedentesEstado(a);

  if (estado === "SIN_REGISTRAR") {
    // 🔴 CON ESTAS PALABRAS. "Sin antecedentes registrados" ≠ "sin
    // alergias": lo primero es una tarea pendiente, lo segundo una
    // respuesta clínica. Pintar aquí un chip verde mataría a alguien.
    return [{ kind: "sin-registrar", tone: "warn", text: "Sin antecedentes registrados" }];
  }

  const chips: EduAlertChip[] = [];

  for (const al of a.allergies) {
    chips.push({ kind: "alergia", tone: "danger", text: `Alergia: ${al}` });
  }

  for (const c of a.chronicConditions.slice(0, CHIP_CAP)) {
    chips.push({ kind: "padecimiento", tone: "warn", text: c });
  }
  if (a.chronicConditions.length > CHIP_CAP) {
    chips.push({
      kind: "mas",
      tone: "warn",
      text: `+${a.chronicConditions.length - CHIP_CAP} padecimientos`,
      detail: a.chronicConditions.slice(CHIP_CAP).join(", "),
    });
  }

  for (const m of a.currentMedications.slice(0, CHIP_CAP)) {
    chips.push({ kind: "medicamento", tone: "info", text: m });
  }
  if (a.currentMedications.length > CHIP_CAP) {
    chips.push({
      kind: "mas",
      tone: "info",
      text: `+${a.currentMedications.length - CHIP_CAP} medicamentos`,
      detail: a.currentMedications.slice(CHIP_CAP).join(", "),
    });
  }

  if (estado === "NO_REFIERE") {
    chips.push({
      kind: "no-refiere",
      tone: "ok",
      text: "Revisado: no refiere alergias ni padecimientos",
    });
  }

  if (a.bloodType) {
    chips.push({ kind: "sangre", tone: "muted", text: `Sangre ${a.bloodType}` });
  }

  return chips;
}

export interface EduAntecedentesInput {
  bloodType?: unknown;
  allergies?: unknown;
  chronicConditions?: unknown;
  currentMedications?: unknown;
  emergencyContactName?: unknown;
  emergencyContactPhone?: unknown;
  emergencyContactRelation?: unknown;
}

export interface EduAntecedentesData {
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
}

/**
 * El resultado del saneo, al estilo de EduGateVerdict: TODOS los campos
 * siempre presentes, nada de unión discriminada. Este repo compila con
 * `strict: false` y ahí `if (!r.ok)` NO estrecha la unión — el código que
 * la usara "bien" no compilaría, y el arreglo obvio (un cast) escondería
 * justo el error que el tipo existía para atrapar.
 *
 * Con ok=false, `error` trae el motivo y `data` viene NEUTRA (no usarla).
 * Con ok=true, `error` es "".
 */
export interface EduAntecedentesParse {
  ok: boolean;
  error: string;
  data: EduAntecedentesData;
}

const ANTECEDENTES_NEUTROS: EduAntecedentesData = {
  bloodType: null,
  allergies: [],
  chronicConditions: [],
  currentMedications: [],
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelation: null,
};

function antecedentesError(error: string): EduAntecedentesParse {
  return { ok: false, error, data: ANTECEDENTES_NEUTROS };
}

interface ListaParse {
  ok: boolean;
  error: string;
  value: string[];
}

/** Una lista del formulario: acepta arreglo de strings o texto con comas
 *  (el patrón del dental), recorta, descarta vacíos y deduplica sin
 *  distinguir mayúsculas ni acentos — "Penicilina" y "penicilina" son la
 *  misma alergia, no dos. */
function parseLista(raw: unknown, nombre: string): ListaParse {
  let items: string[];
  if (raw === undefined || raw === null || raw === "") items = [];
  else if (typeof raw === "string") items = raw.split(",");
  else if (Array.isArray(raw)) {
    if (raw.some((x) => typeof x !== "string")) {
      return { ok: false, error: `La lista de ${nombre} trae algo que no es texto.`, value: [] };
    }
    items = raw as string[];
  } else {
    return { ok: false, error: `La lista de ${nombre} no tiene forma de lista.`, value: [] };
  }

  const vistos = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const v = item.trim().replace(/\s+/g, " ");
    if (!v) continue;
    if (v.length > EDU_ANTECEDENTES_MAX_ITEM_LENGTH) {
      return {
        ok: false,
        error: `Un renglón de ${nombre} pasa de ${EDU_ANTECEDENTES_MAX_ITEM_LENGTH} caracteres. Escribe el nombre, no la historia completa.`,
        value: [],
      };
    }
    // La llave de dedupe reusa el normalizador del buscador (minúsculas,
    // sin acentos): "Penicilina" y "penicilina" son la misma alergia.
    const llave = eduNormalizeSearch(v);
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    out.push(v);
  }
  if (out.length > EDU_ANTECEDENTES_MAX_ITEMS) {
    return {
      ok: false,
      error: `Son demasiados renglones de ${nombre} (máximo ${EDU_ANTECEDENTES_MAX_ITEMS}).`,
      value: [],
    };
  }
  return { ok: true, error: "", value: out };
}

function parseTextoOpcional(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  return v.slice(0, max);
}

/**
 * Sanea el bloque COMPLETO de antecedentes. Es un REEMPLAZO, no un merge:
 * guardar antecedentes significa "revisé el bloque entero hoy", y por eso
 * el servidor estampa `historyRecordedAt`/`historyRecordedById` juntos en
 * la misma escritura. Un merge campo por campo dejaría una fecha de
 * revisión sobre datos que nadie revisó.
 */
export function parseEduAntecedentes(input: EduAntecedentesInput): EduAntecedentesParse {
  const alergias = parseLista(input.allergies, "alergias");
  if (!alergias.ok) return antecedentesError(alergias.error);
  const padecimientos = parseLista(input.chronicConditions, "padecimientos");
  if (!padecimientos.ok) return antecedentesError(padecimientos.error);
  const medicamentos = parseLista(input.currentMedications, "medicamentos");
  if (!medicamentos.ok) return antecedentesError(medicamentos.error);

  let bloodType: string | null = null;
  if (input.bloodType !== undefined && input.bloodType !== null && input.bloodType !== "") {
    if (typeof input.bloodType !== "string") {
      return antecedentesError("Ese tipo de sangre no existe.");
    }
    const v = input.bloodType.trim().toUpperCase();
    if (!(EDU_BLOOD_TYPES as readonly string[]).includes(v)) {
      // La letra es O (de la palabra), no cero — el dedazo clásico.
      return antecedentesError("Ese tipo de sangre no existe. Son A, B, AB u O, con + o −.");
    }
    bloodType = v;
  }

  const emergencyContactName = parseTextoOpcional(input.emergencyContactName, 120);

  let emergencyContactPhone: string | null = null;
  if (
    input.emergencyContactPhone !== undefined &&
    input.emergencyContactPhone !== null &&
    input.emergencyContactPhone !== ""
  ) {
    const v = normalizeEduPhone(input.emergencyContactPhone);
    if (!v) return antecedentesError("El teléfono de emergencia no tiene números suficientes.");
    emergencyContactPhone = v;
  }

  const emergencyContactRelation = parseTextoOpcional(input.emergencyContactRelation, 60);

  return {
    ok: true,
    error: "",
    data: {
      bloodType,
      allergies: alergias.value,
      chronicConditions: padecimientos.value,
      currentMedications: medicamentos.value,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
    },
  };
}
