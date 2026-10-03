// Crear un plan de tratamiento en $0 pide confirmarlo (ws1-t2, F15 de la auditoría BEVADENT:
// «el plan se puede crear en $0 sin aviso» cuando el nombre no coincide con el tarifario).
//
// La regla vive aquí para que la pantalla («Nuevo plan de tratamiento» de la ficha y la página
// /dashboard/treatments) y POST /api/treatments digan lo mismo. El servidor contesta 409
// PLAN_SIN_COSTO si el costo es $0 y no viene `confirmarSinCosto: true`; la pantalla pregunta
// antes de mandar. Un plan en $0 se puede crear (una revisión de cortesía, una garantía…): solo
// que no se cuele por un nombre mal escrito. PURO.

export const CODIGO_PLAN_SIN_COSTO = "PLAN_SIN_COSTO";

/** ¿El plan va en $0? (costo vacío, no numérico o ≤ 0). */
export function planSinCosto(totalCost: unknown): boolean {
  const n = Number(totalCost);
  return !(Number.isFinite(n) && n > 0);
}

/** ¿Hay que frenar este POST hasta que confirmen? */
export function faltaConfirmarSinCosto(body: { totalCost?: unknown; confirmarSinCosto?: unknown } | null | undefined): boolean {
  return planSinCosto(body?.totalCost) && body?.confirmarSinCosto !== true;
}
