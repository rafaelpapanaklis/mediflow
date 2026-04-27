/**
 * Punto de entrada del catálogo de elementos del editor isométrico.
 *
 * Esta primera iteración cubre solo categoría DENTAL. Las otras 17
 * categorías de clínica (AESTHETIC_MEDICINE, HAIR_SALON, PHYSIOTHERAPY,
 * etc.) se agregarán como módulos hermanos `elements-aesthetic.ts`,
 * `elements-hair-salon.ts`, etc., que el selector escogerá.
 */

import { DENTAL_ELEMENT_TYPES } from "./elements-dental";
import type { CategoryGroup, ElementType } from "./element-types";

/** Etiquetas de los grupos del sidebar. */
const CATEGORY_GROUP_LABELS: Record<CategoryGroup["id"], string> = {
  estructura: "Estructura",
  dental: "Equipo Dental",
  recepcion: "Recepción",
  mobiliario: "Mobiliario",
  bano: "Baño",
};

/** Mapa key → ElementType para resolver tipos al renderizar. */
export function buildElementTypeMap(types: ElementType[]): Map<string, ElementType> {
  const m = new Map<string, ElementType>();
  for (const t of types) m.set(t.key, t);
  return m;
}

/** Agrupa una lista plana de tipos por su `category` en el orden definido. */
export function groupByCategory(types: ElementType[]): CategoryGroup[] {
  const order: CategoryGroup["id"][] = ["estructura", "dental", "recepcion", "mobiliario", "bano"];
  return order
    .map((id) => ({
      id,
      label: CATEGORY_GROUP_LABELS[id],
      types: types.filter((t) => t.category === id),
    }))
    .filter((g) => g.types.length > 0);
}

/**
 * Devuelve el catálogo de elementos disponible para una categoría de clínica.
 * Por ahora todas las categorías reciben el set DENTAL (cuando no hay un set
 * dedicado, mostramos el universal de DENTAL — paredes, recepción, baño, etc.
 * — para no dejar vacío el editor).
 *
 * Cuando se implementen categorías específicas, este switch ramifica.
 */
export function getElementTypesForClinic(clinicCategory: string): ElementType[] {
  switch (clinicCategory) {
    case "DENTAL":
      return DENTAL_ELEMENT_TYPES;
    default:
      // Fallback: usar set DENTAL hasta que se agreguen catálogos específicos.
      return DENTAL_ELEMENT_TYPES;
  }
}

/** Conveniente: obtiene el catálogo + agrupado para el sidebar. */
export function getCatalogForClinic(clinicCategory: string): {
  flat: ElementType[];
  grouped: CategoryGroup[];
  byKey: Map<string, ElementType>;
} {
  const flat = getElementTypesForClinic(clinicCategory);
  return {
    flat,
    grouped: groupByCategory(flat),
    byKey: buildElementTypeMap(flat),
  };
}

export type { ElementType, CategoryGroup, LayoutElement, LayoutMetadata, Rotation, ChairStatus, LiveAppointment } from "./element-types";
export { STATUS_COLORS, STATUS_LABELS } from "./element-types";
export { DENTAL_ELEMENT_TYPES } from "./elements-dental";
