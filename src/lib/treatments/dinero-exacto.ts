// Dinero «tal cual» del plan de tratamiento (ws1-t12, revisión P2; decisión de Rafael, 20-oct-2026).
//
// `formatCurrency` (lib/utils) redondea a pesos: un procedimiento de $500.50 se escribía «$501» en el
// texto del plan y salía así en el PDF, con un «Descuento» que nadie dio. Aquí los centavos se
// enseñan SOLO cuando el monto los tiene: $1,250.50 → «$1,250.50»; $1,250 → «$1,250» (sin «.00»).
// Puro: lo usan la ventana del plan (para escribir el texto) y el PDF.

export function dineroExacto(n: number): string {
  const v = Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : 0;
  const conCentavos = Math.round(Math.abs(v) * 100) % 100 !== 0;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: conCentavos ? 2 : 0,
    maximumFractionDigits: conCentavos ? 2 : 0,
  }).format(v);
}
