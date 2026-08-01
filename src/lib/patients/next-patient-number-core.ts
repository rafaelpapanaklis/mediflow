/**
 * Folio de paciente (patientNumber) — LÓGICA PURA, sin Prisma.
 *
 * REGLA: el folio sale del MÁXIMO REALMENTE EMITIDO, nunca de un COUNT de filas.
 * Contar filas reasigna folios en cuanto hay un hueco (baja definitiva): el
 * "count + 1" apunta a un número YA emitido, choca contra
 * @@unique([clinicId, patientNumber]) → P2002 → el alta revienta con un 500.
 * Un folio emitido NO se recicla jamás.
 *
 * Este módulo es el espejo en JS de la query de ./next-patient-number.ts: misma
 * extracción de dígitos, mismo límite de longitud y misma comparación NUMÉRICA
 * (P9999 < P10000; como texto se ordenan al revés). Vive aparte para poder
 * testearlo sin base de datos.
 */

/** Prefijo del folio de paciente. */
export const FOLIO_PREFIX = "P";

/** Dígitos mínimos: P0001. Si el número crece, el folio crece (no se trunca). */
export const FOLIO_PAD = 4;

/**
 * Máximo de dígitos que aceptamos de un folio. Cota de seguridad: la query usa
 * CAST(... AS BIGINT) y un folio con 40 dígitos la haría fallar (22003) para
 * TODA la clínica. Por encima de esto la fila se ignora, igual que una corrupta.
 */
export const MAX_FOLIO_DIGITS = 15;

/**
 * Extrae el valor numérico de un folio. Espejo exacto de
 * `NULLIF(regexp_replace(x, '[^0-9]', '', 'g'), '')::BIGINT` en SQL.
 * Devuelve null si el folio no tiene dígitos (corrupto) o si tiene demasiados.
 */
export function folioToInt(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0 || digits.length > MAX_FOLIO_DIGITS) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Mayor folio emitido de una lista, comparando como NÚMERO. Ignora los folios
 * no numéricos. Devuelve null si no hay ninguno usable (clínica nueva).
 */
export function maxFolioInt(folios: readonly (string | null | undefined)[]): number | null {
  let max: number | null = null;
  for (const folio of folios) {
    const n = folioToInt(folio);
    if (n !== null && (max === null || n > max)) max = n;
  }
  return max;
}

/**
 * Formatea un número de folio. Rellena a 4 dígitos y NO trunca: pasado 9999 el
 * folio crece a 5 dígitos (P10000) en vez de reciclar P0000.
 */
export function formatPatientNumber(seq: number): string {
  const n = Math.max(1, Math.trunc(seq));
  return `${FOLIO_PREFIX}${String(n).padStart(FOLIO_PAD, "0")}`;
}

/** Siguiente folio dado el máximo ya emitido (null = clínica sin pacientes). */
export function nextPatientNumberFrom(maxEmitted: number | null): string {
  return formatPatientNumber((maxEmitted ?? 0) + 1);
}

/**
 * Siguiente folio dada la lista de folios ya emitidos. Es la versión en memoria
 * de nextPatientNumber(); la de producción hace el MAX en SQL.
 */
export function nextPatientNumberFromFolios(
  folios: readonly (string | null | undefined)[],
): string {
  return nextPatientNumberFrom(maxFolioInt(folios));
}
