/**
 * Folio de factura (invoiceNumber) — LÓGICA PURA, sin Prisma.
 *
 * REGLA: el folio sale del MÁXIMO REALMENTE EMITIDO, nunca de un COUNT de filas.
 * Contar filas reasigna folios en cuanto hay un hueco (los DRAFT de
 * presupuesto→factura se borran en duro): el "count + 1" apunta a un número YA
 * emitido, choca contra @@unique([clinicId, invoiceNumber]) → P2002 → y como
 * ningún insert entra, el count nunca sube: la clínica queda sin poder facturar
 * PARA SIEMPRE (P0-2 auditoría 2026-08-06). Es el mismo bug ya corregido en el
 * folio de paciente; este módulo es su espejo (@/lib/patients/next-patient-number-core).
 *
 * DIFERENCIA deliberada con el folio de paciente: aquí se extrae el ÚLTIMO
 * bloque de dígitos, no todos los dígitos. Sobre esta columna conviven DOS
 * series históricas ("MF-0007" e "INV-2026-0007"); leer todos los dígitos
 * convertiría "INV-2026-0007" en 20 260 007 y un solo folio de esa serie
 * condenaría a la clínica a folios de 8 dígitos para siempre (es exactamente lo
 * que hacía el generador de /api/clinical al parsear con replace(/\D/g,"")).
 * Con el último bloque, "INV-2026-0007" vale 7 y las dos series comparten una
 * numeración pequeña y creciente.
 *
 * La única serie que se EMITE de aquí en adelante es MF-#### (la dominante:
 * 3 de los generadores viejos ya la usaban).
 */

/** Prefijo del folio de factura. */
export const INVOICE_FOLIO_PREFIX = "MF-";

/** Dígitos mínimos: MF-0001. Si el número crece, el folio crece (no se trunca). */
export const INVOICE_FOLIO_PAD = 4;

/**
 * Máximo de dígitos que aceptamos de un folio. Cota de seguridad: la query usa
 * CAST(... AS BIGINT) y un folio absurdo la haría fallar (22003) para TODA la
 * clínica. Por encima de esto la fila se ignora, igual que una corrupta.
 */
export const MAX_INVOICE_FOLIO_DIGITS = 15;

/**
 * Extrae el valor numérico de un folio: su ÚLTIMO bloque de dígitos. Espejo
 * exacto de `substring(x from '([0-9]+)[^0-9]*$')` en SQL.
 * Devuelve null si el folio no tiene dígitos (corrupto) o si tiene demasiados.
 */
export function invoiceFolioToInt(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/([0-9]+)[^0-9]*$/);
  if (!m) return null;
  const digits = m[1];
  if (digits.length === 0 || digits.length > MAX_INVOICE_FOLIO_DIGITS) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Mayor folio emitido de una lista, comparando como NÚMERO. Ignora los folios
 * no numéricos. Devuelve null si no hay ninguno usable (clínica sin facturas).
 */
export function maxInvoiceFolioInt(
  folios: readonly (string | null | undefined)[],
): number | null {
  let max: number | null = null;
  for (const folio of folios) {
    const n = invoiceFolioToInt(folio);
    if (n !== null && (max === null || n > max)) max = n;
  }
  return max;
}

/**
 * Formatea un número de folio. Rellena a 4 dígitos y NO trunca: pasado 9999 el
 * folio crece a 5 dígitos (MF-10000) en vez de reciclar MF-0000.
 */
export function formatInvoiceNumber(seq: number): string {
  const n = Math.max(1, Math.trunc(seq));
  return `${INVOICE_FOLIO_PREFIX}${String(n).padStart(INVOICE_FOLIO_PAD, "0")}`;
}

/** Siguiente folio dado el máximo ya emitido (null = clínica sin facturas). */
export function nextInvoiceNumberFrom(maxEmitted: number | null): string {
  return formatInvoiceNumber((maxEmitted ?? 0) + 1);
}

/**
 * Siguiente folio dada la lista de folios ya emitidos. Es la versión en memoria
 * de nextInvoiceNumber(); la de producción hace el MAX en SQL.
 */
export function nextInvoiceNumberFromFolios(
  folios: readonly (string | null | undefined)[],
): string {
  return nextInvoiceNumberFrom(maxInvoiceFolioInt(folios));
}

/** Se agotaron los reintentos de folio: quien llama debe responder 409, no 500. */
export class InvoiceNumberExhaustedError extends Error {
  readonly code = "INVOICE_NUMBER_CONFLICT";
  constructor() {
    super("No se pudo asignar folio de factura por emisión simultánea. Inténtalo de nuevo.");
    this.name = "InvoiceNumberExhaustedError";
  }
}

/**
 * ¿El error es un P2002 del índice de invoiceNumber?
 *
 * OJO: sobre `invoices` hay OTRO unique en juego (`appointmentId`). Ese P2002
 * significa "la cita ya tiene factura" y NO debe reintentarse: se deja pasar
 * para que cada ruta lo traduzca a su 409 de "factura ya existe".
 */
export function isInvoiceNumberConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  // `meta.target` llega como columnas (["clinicId","invoiceNumber"]) o como el
  // nombre del índice ("invoices_clinicId_invoiceNumber_key") según el driver.
  const text = Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
  // Sin target no podemos distinguirlo: asumimos que es el folio. Reintentar es
  // inocuo (el folio se recalcula) y si de verdad era otro índice el P2002
  // vuelve a salir igual en cada reintento y termina en InvoiceNumberExhaustedError.
  return text === "" || text.includes("invoiceNumber");
}

/**
 * Ejecuta `attempt` reintentando cuando dos emisiones simultáneas se pelean el
 * mismo folio (P2002). Cada intento recalcula el folio desde el máximo real.
 *
 * IMPORTANTE: si `attempt` usa una transacción, debe ABRIRLA DENTRO (que la
 * llamada a $transaction quede envuelta por este helper, no al revés): en
 * Postgres una transacción abortada por P2002 ya no admite más queries, así que
 * reintentar dentro de la misma tx fallaría con 25P02.
 */
export async function withInvoiceNumberRetry<T>(
  attempt: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      // Cualquier otro error se propaga tal cual (incluido el P2002 de
      // appointmentId): solo la carrera de folio se reintenta. Agotados los
      // intentos caemos al 409 de abajo, nunca a un 500.
      if (!isInvoiceNumberConflict(err)) throw err;
    }
  }
  throw new InvoiceNumberExhaustedError();
}
