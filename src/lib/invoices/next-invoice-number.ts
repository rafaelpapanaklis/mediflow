import { prisma } from "@/lib/prisma";
import {
  MAX_INVOICE_FOLIO_DIGITS,
  nextInvoiceNumberFrom,
} from "./next-invoice-number-core";

/**
 * Folio de factura (invoiceNumber) — FUENTE ÚNICA para todo el repo.
 *
 * Antes había CINCO generadores conviviendo sobre la misma columna única
 * (@@unique([clinicId, invoiceNumber])): cuatro con `count + 1` (POST
 * /api/invoices, from-appointment, create-invoice-from-quote, import) y uno que
 * parseaba TODOS los dígitos del último folio (/api/clinical, que de un
 * "INV-2026-0007" fabricaba "MF-20260008"). Con cualquier hueco (los DRAFT se
 * borran en duro) el `count + 1` apunta a un folio YA emitido → P2002 → y la
 * clínica queda sin poder facturar de forma permanente. Aquí el folio sale del
 * MÁXIMO REALMENTE EMITIDO y se compara como NÚMERO. Es el calco de
 * @/lib/patients/next-patient-number, que ya curó este mismo bug en pacientes.
 *
 * Uso:
 *   const invoiceNumber = await nextInvoiceNumber(clinicId, tx);      // dentro de tx
 *   await withInvoiceNumberRetry(() => prisma.invoice.create(...));   // envolviendo
 */

/** Cliente admitido: el prisma global o el `tx` de una transacción. */
export type InvoiceFolioClient = { $queryRaw: typeof prisma.$queryRaw };

/**
 * Mayor folio emitido de la clínica, o null si no hay ninguno numérico.
 *
 * Cuenta TODAS las filas, incluidas las CANCELLED: un folio emitido no se
 * recicla ni aunque la factura esté anulada. NO añadir aquí un filtro por
 * status — reintroduce exactamente el bug que este módulo arregla.
 *
 * El valor numérico es el ÚLTIMO bloque de dígitos ("INV-2026-0007" → 7, no
 * 20260007): en esta columna conviven dos series históricas y leer todos los
 * dígitos dejaría el máximo envenenado en 20 millones (ver el docstring del
 * core). El espejo JS de esta extracción vive en invoiceFolioToInt().
 */
export async function lastInvoiceFolio(
  clinicId: string,
  client: InvoiceFolioClient = prisma,
): Promise<number | null> {
  // MAX numérico: ordenar como texto pondría MF-9999 por encima de MF-10000.
  // El filtro por longitud evita que un folio absurdo reviente el CAST (22003).
  const rows = await client.$queryRaw<{ max: bigint | number | null }[]>`
    SELECT MAX(CAST(digits AS BIGINT)) AS max
    FROM (
      SELECT substring("invoiceNumber" from '([0-9]+)[^0-9]*$') AS digits
      FROM "invoices"
      WHERE "clinicId" = ${clinicId}
    ) s
    WHERE digits IS NOT NULL AND length(digits) <= ${MAX_INVOICE_FOLIO_DIGITS}
  `;
  const raw = rows[0]?.max ?? null;
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Siguiente folio libre de la clínica (`MF-0001` si es la primera factura).
 * Pásale el `tx` cuando estés dentro de una transacción: así el cálculo ve lo
 * mismo que el INSERT que viene detrás.
 */
export async function nextInvoiceNumber(
  clinicId: string,
  client: InvoiceFolioClient = prisma,
): Promise<string> {
  return nextInvoiceNumberFrom(await lastInvoiceFolio(clinicId, client));
}

// El detector de conflicto y el retry son lógica pura y viven en el core para
// poder testearse sin base de datos; se re-exportan aquí para que los callers
// tengan una sola ruta de import.
export {
  InvoiceNumberExhaustedError,
  isInvoiceNumberConflict,
  withInvoiceNumberRetry,
} from "./next-invoice-number-core";
