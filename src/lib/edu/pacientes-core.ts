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
import type { EduPatientStatus, EduSex } from "@/lib/edu/types";
import { EDU_PATIENT_STATUSES, EDU_SEXES } from "@/lib/edu/types";
import { eduSearchInput, eduSearchTokens } from "@/lib/edu/padron-core";

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
