// Lo que la lista de plantillas decide SIN pintar: el orden y qué fechas enseña
// cada tarjeta. Sin React a propósito, para que lo prueben los tests en node
// (src/app/dashboard/plantillas/__tests__/plantillas-pulido.test.ts).

export interface PlantillaOrdenable {
  name: string;
  isActive: boolean;
  /** Sembrada por DaleControl (sin autor), no escrita por alguien de la clínica. */
  precargada: boolean;
}

/**
 * Una plantilla sembrada nace sin autor (`ensureConsentTemplates` no pone
 * `createdById`); la que escribe alguien de la clínica siempre lo lleva
 * (`createTemplate`). No hay otra columna que lo diga, y no hace falta.
 */
export function esPrecargada(createdById: string | null | undefined): boolean {
  return !createdById;
}

/**
 * El orden de la lista: lo que está EN USO arriba; dentro de eso, las que
 * escribió la clínica antes que las precargadas (es la suya la que viene a
 * buscar); y al final por nombre.
 */
export function ordenarPlantillas<T extends PlantillaOrdenable>(plantillas: readonly T[], locale: string): T[] {
  return [...plantillas].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      Number(a.precargada) - Number(b.precargada) ||
      a.name.localeCompare(b.name, locale),
  );
}

/** Menos de un minuto entre crear y guardar no es «la editaron»: es el mismo guardado. */
const MARGEN_MISMA_ESCRITURA_MS = 60_000;

/** ¿Alguien la tocó después de crearla? Si no, la tarjeta enseña una sola fecha. */
export function fueEditada(createdAt: string, updatedAt: string): boolean {
  const creada = Date.parse(createdAt);
  const actualizada = Date.parse(updatedAt);
  if (Number.isNaN(creada) || Number.isNaN(actualizada)) return false;
  return actualizada - creada > MARGEN_MISMA_ESCRITURA_MS;
}
