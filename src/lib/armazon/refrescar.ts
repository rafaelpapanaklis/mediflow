/* ============================================================
   «ACABO DE CAMBIAR ESTO»: EL ARMAZÓN NO PUEDE ENSEÑAR LO DE ANTES.

   El menú (sidebar-counts) y la campanita de insights se sirven de una
   caché EN MEMORIA POR INSTANCIA (@/lib/route-cache). Invalidar en el
   servidor solo limpia la instancia que atendió la escritura: la
   siguiente lectura puede caer en otra que todavía guarda el número de
   antes. Para quien NO tocó nada eso es polling normal (lo ve un ciclo
   después). Para quien acaba de leer el último mensaje, ver «1» otra vez
   es exactamente lo que le hace dejar de fiarse del contador.

   Así que quien cambia algo lo apunta aquí, y durante la vida de la caché
   de esa pieza sus lecturas llevan `?fresco=1`: el servidor se salta la
   entrada vigente, consulta y deja el valor nuevo para los demás.

   Va en localStorage (y no en memoria) para que valga también tras
   recargar la página y en las otras pestañas del mismo navegador. Es una
   comodidad por navegador: si el almacenamiento falla o está bloqueado,
   simplemente no se pide fresco y se ve el cambio un TTL después.
   ============================================================ */

export type PiezaArmazon = "contadores" | "insights";

/** Lo que vive cada pieza en la caché del servidor: pasado eso, fresco no hace falta. */
const VENTANA_MS: Record<PiezaArmazon, number> = {
  contadores: 30_000, // CACHE_TTL_MS de /api/dashboard/sidebar-counts
  insights: 2 * 60_000, // CACHE_TTL_MS de /api/notifications/insights
};

export const EVENTO_ARMAZON = "armazon:cambio";
const PREFIJO = "armazon:fresco:";

/** Apunta que ESTE navegador acaba de cambiar la pieza y avisa a quien la pinta. */
export function avisarCambioArmazon(pieza: PiezaArmazon): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIJO + pieza, String(Date.now()));
  } catch {
    /* sin almacenamiento: el aviso de abajo basta para esta pestaña */
  }
  window.dispatchEvent(new CustomEvent<PiezaArmazon>(EVENTO_ARMAZON, { detail: pieza }));
}

/** `url` con `fresco=1` si este navegador cambió la pieza dentro de su ventana. */
export function conFresco(url: string, pieza: PiezaArmazon, ahora: number = Date.now()): string {
  let marca = 0;
  try {
    marca = Number(window.localStorage.getItem(PREFIJO + pieza)) || 0;
  } catch {
    return url;
  }
  if (!marca || ahora - marca >= VENTANA_MS[pieza] || ahora < marca) return url;
  return url + (url.includes("?") ? "&" : "?") + "fresco=1";
}

/**
 * Llama a `alCambiar` cuando la pieza cambia en esta pestaña (evento) o en
 * otra del mismo navegador (`storage`). Devuelve la función para soltarse.
 */
export function escucharCambioArmazon(pieza: PiezaArmazon, alCambiar: () => void): () => void {
  const enEstaPestana = (e: Event) => {
    if ((e as CustomEvent<PiezaArmazon>).detail === pieza) alCambiar();
  };
  const enOtraPestana = (e: StorageEvent) => {
    if (e.key === PREFIJO + pieza) alCambiar();
  };
  window.addEventListener(EVENTO_ARMAZON, enEstaPestana);
  window.addEventListener("storage", enOtraPestana);
  return () => {
    window.removeEventListener(EVENTO_ARMAZON, enEstaPestana);
    window.removeEventListener("storage", enOtraPestana);
  };
}
