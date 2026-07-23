import { getTzParts } from "@/lib/agenda/time-utils";

/**
 * Utilidades puras del cupo de facturas CFDI (sin dependencias de servidor).
 *
 * El "periodo" es el mes calendario "YYYY-MM" anclado a la zona horaria de la
 * clínica (fallback America/Mexico_City). Se usa como clave del contador
 * CfdiUsage y para decidir qué periodos ya cerraron en el cron de cobro.
 */

export const CFDI_DEFAULT_TZ = "America/Mexico_City";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Periodo "YYYY-MM" del `date` en la zona horaria de la clínica (fallback MX). */
export function cfdiPeriodFor(date: Date, timezone?: string | null): string {
  const tz = timezone && timezone.length > 0 ? timezone : CFDI_DEFAULT_TZ;
  const p = getTzParts(date, tz);
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
