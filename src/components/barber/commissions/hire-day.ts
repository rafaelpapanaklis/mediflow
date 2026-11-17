/**
 * «16 nov» de un día «YYYY-MM-DD» — el alta del barbero (decisión 3 del QA de
 * cierre E: renta y sueldo cuentan desde ese día). Es una fecha de calendario:
 * se formatea en UTC para que no se corra de día en ninguna zona. Puro.
 */
export function fmtHireDay(day: string, locale: string): string {
  const d = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
}
