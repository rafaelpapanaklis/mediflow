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

/**
 * Gasto que alimenta GASTO y MARGEN de un procedimiento (ws1-t6, H18).
 *
 * El gasto MANUAL (`procedure.cost`) manda si existe — incluido 0, que es
 * «no gasta nada» y no «no lo sé». Solo cuando no hay manual se usa el costo
 * de la receta de materiales (Σ cantidad × costo unitario del insumo). Una
 * receta que suma 0 (insumos sin costo capturado) o que no existe no es un
 * dato: sigue sin gasto, y por tanto sin margen.
 */
export type GastoDeProcedimiento = { monto: number; origen: "manual" | "receta" } | null;

export function gastoDe(manual: number | null | undefined, receta: number | null | undefined): GastoDeProcedimiento {
  if (manual !== null && manual !== undefined) return { monto: manual, origen: "manual" };
  if (typeof receta === "number" && Number.isFinite(receta) && receta > 0) return { monto: receta, origen: "receta" };
  return null;
}
