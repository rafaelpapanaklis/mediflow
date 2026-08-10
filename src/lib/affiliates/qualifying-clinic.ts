/**
 * Afiliados — QUÉ ES UNA "CLÍNICA QUE CALIFICA". Definición ÚNICA y PURA.
 *
 * Vivía dentro de `./milestones-progress`, que importa Prisma. Al nacer los
 * BONOS POR RED hizo falta el mismo predicado en sitios client-safe (la
 * tarjeta del panel, los tests puros, el copy de los términos), y la única
 * alternativa habría sido teclear otro `>= 3` en otro archivo. Dos verdades
 * sobre qué califica es garantía de reclamos: el afiliado ve un número, Rafael
 * otro, y el que reclama es el afiliado.
 *
 * Por eso se EXTRAE aquí, sin una sola línea de BD. `milestones-progress` lo
 * re-exporta para no romper a nadie, así que hay un solo `MIN_PAID_INVOICES`
 * en todo el repo y los dos programas de bonos —los propios y los de red—
 * cuentan exactamente igual.
 *
 * Atado a: /terminos-afiliados → "Una clínica cuenta como activa cuando lleva
 * al menos 3 mensualidades pagadas y su suscripción sigue vigente".
 */

/**
 * Mensualidades PAGADAS que exige la cláusula del bono. Exportada para que la
 * UI escriba el copy con este valor en vez de teclear un "3" que quedaría
 * desincronizado si algún día se renegocia el requisito.
 */
export const MIN_PAID_INVOICES = 3;

/**
 * ¿Una clínica ACTIVA califica para un bono? Predicado ÚNICO, compartido por
 * el panel del afiliado, /api/admin/affiliates/metrics, los bonos por red y su
 * cron.
 *
 * Se aísla del acceso a BD a propósito: quien necesita el criterio para MUCHAS
 * clínicas de una pasada (el admin, el cron) arma su propio mapa
 * clinicId → cobros pagados con `paidInvoiceCountByClinic` y evalúa con esta
 * función, sin N+1 y sin reescribir la regla.
 */
export function clinicQualifies(paidInvoices: number | null | undefined): boolean {
  return (Number(paidInvoices) || 0) >= MIN_PAID_INVOICES;
}
