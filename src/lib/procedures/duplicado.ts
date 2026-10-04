// C-116 (ws1-t8, auditoría de uso): el tarifario se llenaba de repetidos
// («Blanqueamiento» ×2, «Implante dental» ×2) porque nada avisaba al crear uno
// con el mismo nombre. Repetidos así confunden a recepción al facturar y hacen
// que la clave SAT y el IVA salgan del renglón equivocado (C-40). Aquí, puro,
// cómo se reconoce un repetido; la pantalla pregunta antes de guardar.

export interface ProcedimientoComparable {
  id: string;
  name: string;
  basePrice: number;
  isActive: boolean;
}

/** El nombre como se compara: sin acentos, sin mayúsculas y sin espacios de sobra. */
export function nombreComparable(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El procedimiento del catálogo que se llama igual (activo primero), o null.
 * `excluirId`: el que se está editando, que no cuenta como repetido de sí mismo.
 */
export function procedimientoRepetido<T extends ProcedimientoComparable>(
  nombre: string,
  catalogo: readonly T[],
  excluirId?: string | null,
): T | null {
  const buscado = nombreComparable(nombre);
  if (!buscado) return null;
  const iguales = catalogo.filter((p) => p.id !== excluirId && nombreComparable(p.name) === buscado);
  return iguales.find((p) => p.isActive) ?? iguales[0] ?? null;
}

/** La pregunta que se le hace a la persona antes de crear el repetido. */
export function textoRepetido(p: ProcedimientoComparable, precio: string, locale: string = "es"): { titulo: string; descripcion: string; confirmar: string } {
  if (locale.startsWith("en")) {
    return {
      titulo: `«${p.name}» already exists`,
      descripcion: `The price list already has «${p.name}» at ${precio}${p.isActive ? "" : " (inactive)"}. Two procedures with the same name get mixed up when invoicing. Save another one anyway?`,
      confirmar: "Save anyway",
    };
  }
  return {
    titulo: `Ya existe «${p.name}»`,
    descripcion: `El tarifario ya tiene «${p.name}» a ${precio}${p.isActive ? "" : " (inactivo)"}. Dos procedimientos con el mismo nombre se confunden al facturar. ¿Guardar otro igual de todos modos?`,
    confirmar: "Guardar de todos modos",
  };
}
