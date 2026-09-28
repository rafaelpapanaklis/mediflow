/**
 * WS1-T4 ronda 6 · G1/G2 — la categoría de una clínica DENTAL es fija.
 *
 * El panel (`/dashboard`) es la vertical dental. Cambiar `Clinic.category`
 * desde Configuración sacaba Ortodoncia del menú y encendía módulos de otros
 * giros (Ejercicios, Ortesis, Fórmulas, Paquetes). Decisión del gerente: una
 * clínica dental se queda dental; las clínicas viejas de otra categoría
 * siguen pudiendo cambiarla como hasta ahora.
 *
 * Archivo PURO (sin Prisma, sin sesión): lo usan las rutas `/api/clinic`
 * (guardar) y `/api/clinics` (crear sucursal), y las pantallas para decidir
 * si pintan el selector. La categoría «actual» la pasa SIEMPRE el servidor
 * leyéndola de la base/sesión — nunca sale del cliente.
 */

/** La única categoría que queda fija. */
export const CATEGORIA_FIJA = "DENTAL";

/** ¿Esta clínica tiene la categoría fija (es dental)? */
export function esCategoriaFija(categoriaActual: string | null | undefined): boolean {
  return categoriaActual === CATEGORIA_FIJA;
}

/**
 * Qué categoría se escribe al GUARDAR los datos de la clínica.
 *
 *   · sin `category` en el payload            → `undefined` (no se toca)
 *   · la clínica es DENTAL, pida lo que pida  → "DENTAL"
 *   · cualquier otra categoría                → lo que pidió (como siempre)
 *
 * No lanza: un valor raro en una clínica dental se ignora y se guarda el resto.
 */
export function categoriaAlGuardar(
  categoriaActual: string | null | undefined,
  categoriaPedida: unknown,
): unknown {
  if (categoriaPedida === undefined) return undefined;
  if (esCategoriaFija(categoriaActual)) return CATEGORIA_FIJA;
  return categoriaPedida;
}

/**
 * Con qué categoría nace una SUCURSAL: si la clínica madre es dental, dental;
 * si no, la que eligió el dueño en el diálogo.
 */
export function categoriaDeSucursal(
  categoriaMadre: string | null | undefined,
  categoriaPedida: string,
): string {
  return esCategoriaFija(categoriaMadre) ? CATEGORIA_FIJA : categoriaPedida;
}
