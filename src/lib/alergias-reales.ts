// H18 (revisión final): «N/A», «Ninguna», «Niega»… se capturan en el campo de
// alergias para decir que NO hay, y la cabecera los pintaba como alergia real
// (chip rojo «Alergia: N/A»). Este filtro deja solo lo que es una alergia.
// PURO: lo usan la cabecera de la ficha y la de Ortodoncia.

const SIN_ALERGIA = new Set([
  "n/a", "na", "n.a.", "n/d", "nd", "no", "ninguna", "ninguno", "niega", "negadas", "niega alergias",
  "sin alergias", "ninguna conocida", "no refiere", "no aplica", "sin dato", "-", "--", "—", ".",
]);

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** ¿Este texto dice «no hay alergia» (o está vacío)? */
export function esSinAlergia(valor: unknown): boolean {
  if (typeof valor !== "string") return true;
  const n = normalizar(valor);
  return n === "" || SIN_ALERGIA.has(n);
}

/** Las alergias que sí lo son; el resto (vacíos, «N/A», «Ninguna»…) se descarta. */
export function alergiasReales(lista: unknown): string[] {
  return (Array.isArray(lista) ? lista : []).filter((a): a is string => !esSinAlergia(a)).map((a) => (a as string).trim());
}
