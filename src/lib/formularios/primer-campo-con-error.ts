// «Al fallar, llevar la vista y el foco al primer campo con error» (ws1-t1, auditoría BEVADENT, F8).
//
// «Nuevo paciente» y «Nueva cita» pintaban el borde rojo y un aviso arriba («Completa los campos
// obligatorios»), pero no movían nada: con la ventana desplazada hasta abajo, el campo que faltaba quedaba
// fuera de la vista y recepción no sabía cuál era. Ahora cada campo lleva `data-campo="<nombre>"` y, al
// fallar, se desplaza hasta el PRIMERO en el orden de la pantalla y se le pone el foco.

/** Atributo que marca la envoltura de cada campo. */
export const ATRIBUTO_CAMPO = "data-campo";

/** El primer nombre de `orden` (el orden en pantalla) que tiene error. */
export function primerCampoConError(
  orden: readonly string[],
  errores: Readonly<Record<string, unknown>>,
): string | null {
  for (const campo of orden) if (errores[campo]) return campo;
  return null;
}

const ENFOCABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Desplaza hasta el primer campo con error que esté en pantalla y le pone el foco. Los campos que no se pintan
 * (p. ej. la rejilla de horas sin doctor) se saltan. Devuelve el campo al que llevó, o null.
 */
export function llevarAlPrimerError(
  raiz: ParentNode | null | undefined,
  orden: readonly string[],
  errores: Readonly<Record<string, unknown>>,
): string | null {
  if (!raiz) return null;
  for (const campo of orden) {
    if (!errores[campo]) continue;
    const envoltura = raiz.querySelector<HTMLElement>(`[${ATRIBUTO_CAMPO}="${campo}"]`);
    if (!envoltura) continue;
    const objetivo = envoltura.matches(ENFOCABLE) ? envoltura : envoltura.querySelector<HTMLElement>(ENFOCABLE);
    envoltura.scrollIntoView?.({ block: "center", behavior: "smooth" });
    // `preventScroll`: el desplazamiento ya lo hace `scrollIntoView` (centrado); el del foco lo cortaría en seco.
    objetivo?.focus?.({ preventScroll: true });
    return campo;
  }
  return null;
}
