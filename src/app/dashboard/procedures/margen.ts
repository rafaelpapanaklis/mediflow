/**
 * Margen de un procedimiento: precio − gasto, y SOLO cuando hay gasto puesto.
 *
 * Sin gasto (`null`) no hay margen: ni 0 ni el precio. «No gasta nada»
 * (gasto 0 → margen = precio) y «no lo hemos medido» (null → sin margen) no
 * son lo mismo, y pintar el precio como margen sería inventarse un dato.
 */
export function margenDe(basePrice: number, cost: number | null | undefined): number | null {
  if (cost === null || cost === undefined) return null;
  return basePrice - cost;
}
