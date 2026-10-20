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

// ── ¿El texto del plan pudo redondear sus precios? (revisión t8, N-P2 y N-P5) ──
//
// Antes de `dineroExacto`, la ventana escribía los precios con `formatCurrency`: $500.50 quedaba «$501».
// Un plan nuevo con precios enteros («$450») y uno viejo redondeado («$450» por $449.60) escriben EL
// MISMO texto, así que el texto solo no basta: manda la fecha de creación. El texto lo escribe la
// ventana al crear el plan (editarlo después no lo reescribe), así que un plan creado desde
// `FECHA_DINERO_EXACTO` trae sus precios exactos. Un texto con centavos es nuevo sin duda.
//
// ⚠️ DECISIÓN PARA RAFAEL: esta fecha tiene que ser la del DESPLIEGUE de este cambio. Si se despliega
// después, los planes creados entre esta fecha y el despliegue (con la ventana vieja) se tratan como
// exactos: un redondeo suyo saldría como «Descuento»/«Ajuste». Si se despliega antes, nada se rompe:
// solo esos días cuentan como viejos.

/** Desde cuándo la ventana del plan escribe los precios con centavos. */
export const FECHA_DINERO_EXACTO = new Date("2026-10-21T00:00:00-06:00");

/** «$1,250.50» en algún monto del texto: lo escribió `dineroExacto` (un redondeo viejo nunca trae centavos). */
export function textoConCentavos(texto: string | null | undefined): boolean {
  return !!texto && /\$\s?[\d,]*\d\.\d{2}(?!\d)/.test(texto);
}

/**
 * ¿Los precios del texto pudieron quedar redondeados a pesos? Solo un plan creado antes de
 * `FECHA_DINERO_EXACTO` y sin un solo centavo en su texto. Sin fecha (no debería pasar) se supone
 * viejo, que es lo que nunca inventa un descuento.
 */
export function textoPuedeEstarRedondeado(plan: { createdAt?: Date | string | null; description: string | null | undefined }): boolean {
  if (textoConCentavos(plan.description)) return false;
  if (plan.createdAt == null) return true;
  const creado = new Date(plan.createdAt);
  return Number.isNaN(creado.getTime()) || creado.getTime() < FECHA_DINERO_EXACTO.getTime();
}
