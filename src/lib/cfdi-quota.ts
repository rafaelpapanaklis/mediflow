import { getTzParts } from "@/lib/agenda/time-utils";

/**
 * Utilidades puras del cupo de facturas CFDI (sin dependencias de servidor).
 *
 * El "periodo" es el mes calendario "YYYY-MM" en la hora de CDMX, el MISMO
 * reloj con el que el cron /api/cron/cfdi-overage cierra los meses. Se usa como
 * clave del contador CfdiUsage y para decidir qué periodos ya cerraron.
 *
 * Seguridad ola 2b (lead 8): antes se anclaba a la zona de la CLÍNICA. Con una
 * zona al oeste de CDMX (America/Tijuana, Etc/GMT+12…) el mes anterior seguía
 * abierto horas después del cierre del cron y lo timbrado entonces sumaba a una
 * fila ya cobrada: ese excedente nunca se cobraba. Por eso ya no recibe zona.
 */

export const CFDI_DEFAULT_TZ = "America/Mexico_City";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Periodo "YYYY-MM" del `date` en la hora de CDMX (la del cierre del cron), para TODA clínica. */
export function cfdiPeriodFor(date: Date): string {
  const p = getTzParts(date, CFDI_DEFAULT_TZ);
  return `${p.year}-${pad2(p.month)}`;
}

export interface CfdiOverage {
  /** Timbres emitidos en el periodo. */
  used: number;
  /** Timbres incluidos por el plan. */
  included: number;
  /** Timbres por encima del cupo (0 si no excedió). */
  overage: number;
  /** Precio por timbre excedente, en centavos MXN. */
  overageCents: number;
  /** Monto total del excedente, en centavos MXN (overage × overageCents). */
  overageTotalCents: number;
}

/**
 * Calcula el excedente de un periodo. Todo se satura a ≥0 y a enteros para que
 * un plan mal sembrado (cupo negativo, etc.) nunca genere cobros absurdos.
 */
export function cfdiOverage(
  stamped: number,
  includedMonthly: number,
  overageCents: number,
): CfdiOverage {
  const included = Math.max(0, Math.floor(includedMonthly ?? 0));
  const used = Math.max(0, Math.floor(stamped ?? 0));
  const overage = Math.max(0, used - included);
  const oc = Math.max(0, Math.floor(overageCents ?? 0));
  return { used, included, overage, overageCents: oc, overageTotalCents: overage * oc };
}
