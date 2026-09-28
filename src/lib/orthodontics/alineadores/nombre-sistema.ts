// Ortodoncia — alineadores: el campo «Sistema de alineadores» (ws1-t3, H25 de
// la QA en vivo del 28-sep-2026). Puro, sin React: lo prueban los tests en node.
//
// El fallo: el primer campo del formulario no tenía rótulo a la vista (solo un
// texto de ejemplo que desaparece al escribir), y justo debajo venía «Total de
// alineadores». Quien probaba escribió «24» creyendo que era el total, y así
// se guardó como nombre del sistema.
//
// El rótulo visible es el arreglo. Esto es la red de seguridad: si lo escrito
// es solo un número, se avisa ANTES de guardar. No bloquea — hay marcas con
// cifras («3M Clarity») y una clínica puede llamar a su sistema como quiera.

export const ROTULO_SISTEMA = "Sistema o marca de los alineadores";
export const EJEMPLO_SISTEMA = "Ej. Invisalign, Spark o marca propia";
export const PISTA_SISTEMA = "Opcional. Es el nombre del sistema, no una cantidad.";

/** Lo que se guarda: sin espacios sobrantes, y `null` si quedó vacío. */
export function limpiarNombreSistema(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").replace(/\s+/g, " ").trim();
  return limpio === "" ? null : limpio;
}

/**
 * El aviso que se pinta bajo el campo, o `null` si no hay nada que avisar.
 * Salta cuando lo escrito es SOLO una cantidad («24», «24 alineadores» no: eso
 * ya lleva letras y puede ser un nombre).
 */
export function avisoNombreSistema(valor: string | null | undefined): string | null {
  const limpio = limpiarNombreSistema(valor);
  if (limpio === null) return null;
  if (!/^\d+([.,]\d+)?$/.test(limpio)) return null;
  return `«${limpio}» parece una cantidad. Aquí va el nombre o la marca del sistema; el número de alineadores va en «Total de alineadores».`;
}
