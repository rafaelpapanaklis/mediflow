/**
 * POLÍTICA DE LA CACHÉ DE NAVEGACIÓN — qué pantallas pueden volver a pintarse
 * al instante durante más de 30 s, y cuáles NO.
 *
 * El problema: Next 14 guarda cada pantalla visitada 30 s (`staleTimes.dynamic`)
 * y ese plazo es GLOBAL y de build: subirlo en `next.config.mjs` haría que la
 * Agenda y Caja también sirvieran datos viejos. Aquí no se toca. Lo que sí trae
 * Next por entrada es el TIPO de prefetch: una entrada pedida como «full» se
 * reutiliza entera hasta 5 min (`staleTimes.static`), y las demás siguen en 30 s.
 * Eso da plazos distintos POR RUTA sin tocar la configuración.
 *
 * 🔴 La lista es CERRADA y corta a propósito. Agenda, Caja, Facturación,
 * Pacientes y todo lo que no esté aquí se queda EXACTAMENTE como hoy (30 s).
 * Añadir una ruta es una decisión de producto («¿puede verse un dato de hace
 * unos minutos?»), no un ajuste de rendimiento.
 */

export interface ReglaRuta {
  /**
   * Al volver desde la foto guardada, ¿se piden datos nuevos por detrás?
   * La pantalla se pinta al instante con la foto y se actualiza sola en cuanto
   * responde el servidor (sin esqueleto, sin parpadeo). Con esto la pantalla
   * nunca se queda con un dato más viejo de lo que ya permite Next hoy (30 s)
   * más lo que tarde esa respuesta.
   */
  revalidarAlVolver: boolean;
}

export const RUTAS_TOLERANTES: Readonly<Record<string, ReglaRuta>> = {
  // Hoy lleva la lista de citas del día y el check-in: se pinta al instante,
  // pero SIEMPRE se refresca por detrás. Si alguien movió una cita, aparece
  // movida en cuanto llega la respuesta.
  "/dashboard": { revalidarAlVolver: true },
  // Analítica son agregados del mes: un dato de hace unos minutos no cambia
  // ninguna decisión. No se refresca por detrás: cero peticiones al volver.
  "/dashboard/analytics": { revalidarAlVolver: false },
};

/** Lo que Next ya da hoy a toda pantalla dinámica (`staleTimes.dynamic`). */
export const PLAZO_NEXT_MS = 30_000;
/** Lo que vive una entrada «full» en Next 14.2 (`staleTimes.static`). */
export const VIDA_FOTO_MS = 300_000;
/**
 * La foto se pide un momento DESPUÉS de salir, para que la pantalla a la que
 * vas (la Agenda, casi siempre) llegue primero al servidor y a la base.
 */
export const RETRASO_FOTO_MS = 2_000;

export function reglaDe(pathname: string | null | undefined): ReglaRuta | null {
  if (!pathname) return null;
  return Object.prototype.hasOwnProperty.call(RUTAS_TOLERANTES, pathname)
    ? RUTAS_TOLERANTES[pathname]
    : null;
}

/** ¿Sigue viva en Next la foto que pedimos en `fotoEn`? */
export function fotoVigente(fotoEn: number | undefined, ahora: number): boolean {
  return fotoEn !== undefined && ahora - fotoEn < VIDA_FOTO_MS;
}

/**
 * Al LLEGAR a una ruta: ¿hay que refrescar por detrás?
 * Solo si la ruta lo pide, si se llegó a la URL limpia (la foto es de la URL
 * sin parámetros: con `?period=` Next hizo su petición normal) y si la foto
 * tiene más de los 30 s que Next ya daba por buenos.
 */
export function debeRevalidar(
  pathname: string,
  search: string,
  fotoEn: number | undefined,
  ahora: number,
): boolean {
  const regla = reglaDe(pathname);
  if (!regla || !regla.revalidarAlVolver) return false;
  if (search !== "" && search !== "?") return false;
  if (!fotoVigente(fotoEn, ahora)) return false; // expiró: Next ya pidió datos nuevos
  return ahora - (fotoEn as number) >= PLAZO_NEXT_MS;
}
