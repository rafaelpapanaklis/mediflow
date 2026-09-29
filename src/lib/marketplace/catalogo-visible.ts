// Qué se ofrece hoy en el Marketplace del panel dental (ws1-t6, H21/H22/H23).
// Decisión de Rafael: solo se vende Ortodoncia, que tiene su propia compra
// (Stripe por módulo, /api/marketplace/module-checkout). El resto de módulos
// NO se borra: solo se esconde hasta que tenga una compra que funcione.
// Para ofrecer otro módulo, se añade su key aquí cuando su compra esté lista.
// Archivo puro (sin Prisma) para que la prueba lo importe.

export const MODULOS_CON_COMPRA: readonly string[] = ["orthodontics"];

/** Pestañas de categoría que se muestran. Las demás especialidades no se ofrecen. */
export const TABS_VISIBLES = ["Todos", "Dental"] as const;

export function moduloSeOfrece(key: string): boolean {
  return MODULOS_CON_COMPRA.includes(key);
}

export function soloModulosConCompra<T extends { key: string }>(modulos: T[]): T[] {
  return modulos.filter((m) => moduloSeOfrece(m.key));
}
