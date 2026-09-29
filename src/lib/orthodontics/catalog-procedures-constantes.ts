// Constantes del catálogo de ortodoncia, SIN Prisma: las pueden importar los
// componentes de cliente (Procedimientos, Configuración) sin arrastrar el
// servidor. `catalog-procedures.ts` las re-exporta con los mismos nombres.

/** `procedure_catalog.category` de todo lo que es de ortodoncia. */
export const ORTHO_CATALOG_CATEGORY = "orthodontics";

/** Llave interna (`procedure_catalog.code`) de la fila del control de ortodoncia. */
export const CODIGO_CONTROL_ORTO = "ORTO_CONTROL";
