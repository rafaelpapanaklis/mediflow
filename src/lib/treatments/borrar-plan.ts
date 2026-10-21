// Borrar un plan de tratamiento que ya tiene nota de cobro (ws1-t12 · fase 2, decisión 9 de la
// fase 1, que Rafael pidió HACER): no se puede. La nota (y sus abonos, su CFDI, su corte de Caja) se
// quedaría sin el plan del que nace y el saldo del paciente dejaría de explicarse. Se ofrece
// CANCELARLO (estado «Abandonado»): sale de los planes activos y la nota queda como está.
//
// Este archivo es PURO: lo importan la ficha (para reconocer la respuesta) y la ruta DELETE.

/** `code` del 409 de DELETE /api/treatments/[id] cuando el plan tiene nota de cobro. */
export const CODIGO_PLAN_CON_NOTA = "plan_con_nota";

export function cuerpoPlanConNota(folios: string[]) {
  const lista = folios.filter(Boolean);
  return {
    code: CODIGO_PLAN_CON_NOTA,
    error:
      `Este plan ya tiene nota de cobro${lista.length ? ` (${lista.join(", ")})` : ""} y no se puede borrar: ` +
      "la nota y sus pagos se quedarían sin plan. Puedes cancelarlo (deja de estar activo y la nota no cambia).",
    notas: lista,
  };
}
