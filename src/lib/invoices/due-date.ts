// Vencimiento de facturas — fuente ÚNICA del criterio "vencida" (client-safe,
// sin I/O). Lo comparten el POST /api/invoices (cómo se guarda "Vence el"), el
// filtro "Vencidas" de la tabla de Facturas y los tests.
//
// Regla: una factura está VENCIDA si está emitida (ni DRAFT ni CANCELLED),
// tiene saldo > 0 y su `dueDate` es ANTERIOR al inicio de HOY en la zona de la
// clínica. NUNCA por Invoice.status = "OVERDUE": ningún flujo lo escribe. Una
// factura sin dueDate no vence jamás — a las que ya existen no se les inventa
// una fecha.
//
// El lado servidor (Prisma) de esta misma regla es overdueInvoiceWhere en
// src/lib/caja.ts; aquí vive la versión pura para el cliente. Si cambia una,
// cambia la otra.

import { isValidDateISO, periodRangeUtc, tzLocalToUtc } from "@/lib/agenda/time-utils";

/** Zona por default cuando la clínica no trae una (misma que el resto del panel). */
export const DEFAULT_INVOICE_TZ = "America/Mexico_City";

/** Estados que NUNCA cuentan como vencidos: no emitida / anulada. */
export const NON_OVERDUE_STATUSES: readonly string[] = ["DRAFT", "CANCELLED"];

/** Inicio de HOY (00:00) en la zona de la clínica, como instante UTC. */
export function startOfTodayInTz(timezone: string): Date {
  return periodRangeUtc("day", timezone || DEFAULT_INVOICE_TZ).from;
}

/**
 * Convierte lo que manda el editor en el instante que se guarda en
 * Invoice.dueDate:
 *  - "YYYY-MM-DD" (input type="date") → 00:00 de ESE día en la zona de la
 *    clínica. Vercel corre en UTC: `new Date("2026-08-22")` sería el 21 a las
 *    18:00 en México y la factura vencería un día antes.
 *  - ISO completo → tal cual (compatibilidad con el contrato anterior del POST).
 *  - "" / null / undefined → undefined: no se manda, la columna queda NULL.
 *  - cualquier otra cosa → null: inválido, el caller responde 400.
 */
export function parseInvoiceDueDate(raw: unknown, timezone: string): Date | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return undefined;
  if (isValidDateISO(s)) return tzLocalToUtc(s, 0, 0, timezone || DEFAULT_INVOICE_TZ);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export interface OverdueCandidate {
  status: string;
  balance: number | null | undefined;
  dueDate: Date | string | null | undefined;
}

/**
 * ¿La factura está vencida al inicio de `todayStart`? Con `dueDate` = 00:00 del
 * día de vencimiento (ver parseInvoiceDueDate) y `todayStart` = 00:00 de hoy,
 * "vence el 22" NO está vencida el 22 y SÍ lo está desde el 23.
 */
export function isInvoiceOverdue(inv: OverdueCandidate, todayStart: Date | string): boolean {
  if (!inv.dueDate) return false;
  if (NON_OVERDUE_STATUSES.includes(inv.status)) return false;
  if (!(Number(inv.balance ?? 0) > 0)) return false;
  const due = inv.dueDate instanceof Date ? inv.dueDate : new Date(inv.dueDate);
  const today = todayStart instanceof Date ? todayStart : new Date(todayStart);
  if (isNaN(due.getTime()) || isNaN(today.getTime())) return false;
  return due.getTime() < today.getTime();
}
