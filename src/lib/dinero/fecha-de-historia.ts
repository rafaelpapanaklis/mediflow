// ═══════════════════════════════════════════════════════════════════════════
// Fechas de la HISTORIA MIGRADA (ws1-t2, auditoría de uso C-20). Puro, sin
// Prisma (src/lib/dinero/__tests__/fecha-de-historia.test.ts).
//
// Un pago que llega de otro sistema trae una FECHA DE CALENDARIO, sin hora.
// El importador la guardaba como la medianoche del SERVIDOR: en este servidor
// (Nueva York) son las 04:00 UTC, y en Vercel las 00:00 UTC. Vista en la
// Ciudad de México (UTC−6) esa hora cae el día ANTERIOR: el «Abono limpieza»
// del 1-ago contaba en julio, y Finanzas de agosto decía $3,750 cuando en
// agosto había $4,250.
//
// Sin tocar los datos ya importados (nada de UPDATE masivo): las filas de
// historia se leen por su día de calendario en UTC —que es el día que trae el
// archivo, sea cual sea la medianoche al oeste de Greenwich con que se
// guardó—, y el importador guarda desde hoy el mediodía UTC de ese día
// (`calendarNoonUtc`), que es el mismo día en toda América.
// ═══════════════════════════════════════════════════════════════════════════

import { getTzParts } from "@/lib/agenda/time-utils";

const ZONA_POR_DEFECTO = "America/Mexico_City";
const DIA_MS = 24 * 60 * 60 * 1000;

/** El día de calendario de una fila de historia, a mediodía UTC (para pintarlo en cualquier zona de América). */
export function fechaDeHistoria(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0));
}

function inicioUtcDelDiaLocal(d: Date, zona: string): number {
  const p = getTzParts(d, zona);
  return Date.UTC(p.year, p.month - 1, p.day);
}

/**
 * La ventana de un periodo de la clínica (`paidAt` de Finanzas: instantes)
 * convertida a la ventana de DÍAS de calendario con que se guardan las filas
 * de historia: `[día del inicio 00:00 UTC, día siguiente al fin 00:00 UTC)`.
 * Sin inicio (`gte`/`gt`), se devuelve tal cual.
 */
export function ventanaDeHistoria(
  paidAt: { gte?: Date; gt?: Date; lte?: Date; lt?: Date },
  zona: string = ZONA_POR_DEFECTO,
): { gte?: Date; gt?: Date; lte?: Date; lt?: Date } {
  const desde = paidAt.gte ?? paidAt.gt;
  if (!desde) return paidAt;
  const fin = paidAt.lt ? new Date(paidAt.lt.getTime() - 1) : paidAt.lte;
  const out: { gte: Date; lt?: Date } = { gte: new Date(inicioUtcDelDiaLocal(desde, zona)) };
  if (fin) out.lt = new Date(inicioUtcDelDiaLocal(fin, zona) + DIA_MS);
  return out;
}
