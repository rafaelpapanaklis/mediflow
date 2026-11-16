// «$3,000 semanal»: cómo se nombra un sueldo en Barberos, Comisiones y el recibo
// (ws6-t6). Puro y client-safe. El adjetivo sale del diccionario de cada
// pantalla con la clave «salaryAdj_<PERIODO>» (es: semanal / quincenal /
// mensual; en: weekly / biweekly / monthly).
import type { BarberSalaryPeriod } from "@/lib/barber/sueldo-core";

const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** $3,000 · $4,500.50 (sin centavos cuando son cero). */
export function salaryMoney(amount: number): string {
  const n = Math.round(amount * 100) / 100;
  return Number.isInteger(n) ? MXN.format(n) : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }).format(n);
}

export function salaryLabel(
  amount: number,
  period: BarberSalaryPeriod,
  t: (key: string, vars?: Record<string, string | number>) => string,
  prefix = "barbers",
): string {
  return `${salaryMoney(amount)} ${t(`${prefix}.salaryAdj_${period}`)}`;
}
